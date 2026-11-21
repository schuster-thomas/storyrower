import type { EffectId } from '../story/story';
import { SampleBank } from './SampleBank';

export interface AudioSettings { effects: number; muted: boolean }
export const DEFAULT_AUDIO: AudioSettings = { effects: 0.8, muted: false };

const KEY = 'storyrower.audio';
export function loadAudioSettings(): AudioSettings {
  try {
    const { effects, muted } = { ...DEFAULT_AUDIO, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
    return { effects, muted };
  } catch { return { ...DEFAULT_AUDIO }; }
}
export function saveAudioSettings(s: AudioSettings) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* storage unavailable */ }
}

const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const midi = (n: number) => 440 * 2 ** ((n - 69) / 12);

/** Recorded ambience loops, levels set every frame in update() */
const LOOPS = ['water-calm', 'water-fast', 'river', 'wind', 'seabirds', 'rumble', 'ash'] as const;
type LoopSlot = typeof LOOPS[number];

interface PlayOpts { at?: number; vol?: number; rate?: number; spread?: number; lowpass?: number; out?: AudioNode; offset?: number }

/**
 * Ambience and effects – no background music. Recorded CC0 sounds (public/audio/, see
 * scripts/audio/) are used where they exist; everything else – and everything until the
 * files are decoded – is synthesised here.
 * Must be created inside a user gesture (browser autoplay rules).
 */
export class AudioEngine {
  readonly ctx: AudioContext;
  private master: GainNode;
  private sfxBus: GainNode;
  private noise: AudioBuffer;
  private water: { gain: GainNode; filter: BiquadFilterNode };
  private rumble: GainNode;
  private bank: SampleBank;
  private loops: Partial<Record<LoopSlot, GainNode>> = {};
  private birdTimer = 1;
  private settings: AudioSettings;

  constructor(settings: AudioSettings = loadAudioSettings()) {
    this.ctx = new AudioContext();
    this.settings = settings;
    const c = this.ctx;
    this.master = c.createGain();
    const comp = c.createDynamicsCompressor();
    this.master.connect(comp).connect(c.destination);
    this.sfxBus = c.createGain();
    this.sfxBus.connect(this.master);

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

    this.applySettings();

    this.bank = new SampleBank(c);
    this.bank.ready.then(() => this.startLoops()).catch(() => {});
  }

  /** Recorded ambience loops, started silent at a random point so they never line up. */
  private startLoops() {
    const c = this.ctx;
    if (c.state === 'closed') return;
    for (const slot of LOOPS) {
      const buf = this.bank.pick(slot);
      if (!buf || this.loops[slot]) continue;
      const src = c.createBufferSource();
      src.buffer = buf; src.loop = true;
      const g = c.createGain(); g.gain.value = 0;
      src.connect(g).connect(this.sfxBus);
      src.start(c.currentTime + 0.05, Math.random() * buf.duration);
      this.loops[slot] = g;
    }
  }

  // ---------- control ----------

  setSettings(s: AudioSettings) { this.settings = s; saveAudioSettings(s); this.applySettings(); }
  get currentSettings() { return { ...this.settings }; }
  toggleMute() { this.setSettings({ ...this.settings, muted: !this.settings.muted }); return this.settings.muted; }

  private applySettings() {
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.settings.muted ? 0 : 1, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(this.settings.effects, t, 0.05);
  }

  resume() { return this.ctx.resume(); }

  dispose() { this.ctx.close().catch(() => {}); }

  /**
   * Call every frame.
   * @param intensity story/workout intensity 0–1 (more wind when it heats up)
   * @param danger 0–1 how close the wave is (only matters while it is shown)
   */
  update(p: { dt: number; intensity: number; danger: number; speed: number; smoke: number; birds: number; ash: number }) {
    const now = this.ctx.currentTime;
    const L = this.loops;
    const fast = smooth(1.2, 4.5, p.speed);
    if (L['water-calm'] || L['water-fast']) {
      this.water.gain.gain.setTargetAtTime(0, now, 0.5);
      L['water-calm']?.gain.setTargetAtTime(0.12 - 0.05 * fast, now, 0.6);
      L['water-fast']?.gain.setTargetAtTime(0.02 + 0.17 * fast, now, 0.6);
    } else {
      this.water.gain.gain.setTargetAtTime(0.03 + Math.min(0.08, p.speed * 0.008), now, 0.5);
      this.water.filter.frequency.setTargetAtTime(500 + p.speed * 60, now, 0.5);
    }
    L.river?.gain.setTargetAtTime(0.06, now, 2);
    L.wind?.gain.setTargetAtTime(0.07 + 0.2 * smooth(0.5, 1, p.intensity) + 0.2 * p.danger, now, 2);
    L.seabirds?.gain.setTargetAtTime(p.birds * 0.3, now, 2);
    L.ash?.gain.setTargetAtTime(p.ash * 0.8, now, 2);
    if (L.rumble) {
      this.rumble.gain.setTargetAtTime(p.smoke * 0.15, now, 1); // keeps the sub-bass the recording may lack
      L.rumble.gain.setTargetAtTime(p.smoke * 0.6, now, 1);
    } else this.rumble.gain.setTargetAtTime(p.smoke * 0.35, now, 1);

    // puffin chirps
    if (p.birds > 0) {
      this.birdTimer -= p.dt;
      if (this.birdTimer <= 0) {
        if (this.birdCall(0.25)) this.birdTimer = 3 + Math.random() * 6;
        else { this.birdTimer = 0.6 + Math.random() * 2.5; this.chirp(); }
      }
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

  // ---------- effects ----------

  /**
   * Every real stroke: only the blade going in and pushing water away – no knocks, no drips.
   * Louder and brighter with more power.
   * @param power current power in watts (0 if unknown)
   */
  stroke(power = 0) {
    const t = this.ctx.currentTime;
    const s = power > 0 ? Math.max(0.45, Math.min(1.15, power / 170)) : 0.75;
    if (this.play('oar-catch', { vol: 0.65 * s, spread: 0.06, lowpass: 2500 + 6000 * s })) return;
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
    if (this.play('rock-splash', { vol: 0.9 * vol, spread: 0.1, lowpass: 1200 + 9000 * vol })) {
      this.thump(t, 70, 0.35 * vol, 0.5);
      return;
    }
    const src = this.noiseSource(t, 1.2);
    const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
    src.connect(f).connect(this.envelope(t, 0.7 * vol, 0.9, 0.01)).connect(this.sfxBus);
    this.thump(t, 70, 0.6 * vol, 0.5);
  }

  effect(id: EffectId) {
    const c = this.ctx;
    const t = c.currentTime;
    if (this.recordedEffect(id, t)) return;
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
      case 'calving': {
        // the ice cracks, a moment later it crashes into the river
        this.thump(t, 420, 0.5, 0.25, 90);
        const crack = this.noiseSource(t, 0.6);
        const hp = c.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1800;
        crack.connect(hp).connect(this.envelope(t, 0.5, 0.5, 0.005)).connect(this.sfxBus);
        this.thump(t + 2.4, 90, 1.0, 1.8, 30);
        const splash = this.noiseSource(t + 2.4, 3);
        const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
        splash.connect(lp).connect(this.envelope(t + 2.4, 0.9, 2.6, 0.02)).connect(this.sfxBus);
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

  /** A puffin or gull call (whichever are loaded, mixed at random); false if neither is. */
  private birdCall(vol: number, at?: number): boolean {
    const kinds = (['puffin', 'gull'] as const).filter((k) => this.bank.has(k));
    if (!kinds.length) return false;
    const kind = kinds[Math.floor(Math.random() * kinds.length)];
    return !!this.play(kind, { at, vol: kind === 'puffin' ? vol * 1.2 : vol, spread: 0.1 });
  }

  /** Recorded version of a story effect; false if those sounds are not there (yet). */
  private recordedEffect(id: EffectId, t: number): boolean {
    switch (id) {
      case 'tremor':
        if (!this.play('quake', { vol: 1 })) return false;
        this.thump(t + 0.2, 38, 0.4, 3);
        return true;
      case 'calving':
        // the generated crash is at ~3.95 s, the ice hits the water after 2.4 s (Calving.ts FALL)
        if (this.play('calving', { vol: 1, offset: 1.55 })) return true;
        if (!this.bank.has('ice-crack') || !this.bank.has('ice-splash')) return false;
        this.play('ice-crack', { vol: 0.8 });
        this.play('ice-splash', { at: t + 2.4, vol: 1 });
        this.thump(t + 2.4, 90, 0.6, 1.8, 30);
        return true;
      case 'eruption':
        if (!this.play('eruption', { vol: 1 })) return false;
        this.thump(t, 140, 0.8, 2.2, 28);
        return true;
      case 'wave':
        if (this.play('tidal-wave', { vol: 1 })) return true;
        // the synthesised roar still builds up (return false); the recorded crash lands on its peak
        this.play('wave', { at: t + 2.3, vol: 0.9 });
        return false;
      case 'birds':
        if (!this.birdCall(0.3)) return false;
        for (let k = 1; k < 3; k++) this.birdCall(0.3, t + k * 0.6 + Math.random() * 0.3);
        return true;
      case 'escape':
      case 'sunset':
        return !!this.play(id, { vol: 0.7 });
      default:
        return false;
    }
  }

  /**
   * Plays a random variant of a recorded slot; null if the slot is not loaded.
   * `spread` varies pitch (and speed) by ± that fraction, `lowpass` darkens soft sounds.
   */
  private play(slot: string, o: PlayOpts = {}): AudioBufferSourceNode | null {
    const buf = this.bank.pick(slot);
    if (!buf) return null;
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = (o.rate ?? 1) * (1 + (Math.random() * 2 - 1) * (o.spread ?? 0));
    const g = c.createGain();
    g.gain.value = (o.vol ?? 1) * (0.9 + Math.random() * 0.2);
    let node: AudioNode = src;
    if (o.lowpass && o.lowpass < 18000) {
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lowpass;
      node = node.connect(f);
    }
    node.connect(g).connect(o.out ?? this.sfxBus);
    src.start(Math.max(c.currentTime, o.at ?? c.currentTime), o.offset ?? 0);
    return src;
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
