import * as THREE from 'three';
import type { EffectId } from '../../story/story';
import type { Environment } from '../levels/level';
import { Backdrop } from './Backdrop';
import { Calving } from './Calving';
import { buildFjordChunk, createFjordMaterials, disposeFjordChunk, type Perch } from './Fjord';
import { NatureKit } from './NatureKit';
import { PaintedProps } from './PaintedProps';
import { PaintedShore } from './PaintedShore';
import { Puffins } from './Puffins';
import type { QualityLevel, QualityProfile } from './quality';
import { TidalWave } from './TidalWave';
import { Volcano } from './Volcano';
import type { LevelWorld, WorldFrame, WorldHost } from './World';

const CHUNK = 100;         // length of one fjord chunk (m)
const CHUNKS_BEHIND = 3;   // the finale camera looks back at the wave

interface Chunk { index: number; group: THREE.Group; gen: number }

/**
 * Iceland Volcano Run: an endless glacier lagoon made of chunks (mossy basalt slopes on the left,
 * a glacier front on the right), painted banks, icebergs, puffins, the volcano in the distance and
 * a tidal wave that chases the boat.
 */
export class IcelandWorld implements LevelWorld {
  static preload() {
    return Promise.all([Backdrop.preload(), NatureKit.load(), PaintedShore.preload('cliffs'), PaintedShore.preload('glacier'), Volcano.preload(), PaintedProps.preload(), Puffins.preload()]);
  }

  readonly ready: Promise<void>;
  private scene: THREE.Scene;
  private mats = createFjordMaterials();
  private chunks: Chunk[] = [];
  /** bumped when chunks must be rebuilt (graphics level, model kit loaded) */
  private chunkGen = 0;
  private q: QualityProfile;
  private kit: NatureKit | null = null;
  private backdrop: Backdrop;
  /** painted banks (replace the generated slopes and glacier once loaded) */
  private painted: PaintedShore;
  private paintedIce: PaintedShore;
  /** painted icebergs and rocks in the water */
  private props = new PaintedProps();
  private puffins = new Puffins();
  private calving: Calving;
  /** the painted volcano with flowing lava, plume and fountain (the greybox `volcano` is its stand-in) */
  private setPiece: Volcano;
  private paintTint = new THREE.Color();
  private volcano = new THREE.Group();
  private lavaMat = new THREE.MeshStandardMaterial({ color: 0x3a2a24, emissive: 0xff4a10, emissiveIntensity: 0, roughness: 1, flatShading: true, fog: false });
  private smoke: THREE.Mesh[] = [];
  private smokeBurst = 0;
  private wave: TidalWave;
  private env: Environment | null = null;

  constructor(private host: WorldHost, quality: QualityLevel) {
    const scene = this.scene = host.scene;
    this.q = host.quality;
    this.buildVolcano();
    this.wave = new TidalWave(this.q.particles);
    scene.add(this.wave.group);
    this.calving = new Calving(this.props);
    this.calving.onSwell = () => { host.shake(0.9); host.rock(0.14); };
    scene.add(this.calving.group);
    // Painted layers replace the greybox mountains once loaded
    this.backdrop = new Backdrop();
    scene.add(this.backdrop.group);
    this.backdrop.onReady = () => {
      host.sky.setMountainsVisible(false);
    };
    this.setPiece = new Volcano(quality);
    scene.add(this.setPiece.group);
    // Icebergs and shore boulders come from the model kit; the chunks are rebuilt once it is loaded
    const kitReady = NatureKit.load().then((kit) => {
      this.kit = kit;
      this.chunkGen++;
    }).catch((e) => console.warn('Model kit could not be loaded, the fjord stays without icebergs', e));
    this.painted = new PaintedShore('cliffs', this.mats.mist, this.props);
    this.paintedIce = new PaintedShore('glacier', this.mats.mist, this.props);
    scene.add(this.painted.group, this.paintedIce.group, this.puffins.group);
    const paintedReady = Promise.all([this.painted.loaded, this.paintedIce.loaded, this.props.loaded]).then(() => { this.chunkGen++; });
    this.ready = Promise.all([this.backdrop.loaded, kitReady, paintedReady, this.setPiece.loaded, this.puffins.loaded]).then(() => {});
  }

  setQuality(level: QualityLevel, profile: QualityProfile) {
    this.q = profile;
    this.setPiece.setQuality(level);
    // rebuild the landscape with the new detail – chunk by chunk, so the sky never shows through
    this.chunkGen++;
  }

  play(effect: EffectId, boatZ: number) {
    if (effect === 'calving') this.calving.start(boatZ);
    if (effect === 'eruption') this.smokeBurst = 1;
  }

  applyEnvironment(e: Environment) {
    this.env = e;
    // ash greys the moss and dulls the ice; the eruption warms everything
    const ash = new THREE.Color(0x8a857c);
    this.mats.land.color.set(0xffffff).lerp(ash, e.smoke * 0.5).lerp(new THREE.Color(1.05, 0.85, 0.72), e.lava * 0.3);
    this.mats.ice.color.set(0xffffff).lerp(ash, e.smoke * 0.3).lerp(new THREE.Color(1.05, 0.88, 0.8), e.lava * 0.25);
    this.mats.ice.emissiveIntensity = 0.4 * (1 - e.smoke * 0.5);
    this.lavaMat.emissiveIntensity = e.lava * 2.5;
  }

  update(f: WorldFrame) {
    const env = f.env;
    this.updateChunks(f.boatZ);
    // phase tint for the painted light: ash greys it, the eruption warms it
    this.paintTint.setRGB(1, 1, 1).lerp(new THREE.Color(0x9a948a), env.smoke * 0.45).lerp(new THREE.Color(1.1, 0.8, 0.62), env.lava * 0.35);
    // in the narrow valley the banks further than ~600 m are lost in the haze anyway
    const bankFrame = { time: f.time, boatZ: f.boatZ, ahead: Math.min(600, this.q.chunksAhead * CHUNK), behind: 240, tint: this.paintTint, light: Math.min(1.1, f.light * 1.02) };
    this.painted.update(bankFrame);
    this.paintedIce.update(bankFrame);
    this.props.update({ time: f.time, swell: env.swell, tint: this.paintTint, light: bankFrame.light });
    this.puffins.update({ dt: f.dt, time: f.time, boatZ: f.boatZ, birds: f.story.birds, light: f.light, swell: env.swell, perches: [...this.painted.perches(), ...this.chunks.flatMap((c) => (c.group.userData.perches ?? []) as Perch[])] });
    this.mats.fall.uniforms.uTime.value = f.time;
    this.mats.fall.uniforms.uLight.value = Math.min(1.1, f.light);
    this.updateVolcano(f);
    this.backdrop.update({ dt: f.dt, boatZ: f.boatZ, camera: f.camera, horizon: f.horizon, light: f.light, smoke: env.smoke });
    this.setPiece.update({
      dt: f.dt, time: f.time, boatZ: f.boatZ, light: f.light, horizon: f.horizon, lava: env.lava, smoke: env.smoke,
      unrest: f.story.unrest, eruptionAge: f.story.eruptionAge, cooling: f.story.cooling, pixelHeight: f.pixelHeight, camera: f.camera,
    });
    this.calving.prepare(f.boatZ, f.speed, f.story.calvingIn);
    this.calving.update({ dt: f.dt, time: f.time, boatZ: f.boatZ, light: f.light, pixelHeight: f.pixelHeight, camera: f.camera });
    this.wave.update({
      time: f.time, boatZ: f.boatZ, wave: env.wave, threat: f.threat, light: f.light, tint: this.paintTint,
      sunDir: f.sunDir, pixelHeight: f.pixelHeight, camera: f.camera,
    });
  }

  dispose() {
    for (const c of this.chunks) disposeFjordChunk(c.group);
    this.backdrop.dispose();
    this.setPiece.dispose();
    this.puffins.dispose();
    this.wave.dispose();
    this.calving.dispose();
  }

  // ---------- chunks ----------

  private updateChunks(boatZ: number) {
    const current = Math.floor(-boatZ / CHUNK);
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
      const group = buildFjordChunk(target, CHUNK, this.mats, { kit: this.kit, props: this.props, detail: this.q.fjordDetail, shadows: this.host.shadows, paintedLeft: this.painted.ready, paintedRight: this.paintedIce.ready });
      this.scene.add(group);
      const old = this.chunks.find((c) => c.index === target);
      if (old) { this.scene.remove(old.group); disposeFjordChunk(old.group); this.chunks.splice(this.chunks.indexOf(old), 1); }
      this.chunks.push({ index: target, group, gen: this.chunkGen });
    }
  }

  // ---------- greybox volcano & smoke (stand-in until the painted one is loaded) ----------

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

  private updateVolcano(f: WorldFrame) {
    this.volcano.visible = !this.setPiece.ready;
    if (!this.volcano.visible || !this.env) return;
    // Stays on the horizon, slowly drifting closer as the story escalates
    this.volcano.position.z = f.boatZ - 700 + this.env.lava * 180;
    this.smokeBurst *= Math.exp(-f.dt * 0.15);
    const s = Math.min(1.6, this.env.smoke + this.smokeBurst * 0.8);
    this.smoke.forEach((puff, i) => {
      const life = (f.time * 0.05 + i / this.smoke.length) % 1;
      const size = (8 + life * 55) * s;
      puff.scale.setScalar(Math.max(0.001, size));
      puff.position.set(Math.sin(i * 2.1) * 20 * life, 150 + life * 160 * Math.max(0.3, s), Math.cos(i * 1.7) * 15 * life);
      puff.visible = s > 0.02;
    });
  }
}
