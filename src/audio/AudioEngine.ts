import type { EffectId } from '../story/story';

export interface AudioSettings { music: number; effects: number; muted: boolean }
export const DEFAULT_AUDIO: AudioSettings = { music: 0.6, effects: 0.8, muted: false };

const KEY = 'storyrower.audio';
export function loadAudioSettings(): AudioSettings {
  try { return { ...DEFAULT_AUDIO, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return { ...DEFAULT_AUDIO }; }
}
export function saveAudioSettings(s: AudioSettings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
}

const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);

// A minor: Am – F – C – G, one chord per bar
const CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
const BPM = 84;
const BEAT = 60 / BPM;

/**
 * Procedural placeholder soundtrack and effects (no audio files, no licences).
 * Music is made of layers that the story intensity fades in and out:
 *   idyll  – soft bell arpeggio      (calm start, fades out as things heat up)
 *   pad    – warm chords              (always)
 *   pulse  – kick, hats, snare        (from the build-up on)
 *   threat – low wobbling drone       (eruption, wave chase, and whenever the wave is close)
 * Must be created inside a user gesture (browser autoplay rules).
 */
export class AudioEngine {
  readonly ctx: AudioContext;
  private master: GainNode;
  private musicBus: GainNode;
  private sfxBus: GainNode;
  private layers: Record<'idyll' | 'pad' | 'pulse' | 'threat', GainNode>;
  private noise: AudioBuffer;
  private water: { gain: GainNode; filter: BiquadFilterNode };
  private rumble: GainNode;
  private nextBeat = 0;
  private beatIndex = 0;
  private birdTimer = 1;
  private settings: AudioSettings;
  private intensity = 0;
  private danger = 0;
  private birds = 0;

  constructor(settings: AudioSettings = loadAudioSettings()) {
    this.ctx = new AudioContext();
    this.settings = settings;
    const c = this.ctx;
    this.master = c.createGain();
    const comp = c.createDynamicsCompressor();
    this.master.connect(comp).connect(c.destination);
    this.musicBus = c.createGain();
    this.sfxBus = c.createGain();
    this.musicBus.connect(this.master);
    this.sfxBus.connect(this.master);
    this.layers = { idyll: c.createGain(), pad: c.createGain(), pulse: c.createGain(), threat: c.createGain() };
    for (const g of Object.values(this.layers)) { g.gain.value = 0; g.connect(this.musicBus); }

    // 2 s of white noise, reused for everything noisy
    this.noise = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // Ambience: water hiss (louder with speed) and volcanic rumble
    const waterSrc = this.loopNoise();
    const wf = c.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 700; wf.Q.value = 0.6;
    const wg = c.createGain(); wg.gain.value = 0;
    waterSrc.connect(wf).connect(wg).connect(this.sfxBus);
    this.water = { gain: wg, filter: wf };
    const rumbleSrc = this.loopNoise();
    const rf = c.createBiquadFilter(); rf.type = 'lowpass'; rf.frequency.value = 110;
    this.rumble = c.createGain(); this.rumble.gain.value = 0;
    rumbleSrc.connect(rf).connect(this.rumble).connect(this.sfxBus);

    this.buildThreatDrone();
    this.applySettings();
    this.nextBeat = c.currentTime + 0.1;
  }

  // ---------- control ----------

  setSettings(s: AudioSettings) { this.settings = s; saveAudioSettings(s); this.applySettings(); }
  get currentSettings() { return { ...this.settings }; }
  toggleMute() { this.setSettings({ ...this.settings, muted: !this.settings.muted }); return this.settings.muted; }

  private applySettings() {
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.settings.muted ? 0 : 1, t, 0.05);
    this.musicBus.gain.setTargetAtTime(this.settings.music * 0.55, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(this.settings.effects, t, 0.05);
  }

  resume() { return this.ctx.resume(); }

  dispose() { this.ctx.close().catch(() => {}); }

  /**
   * Call every frame.
   * @param intensity story/workout intensity 0–1
   * @param danger 0–1 how close the wave is (only matters while it is shown)
   */
  update(p: { dt: number; intensity: number; danger: number; speed: number; smoke: number; birds: number; active: boolean }) {
    const c = this.ctx;
    const now = c.currentTime;
    this.intensity = p.intensity;
    this.danger = p.danger;
    this.birds = p.birds;
    const i = p.intensity;
    const quiet = p.active ? 1 : 0.5; // music steps back while paused
    this.layers.idyll.gain.setTargetAtTime((1 - smooth(0.25, 0.55, i)) * 0.7 * quiet, now, 1.5);
    this.layers.pad.gain.setTargetAtTime((0.55 + 0.2 * i) * quiet, now, 1.5);
    this.layers.pulse.gain.setTargetAtTime(smooth(0.2, 0.45, i) * 0.9 * (p.active ? 1 : 0), now, 1);
    this.layers.threat.gain.setTargetAtTime(Math.max(smooth(0.6, 0.9, i), p.danger) * 0.6 * quiet, now, 1);
    this.water.gain.gain.setTargetAtTime(0.04 + Math.min(0.12, p.speed * 0.012), now, 0.5);
    this.water.filter.frequency.setTargetAtTime(500 + p.speed * 60, now, 0.5);
    this.rumble.gain.setTargetAtTime(p.smoke * 0.35, now, 1);

    // schedule music slightly ahead of time
    while (this.nextBeat < now + 0.25) {
      this.scheduleBeat(this.nextBeat, this.beatIndex);
      this.nextBeat += BEAT / 2; // eighth notes
      this.beatIndex++;
    }
    // puffin chirps
    if (this.birds > 0) {
      this.birdTimer -= p.dt;
      if (this.birdTimer <= 0) { this.birdTimer = 0.6 + Math.random() * 2.5; this.chirp(); }
    }
  }

  // ---------- music ----------

  private scheduleBeat(t: number, n: number) {
    const eighth = n % 8;               // position in the bar
    const bar = Math.floor(n / 8);
    const chord = CHORDS[bar % CHORDS.length];

    if (eighth === 0) this.padChord(t, chord, BEAT * 4);
    // idyll bells: rising arpeggio on every eighth
    const arp = [0, 1, 2, 1, 0, 1, 2, 3];
    this.bell(t, midi(chord[arp[eighth] % 3] + 12 + (arp[eighth] === 3 ? 12 : 0)), this.layers.idyll, 0.12);
    // pulse: kick on 1 and 3, snare on 2 and 4 (only when it gets hot), hats on eighths
    if (eighth % 4 === 0) this.kick(t);
    if (this.intensity > 0.55 && eighth % 4 === 2) this.snare(t);
    this.hat(t, eighth % 2 === 0 ? 0.25 : 0.14);
    // threat: bass root on every beat, pushing
    if (eighth % 2 === 0) this.bass(t, midi(chord[0] - 24), BEAT * 0.9);
  }

  private padChord(t: number, chord: number[], dur: number) {
    const c = this.ctx;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900 + this.intensity * 1200;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.8);
    g.gain.setTargetAtTime(0, t + dur - 0.4, 0.4);
    f.connect(g).connect(this.layers.pad);
    for (const note of chord) for (const det of [-6, 6]) {
      const o = c.createOscillator();
      o.type = 'triangle';
      o.frequency.value = midi(note);
      o.detune.value = det;
      o.connect(f);
      o.start(t); o.stop(t + dur + 1.5);
    }
  }

  private bell(t: number, freq: number, out: AudioNode, vol: number) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
    o.connect(g).connect(out);
    o.start(t); o.stop(t + 1);
  }

  private kick(t: number) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.18);
    const g = c.createGain();
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o.connect(g).connect(this.layers.pulse);
    o.start(t); o.stop(t + 0.4);
  }

  private snare(t: number) {
    const src = this.noiseSource(t, 0.2);
    const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1800;
    const g = this.envelope(t, 0.35, 0.18);
    src.connect(f).connect(g).connect(this.layers.pulse);
  }

  private hat(t: number, vol: number) {
    const src = this.noiseSource(t, 0.06);
    const f = this.ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 7000;
    const g = this.envelope(t, vol * (0.4 + this.intensity * 0.6), 0.05);
    src.connect(f).connect(g).connect(this.layers.pulse);
  }

  private bass(t: number, freq: number, dur: number) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = freq;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 260 + this.danger * 500;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(f).connect(g).connect(this.layers.threat);
    o.start(t); o.stop(t + dur + 0.05);
  }

  private buildThreatDrone() {
    const c = this.ctx;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 300; f.Q.value = 6;
    const lfo = c.createOscillator(); lfo.frequency.value = 0.35;
    const lfoGain = c.createGain(); lfoGain.gain.value = 180;
    lfo.connect(lfoGain).connect(f.frequency);
    const g = c.createGain(); g.gain.value = 0.18;
    for (const [freq, type] of [[55, 'sawtooth'], [82.4, 'sawtooth'], [54.6, 'square']] as const) {
      const o = c.createOscillator(); o.type = type; o.frequency.value = freq;
      o.connect(f);
      o.start();
    }
    f.connect(g).connect(this.layers.threat);
    lfo.start();
  }

  // ---------- effects ----------

  /** Splash for every real stroke. */
  stroke() {
    const t = this.ctx.currentTime;
    const src = this.noiseSource(t, 0.4);
    const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 900 + Math.random() * 500; f.Q.value = 0.8;
    const g = this.envelope(t, 0.35, 0.3, 0.04);
    src.connect(f).connect(g).connect(this.sfxBus);
  }

  /** Two-note ping when the targets change. */
  targetChange() {
    const t = this.ctx.currentTime;
    this.bell(t, midi(81), this.sfxBus, 0.18);
    this.bell(t + 0.12, midi(88), this.sfxBus, 0.18);
  }

  bombLanded(distance: number) {
    const t = this.ctx.currentTime;
    const vol = Math.max(0.15, 1 - distance / 70);
    const src = this.noiseSource(t, 1.2);
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
    src.connect(f).connect(this.envelope(t, 0.7 * vol, 0.9, 0.01)).connect(this.sfxBus);
    this.thump(t, 70, 0.6 * vol, 0.5);
  }

  effect(id: EffectId) {
    const c = this.ctx;
    const t = c.currentTime;
    switch (id) {
      case 'tremor': {
        const src = this.noiseSource(t, 4);
        const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 90;
        const g = c.createGain();
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1.4, t + 0.8); g.gain.linearRampToValueAtTime(0, t + 3.8);
        src.connect(f).connect(g).connect(this.sfxBus);
        this.thump(t + 0.2, 38, 0.6, 3);
        break;
      }
      case 'eruption': {
        this.thump(t, 140, 1.2, 2.2, 28);
        const src = this.noiseSource(t, 4);
        const f = c.createBiquadFilter(); f.type = 'lowpass';
        f.frequency.setValueAtTime(3000, t); f.frequency.exponentialRampToValueAtTime(150, t + 3.5);
        src.connect(f).connect(this.envelope(t, 1.1, 3.5, 0.01)).connect(this.sfxBus);
        break;
      }
      case 'wave': {
        const src = this.noiseSource(t, 6);
        const f = c.createBiquadFilter(); f.type = 'lowpass';
        f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(2200, t + 3);
        const g = c.createGain();
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.9, t + 2.5); g.gain.linearRampToValueAtTime(0, t + 6);
        src.connect(f).connect(g).connect(this.sfxBus);
        break;
      }
      case 'escape':
        [69, 73, 76, 81].forEach((n, k) => this.bell(t + k * 0.16, midi(n + 12), this.sfxBus, 0.22));
        break;
      case 'sunset':
        [64, 69, 73].forEach((n, k) => this.bell(t + k * 0.4, midi(n + 12), this.sfxBus, 0.12));
        break;
      case 'birds':
        for (let k = 0; k < 4; k++) setTimeout(() => this.chirp(), k * 220);
        break;
      case 'ash':
      case 'calm':
        break;
    }
  }

  private chirp() {
    const c = this.ctx;
    const t = c.currentTime;
    const o = c.createOscillator(); o.type = 'sine';
    const f0 = 2200 + Math.random() * 1500;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * (Math.random() < 0.5 ? 1.5 : 0.7), t + 0.09);
    const g = c.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.06, t + 0.01); g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.connect(g).connect(this.sfxBus);
    o.start(t); o.stop(t + 0.15);
  }

  private thump(t: number, from: number, vol: number, dur: number, to = 35) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(to, t + dur * 0.8);
    const g = c.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.sfxBus);
    o.start(t); o.stop(t + dur + 0.05);
  }

  // ---------- helpers ----------

  private loopNoise() {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise; s.loop = true; s.start();
    return s;
  }

  private noiseSource(t: number, dur: number) {
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    s.loop = dur > 2;
    s.start(t, Math.random() * 1.5);
    s.stop(t + dur);
    return s;
  }

  private envelope(t: number, vol: number, decay: number, attack = 0.002) {
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.001, t + attack + decay);
    return g;
  }
}
