import * as THREE from 'three';
import { type GLTF, GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import cliffsUrl from '../../assets/painted/cliffs.glb?url';
import glacierUrl from '../../assets/painted/glacier.glb?url';
import lupinesUrl from '../../assets/painted/lupines.webp';
import { SHORE_SECTION } from './Fjord';

/**
 * A river bank as painted sections – basalt cliffs on the left, the glacier front on the right
 * (matte-painting approach, scripts/blender/painted_shore.py): simple geometry with a painting
 * projected onto it, so the light, detail and style come from the painting while the banks still
 * pass by with real depth. Sections are 120 m long and alternate normal / mirrored, so neighbours
 * always meet without a seam.
 *
 * Things that must stand upright would lie flat if they were only projected onto the ground, so
 * they are added on top: lupine clumps as painted cut-out cards swaying in the wind, and the
 * waterfalls as an arched, flowing sheet with foam and swirling mist at their foot.
 */
export type BankKind = 'cliffs' | 'glacier';

interface Assets { gltf: GLTF; lupines: THREE.Texture | null }

const LUPINE_TILES = [1, 2, 3];     // atlas tiles with complete clumps (scripts/painted/sprites.mjs)

const foamVertex = /* glsl */ `
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
const foamFragment = /* glsl */ `
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
    vec2 c = vUv - 0.5;
    float r = length(c) * 2.0;
    // foam rings pushed outwards from where the water hits the river
    float rings = noise(vec2(atan(c.y, c.x) * 3.0, r * 6.0 - uTime * 1.6)) * 0.7 + noise(vec2(c * 18.0 + uTime * 0.4)) * 0.3;
    float a = smoothstep(1.0, 0.25, r) * (0.45 + rings * 0.6);
    gl_FragColor = vec4(vec3(0.94, 0.98, 1.0) * uLight, clamp(a, 0.0, 0.9));
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

export class PaintedShore {
  readonly group = new THREE.Group();
  ready = false;
  readonly loaded: Promise<void>;

  private template: THREE.Object3D | null = null;
  private material: THREE.MeshBasicMaterial | null = null;
  private lupineMat: THREE.MeshBasicMaterial | null = null;
  private lupineTime = { value: 0 };
  private live = new Map<number, THREE.Object3D>();
  private fallMat: THREE.ShaderMaterial;
  private foamMat: THREE.ShaderMaterial;
  private mistMat: THREE.SpriteMaterial;

  private static loading = new Map<BankKind, Promise<Assets>>();
  static preload(kind: BankKind): Promise<Assets> {
    let p = this.loading.get(kind);
    if (!p) {
      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);
      const lupines = kind === 'cliffs'
        ? new THREE.TextureLoader().loadAsync(lupinesUrl).then((t) => { t.colorSpace = THREE.SRGBColorSpace; return t; }).catch(() => null)
        : Promise.resolve(null);
      p = Promise.all([loader.loadAsync(kind === 'cliffs' ? cliffsUrl : glacierUrl), lupines]).then(([gltf, tex]) => ({ gltf, lupines: tex }));
      p.catch(() => { this.loading.delete(kind); });
      this.loading.set(kind, p);
    }
    return p;
  }

  constructor(kind: BankKind, fall: THREE.ShaderMaterial, mist: THREE.SpriteMaterial) {
    // every section is built as a left bank; the glacier is mirrored onto the right bank
    if (kind === 'glacier') this.group.scale.x = -1;
    // the fjord's waterfall shader, a little softer: the painting already shows the water
    this.fallMat = fall.clone();
    this.fallMat.uniforms.uAlpha.value = 0.75;
    this.foamMat = new THREE.ShaderMaterial({
      vertexShader: foamVertex, fragmentShader: foamFragment, transparent: true, depthWrite: false, fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uLight: { value: 1 } }]),
    });
    this.mistMat = mist.clone();
    this.loaded = PaintedShore.preload(kind).then(({ gltf, lupines }) => {
      const root = gltf.scene;
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const src = mesh.material as THREE.MeshStandardMaterial;
        // the light is painted in: unlit, but fogged and tinted with the phase
        this.material ??= new THREE.MeshBasicMaterial({ map: src.map, fog: true, side: THREE.DoubleSide });
        mesh.material = this.material;
      });
      root.updateMatrixWorld(true);
      this.addWaterfalls(root);
      if (lupines) this.addLupines(root, lupines);
      this.template = root;
      this.ready = true;
    }).catch((e) => console.warn(`Painted ${kind} could not be loaded, keeping the generated bank`, e));
  }

  /** Arched falling sheets at the markers (scale = width × height), foam and mist at the foot. */
  private addWaterfalls(root: THREE.Object3D) {
    for (const name of ['Fall_Lower', 'Fall_Upper']) {
      const marker = root.getObjectByName(name);
      if (!marker) continue;
      const w = marker.scale.x, h = marker.scale.y;
      // the water leaves the lip and arcs a little away from the rock on its way down
      const g = new THREE.PlaneGeometry(1, 1, 1, 14);
      const pos = g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) {
        const fallen = 0.5 - pos.getY(i);                       // 0 at the lip, 1 at the foot
        pos.setZ(i, 0.9 * Math.sin(fallen * Math.PI * 0.6));
      }
      g.computeVertexNormals();
      const sheet = new THREE.Mesh(g, this.fallMat);
      sheet.position.copy(marker.position);
      sheet.scale.set(w, h, 1);
      sheet.rotation.y = Math.PI / 2; // face the river
      sheet.renderOrder = 2;
      root.add(sheet);
      const footY = marker.position.y - h / 2;
      if (name === 'Fall_Lower') {
        const foam = new THREE.Mesh(new THREE.PlaneGeometry(w * 2.6, w * 2.6).rotateX(-Math.PI / 2), this.foamMat);
        foam.position.set(marker.position.x + 1.6, 0.08, marker.position.z);
        foam.renderOrder = 3;
        root.add(foam);
      }
      for (let k = 0; k < 3; k++) {
        const m = new THREE.Sprite(this.mistMat);
        const s = w * (1.4 + k * 0.7);
        m.scale.set(s, s * 0.6, 1);
        m.position.set(marker.position.x + 1.2 + k * 0.8, Math.max(0.6, footY) + s * 0.18, marker.position.z + (k - 1) * 1.2);
        root.add(m);
      }
    }
  }

  /**
   * Lupine clumps standing on the ledge at the water, right beside the boat (the bench above the
   * cliff is hidden from the river). Placed by casting rays onto the bank.
   */
  private addLupines(root: THREE.Object3D, tex: THREE.Texture) {
    const bank = root.getObjectByName('Bank');
    if (!bank) return;
    this.lupineMat = new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, fog: true });
    const time = this.lupineTime;
    this.lupineMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = time;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vec4 basePos = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          float sway = sin(uTime * 1.6 + basePos.x * 0.35 + basePos.z * 0.22) + 0.4 * sin(uTime * 3.1 + basePos.z);
          transformed.x += sway * 0.07 * position.y * position.y;`);
    };
    const ray = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    const per = new Map<number, THREE.Matrix4[]>(LUPINE_TILES.map((t) => [t, []]));
    let seed = 7;
    const r = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    for (let n = 0; n < 200; n++) {
      // section-local: the ledge at the water (3.6 m wide, scripts/blender/painted_shore.py), all
      // along the section except where the waterfall comes down (z ≈ -76)
      const z = -r() * SHORE_SECTION;
      if (Math.abs(z + 76) < 7) continue;
      const x = -14 - (0.4 + r() * 2.8);
      ray.set(new THREE.Vector3(x, 200, z), down);
      const hit = ray.intersectObject(bank, true)[0];
      if (!hit || hit.point.y < 0.3 || hit.point.y > 2.5 || !hit.face || hit.face.normal.clone().transformDirection(hit.object.matrixWorld).y < 0.7) continue;
      const tile = LUPINE_TILES[Math.floor(r() * LUPINE_TILES.length)];
      const size = 0.9 + r() * 0.7;
      p.copy(hit.point).y -= 0.08;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), r() * Math.PI);
      sc.set(size, size, size);
      per.get(tile)!.push(m.compose(p, q, sc).clone());
    }
    for (const [tile, mats] of per) {
      if (!mats.length) continue;
      const inst = new THREE.InstancedMesh(lupineCard(tile), this.lupineMat, mats.length);
      mats.forEach((mt, i) => inst.setMatrixAt(i, mt));
      inst.computeBoundingSphere();
      root.add(inst);
    }
  }

  /** Keep the sections around the boat; tint the painted light with the phase. */
  update(p: { time: number; boatZ: number; ahead: number; behind: number; tint: THREE.Color; light: number }) {
    if (!this.template) return;
    const cur = Math.floor(-p.boatZ / SHORE_SECTION);
    const min = cur - Math.ceil(p.behind / SHORE_SECTION), max = cur + Math.ceil(p.ahead / SHORE_SECTION);
    for (const [k, g] of this.live) if (k < min || k > max) { this.group.remove(g); this.live.delete(k); }
    for (let k = min; k <= max; k++) {
      if (this.live.has(k)) continue;
      const g = this.template.clone();
      // even sections as painted, odd ones mirrored along the river
      if (k % 2 === 0) g.position.z = -k * SHORE_SECTION;
      else { g.scale.z = -1; g.position.z = -(k + 1) * SHORE_SECTION; }
      this.group.add(g);
      this.live.set(k, g);
    }
    this.material?.color.copy(p.tint).multiplyScalar(p.light);
    this.lupineMat?.color.copy(p.tint).multiplyScalar(p.light);
    this.lupineTime.value = p.time;
    this.fallMat.uniforms.uTime.value = p.time;
    this.fallMat.uniforms.uLight.value = p.light;
    this.foamMat.uniforms.uTime.value = p.time;
    this.foamMat.uniforms.uLight.value = p.light;
    this.mistMat.rotation = Math.sin(p.time * 0.4) * 0.25;
    this.mistMat.opacity = 0.55 + 0.15 * Math.sin(p.time * 1.3);
  }
}

/** Two crossed upright quads (1 × 1, base at y = 0) showing one tile of the lupine atlas. */
function lupineCard(tile: number): THREE.BufferGeometry {
  const a = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
  const b = a.clone().rotateY(Math.PI / 2);
  const g = new THREE.BufferGeometry();
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (const [k, part] of [a, b].entries()) {
    const pa = part.attributes.position as THREE.BufferAttribute, ua = part.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < pa.count; i++) {
      pos.push(pa.getX(i), pa.getY(i), pa.getZ(i));
      uv.push((tile + ua.getX(i)) / 4, ua.getY(i));
    }
    for (const i of Array.from(part.index!.array)) idx.push(i + k * 4);
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}
