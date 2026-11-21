import type { EffectId } from '../story/story';
import type { WorldSound } from '../game/scene/World';
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
const LOOPS = ['water-calm', 'water-fast', 'river', 'wind', 'seabirds', 'rumble', 'ash', 'city', 'garden-birds', 'surf', 'tropical-birds', 'palm-wind', 'rain'] as const;

/**
 * The level's soundscape: Iceland – a river, seabirds and gulls; Tokyo – a Japanese garden
 * (bush warblers, a bamboo fountain, wind chimes) on one bank, the city (distant traffic, crows,
 * a train now and then) on the other; Mauritius – surf on the beach, tropical birds and the wind in
 * the palms, then rain, gusts and thunder in the storm (no river, no gulls). Boat, water, wind and
 * the story effects are shared.
 * Named after the level's world; worlds without their own soundscape get Iceland's.
 */
export type Soundscape = string;
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
  private soundscape: Soundscape = 'iceland';
  /** Tokyo: seconds until the next garden / city sound */
  private timers = { fountain: 6, chime: 3, crow: 9, train: 40 };

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

  /** Switch the level's ambience (the setup screen calls this before every game). */
  setSoundscape(s: Soundscape) {
    this.soundscape = s;
    this.timers = { fountain: 6, chime: 3, crow: 9, train: 40 };
  }

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
  update(p: { dt: number; intensity: number; danger: number; speed: number; smoke: number; birds: number; ash: number; calm?: number; storm?: number }) {
    const tokyo = this.soundscape === 'tokyo';
    const tropical = this.soundscape === 'mauritius';
    const storm = p.storm ?? 0;
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
    L.river?.gain.setTargetAtTime(tokyo || tropical ? 0 : 0.06, now, 2);
    // (the recorded wind is a cold, whistling one: in the tropics only a little of it, in the storm gusts)
    L.wind?.gain.setTargetAtTime(tropical ? 0.12 * storm : 0.07 + 0.2 * smooth(0.5, 1, p.intensity) + 0.2 * p.danger, now, 2);
    L.seabirds?.gain.setTargetAtTime(tokyo || tropical ? 0 : p.birds * 0.3, now, 2);
    // Mauritius: waves rolling onto the beach, tropical birds while the weather is fine, the wind in
    // the palms; in the thunderstorm heavier surf, rain and gusts
    const calmTropics = Math.max(p.birds, p.calm ?? 0);
    L.surf?.gain.setTargetAtTime(tropical ? 0.16 + 0.14 * storm : 0, now, 2);
    L['tropical-birds']?.gain.setTargetAtTime(tropical ? calmTropics * (1 - storm) * 0.3 : 0, now, 2);
    L['palm-wind']?.gain.setTargetAtTime(tropical ? 0.04 + 0.4 * storm : 0, now, 2);
    L.rain?.gain.setTargetAtTime(tropical ? Math.max(0, (storm - 0.55) / 0.45) * 0.55 : 0, now, 1.5);
    // Tokyo: the city hums on one bank, warblers sing in the garden while all is calm
    const calm = Math.max(p.birds, p.calm ?? 0);
    L.city?.gain.setTargetAtTime(tokyo ? 0.09 + 0.05 * p.intensity : 0, now, 2);
    L['garden-birds']?.gain.setTargetAtTime(tokyo ? calm * 0.32 : 0, now, 2);
    L.ash?.gain.setTargetAtTime(p.ash * 0.8, now, 2);
    if (L.rumble) {
      this.rumble.gain.setTargetAtTime(p.smoke * 0.15, now, 1); // keeps the sub-bass the recording may lack
      L.rumble.gain.setTargetAtTime(p.smoke * 0.6, now, 1);
    } else this.rumble.gain.setTargetAtTime(p.smoke * 0.35, now, 1);

    if (tokyo) this.tokyoSounds(p.dt, calm);
    // puffin chirps (not in the tropics: their birds are in the loop)
    else if (p.birds > 0 && !tropical) {
      this.birdTimer -= p.dt;
      if (this.birdTimer <= 0) {
        if (this.birdCall(0.25)) this.birdTimer = 3 + Math.random() * 6;
        else { this.birdTimer = 0.6 + Math.random() * 2.5; this.chirp(); }
      }
    }
  }

  /**
   * Tokyo's sounds now and then: the bamboo fountain and wind chimes in the calm garden, crows and
   * a passing train from the city (quieter while the story is loud). Synthesised if not loaded.
   */
  private tokyoSounds(dt: number, calm: number) {
    const t = this.ctx.currentTime, T = this.timers;
    const rnd = (a: number, b: number) => a + Math.random() * (b - a);
    T.fountain -= dt; T.chime -= dt; T.crow -= dt; T.train -= dt;
    if (T.fountain <= 0) {
      T.fountain = rnd(14, 26);
      if (calm > 0.3 && !this.play('shishi-odoshi', { vol: 0.32 * calm, spread: 0.04, lowpass: 5000 })) this.bambooKnock(t, 0.25 * calm);
    }
    if (T.chime <= 0) {
      T.chime = rnd(9, 22);
      if (calm > 0.3 && !this.play('wind-chime', { vol: 0.22 * calm, spread: 0.05 })) this.windChime(t, 0.1 * calm);
    }
    if (T.crow <= 0) {
      T.crow = rnd(12, 30);
      const n = 1 + Math.floor(Math.random() * 3);
      for (let k = 0; k < n; k++) this.play('crow', { at: t + k * rnd(0.5, 0.8), vol: 0.16, spread: 0.06, lowpass: 3500 });
    }
    if (T.train <= 0) {
      T.train = rnd(55, 95);
      this.play('train', { vol: 0.18, lowpass: 2500 });
    }
  }

  /** A hollow bamboo clack (shishi-odoshi) when the recording is missing. */
  private bambooKnock(t: number, vol: number) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(520, t); o.frequency.exponentialRampToValueAtTime(380, t + 0.25);
    o.connect(this.envelope(t, vol, 0.35, 0.002)).connect(this.sfxBus);
    o.start(t); o.stop(t + 0.5);
    const src = this.noiseSource(t, 0.1);
    const f = c.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1400; f.Q.value = 4;
    src.connect(f).connect(this.envelope(t, vol * 0.8, 0.06, 0.001)).connect(this.sfxBus);
  }

  /** A few glassy chime notes from a pentatonic scale when the recording is missing. */
  private windChime(t: number, vol: number) {
    const scale = [84, 86, 88, 91, 93, 96];
    for (let k = 0; k < 3 + Math.floor(Math.random() * 3); k++) this.bell(t + k * (0.12 + Math.random() * 0.25), midi(scale[Math.floor(Math.random() * scale.length)]), this.sfxBus, vol);
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
      case 'blossom':
        // a temple bell far away: a low, long strike with a soft overtone
        this.templeBell(t, 0.5);
        break;
      case 'quake': {
        // the great quake: a deep roll, then the city cracks and the first parts crash into the river
        const src = this.noiseSource(t, 6);
        const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 110;
        const g = c.createGain();
        g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1.6, t + 0.6); g.gain.linearRampToValueAtTime(0, t + 5.5);
        src.connect(f).connect(g).connect(this.sfxBus);
        this.thump(t + 0.1, 34, 0.9, 4);
        this.play('quake', { vol: 1 });
        this.play('rumble', { at: t + 0.5, vol: 0.8 });
        this.thump(t + 1.2, 420, 0.35, 0.25, 90);
        break;
      }
      case 'dragon':
        this.roar(t, 1);
        this.roar(t + 2.6, 0.6);
        break;
      // Mauritius: the thunder comes with the lightning (worldSound); the people and clouds need none
      case 'visitors':
      case 'clouds':
      case 'thunderstorm':
        break;
      case 'fin':
        this.dread(t, 0.8);
        break;
      case 'shark':
        // it bursts out of the water: a huge splash and a deep hit
        if (!this.play('ice-splash', { vol: 1 })) this.play('rock-splash', { vol: 1 });
        this.thump(t, 90, 0.9, 1.6, 30);
        this.dread(t + 0.3, 1);
        break;
    }
  }

  /**
   * Something is down there: a deep swell of two low tones that slowly beat against each other,
   * with a dark breath of noise (no melody – nothing a famous film score owns).
   */
  private dread(t: number, vol: number) {
    const c = this.ctx;
    for (const [freq, det] of [[41.2, 0], [41.2, 1.3], [61.7, -0.8]] as const) {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = freq + det;
      const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(120, t); f.frequency.linearRampToValueAtTime(380, t + 2.5); f.frequency.linearRampToValueAtTime(140, t + 5);
      const g = c.createGain();
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.13 * vol, t + 2.2); g.gain.linearRampToValueAtTime(0, t + 5.5);
      o.connect(f).connect(g).connect(this.sfxBus);
      o.start(t); o.stop(t + 5.6);
    }
    const n = this.noiseSource(t, 5);
    const nf = c.createBiquadFilter(); nf.type = 'lowpass'; nf.frequency.value = 260;
    const ng = c.createGain();
    ng.gain.setValueAtTime(0, t); ng.gain.linearRampToValueAtTime(0.35 * vol, t + 2.5); ng.gain.linearRampToValueAtTime(0, t + 5);
    n.connect(nf).connect(ng).connect(this.sfxBus);
  }

  /** A sound of the level world (Tokyo: debris falling into the river, laser beams and their hits). */
  worldSound(id: WorldSound, distance: number) {
    const t = this.ctx.currentTime;
    const vol = Math.max(0.15, 1 - distance / 80);
    switch (id) {
      case 'debris': this.bombLanded(distance); break;
      case 'laser': {
        // a bright, falling zap
        const o = this.ctx.createOscillator(); o.type = 'sawtooth';
        o.frequency.setValueAtTime(1800, t); o.frequency.exponentialRampToValueAtTime(220, t + 0.5);
        const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1400; f.Q.value = 2;
        o.connect(f).connect(this.envelope(t, 0.22 * vol, 0.55, 0.01)).connect(this.sfxBus);
        o.start(t); o.stop(t + 0.6);
        break;
      }
      case 'laser-hit': {
        // hissing steam where the beam hits the water
        const src = this.noiseSource(t, 1.4);
        const f = this.ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = 1500;
        src.connect(f).connect(this.envelope(t, 0.45 * vol, 1.2, 0.02)).connect(this.sfxBus);
        this.play('rock-splash', { vol: 0.5 * vol, spread: 0.15, lowpass: 3000 + 5000 * vol });
        break;
      }
      case 'thunder': {
        // it rolls in after the lightning (sound needs ~3 s per km), duller and quieter from far away
        const at = t + Math.min(4, distance / 340);
        const v = Math.max(0.25, Math.min(1, 1.25 - distance / 1100));
        const lp = Math.max(700, 9000 - distance * 9);
        if (!this.play('thunder', { at, vol: v, spread: 0.08, lowpass: lp })) {
          const src = this.noiseSource(at, 5);
          const f = this.ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(lp * 0.3, at); f.frequency.exponentialRampToValueAtTime(90, at + 4.5);
          src.connect(f).connect(this.envelope(at, 0.9 * v, 4.5, 0.03)).connect(this.sfxBus);
        }
        this.thump(at, 70, 0.5 * v, 3, 28);
        break;
      }
      case 'bite': {
        // the jaws slam shut: two hard clacks and a low thud
        for (const dt of [0, 0.07]) {
          const src = this.noiseSource(t + dt, 0.12);
          const f = this.ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 1600; f.Q.value = 1.2;
          src.connect(f).connect(this.envelope(t + dt, 0.7, 0.09, 0.002)).connect(this.sfxBus);
        }
        this.thump(t, 160, 0.6, 0.35, 50);
        this.play('rock-splash', { vol: 0.6, spread: 0.1 });
        break;
      }
      case 'splash':
        if (!this.play('ice-splash', { vol: 0.85, spread: 0.08 })) this.play('rock-splash', { vol: 1, spread: 0.1 });
        this.thump(t, 80, 0.5, 0.8, 30);
        break;
      case 'speedboat':
        if (!this.play('motorboat', { vol: 0.35, lowpass: 5000 })) this.engine(t, 0.12);
        break;
    }
  }

  /** A speedboat roaring past when the recording is missing: a buzzing engine, pitch falling as it goes. */
  private engine(t: number, vol: number) {
    const c = this.ctx, len = 7;
    const o = c.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(95, t); o.frequency.linearRampToValueAtTime(110, t + 3); o.frequency.linearRampToValueAtTime(78, t + len);
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
    const g = c.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 3); g.gain.linearRampToValueAtTime(0, t + len);
    o.connect(f).connect(g).connect(this.sfxBus);
    o.start(t); o.stop(t + len + 0.1);
  }

  /** Low temple bell: a few inharmonic partials that ring out slowly. */
  private templeBell(t: number, vol: number) {
    const c = this.ctx;
    for (const [ratio, gain, decay] of [[1, 1, 6], [2.76, 0.35, 3], [5.4, 0.15, 1.5]] as const) {
      const o = c.createOscillator(); o.type = 'sine'; o.frequency.value = 98 * ratio;
      const g = c.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(vol * gain * 0.4, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + decay);
      o.connect(g).connect(this.sfxBus);
      o.start(t); o.stop(t + decay + 0.1);
    }
  }

  /** The dragon's roar: a growling, falling saw tone through a sweeping filter, with breath noise. */
  private roar(t: number, vol: number) {
    const c = this.ctx;
    const len = 2.2;
    for (const det of [0, 7, -5]) {
      const o = c.createOscillator(); o.type = 'sawtooth';
      o.frequency.setValueAtTime(150 + det, t); o.frequency.linearRampToValueAtTime(210 + det, t + 0.5); o.frequency.exponentialRampToValueAtTime(70 + det, t + len);
      const lfo = c.createOscillator(); lfo.frequency.value = 28 + det;
      const lg = c.createGain(); lg.gain.value = 18;
      lfo.connect(lg).connect(o.frequency);
      const f = c.createBiquadFilter(); f.type = 'lowpass';
      f.frequency.setValueAtTime(400, t); f.frequency.linearRampToValueAtTime(1600, t + 0.5); f.frequency.exponentialRampToValueAtTime(300, t + len);
      o.connect(f).connect(this.envelope(t, 0.16 * vol, len, 0.15)).connect(this.sfxBus);
      o.start(t); o.stop(t + len + 0.1); lfo.start(t); lfo.stop(t + len + 0.1);
    }
    const n = this.noiseSource(t, len);
    const nf = c.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 700; nf.Q.value = 0.7;
    n.connect(nf).connect(this.envelope(t, 0.35 * vol, len, 0.2)).connect(this.sfxBus);
    this.thump(t, 60, 0.5 * vol, 1.5);
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
