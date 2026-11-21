import * as THREE from 'three';
import type { EffectId } from '../../../story/story';
import type { Environment } from '../../levels/level';
import { CardField, type Card } from '../Cards';
import type { QualityLevel, QualityProfile } from '../quality';
import type { LevelWorld, WorldFrame, WorldHost } from '../World';
import { BEACH_OFFSET, beachMaterials, buildBeachChunk, CHUNK, disposeBeachChunk, type BeachChunk, type BeachMaterials, type Floater } from './Beach';
import { loadKit, type MauritiusKit } from './kit';
import { SeaClouds } from './Clouds';
import { Shark } from './Shark';
import { Storm } from './Storm';
import { Visitors } from './Visitors';
import manifest from '../../../assets/levels/mauritius/assets.json';
import coastUrl from '../../../assets/levels/mauritius/coast.webp';
import palmsUrl from '../../../assets/levels/mauritius/palms.webp';
import tropicUrl from '../../../assets/levels/mauritius/tropic.webp';

const CHUNKS_BEHIND = 2;
/** The painted coast with the mountain: an arc on the right, from just left of straight ahead round to behind. */
const COAST_RADIUS = 640;
const COAST_FROM = -0.62;    // radians right of straight ahead (negative = left): where the headland meets the horizon
const COAST_TO = 2.5;
const COAST_SQUASH = 0.34;

type Key = 'coast' | 'palms' | 'tropic';
const URLS: Record<Key, string> = { coast: coastUrl, palms: palmsUrl, tropic: tropicUrl };
const smooth = (x: number) => { const c = Math.max(0, Math.min(1, x)); return c * c * (3 - 2 * c); };

/**
 * Mauritius Shark Madness: a lagoon off the south-west coast of the island. On the left only the
 * open sea with surf on the reef; on the right a white beach with palms, loungers and black rocks,
 * jungle hills and the great basalt monolith behind. People paddle, windsurf and water-ski. Then
 * clouds gather, a fin appears far out, a thunderstorm breaks with rain and lightning, the fin
 * circles closer – until the shark attacks the boat. After the escape the storm clears and the
 * rower glides into a low, soft sunset over the sea.
 */
export class MauritiusWorld implements LevelWorld {
  private static textures: Promise<Record<Key, THREE.Texture>> | null = null;
  private static loadTextures() {
    if (!this.textures) {
      const loader = new THREE.TextureLoader();
      this.textures = Promise.all((Object.keys(URLS) as Key[]).map((k) => loader.loadAsync(URLS[k]).then((t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 4;
        return [k, t] as const;
      }))).then((pairs) => Object.fromEntries(pairs) as Record<Key, THREE.Texture>);
      this.textures.catch(() => { this.textures = null; });
    }
    return this.textures;
  }
  static preload() { return Promise.all([this.loadTextures(), loadKit()]); }

  readonly ready: Promise<void>;
  private scene: THREE.Scene;
  private q: QualityProfile;
  private kit: MauritiusKit | null = null;
  private mats: BeachMaterials | null = null;
  private chunks: BeachChunk[] = [];
  private chunkGen = 0;
  private chunkKey = '';
  private fields: { palms: CardField; tropic: CardField } | null = null;
  private floaters: Floater[] = [];
  private coast: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial> | null = null;
  private coastFade: THREE.Texture | null = null;
  private storm: Storm;
  private clouds = new SeaClouds();
  private shark: Shark | null = null;
  private visitors: Visitors | null = null;
  private tint = new THREE.Color();
  private haze = new THREE.Color();
  private camera: THREE.PerspectiveCamera | null = null;

  constructor(private host: WorldHost, _quality: QualityLevel) {
    this.scene = host.scene;
    this.q = host.quality;
    // no left bank: the sea runs on to the horizon, surf breaks on a reef out there; a turquoise
    // lagoon with sunlight on its sandy bottom before the beach on the right
    host.water.openSea(true);
    host.water.milk = 0.75;
    host.water.setLook({ rightOffset: BEACH_OFFSET, milkReach: 22, reef: 1, caustics: 1, rain: 0 });
    host.sky.setMountainsVisible(false);
    this.storm = new Storm(host);
    this.scene.add(this.storm.group, this.clouds.group);
    this.ready = Promise.all([MauritiusWorld.loadTextures(), loadKit()]).then(([tex, kit]) => this.build(tex, kit))
      .catch((e) => console.warn('Mauritius could not be loaded', e));
  }

  private build(tex: Record<Key, THREE.Texture>, kit: MauritiusKit) {
    this.kit = kit;
    this.mats = beachMaterials(kit);
    const a = manifest as unknown as Record<string, { aspect?: number; aspects?: number[] }>;
    this.fields = { palms: new CardField(tex.palms, a.palms.aspects!, 1300), tropic: new CardField(tex.tropic, a.tropic.aspects!, 800) };
    this.scene.add(this.fields.palms.mesh, this.fields.tropic.mesh);
    this.coast = this.arc(tex.coast, a.coast.aspect!);
    this.shark = new Shark(this.host, kit.shark);
    this.visitors = new Visitors(this.host, kit, this.host.water);
    this.scene.add(this.shark.group, this.visitors.group);
  }

  /** The painted coast on a partial cylinder round the boat (follows it like the far mountains). */
  private arc(map: THREE.Texture, aspect: number) {
    // three.js cylinders: x = r·sin θ, z = r·cos θ – straight ahead (−z) is θ = π, so "a radians
    // right of ahead" is θ = π − a. The picture runs from the headland (ahead-left) to behind-right.
    const len = COAST_TO - COAST_FROM;
    const height = ((COAST_RADIUS * len) / aspect) * COAST_SQUASH;
    map.wrapS = THREE.RepeatWrapping;
    map.repeat.x = -1;
    map.offset.x = 1;
    // the headland ahead fades into the haze over the sea instead of ending in a cut
    const c = document.createElement('canvas');
    c.width = 256; c.height = 1;
    const g = c.getContext('2d')!;
    const grad = g.createLinearGradient(0, 0, 256, 0);
    grad.addColorStop(0, '#fff'); grad.addColorStop(0.86, '#fff'); grad.addColorStop(1, '#000');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 1);
    this.coastFade = new THREE.CanvasTexture(c);
    const mat = new THREE.MeshBasicMaterial({ map, alphaMap: this.coastFade, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(COAST_RADIUS, COAST_RADIUS, height, 80, 1, true, Math.PI - COAST_TO, len), mat);
    mesh.position.y = height / 2 - 3;
    mesh.renderOrder = -6;
    this.scene.add(mesh);
    return mesh;
  }

  setQuality(_level: QualityLevel, profile: QualityProfile) {
    this.q = profile;
    this.chunkGen++;
  }

  applyEnvironment(_env: Environment) {}

  play(effect: EffectId, boatZ: number) {
    switch (effect) {
      case 'visitors': this.visitors?.speedboatNow(boatZ); break;
      // far away over the sea: a first rumble of thunder
      case 'clouds': this.host.sound('thunder', 1400); break;
      case 'thunderstorm': if (this.camera) this.storm.strike(boatZ, this.camera, true); break;
      case 'shark':
        this.shark?.attackNow();
        this.host.shake(0.8);
        break;
      case 'escape': this.host.flash(0xffd9a8, 0.4); break;
      default: break;
    }
  }

  update(f: WorldFrame) {
    this.camera = f.camera;
    const s = f.story;
    const storm = s.storm;
    this.updateChunks(f.boatZ);

    // the lagoon: sunlight on the sand while it is fine, rain on the surface in the thunderstorm
    const rain = Math.max(0, (storm - 0.55) / 0.45);
    this.host.water.setLook({ caustics: (1 - smooth(storm * 1.6)) * Math.min(1, f.env.sunHeight * 3), rain });
    this.host.sky.overcast = smooth(storm * 1.3);
    // under the storm clouds everything gets darker
    this.host.dim(smooth(storm) * 0.5);

    // painted cut-outs are unlit: follow the scene light and take on the evening colour; the palms
    // whip about in the storm, bent over towards the sea
    this.tint.setRGB(1, 1, 1).lerp(f.horizon, 0.08 + Math.max(0, 0.32 - f.env.sunHeight) * 1.3).multiplyScalar(Math.min(1.08, f.light));
    if (this.fields) {
      // far palms fade into the hazy jungle green of the painted hills, not into the blue sky
      this.haze.setHex(0x5d8a58).lerp(f.horizon, 0.3).multiplyScalar(Math.min(1, f.light));
      this.fields.palms.setHaze(this.haze, 0.85);
      this.fields.tropic.setHaze(this.haze, 0.85);
      this.fields.palms.update(f.time, 0, this.tint, 1 + storm * 3.5, -storm * 0.09);
      this.fields.tropic.update(f.time, 0, this.tint, 1 + storm * 2.5, -storm * 0.05);
    }
    if (this.coast) {
      this.coast.position.x = 0;
      this.coast.position.z = f.boatZ;
      const l = Math.max(0.35, f.light);
      // hazier in the storm; warm and a little backlit when the sun is low over the sea
      const evening = Math.max(0, 0.3 - f.env.sunHeight) * 2;
      this.clouds.update({ dt: f.dt, boatZ: f.boatZ, storm, horizon: f.horizon, light: f.light, evening });
      this.coast.material.color.setRGB(l, l, l).lerp(f.horizon, 0.18 + storm * 0.3 + evening * 0.3).multiplyScalar((1 - smooth(storm) * 0.35) * (1 - evening * 0.2));
    }
    for (const fl of this.floaters) {
      const y = this.host.water.surfaceAt(fl.x, fl.z, f.time, f.env.swell);
      fl.obj.position.y = y - fl.sink;
      fl.obj.rotation.z = Math.sin(f.time * 1.2 + fl.seed) * 0.05 * (0.4 + f.env.swell);
      fl.obj.rotation.x = Math.sin(f.time * 0.9 + fl.seed * 2) * 0.04 * (0.4 + f.env.swell);
    }
    const effort = Math.max(s.attack, Math.min(1, f.env.swell));
    this.storm.update({ dt: f.dt, time: f.time, boatZ: f.boatZ, camera: f.camera, storm, effort, light: f.light, share: this.q.particles });
    this.shark?.update({ dt: f.dt, time: f.time, boatZ: f.boatZ, presence: s.shark, age: s.sharkAge, near: s.sharkNear, attack: s.attack, threat: f.threat });
    this.visitors?.update({ dt: f.dt, time: f.time, boatZ: f.boatZ, speed: f.speed, swell: f.env.swell, visitors: s.visitors });
  }

  private updateChunks(boatZ: number) {
    if (!this.kit || !this.mats) return;
    const current = Math.floor(-boatZ / CHUNK);
    const min = current - CHUNKS_BEHIND, max = current + this.q.chunksAhead;
    let changed = false;
    this.chunks = this.chunks.filter((c) => {
      if (c.index >= min && c.index <= max) return true;
      this.scene.remove(c.group);
      disposeBeachChunk(c);
      changed = true;
      return false;
    });
    // nearest missing chunk first; after the first fill one per frame (no hitches)
    const fill = this.chunks.length < 3;
    for (let n = 0; n < (fill ? 4 : 1); n++) {
      let target = -1;
      for (let i = current; i <= max && target < 0; i++) if (!this.chunks.some((c) => c.index === i)) target = i;
      for (let i = min; i < current && target < 0; i++) if (!this.chunks.some((c) => c.index === i)) target = i;
      for (let i = current; i <= max && target < 0; i++) if ((this.chunks.find((c) => c.index === i)?.group.userData.gen) !== this.chunkGen) target = i;
      if (target < 0) break;
      const chunk = buildBeachChunk(target, this.mats, this.kit, this.host.shadows);
      chunk.group.userData.gen = this.chunkGen;
      this.scene.add(chunk.group);
      const old = this.chunks.find((c) => c.index === target);
      if (old) { this.scene.remove(old.group); disposeBeachChunk(old); this.chunks.splice(this.chunks.indexOf(old), 1); }
      this.chunks.push(chunk);
      changed = true;
    }
    const key = this.chunks.map((c) => c.index).sort((x, y) => x - y).join(',');
    if (changed || key !== this.chunkKey) {
      this.chunkKey = key;
      if (this.fields) {
        this.fields.palms.set(this.chunks.flatMap((c) => c.cards.palms) as Card[]);
        this.fields.tropic.set(this.chunks.flatMap((c) => c.cards.tropic) as Card[]);
      }
      this.floaters = this.chunks.flatMap((c) => c.floaters);
    }
  }

  dispose() {
    for (const c of this.chunks) disposeBeachChunk(c);
    this.chunks = [];
    if (this.fields) { this.fields.palms.dispose(); this.fields.tropic.dispose(); }
    if (this.coast) { this.coast.geometry.dispose(); this.coast.material.dispose(); }
    this.coastFade?.dispose();
    this.storm.dispose();
    this.clouds.dispose();
    this.shark?.dispose();
    this.visitors?.dispose();
    if (this.mats) for (const m of Object.values(this.mats)) m.dispose();
    this.host.water.openSea(false);
    this.host.water.setLook({ rightOffset: 0, milkReach: 16, reef: 0, caustics: 0, rain: 0 });
    this.host.sky.overcast = 0;
    this.host.dim(0);
  }
}
