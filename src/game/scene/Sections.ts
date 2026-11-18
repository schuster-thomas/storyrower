import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import fjordGlb from '../../assets/sections/fjord.glb?url';
import fjordPlacements from '../../assets/sections/fjord.placements.json?url';
import { NatureKit, Scatter, type ModelId } from './NatureKit';

/** Authored river sections built in Blender (scripts/blender/section_*.py). */
const SECTIONS = [{ id: 'fjord', glb: fjordGlb, placements: fjordPlacements }];

interface Placement { m: ModelId; p: [number, number, number]; r: number; s: number }
interface PlacementFile { length: number; riverHalf: number; sunDir: [number, number, number]; items: Placement[] }

const fallVertex = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;
const fallFragment = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>
  uniform float uTime;
  uniform float uLight;
  varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  void main() {
    // The plane was rotated in Blender: u runs along the fall, v across it
    float along = vUv.x, across = vUv.y;
    float streaks = noise(vec2(across * 14.0, along * 3.0 + uTime * 2.6)) * 0.6 + noise(vec2(across * 40.0, along * 8.0 + uTime * 4.0)) * 0.4;
    float edge = smoothstep(0.0, 0.18, across) * smoothstep(1.0, 0.82, across);
    float foamBottom = smoothstep(0.25, 0.0, along);
    float alpha = clamp(edge * (0.55 + streaks * 0.5) + foamBottom * 0.6 * edge, 0.0, 0.95);
    vec3 col = mix(vec3(0.72, 0.84, 0.92), vec3(1.0), streaks) * uLight;
    gl_FragColor = vec4(col, alpha);
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

/**
 * Lines up authored sections one after another along the river (−z), each 200 m long.
 * Terrain lighting is baked (unlit material), the scanned rocks are lit live, waterfalls are
 * animated and the vegetation is placed from the section's placement file with the model kit.
 */
export class SectionTrack {
  readonly group = new THREE.Group();
  ready = false;
  /** direction towards the sun the section was lit with (three.js space) */
  sunDir = new THREE.Vector3(0.6, 0.4, 0.4).normalize();
  length = 200;
  onReady: (() => void) | null = null;

  private template: THREE.Group | null = null;
  /** built sections by index, with the settings generation they were built for */
  private live = new Map<number, { g: THREE.Group; gen: number }>();
  private gen = 0;
  private bakedMats: THREE.MeshBasicMaterial[] = [];
  private fallMat: THREE.ShaderMaterial;
  private placements: Placement[] = [];
  private density = 1;

  constructor(private kit: Promise<NatureKit>) {
    this.fallMat = new THREE.ShaderMaterial({
      vertexShader: fallVertex, fragmentShader: fallFragment, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uLight: { value: 1 } }]),
    });
    this.load().catch((e) => console.warn('River sections could not be loaded, keeping the generated landscape', e));
  }

  /** Share of the vegetation that is drawn (graphics level). Rebuilds the sections. */
  setDensity(share: number, shadows: boolean) {
    if (share === this.density && shadows === this.shadows) return;
    this.density = share;
    this.shadows = shadows;
    // Don't tear the world down (that showed the bright sky for a few frames): sections are
    // swapped one by one in update(), each old one stays until its replacement exists.
    this.gen++;
  }
  private shadows = true;

  private async load() {
    const s = SECTIONS[0];
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    const [gltf, file, kit] = await Promise.all([
      loader.loadAsync(s.glb),
      fetch(s.placements).then((r) => r.json() as Promise<PlacementFile>),
      this.kit,
    ]);
    this.length = file.length;
    this.sunDir.fromArray(file.sunDir).normalize();
    this.placements = file.items;

    const scene = gltf.scene;
    scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const m = mesh.material as THREE.MeshStandardMaterial;
      if (m.name === 'Baked_Terrain') {
        // light is already in the texture → unlit, but fogged and tinted by the phase
        const baked = new THREE.MeshBasicMaterial({ map: m.map, fog: true });
        this.bakedMats.push(baked);
        mesh.material = baked;
        mesh.receiveShadow = false;
      } else if (m.name === 'Waterfall') {
        mesh.material = this.fallMat;
        mesh.renderOrder = 2;
      } else {
        m.envMapIntensity = 0;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      }
    });
    this.template = scene;
    this.kitRef = kit;
    this.ready = true;
    this.onReady?.();
  }
  private kitRef: NatureKit | null = null;

  private build(index: number): THREE.Group {
    const g = new THREE.Group();
    g.add(this.template!.clone());
    // vegetation from the placement file (thinned out on lower graphics levels)
    const s = new Scatter(this.kitRef!);
    let k = 0;
    for (const it of this.placements) {
      const keep = it.m.startsWith('Iceberg') || it.m.startsWith('Rock') || (k++ % 100) / 100 < this.density;
      if (keep) s.add(it.m, it.p[0], it.p[1], it.p[2], it.s, it.r);
    }
    s.build(g, { cast: this.shadows });
    g.position.z = -index * this.length;
    return g;
  }

  private drop(g: THREE.Group) {
    this.group.remove(g);
    g.traverse((o) => { if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose(); });
  }

  /** Keep the sections around the boat alive; tint baked light with the phase. */
  update(p: { time: number; boatZ: number; ahead: number; light: number; tint: THREE.Color }) {
    if (!this.ready) return;
    const cur = Math.floor(-p.boatZ / this.length);
    const min = cur - 1, max = cur + Math.max(1, Math.ceil(p.ahead / this.length));
    for (const [i, e] of this.live) if (i < min || i > max) { this.drop(e.g); this.live.delete(i); }
    // build at most one section per frame: missing ones first (nearest first), then outdated ones
    const order = [cur, ...Array.from({ length: max - cur }, (_, k) => cur + 1 + k), cur - 1];
    const target = order.find((i) => !this.live.has(i)) ?? order.find((i) => this.live.get(i)!.gen !== this.gen);
    if (target !== undefined) {
      const g = this.build(target);
      this.group.add(g);
      const old = this.live.get(target);
      if (old) this.drop(old.g);
      this.live.set(target, { g, gen: this.gen });
    }
    for (const m of this.bakedMats) m.color.copy(p.tint).multiplyScalar(p.light);
    this.fallMat.uniforms.uTime.value = p.time;
    this.fallMat.uniforms.uLight.value = p.light;
  }
}
