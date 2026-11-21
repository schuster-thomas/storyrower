import * as THREE from 'three';
import type { EffectId } from '../../../story/story';
import type { Environment } from '../../levels/level';
import type { QualityLevel, QualityProfile } from '../quality';
import type { LevelWorld, WorldFrame, WorldHost } from '../World';
import { buildTokyoChunk, CHUNK, createTokyoMaterials, disposeTokyoChunk, type FacadeSpot, type TokyoChunk, type TokyoMaterials } from './Banks';
import { CardField, type Card } from '../Cards';
import { Debris } from './Debris';
import { Dragon } from './Dragon';
import { loadKit, type Kit } from './kit';
import { Petals } from './Petals';
import manifest from '../../../assets/levels/tokyo/assets.json';
import farUrl from '../../../assets/levels/tokyo/far.webp';
import skylineUrl from '../../../assets/levels/tokyo/skyline.webp';
import sakuraUrl from '../../../assets/levels/tokyo/sakura.webp';
import gardenUrl from '../../../assets/levels/tokyo/garden.webp';
import shrubsUrl from '../../../assets/levels/tokyo/shrubs.webp';
import treesUrl from '../../../assets/levels/tokyo/trees.webp';
import towerUrl from '../../../assets/levels/tokyo/tower.webp';

const CHUNKS_BEHIND = 2;
const FAR_RADIUS = 800;       // the volcano on the horizon
const FAR_SQUASH = 0.36;      // a distant giant, not a wall
const CITY_RADIUS = 430;      // the high-rises between the river and the volcano
const CITY_SQUASH = 0.4;
const TOWER_HEIGHT = 190;

type Key = 'far' | 'skyline' | 'sakura' | 'garden' | 'shrubs' | 'trees' | 'tower';
const URLS: Record<Key, string> = { far: farUrl, skyline: skylineUrl, sakura: sakuraUrl, garden: gardenUrl, shrubs: shrubsUrl, trees: treesUrl, tower: towerUrl };
type Fields = Record<'sakura' | 'garden' | 'shrubs' | 'trees', CardField>;

/**
 * Tokyo Super Row: a river through Tokyo in cherry-blossom season, modelled in 3D – a Japanese
 * garden behind a granite wall on the left (lawn, gravel path, rocks, lanterns, a tea house, a
 * pagoda), a promenade with high-rises on the right, arched vermilion bridges and a tunnel of torii.
 * Trees and bushes are painted cut-outs; behind everything the lattice tower, a band of high-rises
 * and the snow-capped volcano. The story: petals on the water, tremors, a great quake that breaks
 * parts off the high-rises, a dragon that fires lasers at the rower – and blossoms again at the end.
 */
export class TokyoWorld implements LevelWorld {
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
  static preload() {
    return Promise.all([this.loadTextures(), loadKit(), Dragon.preload()]);
  }

  readonly ready: Promise<void>;
  private scene: THREE.Scene;
  private q: QualityProfile;
  private kit: Kit | null = null;
  private mats: TokyoMaterials | null = null;
  private chunks: TokyoChunk[] = [];
  private chunkGen = 0;
  private chunkKey = '';
  private fields: Fields | null = null;
  private tower: CardField | null = null;
  private rings: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>[] = [];
  private petals: Petals;
  private debris: Debris | null = null;
  private dragon: Dragon;
  private spots: FacadeSpot[] = [];
  private tremble = 0;
  private tint = new THREE.Color();

  constructor(private host: WorldHost, _quality: QualityLevel) {
    this.scene = host.scene;
    this.q = host.quality;
    host.water.milk = 0;   // no glacier: clear river water right up to the wall
    this.petals = new Petals(host.water);
    this.dragon = new Dragon(host);
    this.scene.add(this.petals.group, this.dragon.group);
    this.ready = Promise.all([TokyoWorld.loadTextures(), loadKit()]).then(([tex, kit]) => this.build(tex, kit))
      .then(() => this.dragon.loaded)
      .catch((e) => console.warn('Tokyo could not be loaded', e));
  }

  private build(tex: Record<Key, THREE.Texture>, kit: Kit) {
    this.kit = kit;
    this.mats = createTokyoMaterials(kit);
    this.debris = new Debris(this.host, this.mats.city.facades);
    this.scene.add(this.debris.group);
    const a = manifest as unknown as Record<string, { aspect?: number; aspects?: number[] }>;
    this.fields = {
      sakura: new CardField(tex.sakura, a.sakura.aspects!, 600),
      garden: new CardField(tex.garden, a.garden.aspects!, 200),
      shrubs: new CardField(tex.shrubs, a.shrubs.aspects!, 400),
      trees: new CardField(tex.trees, a.trees.aspects!, 400),
    };
    this.tower = new CardField(tex.tower, [a.tower.aspect!], 1);
    this.scene.add(...Object.values(this.fields).map((f) => f.mesh), this.tower.mesh);
    // painted rings around the boat (mirrored behind, like the Iceland mountains): the volcano far
    // away, a band of high-rises in front of it
    this.rings.push(this.ring(tex.far, a.far.aspect!, FAR_RADIUS, FAR_SQUASH, -0.19, -4, -6));
    this.rings.push(this.ring(tex.skyline, a.skyline.aspect!, CITY_RADIUS, CITY_SQUASH, 0.22, -6, -5));
    this.host.sky.setMountainsVisible(false);
  }

  private ring(map: THREE.Texture, aspect: number, radius: number, squash: number, offset: number, lift: number, order: number) {
    map.wrapS = THREE.MirroredRepeatWrapping;
    map.repeat.x = 2;
    map.offset.x = offset;
    const height = ((Math.PI * radius) / aspect) * squash;
    const mat = new THREE.MeshBasicMaterial({ map, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide });
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 96, 1, true, Math.PI / 2, Math.PI * 2), mat);
    ring.scale.x = -1;
    ring.position.y = height / 2 + lift;
    ring.renderOrder = order;
    this.scene.add(ring);
    return ring;
  }

  setQuality(_level: QualityLevel, profile: QualityProfile) {
    this.q = profile;
    this.chunkGen++;
  }

  /** The look is read from each frame (cut-outs follow the light and the horizon colour). */
  applyEnvironment(_env: Environment) {}

  play(effect: EffectId, boatZ: number) {
    switch (effect) {
      case 'blossom': this.petals.burst(); break;
      case 'tremor': this.tremble = Math.max(this.tremble, 1); break;
      case 'quake':
        this.tremble = 1.6;
        this.host.shake(1.7);
        this.host.flash(0xe8d8b8, 0.35);
        this.debris?.volley(this.spots, boatZ, 5);
        break;
      case 'dragon':
        this.host.shake(0.8);
        this.host.flash(0x4fb4ff, 0.5);
        break;
      case 'escape':
        // the dragon soars away – blossoms everywhere again
        this.petals.burst();
        this.host.flash(0xffd6e8, 0.45);
        break;
      default: break;
    }
  }

  update(f: WorldFrame) {
    const env = f.env;
    this.updateChunks(f.boatZ);
    const quake = f.story.quake;
    this.tremble = Math.max(0, this.tremble - f.dt * 0.35);
    const shake = Math.min(1.6, this.tremble + quake * 0.6);
    // the city trembles with the quake
    for (const c of this.chunks) c.city.position.set(Math.sin(f.time * 23 + c.index) * 0.08 * shake, Math.sin(f.time * 31 + c.index * 2) * 0.03 * shake, 0);

    // painted cut-outs are unlit: follow the scene light and take on the evening / dusk colour
    this.tint.setRGB(1, 1, 1).lerp(f.horizon, 0.1 + Math.max(0, 0.32 - env.sunHeight) * 1.2).multiplyScalar(Math.min(1.08, f.light));
    if (this.fields) for (const field of Object.values(this.fields)) field.update(f.time, shake, this.tint);
    if (this.tower) {
      this.tower.update(f.time, shake * 0.3, this.tint);
      // ahead and to the right of the river, rising high above the waterfront
      this.tower.set([{ x: 32, y: -2, z: f.boatZ - 360, tile: 0, height: TOWER_HEIGHT }]);
    }
    const light = Math.max(0.4, f.light);
    for (const [i, ring] of this.rings.entries()) {
      ring.position.x = 0;
      ring.position.z = f.boatZ;
      ring.material.color.setRGB(light, light, light).lerp(f.horizon, i === 0 ? 0.3 : 0.2);
    }
    this.petals.update({ dt: f.dt, time: f.time, boatZ: f.boatZ, swell: env.swell, light: f.light, share: this.q.particles, amount: 1 - 0.6 * Math.min(1, quake + f.story.dragon * 0.5) });
    this.debris?.update({ dt: f.dt, boatZ: f.boatZ, quake, light: f.light, spots: this.spots });
    this.dragon.update({ dt: f.dt, time: f.time, boatZ: f.boatZ, presence: f.story.dragon, age: f.story.dragonAge, attack: f.story.attack, threat: f.threat, light: f.light });
  }

  private updateChunks(boatZ: number) {
    if (!this.kit || !this.mats) return;
    const current = Math.floor(-boatZ / CHUNK);
    const min = current - CHUNKS_BEHIND, max = current + this.q.chunksAhead;
    let changed = false;
    this.chunks = this.chunks.filter((c) => {
      if (c.index >= min && c.index <= max) return true;
      this.scene.remove(c.group);
      disposeTokyoChunk(c);
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
      const chunk = buildTokyoChunk(target, this.mats, this.kit, this.host.shadows);
      chunk.group.userData.gen = this.chunkGen;
      this.scene.add(chunk.group);
      const old = this.chunks.find((c) => c.index === target);
      if (old) { this.scene.remove(old.group); disposeTokyoChunk(old); this.chunks.splice(this.chunks.indexOf(old), 1); }
      this.chunks.push(chunk);
      changed = true;
    }
    const key = this.chunks.map((c) => c.index).sort((x, y) => x - y).join(',');
    if (changed || key !== this.chunkKey) {
      this.chunkKey = key;
      if (this.fields) for (const k of Object.keys(this.fields) as (keyof Fields)[]) this.fields[k].set(this.chunks.flatMap((c) => c.cards[k]) as Card[]);
      this.spots = this.chunks.flatMap((c) => c.facades);
    }
  }

  dispose() {
    for (const c of this.chunks) disposeTokyoChunk(c);
    this.chunks = [];
    if (this.fields) for (const f of Object.values(this.fields)) f.dispose();
    this.tower?.dispose();
    for (const r of this.rings) { r.geometry.dispose(); r.material.dispose(); }
    this.petals.dispose();
    this.debris?.dispose();
    this.dragon.dispose();
    if (this.mats) {
      // the kit's textures are shared by every run and stay loaded
      const all = [this.mats.painted, ...Object.values(this.mats.city).flat(), ...Object.values(this.mats.garden)] as THREE.Material[];
      for (const m of all) m.dispose();
      this.mats.torii.dispose();
    }
  }
}
