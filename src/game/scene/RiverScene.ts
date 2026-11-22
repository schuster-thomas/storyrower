import * as THREE from 'three';
import type { EffectId, StoryState } from '../../story/story';
import type { Environment } from '../levels/level';
import { Boat } from './Boat';
import { Effects } from './Effects';
import { Gates, type GateInfo, type GateStyle } from './Gates';
import { Post } from './Post';
import { FrameStats, PROFILES, type QualityLevel, type QualityProfile } from './quality';
import { Sky } from './Sky';
import { NO_REFLECTION, Water } from './Water';
import { WORLDS, type LevelWorld, type WorldHost, type WorldId, type WorldSound } from './World';

const CHUNK = 100;         // the worlds build ahead in 100 m steps (quality.chunksAhead) – the fog hides the end
const HULL = 8;            // hull length (scripts/blender/boat.py) – where the boat samples the waves
const SPAN = 1.6;          // across the riggers
/** World units per real metre. >1 makes the boat feel faster than the real split. */
export const SPEED_SCALE = 2;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Which level world to build, and the level's look of the gates. */
export interface SceneOptions { world: WorldId; gates?: GateStyle }

/**
 * The river world every level shares – a rowing boat whose oars follow the real strokes, water,
 * sky, gates, splashes and the chase camera – plus the level's own world (banks, backdrop, set
 * piece, threat; see World.ts), loaded when the level is chosen.
 */
export class RiverScene {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(55, 1, 0.1, 2000);
  private hemi = new THREE.HemisphereLight(0xffffff, 0x6f7a5a, 1.7);
  private sun = new THREE.DirectionalLight(0xffffff, 2);

  private env: Environment;
  private envTarget: Environment;
  private skyColor = new THREE.Color();
  private water: Water;
  private sky: Sky;
  private q: QualityProfile;
  private _quality: QualityLevel;
  /** frame time, render time, draw calls and triangles – for the diagnostics overlay and recordings */
  readonly stats = new FrameStats();
  /** Resolves once the boat, the painted layers and the model kit are in place (show the game then). */
  readonly ready: Promise<void>;

  /** Start loading every asset of a level's world early (setup screen), so a game starts in the final look. */
  static preload(world: WorldId) {
    return Promise.all([Boat.preload(), WORLDS[world]().then((W) => W.preload())]).then(() => {}, () => {});
  }
  private topColor = new THREE.Color();
  private horizonColor = new THREE.Color();
  private sunColor = new THREE.Color();
  private waterColor = new THREE.Color();
  private light = 1;
  /** the level's own world (banks, backdrop, set piece, threat) – null until its module is loaded */
  private world: LevelWorld | null = null;
  private disposed = false;
  /** 0–0.8 the world darkens the light (Mauritius: under the storm clouds) */
  private dim = 0;
  /** extra rocking of the boat (the calving swell), decays */
  private rock = 0;
  private bufferSize = new THREE.Vector2();
  private sizeTmp = new THREE.Vector2();
  private post: Post;
  private tint = new THREE.Color(1, 1, 1);

  private boat = new THREE.Group();
  /** the scull and the rigged rower */
  private model: Boat;
  private prevPhase = 1;
  private bladePos: THREE.Vector3[] = [];
  /** the gates at target changes and at the finish */
  private gates: Gates;
  private gateInfo: GateInfo | null = null;
  private gateMoving = false;

  private z = 0;              // boat position (moves towards -z)
  private speed = 0;          // current world speed (units/s)
  private time = 0;
  private strokePhase = 1;    // 0 = catch, 0.35 = finish, 1 = ready for next catch
  private strokeCycle = 2.5;  // s
  private shake = 0;
  private impulse = 0;        // extra camera shake from story events (tremor, eruption …)
  private flashLevel = 0;
  private flashColor = new THREE.Color();
  private viewDir = 1;
  private effects: Effects;
  private story: StoryState = { lavaBombs: 0, ashfall: 0, birds: 0, unrest: 0, eruptionAge: -1, cooling: 0, calvingIn: -1, quake: 0, quakeAge: -1, dragon: 0, dragonAge: -1, attack: 0, visitors: 0, storm: 0, shark: 0, sharkAge: -1, sharkNear: 0 };
  /** Forwarded from the effects (for sound): a lava bomb hit the water at this distance. */
  set onBombLanded(fn: ((distance: number) => void) | null) { this.effects.onBombLanded = fn; }
  /** A sound of the level's world (falling debris, lasers …) at this distance from the boat. */
  onWorldSound: ((id: WorldSound, distance: number) => void) | null = null;

  constructor(canvas: HTMLCanvasElement, env: Environment, quality: QualityLevel = 'medium', options: SceneOptions = { world: 'iceland' }) {
    this._quality = quality;
    this.q = PROFILES[quality];
    // Our own context so the canvas is opaque: three.js always asks for an alpha channel, which makes the
    // compositor blend the whole canvas over the black page every frame (and shows black wherever a frame
    // leaves alpha < 1). No multisampling on the canvas either: medium/high draw through the post chain
    // (its render targets have no MSAA, the canvas only gets a full-screen quad) and "low" never had it –
    // at 2.5k on the tablet that was ~100 MB of GPU memory and a resolve per frame for nothing.
    const context = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: true, stencil: false, powerPreference: 'high-performance' });
    this.renderer = new THREE.WebGLRenderer({ canvas, context: context ?? undefined, antialias: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.q.pixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // Soft sun shadows near the boat (off on "low")
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.sun.castShadow = quality !== 'low';
    this.sun.shadow.mapSize.set(quality === 'high' ? 2048 : 1024, quality === 'high' ? 2048 : 1024);
    const sc = this.sun.shadow.camera;
    sc.left = -30; sc.right = 30; sc.top = 30; sc.bottom = -30; sc.near = 10; sc.far = 300;
    this.sun.shadow.bias = -0.0005;
    this.sun.shadow.normalBias = 0.04;
    this.env = { ...env };
    this.envTarget = { ...env };
    this.scene.fog = new THREE.Fog(env.fog, env.fogNear, env.fogFar);

    this.sun.position.set(-40, 80, 30);
    this.scene.add(this.hemi, this.sun, this.sun.target);

    this.sky = new Sky(this.q.clouds);
    this.scene.add(this.sky.group);
    this.water = new Water(this.q.waterSegments);
    this.scene.add(this.water.mesh);

    this.buildBoat();
    this.model = new Boat(this.sun.castShadow);
    this.boat.add(this.model.group);
    this.gates = new Gates(options.gates ?? 'buoys');
    this.scene.add(this.gates.group);
    // passing a gate: a short flash in its colour (the finish throws confetti on its own)
    this.gates.onPass = (kind, color) => this.flash(color, kind === 'finish' ? 0.45 : 0.22);
    this.effects = new Effects(this.scene);
    this.effects.setParticleShare(this.q.particles);
    // the main camera sees everything; the water's mirror camera leaves out the NO_REFLECTION layer
    this.camera.layers.enable(NO_REFLECTION);
    // the level's world: its module is loaded on demand (each level is its own chunk)
    const self = this;
    const host: WorldHost = {
      scene: this.scene, sky: this.sky, water: this.water, effects: this.effects,
      get shadows() { return self.sun.castShadow; },
      get quality() { return self.q; },
      shake: (amount) => { this.impulse = Math.max(this.impulse, amount); },
      rock: (amount) => { this.rock = amount; },
      dim: (amount) => { this.dim = Math.max(0, Math.min(0.8, amount)); },
      flash: (color, strength) => this.flash(color, strength),
      sound: (id, distance) => this.onWorldSound?.(id, distance),
    };
    const worldReady = WORLDS[options.world]().then((W) => {
      if (this.disposed) return;
      this.world = new W(host, this._quality);
      this.world.applyEnvironment(this.env);
      return this.world.ready;
    });
    this.ready = Promise.all([this.model.loaded, worldReady]).then(() => {});
    this.post = new Post(this.renderer, this.scene, this.camera);
    this.post.setQuality(quality);
    this.water.reflections = quality !== 'low';
    this.applyEnvironment(1);
  }

  // ---------- public API ----------

  get quality() { return this._quality; }

  /** Switch the graphics level on the fly (resolution, water/terrain detail, particles, clouds). */
  setQuality(level: QualityLevel) {
    if (level === this._quality) return;
    this._quality = level;
    this.q = PROFILES[level];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.q.pixelRatio));
    const size = this.renderer.getSize(new THREE.Vector2());
    this.renderer.setSize(size.x, size.y, false);
    this.water.setSegments(this.q.waterSegments);
    this.water.reflections = level !== 'low';
    this.sky.setCloudCount(this.q.clouds);
    this.effects.setParticleShare(this.q.particles);
    this.sun.castShadow = level !== 'low';
    this.model.setShadows(this.sun.castShadow);
    this.post.setQuality(level);
    this.world?.setQuality(level, this.q);
    this.post.setSize(size.x, size.y);
    this.resizeReflection();
  }

  /** The mirror image is rendered at half the drawing-buffer resolution (it is rippled anyway). */
  private resizeReflection() {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.water.setReflectionSize(size.x / 2, size.y / 2);
  }

  /** Blend the world towards another phase look (smoothly over a few seconds). */
  setEnvironment(env: Environment, immediate = false) {
    this.envTarget = { ...env };
    if (immediate) this.applyEnvironment(1);
  }

  /**
   * The next gate (target change or finish): when the boat should pass it, and whether the
   * workout clock is running (a paused workout freezes the gate where it is).
   */
  setGate(info: GateInfo | null, moving: boolean) { this.gateInfo = info; this.gateMoving = moving; }

  /** Ongoing story effects (lava bombs, ash, birds) – derived from the workout time. */
  setStory(state: StoryState) { this.story = state; }

  /** Play a one-shot story effect. */
  play(effect: EffectId) {
    switch (effect) {
      case 'tremor': this.impulse = Math.max(this.impulse, 1.1); break;
      case 'calving': this.impulse = Math.max(this.impulse, 0.5); break;
      case 'eruption':
        this.impulse = Math.max(this.impulse, 1.6);
        this.flash(0xffa040, 1);
        this.effects.volley({ boatZ: this.z, viewDir: this.viewDir, threat: 0.6 }, 5);
        break;
      case 'wave': this.impulse = Math.max(this.impulse, 0.9); break;
      case 'escape': this.flash(0xfff0c8, 0.45); break;
      default: break;
    }
    this.world?.play(effect, this.z);
  }

  /** Short light flash, e.g. for the eruption. */
  flash(color: number, strength: number) { this.flashColor.set(color); this.flashLevel = Math.max(this.flashLevel, strength); }

  /** A real stroke happened. `intervalMs` = time since the previous one. */
  stroke(intervalMs: number | null) {
    if (intervalMs && intervalMs > 800 && intervalMs < 6000) this.strokeCycle = lerp(this.strokeCycle, intervalMs / 1000, 0.5);
    this.strokePhase = 0;
  }

  /**
   * @param dt seconds since last frame
   * @param metersPerSecond boat speed from the (smoothed) split, 0 when paused
   * @param threat 0 = wave on top of you, 1 = far away
   * @param intensity 0–1 from the workout segment (camera shake, swell)
   */
  update(dt: number, metersPerSecond: number, threat: number, intensity: number, story?: StoryState) {
    if (story) this.story = story;
    dt = Math.min(dt, 0.1);
    this.time += dt;
    // Speed eases towards the target; the drive adds a little surge
    const surge = this.strokePhase < 0.35 ? 1.15 : 0.95;
    const target = metersPerSecond * SPEED_SCALE * (metersPerSecond > 0 ? surge : 1);
    this.speed = lerp(this.speed, target, 1 - Math.exp(-dt * 1.5));
    this.z -= this.speed * dt;

    this.applyEnvironment(1 - Math.exp(-dt * 0.4));
    this.applyFlash(dt);
    this.light = (0.45 + 0.55 * Math.min(1, this.env.sunIntensity / 2.2) * (1 - this.env.smoke * 0.25)) * (1 - this.dim * 0.6) + this.flashLevel * 0.4;
    this.updateBoat(dt);
    this.updateCamera(dt, threat, intensity);
    this.effects.update({ dt, time: this.time, boatZ: this.z, speed: this.speed, viewDir: this.viewDir, threat, smoke: this.env.smoke, lava: this.env.lava, story: this.story });
    this.sky.update({ dt, time: this.time, camera: this.camera, boatZ: this.z, top: this.topColor, horizon: this.horizonColor, sunColor: this.sunColor, smoke: this.env.smoke, sunHeight: this.env.sunHeight });
    this.water.update({ time: this.time, boatZ: this.z, speed: this.speed, swell: this.env.swell, water: this.waterColor, sky: this.horizonColor, sunColor: this.sunColor, sunDir: this.sky.sunDir, light: this.light });
    this.renderer.getDrawingBufferSize(this.bufferSize);
    this.effects.setPixelHeight(this.bufferSize.y, this.camera.fov);
    this.world?.update({
      dt, time: this.time, boatZ: this.z, speed: this.speed, env: this.env, story: this.story, threat, light: this.light,
      horizon: this.horizonColor, sunDir: this.sky.sunDir, camera: this.camera, pixelHeight: this.bufferSize.y, viewDir: this.viewDir,
    });
    this.gates.update({ dt, time: this.time, boatZ: this.z, speed: this.speed, moving: this.gateMoving, info: this.gateInfo, surfaceAt: (x, z) => this.water.surfaceAt(x, z, this.time, this.env.swell) });
    // The visible sun sits ahead in the sky; the light comes from high right-behind so the mossy
    // slopes on the left and the rower's face are lit, the glacier walls glow blue in their own shade
    this.sun.position.set(55, 50 + this.env.sunHeight * 90, this.z + 45);
    this.sun.target.position.set(0, 0, this.z);

    // count draw calls over all passes (post-processing would otherwise reset the counter per pass)
    this.renderer.info.autoReset = false;
    this.renderer.info.reset();
    const t0 = performance.now();
    // phase tint for the colour grade: warm at sunset, orange under the eruption, cool in the idyll
    this.tint.setRGB(1, 1, 1).lerp(new THREE.Color(1.08, 0.92, 0.82), this.env.lava * 0.6).lerp(new THREE.Color(1.06, 0.98, 0.9), Math.max(0, 0.3 - this.env.sunHeight) * 2);
    this.water.renderReflection(this.renderer, this.scene, this.camera);
    this.post.render(this.scene, this.camera, this.tint, this.env.lava * 0.6 + this.flashLevel);
    const info = this.renderer.info.render;
    this.stats.calls = info.calls;
    this.stats.triangles = info.triangles;
    this.stats.push(dt * 1000, performance.now() - t0);
  }

  /**
   * Resizing clears the canvas – call it right before `update()` renders the next frame (not from a
   * ResizeObserver, which runs after this frame was drawn and would leave a cleared, black canvas on screen).
   * Returns false when nothing changed.
   */
  resize(width: number, height: number): boolean {
    const cur = this.renderer.getSize(this.sizeTmp);
    if (cur.x === width && cur.y === height) return false;
    this.renderer.setSize(width, height, false);
    this.post.setSize(width, height);
    this.resizeReflection();
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
    return true;
  }

  dispose() {
    this.disposed = true;
    this.model.dispose();
    this.world?.dispose();
    this.post.dispose();
    this.gates.dispose();
    this.water.dispose();
    this.sky.dispose();
    this.renderer.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
    });
  }

  // ---------- environment ----------

  private applyFlash(dt: number) {
    if (this.flashLevel < 0.005) { this.flashLevel = 0; return; }
    this.skyColor.lerp(this.flashColor, this.flashLevel * 0.85);
    this.topColor.lerp(this.flashColor, this.flashLevel * 0.7);
    this.horizonColor.lerp(this.flashColor, this.flashLevel * 0.85);
    (this.scene.fog as THREE.Fog).color.lerp(this.flashColor, this.flashLevel * 0.6);
    this.hemi.intensity = 1.7 * (1 - this.dim) + this.flashLevel * 2.5;
    this.flashLevel *= Math.exp(-dt * 2.2);
    if (this.flashLevel < 0.005) this.hemi.intensity = 1.7 * (1 - this.dim);
  }

  private applyEnvironment(t: number) {
    const e = this.env, g = this.envTarget;
    for (const k of ['fogNear', 'fogFar', 'sunIntensity', 'lava', 'smoke', 'wave', 'swell', 'sunHeight'] as const) e[k] = lerp(e[k], g[k], t);
    for (const k of ['sky', 'fog', 'sun', 'ground', 'water'] as const) e[k] = new THREE.Color(e[k]).lerp(new THREE.Color(g[k]), t).getHex();

    this.skyColor.set(e.sky);
    this.scene.background = this.skyColor;
    const fog = this.scene.fog as THREE.Fog;
    // the fog must swallow the shores before the last built chunk ends
    const reach = this.q.chunksAhead * CHUNK * 0.92;
    fog.color.set(e.fog); fog.far = Math.min(e.fogFar, reach); fog.near = Math.min(e.fogNear, fog.far * 0.3);
    this.sun.color.set(e.sun); this.sun.intensity = e.sunIntensity * (1 - this.dim);
    if (this.flashLevel < 0.005) this.hemi.intensity = 1.7 * (1 - this.dim);
    this.hemi.color.set(e.sky).lerp(new THREE.Color(0xffffff), 0.4);
    // sky: deeper colour overhead, the fog colour at the horizon so land and sky blend
    this.topColor.set(e.sky).offsetHSL(0, 0.08, -0.12);
    this.horizonColor.set(e.fog);
    this.sunColor.set(e.sun);
    this.waterColor.set(e.water);
    this.world?.applyEnvironment(e);
  }

  // ---------- boat ----------

  private buildBoat() {
    this.scene.add(this.boat);
  }

  private updateBoat(dt: number) {
    // Advance the stroke cycle; hold at the catch until the next real stroke arrives
    if (this.strokePhase < 1) this.strokePhase = Math.min(1, this.strokePhase + dt / this.strokeCycle);
    const p = this.strokePhase;

    // The boat floats on the same waves the water shader draws: height from the hull's average,
    // pitch from bow vs stern, roll from the two riggers – it rides the crests instead of sinking
    const t = this.time, sw = this.env.swell, z = this.z;
    const at = (x: number, dz: number) => this.water.surfaceAt(x, z + dz, t, sw);
    const bow = at(0, -HULL / 2), stern = at(0, HULL / 2), mid = at(0, 0);
    const left = at(-SPAN / 2, 0), right = at(SPAN / 2, 0);
    const y = (bow + stern + 2 * mid + left + right) / 6;
    this.boat.position.set(0, y + Math.sin(t * 1.7) * 0.02, z);
    // the calving swell rocks it hard for a few seconds
    this.rock *= Math.exp(-dt * 0.6);
    this.boat.rotation.x = Math.atan2(bow - stern, HULL) + Math.sin(t * 0.9) * 0.006 + Math.sin(t * 2.1) * this.rock * 0.5;
    this.boat.rotation.z = Math.atan2(right - left, SPAN) + Math.sin(t * 1.1) * 0.008 + Math.sin(t * 2.6) * this.rock;

    // The real rower model: same phase convention as the clip (catch 0, finish 0.35)
    this.model.update(p);
    if (this.model.ready) {
      const prev = this.prevPhase;
      const crossed = (at: number) => (prev < at && p >= at) || (prev > p && p >= at); // also after a new stroke reset the phase
      if (crossed(0.03) || crossed(0.37)) {
        this.boat.updateMatrixWorld(true);
        for (const b of this.model.bladePositions(this.bladePos)) {
          if (crossed(0.03)) this.effects.bladeSplash(b, Math.min(1.4, 0.6 + this.speed / 8));
          else this.effects.puddle(b);
        }
      }
    }
    this.prevPhase = p;
  }

  // ---------- camera ----------

  private updateCamera(dt: number, threat: number, intensity: number) {
    const danger = this.env.wave * (1 - threat);
    this.impulse *= Math.exp(-dt * 0.9);
    this.shake = lerp(this.shake, 0.02 + intensity * 0.05 * this.env.swell + danger * 0.25 + this.impulse * 0.35, 1 - Math.exp(-dt * 4));
    const sx = (Math.sin(this.time * 23) + Math.sin(this.time * 17)) * 0.5 * this.shake;
    const sy = (Math.sin(this.time * 19) + Math.sin(this.time * 29)) * 0.5 * this.shake;
    // While the wave chases you, the camera swings around the boat: side view during the
    // eruption, a front view (the rower's own view – rowers face the stern) in the finale.
    const w = this.env.wave;
    const a = Math.PI * w * w * w * w; // eruption (0.6) ≈ 23° (the volcano stays ahead), finale (1) = 180°
    const f = a / Math.PI;
    this.viewDir = Math.cos(a) >= 0 ? 1 : -1;
    // low chase camera close behind the stern: the rower is big in the lower third, the fjord opens up above
    const r = 7.2 + 4 * Math.sin(a) + 3 * f;
    // the banks are close: swing round inside the river (at most 6 m to the side), rising a little
    // halfway round instead of passing through the cliffs
    const side = Math.max(-6, Math.min(6, Math.sin(a) * r));
    this.camera.position.set(sx + side + Math.sin(this.time * 0.3) * 0.2, 2.5 + 2.2 * f + 2 * Math.sin(a) + sy, this.z + Math.cos(a) * r);
    this.camera.lookAt(-Math.sin(a) * 3, 1.25 - 0.5 * f, this.z - Math.cos(a) * (14 - 3 * f));
  }
}


