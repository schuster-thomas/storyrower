import * as THREE from 'three';
import type { EffectId, StoryState } from '../../story/story';
import type { Environment } from '../levels/iceland';
import { Effects } from './Effects';
import { FrameStats, PROFILES, type QualityLevel, type QualityProfile } from './quality';
import { Sky } from './Sky';
import { buildChunk, createTerrainMaterials, disposeChunk } from './Terrain';
import { Water } from './Water';

const CHUNK = 40;          // length of one world chunk (m)
const CHUNKS_BEHIND = 2;
const RIVER_HALF = 9;      // half river width
/** World units per real metre. >1 makes the boat feel faster than the real split. */
export const SPEED_SCALE = 2;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

interface Chunk { index: number; group: THREE.Group }

/**
 * Greybox river world: endless river made of chunks, a rowing boat whose oars follow the
 * real strokes, a volcano in the distance and a tidal wave that chases the boat.
 */
export class RiverScene {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1200);
  private hemi = new THREE.HemisphereLight(0xffffff, 0x445533, 1.2);
  private sun = new THREE.DirectionalLight(0xffffff, 2);

  private env: Environment;
  private envTarget: Environment;
  private skyColor = new THREE.Color();
  private mats = createTerrainMaterials();
  private water: Water;
  private sky: Sky;
  private chunks: Chunk[] = [];
  private q: QualityProfile;
  private _quality: QualityLevel;
  /** frame time, render time, draw calls and triangles – for the diagnostics overlay and recordings */
  readonly stats = new FrameStats();
  private topColor = new THREE.Color();
  private horizonColor = new THREE.Color();
  private sunColor = new THREE.Color();
  private waterColor = new THREE.Color();

  private boat = new THREE.Group();
  private torso!: THREE.Group;
  private oars: { pivot: THREE.Group; side: 1 | -1 }[] = [];
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
  private story: StoryState = { lavaBombs: 0, ashfall: 0, birds: 0 };
  /** Forwarded from the effects (for sound): a lava bomb hit the water at this distance. */
  set onBombLanded(fn: ((distance: number) => void) | null) { this.effects.onBombLanded = fn; }

  constructor(canvas: HTMLCanvasElement, env: Environment, quality: QualityLevel = 'medium') {
    this._quality = quality;
    this.q = PROFILES[quality];
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: quality !== 'low', powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.q.pixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.env = { ...env };
    this.envTarget = { ...env };
    this.scene.fog = new THREE.Fog(env.fog, env.fogNear, env.fogFar);

    this.sun.position.set(-40, 80, 30);
    this.scene.add(this.hemi, this.sun, this.sun.target);

    this.sky = new Sky(this.q.clouds);
    this.scene.add(this.sky.group);
    this.water = new Water(RIVER_HALF, this.q.waterSegments);
    this.scene.add(this.water.mesh);

    this.buildBoat();
    this.buildVolcano();
    this.wave = this.buildWave();
    this.effects = new Effects(this.scene);
    this.effects.setParticleShare(this.q.particles);
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
    this.sky.setCloudCount(this.q.clouds);
    this.effects.setParticleShare(this.q.particles);
    // rebuild the landscape with the new density
    for (const c of this.chunks) { this.scene.remove(c.group); disposeChunk(c.group); }
    this.chunks = [];
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
    this.updateChunks();
    this.updateBoat(dt);
    this.updateVolcano(dt);
    this.updateWave(dt, threat);
    this.updateCamera(dt, threat, intensity);
    this.effects.update({ dt, time: this.time, boatZ: this.z, speed: this.speed, viewDir: this.viewDir, threat, smoke: this.env.smoke, lava: this.env.lava, story: this.story });
    this.sky.update({ dt, time: this.time, camera: this.camera, boatZ: this.z, top: this.topColor, horizon: this.horizonColor, sunColor: this.sunColor, smoke: this.env.smoke, sunHeight: this.env.sunHeight });
    this.water.update({ time: this.time, boatZ: this.z, speed: this.speed, swell: this.env.swell, water: this.waterColor, sky: this.horizonColor, sunColor: this.sunColor, sunDir: this.sky.sunDir, light: 0.45 + 0.55 * Math.min(1, this.env.sunIntensity / 2.2) * (1 - this.env.smoke * 0.25) + this.flashLevel * 0.4 });
    this.sun.position.copy(this.sky.sunDir).multiplyScalar(120).add(new THREE.Vector3(0, 0, this.z));
    this.sun.target.position.set(0, 0, this.z);

    const t0 = performance.now();
    this.renderer.render(this.scene, this.camera);
    const info = this.renderer.info.render;
    this.stats.calls = info.calls;
    this.stats.triangles = info.triangles;
    this.stats.push(dt * 1000, performance.now() - t0);
  }

  resize(width: number, height: number) {
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    for (const c of this.chunks) disposeChunk(c.group);
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
    this.hemi.intensity = 1.2 + this.flashLevel * 2.5;
    this.flashLevel *= Math.exp(-dt * 2.2);
    if (this.flashLevel < 0.005) this.hemi.intensity = 1.2;
  }

  private applyEnvironment(t: number) {
    const e = this.env, g = this.envTarget;
    for (const k of ['fogNear', 'fogFar', 'sunIntensity', 'lava', 'smoke', 'wave', 'swell', 'sunHeight'] as const) e[k] = lerp(e[k], g[k], t);
    for (const k of ['sky', 'fog', 'sun', 'ground', 'water'] as const) e[k] = new THREE.Color(e[k]).lerp(new THREE.Color(g[k]), t).getHex();

    this.skyColor.set(e.sky);
    this.scene.background = this.skyColor;
    const fog = this.scene.fog as THREE.Fog;
    fog.color.set(e.fog); fog.near = e.fogNear; fog.far = e.fogFar;
    this.sun.color.set(e.sun); this.sun.intensity = e.sunIntensity;
    this.hemi.color.set(e.sky);
    // sky: deeper colour overhead, the fog colour at the horizon so land and sky blend
    this.topColor.set(e.sky).offsetHSL(0, 0.08, -0.12);
    this.horizonColor.set(e.fog);
    this.sunColor.set(e.sun);
    this.waterColor.set(e.water);
    // ash greys the landscape
    const ash = new THREE.Color(0x77736c);
    this.mats.ground.color.set(0xffffff).lerp(ash, e.smoke * 0.45).lerp(new THREE.Color(e.ground), 0.15);
    this.mats.tree.color.set(0x2f6b3a).lerp(new THREE.Color(0x3a3d33), e.smoke * 0.6);
    this.mats.lupine.color.set(0x8e66c4).lerp(ash, e.smoke * 0.5);
    this.lavaMat.emissiveIntensity = e.lava * 2.5;
  }

  // ---------- chunks ----------

  private updateChunks() {
    const current = Math.floor(-this.z / CHUNK);
    const min = current - CHUNKS_BEHIND, max = current + this.q.chunksAhead;
    this.chunks = this.chunks.filter((c) => {
      if (c.index >= min && c.index <= max) return true;
      this.scene.remove(c.group);
      disposeChunk(c.group);
      return false;
    });
    // after the first fill, build at most one new chunk per frame to avoid hitches
    let built = 0;
    for (let i = min; i <= max; i++) {
      if (this.chunks.some((c) => c.index === i)) continue;
      const group = buildChunk(i, CHUNK, RIVER_HALF, this.q, this.mats);
      this.scene.add(group);
      this.chunks.push({ index: i, group });
      if (++built >= 1 && this.chunks.length > 4) break;
    }
  }

  // ---------- boat ----------

  private buildBoat() {
    const hullMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.4 });
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0xd8333b, roughness: 0.5 });
    const oarMat = new THREE.MeshStandardMaterial({ color: 0x222831, roughness: 0.6 });
    const bladeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xe0b48f, roughness: 0.8 });
    const shirtMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.7 });

    const hull = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 6.5, 4, 10), hullMat);
    hull.rotation.x = Math.PI / 2;
    hull.scale.set(1, 1, 0.45);
    hull.position.y = 0.15;
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 5.5), stripeMat);
    stripe.position.set(0, 0.36, 0);
    this.boat.add(hull, stripe);

    // Rower: torso pivots at the hips to lean with the stroke
    this.torso = new THREE.Group();
    this.torso.position.set(0, 0.55, 0.4);
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.6, 4, 8), shirtMat);
    body.position.y = 0.45;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), skinMat);
    head.position.y = 1.05;
    this.torso.add(body, head);
    this.boat.add(this.torso);

    // Oars on riggers
    for (const side of [-1, 1] as const) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.75, 0.75, 0.1);
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 3.6, 6), oarMat);
      shaft.rotation.z = Math.PI / 2;
      shaft.position.x = side * 1.2;
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.22, 0.03), bladeMat);
      blade.position.x = side * 2.95;
      pivot.add(shaft, blade);
      this.boat.add(pivot);
      this.oars.push({ pivot, side });
    }
    this.scene.add(this.boat);
  }

  private updateBoat(dt: number) {
    // Advance the stroke cycle; hold at the catch until the next real stroke arrives
    if (this.strokePhase < 1) this.strokePhase = Math.min(1, this.strokePhase + dt / this.strokeCycle);
    const p = this.strokePhase;
    const drive = p < 0.35;
    const k = drive ? p / 0.35 : (p - 0.35) / 0.65;           // progress within drive/recovery
    const sweep = drive ? lerp(0.75, -0.55, easeInOut(k)) : lerp(-0.55, 0.75, easeInOut(k)); // + = towards the bow
    const lift = drive ? -0.12 : 0.18 * Math.sin(Math.PI * k);
    for (const o of this.oars) {
      o.pivot.rotation.y = -o.side * sweep * 0.9;
      o.pivot.rotation.z = o.side * (lift - 0.08);
    }
    this.torso.rotation.x = drive ? lerp(0.45, -0.35, easeInOut(k)) : lerp(-0.35, 0.45, easeInOut(k));
    this.torso.position.z = drive ? lerp(0.0, 0.5, k) : lerp(0.5, 0.0, k);

    this.boat.position.set(0, Math.sin(this.time * 1.7) * 0.04 * (1 + this.env.swell * 3), this.z);
    this.boat.rotation.z = Math.sin(this.time * 1.1) * 0.015 * (1 + this.env.swell * 4);
    this.boat.rotation.x = Math.sin(this.time * 0.9) * 0.01 * (1 + this.env.swell * 3);
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
    this.wave.visible = show > 0.02;
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
    const a = Math.PI * w * w * w; // eruption (0.6) ≈ 40° three-quarter view, finale (1) = 180°
    const f = a / Math.PI;
    this.viewDir = Math.cos(a) >= 0 ? 1 : -1;
    const r = 8.5 + 3 * Math.sin(a) + 2.5 * f;
    this.camera.position.set(sx + Math.sin(a) * r + Math.sin(this.time * 0.3) * 0.3, 3.4 + 2.6 * f + sy, this.z + Math.cos(a) * r);
    this.camera.lookAt(-Math.sin(a) * 4, 1.2 - 0.7 * f, this.z - Math.cos(a) * (12 - 2 * f));
  }
}

function easeInOut(t: number) { return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2; }
