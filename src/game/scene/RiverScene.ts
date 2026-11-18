import * as THREE from 'three';
import type { EffectId, StoryState } from '../../story/story';
import type { Environment } from '../levels/iceland';
import { Backdrop } from './Backdrop';
import { Boat } from './Boat';
import { Effects } from './Effects';
import { buildFjordChunk, createFjordMaterials, disposeFjordChunk } from './Fjord';
import { NatureKit } from './NatureKit';
import { PaintedShore } from './PaintedShore';
import { Volcano } from './Volcano';
import { PaintedProps } from './PaintedProps';
import { Puffins } from './Puffins';
import { Post } from './Post';
import { FrameStats, PROFILES, type QualityLevel, type QualityProfile } from './quality';
import { Sky } from './Sky';
import { NO_REFLECTION, Water } from './Water';

const CHUNK = 100;         // length of one fjord chunk (m)
const CHUNKS_BEHIND = 3;   // the finale camera looks back at the wave
const HULL = 8;            // hull length (scripts/blender/boat.py) – where the boat samples the waves
const SPAN = 1.6;          // across the riggers
/** World units per real metre. >1 makes the boat feel faster than the real split. */
export const SPEED_SCALE = 2;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

interface Chunk { index: number; group: THREE.Group; gen: number }

/**
 * The fjord world: an endless glacier lagoon made of chunks (mossy basalt slopes on the left,
 * a glacier front on the right), a rowing boat whose oars follow the real strokes, a volcano
 * in the distance and a tidal wave that chases the boat.
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
  private mats = createFjordMaterials();
  private water: Water;
  private sky: Sky;
  private chunks: Chunk[] = [];
  /** bumped when chunks must be rebuilt (graphics level, model kit loaded) */
  private chunkGen = 0;
  private q: QualityProfile;
  private _quality: QualityLevel;
  /** frame time, render time, draw calls and triangles – for the diagnostics overlay and recordings */
  readonly stats = new FrameStats();
  /** Resolves once the boat, the painted layers and the model kit are in place (show the game then). */
  readonly ready: Promise<void>;

  /** Start loading every asset of the world early (setup screen), so a game starts in the final look. */
  static preload() {
    return Promise.all([Boat.preload(), Backdrop.preload(), NatureKit.load(), PaintedShore.preload('cliffs'), PaintedShore.preload('glacier'), Volcano.preload(), PaintedProps.preload(), Puffins.preload()]).then(() => {}, () => {});
  }
  private topColor = new THREE.Color();
  private horizonColor = new THREE.Color();
  private sunColor = new THREE.Color();
  private waterColor = new THREE.Color();
  private backdrop: Backdrop;
  private light = 1;
  private kit: NatureKit | null = null;
  /** painted banks (replace the generated slopes and glacier once loaded) */
  private painted: PaintedShore;
  /** painted icebergs and rocks in the water */
  private props = new PaintedProps();
  private puffins = new Puffins();
  /** the painted volcano with flowing lava, plume and fountain (the greybox `volcano` is its stand-in) */
  private setPiece: Volcano;
  private bufferSize = new THREE.Vector2();
  private paintedIce: PaintedShore;
  private paintTint = new THREE.Color();
  private post: Post;
  private tint = new THREE.Color(1, 1, 1);

  private boat = new THREE.Group();
  /** the scull and the rigged rower */
  private model: Boat;
  private prevPhase = 1;
  private bladePos: THREE.Vector3[] = [];
  private volcano = new THREE.Group();
  private lavaMat = new THREE.MeshStandardMaterial({ color: 0x3a2a24, emissive: 0xff4a10, emissiveIntensity: 0, roughness: 1, flatShading: true, fog: false });
  private smoke: THREE.Mesh[] = [];
  private wave: THREE.Mesh;
  private waveMat = new THREE.MeshStandardMaterial({ color: 0x6fb4d8, roughness: 0.3, transparent: true, opacity: 0.92, flatShading: true });

  private z = 0;              // boat position (moves towards -z)
  private speed = 0;          // current world speed (units/s)
  private time = 0;
  private strokePhase = 1;    // 0 = catch, 0.35 = finish, 1 = ready for next catch
  private strokeCycle = 2.5;  // s
  private shake = 0;
  private impulse = 0;        // extra camera shake from story events (tremor, eruption …)
  private flashLevel = 0;
  private flashColor = new THREE.Color();
  private smokeBurst = 0;
  private viewDir = 1;
  private effects: Effects;
  private story: StoryState = { lavaBombs: 0, ashfall: 0, birds: 0, unrest: 0, eruptionAge: -1, cooling: 0 };
  /** Forwarded from the effects (for sound): a lava bomb hit the water at this distance. */
  set onBombLanded(fn: ((distance: number) => void) | null) { this.effects.onBombLanded = fn; }

  constructor(canvas: HTMLCanvasElement, env: Environment, quality: QualityLevel = 'medium') {
    this._quality = quality;
    this.q = PROFILES[quality];
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: quality !== 'low', powerPreference: 'high-performance' });
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
    this.buildVolcano();
    this.wave = this.buildWave();
    this.effects = new Effects(this.scene);
    this.effects.setParticleShare(this.q.particles);
    // Painted layers replace the greybox mountains, volcano, cliffs and wave once loaded
    this.backdrop = new Backdrop();
    this.scene.add(this.backdrop.group);
    this.backdrop.onReady = () => {
      this.sky.setMountainsVisible(false);
      this.wave.visible = false;
    };
    this.setPiece = new Volcano(quality);
    this.scene.add(this.setPiece.group);
    // the main camera sees everything; the water's mirror camera leaves out the NO_REFLECTION layer
    this.camera.layers.enable(NO_REFLECTION);
    // Icebergs and shore boulders come from the model kit; the chunks are rebuilt once it is loaded
    const kitReady = NatureKit.load().then((kit) => {
      this.kit = kit;
      this.dropChunks();
    }).catch((e) => console.warn('Model kit could not be loaded, the fjord stays without icebergs', e));
    this.painted = new PaintedShore('cliffs', this.mats.mist, this.props);
    this.paintedIce = new PaintedShore('glacier', this.mats.mist, this.props);
    this.scene.add(this.painted.group, this.paintedIce.group, this.puffins.group);
    const paintedReady = Promise.all([this.painted.loaded, this.paintedIce.loaded, this.props.loaded]).then(() => this.dropChunks());
    this.ready = Promise.all([this.model.loaded, this.backdrop.loaded, kitReady, paintedReady, this.setPiece.loaded, this.puffins.loaded]).then(() => {});
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
    this.setPiece.setQuality(level);
    this.post.setSize(size.x, size.y);
    this.resizeReflection();
    // rebuild the landscape with the new detail – chunk by chunk, so the sky never shows through
    this.chunkGen++;
  }

  private dropChunks() { this.chunkGen++; }

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

  /** Ongoing story effects (lava bombs, ash, birds) – derived from the workout time. */
  setStory(state: StoryState) { this.story = state; }

  /** Play a one-shot story effect. */
  play(effect: EffectId) {
    switch (effect) {
      case 'tremor': this.impulse = Math.max(this.impulse, 1.1); break;
      case 'eruption':
        this.impulse = Math.max(this.impulse, 1.6);
        this.flash(0xffa040, 1);
        this.smokeBurst = 1;
        this.effects.volley({ boatZ: this.z, viewDir: this.viewDir, threat: 0.6 }, 5);
        break;
      case 'wave': this.impulse = Math.max(this.impulse, 0.9); break;
      case 'escape': this.flash(0xfff0c8, 0.45); break;
      default: break;
    }
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
    this.light = 0.45 + 0.55 * Math.min(1, this.env.sunIntensity / 2.2) * (1 - this.env.smoke * 0.25) + this.flashLevel * 0.4;
    this.updateChunks();
    // phase tint for the painted light: ash greys it, the eruption warms it
    this.paintTint.setRGB(1, 1, 1).lerp(new THREE.Color(0x9a948a), this.env.smoke * 0.45).lerp(new THREE.Color(1.1, 0.8, 0.62), this.env.lava * 0.35);
    // in the narrow valley the banks further than ~600 m are lost in the haze anyway
    const bankFrame = { time: this.time, boatZ: this.z, ahead: Math.min(600, this.q.chunksAhead * CHUNK), behind: 240, tint: this.paintTint, light: Math.min(1.1, this.light * 1.02) };
    this.painted.update(bankFrame);
    this.paintedIce.update(bankFrame);
    this.props.update({ time: this.time, swell: this.env.swell, tint: this.paintTint, light: bankFrame.light });
    this.puffins.update({ dt, time: this.time, boatZ: this.z, birds: this.story.birds, light: this.light, perches: this.painted.perches() });
    this.mats.fall.uniforms.uTime.value = this.time;
    this.mats.fall.uniforms.uLight.value = Math.min(1.1, this.light);
    this.updateBoat(dt);
    this.updateVolcano(dt);
    this.updateWave(dt, threat);
    this.updateCamera(dt, threat, intensity);
    this.effects.update({ dt, time: this.time, boatZ: this.z, speed: this.speed, viewDir: this.viewDir, threat, smoke: this.env.smoke, lava: this.env.lava, story: this.story });
    this.sky.update({ dt, time: this.time, camera: this.camera, boatZ: this.z, top: this.topColor, horizon: this.horizonColor, sunColor: this.sunColor, smoke: this.env.smoke, sunHeight: this.env.sunHeight });
    this.water.update({ time: this.time, boatZ: this.z, speed: this.speed, swell: this.env.swell, water: this.waterColor, sky: this.horizonColor, sunColor: this.sunColor, sunDir: this.sky.sunDir, light: this.light });
    this.backdrop.update({ dt, boatZ: this.z, camera: this.camera, horizon: this.horizonColor, light: this.light, smoke: this.env.smoke, wave: this.env.wave, threat });
    this.renderer.getDrawingBufferSize(this.bufferSize);
    this.setPiece.update({
      dt, time: this.time, boatZ: this.z, light: this.light, horizon: this.horizonColor, lava: this.env.lava, smoke: this.env.smoke,
      unrest: this.story.unrest, eruptionAge: this.story.eruptionAge, cooling: this.story.cooling, pixelHeight: this.bufferSize.y, camera: this.camera,
    });
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

  resize(width: number, height: number) {
    this.renderer.setSize(width, height, false);
    this.post.setSize(width, height);
    this.resizeReflection();
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    for (const c of this.chunks) disposeFjordChunk(c.group);
    this.post.dispose();
    this.backdrop.dispose();
    this.setPiece.dispose();
    this.puffins.dispose();
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
    this.hemi.intensity = 1.7 + this.flashLevel * 2.5;
    this.flashLevel *= Math.exp(-dt * 2.2);
    if (this.flashLevel < 0.005) this.hemi.intensity = 1.7;
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
    this.sun.color.set(e.sun); this.sun.intensity = e.sunIntensity;
    this.hemi.color.set(e.sky).lerp(new THREE.Color(0xffffff), 0.4);
    // sky: deeper colour overhead, the fog colour at the horizon so land and sky blend
    this.topColor.set(e.sky).offsetHSL(0, 0.08, -0.12);
    this.horizonColor.set(e.fog);
    this.sunColor.set(e.sun);
    this.waterColor.set(e.water);
    // ash greys the moss and dulls the ice; the eruption warms everything
    const ash = new THREE.Color(0x8a857c);
    this.mats.land.color.set(0xffffff).lerp(ash, e.smoke * 0.5).lerp(new THREE.Color(1.05, 0.85, 0.72), e.lava * 0.3);
    this.mats.ice.color.set(0xffffff).lerp(ash, e.smoke * 0.3).lerp(new THREE.Color(1.05, 0.88, 0.8), e.lava * 0.25);
    this.mats.ice.emissiveIntensity = 0.4 * (1 - e.smoke * 0.5);
    this.lavaMat.emissiveIntensity = e.lava * 2.5;
  }

  // ---------- chunks ----------

  private updateChunks() {
    const current = Math.floor(-this.z / CHUNK);
    const min = current - CHUNKS_BEHIND, max = current + this.q.chunksAhead;
    this.chunks = this.chunks.filter((c) => {
      if (c.index >= min && c.index <= max) return true;
      this.scene.remove(c.group);
      disposeFjordChunk(c.group);
      return false;
    });
    // Build missing chunks first (nearest first), then replace outdated ones (new detail level or
    // the model kit arrived). After the first fill at most one per frame, to avoid hitches; an
    // outdated chunk stays until its replacement exists, so the sky never shows through.
    const fill = this.chunks.length < 3;
    for (let n = 0; n < (fill ? 4 : 1); n++) {
      let target = -1;
      for (let i = current; i <= max && target < 0; i++) if (!this.chunks.some((c) => c.index === i)) target = i;
      for (let i = min; i < current && target < 0; i++) if (!this.chunks.some((c) => c.index === i)) target = i;
      for (let i = current; i <= max && target < 0; i++) if (this.chunks.find((c) => c.index === i)?.gen !== this.chunkGen) target = i;
      if (target < 0) break;
      const group = buildFjordChunk(target, CHUNK, this.mats, { kit: this.kit, props: this.props, detail: this.q.fjordDetail, shadows: this.sun.castShadow, paintedLeft: this.painted.ready, paintedRight: this.paintedIce.ready });
      this.scene.add(group);
      const old = this.chunks.find((c) => c.index === target);
      if (old) { this.scene.remove(old.group); disposeFjordChunk(old.group); this.chunks.splice(this.chunks.indexOf(old), 1); }
      this.chunks.push({ index: target, group, gen: this.chunkGen });
    }
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
    this.boat.rotation.x = Math.atan2(bow - stern, HULL) + Math.sin(t * 0.9) * 0.006;
    this.boat.rotation.z = Math.atan2(right - left, SPAN) + Math.sin(t * 1.1) * 0.008;

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

  // ---------- volcano & smoke ----------

  private buildVolcano() {
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x6a6670, roughness: 1, flatShading: true, fog: false });
    const cone = new THREE.Mesh(new THREE.ConeGeometry(160, 150, 9, 1, true), rockMat);
    cone.position.y = 70;
    const crater = new THREE.Mesh(new THREE.CylinderGeometry(28, 40, 12, 9), this.lavaMat);
    crater.position.y = 140;
    this.volcano.add(cone, crater);
    const smokeMat = new THREE.MeshStandardMaterial({ color: 0x3d3a3a, roughness: 1, transparent: true, opacity: 0.85, flatShading: true, fog: false });
    for (let i = 0; i < 9; i++) {
      const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), smokeMat);
      this.smoke.push(puff);
      this.volcano.add(puff);
    }
    this.volcano.position.set(110, 0, -700);
    this.scene.add(this.volcano);
  }

  private updateVolcano(_dt: number) {
    this.volcano.visible = !this.setPiece.ready;
    if (!this.volcano.visible) return;
    // Stays on the horizon, slowly drifting closer as the story escalates
    this.volcano.position.z = this.z - 700 + this.env.lava * 180;
    this.smokeBurst *= Math.exp(-_dt * 0.15);
    const s = Math.min(1.6, this.env.smoke + this.smokeBurst * 0.8);
    this.smoke.forEach((puff, i) => {
      const life = (this.time * 0.05 + i / this.smoke.length) % 1;
      const size = (8 + life * 55) * s;
      puff.scale.setScalar(Math.max(0.001, size));
      puff.position.set(Math.sin(i * 2.1) * 20 * life, 150 + life * 160 * Math.max(0.3, s), Math.cos(i * 1.7) * 15 * life);
      puff.visible = s > 0.02;
    });
  }

  // ---------- tidal wave ----------

  private buildWave(): THREE.Mesh {
    const g = new THREE.CylinderGeometry(9, 9, 60, 20, 1, true, 0, Math.PI);
    g.rotateZ(Math.PI / 2);
    const wave = new THREE.Mesh(g, this.waveMat);
    wave.material.side = THREE.DoubleSide;
    this.scene.add(wave);
    return wave;
  }

  private updateWave(_dt: number, threat: number) {
    const show = this.env.wave;
    this.wave.visible = show > 0.02 && !this.backdrop.ready;
    if (!this.wave.visible) return;
    // threat 1 → far behind, threat 0 → right at the stern
    const dist = 12 + threat * 70 + (1 - show) * 120;
    const h = 0.6 + show * 1.2;
    this.wave.position.set(0, -2, this.z + dist);
    this.wave.scale.set(1, h, 1);
    this.wave.rotation.x = Math.sin(this.time * 2) * 0.03;
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


