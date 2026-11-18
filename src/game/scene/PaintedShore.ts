import * as THREE from 'three';
import { type GLTF, GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import cliffsUrl from '../../assets/painted/cliffs.glb?url';
import cliffsBUrl from '../../assets/painted/cliffs-b.glb?url';
import glacierUrl from '../../assets/painted/glacier.glb?url';
import glacierBUrl from '../../assets/painted/glacier-b.glb?url';
import lupinesUrl from '../../assets/painted/lupines.webp';
import { SHORE_SECTION } from './Fjord';
import type { PaintedProps } from './PaintedProps';
import type { Perch } from './Fjord';

/**
 * A river bank as painted sections – basalt cliffs on the left, the glacier front on the right
 * (matte-painting approach, scripts/blender/painted_shore.py): simple geometry with a painting
 * projected onto it, so the light, detail and style come from the painting while the banks still
 * pass by with real depth. Sections are 120 m long and alternate normal / mirrored, so neighbours
 * always meet without a seam; two different sections per bank (a, b – the same profile at their
 * ends) are chained a, a mirrored, b, b mirrored, so the river repeats only every 480 m.
 *
 * Things that must stand upright would lie flat if they were only projected onto the ground, so
 * they are added on top: lupine clumps as painted cut-out cards swaying in the wind, and the
 * waterfalls as an arched, flowing sheet with foam and swirling mist at their foot.
 */
export type BankKind = 'cliffs' | 'glacier';

interface Assets { gltfs: GLTF[]; lupines: THREE.Texture | null }

const URLS: Record<BankKind, string[]> = { cliffs: [cliffsUrl, cliffsBUrl], glacier: [glacierUrl, glacierBUrl] };

const LUPINE_TILES = [1, 2, 3];     // atlas tiles with complete clumps (scripts/painted/sprites.mjs)

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
/** A real waterfall sheet: strands of water at three speeds, a bright lip, ragged see-through
 *  edges where the sheet breaks into strands, and white water at the foot. */
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
    float across = vUv.x, along = vUv.y;            // along = 1 at the lip, 0 at the foot
    float t = uTime;
    float s1 = noise(vec2(across * 8.0, along * 2.2 + t * 2.0));
    float s2 = noise(vec2(across * 24.0, along * 5.5 + t * 3.3));
    float s3 = noise(vec2(across * 64.0, along * 13.0 + t * 5.2));
    float strands = s1 * 0.5 + s2 * 0.32 + s3 * 0.18;
    float edge = smoothstep(0.0, 0.2, across) * smoothstep(1.0, 0.8, across);
    float ragged = smoothstep(0.22, 0.5, strands * (0.6 + 0.6 * edge) + edge * 0.35);
    float lip = smoothstep(1.0, 0.95, along);
    float foot = smoothstep(0.2, 0.0, along);
    vec3 deep = vec3(0.42, 0.62, 0.74);
    vec3 white = vec3(0.97, 0.99, 1.0);
    vec3 col = mix(deep, white, smoothstep(0.3, 0.75, strands));
    col = mix(col, white, smoothstep(0.86, 0.98, along) * 0.6 + foot);
    float alpha = edge * ragged * lip * (0.78 + 0.22 * strands);
    alpha = max(alpha, foot * edge * 0.92);
    gl_FragColor = vec4(col * uLight, clamp(alpha, 0.0, 0.97));
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

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

  private templates: THREE.Object3D[] = [];
  private materials = new Map<THREE.Material, THREE.MeshBasicMaterial>();
  private lupineMat: THREE.MeshBasicMaterial | null = null;
  private lupineTime = { value: 0 };
  private live = new Map<number, THREE.Object3D>();
  private fallMat: THREE.ShaderMaterial;
  private foamMat: THREE.ShaderMaterial;
  private sprayMat = new THREE.PointsMaterial({ color: 0xf4fbff, size: 0.28, transparent: true, opacity: 0.85, depthWrite: false, fog: true });
  private spray: { geo: THREE.BufferGeometry; vel: Float32Array; life: Float32Array } | null = null;
  private lastTime = 0;

  private sprayGeometry() {
    if (!this.spray) {
      const n = 90;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
      this.spray = { geo, vel: new Float32Array(n * 3), life: new Float32Array(n).map(() => Math.random() * 1.2) };
    }
    return this.spray.geo;
  }

  /** droplets leap out from the foot of the fall towards the river and drop back */
  private updateSpray(dt: number) {
    if (!this.spray) return;
    const { geo, vel, life } = this.spray;
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const a = pos.array as Float32Array;
    for (let i = 0; i < life.length; i++) {
      life[i] -= dt;
      if (life[i] <= 0) {
        life[i] = 0.7 + Math.random() * 0.7;
        a.set([0, 0, (Math.random() - 0.5) * 3], i * 3);
        vel.set([0.6 + Math.random() * 2.2, 1.2 + Math.random() * 2.4, (Math.random() - 0.5) * 1.2], i * 3);
      }
      vel[i * 3 + 1] -= 6 * dt;
      a[i * 3] += vel[i * 3] * dt;
      a[i * 3 + 1] = Math.max(0, a[i * 3 + 1] + vel[i * 3 + 1] * dt);
      a[i * 3 + 2] += vel[i * 3 + 2] * dt;
    }
    pos.needsUpdate = true;
  }
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
      p = Promise.all([Promise.all(URLS[kind].map((u) => loader.loadAsync(u))), lupines]).then(([gltfs, tex]) => ({ gltfs, lupines: tex }));
      p.catch(() => { this.loading.delete(kind); });
      this.loading.set(kind, p);
    }
    return p;
  }

  constructor(kind: BankKind, mist: THREE.SpriteMaterial, private props: PaintedProps) {
    // every section is built as a left bank; the glacier is mirrored onto the right bank
    if (kind === 'glacier') this.group.scale.x = -1;
    this.fallMat = new THREE.ShaderMaterial({
      vertexShader: fallVertex, fragmentShader: fallFragment, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uLight: { value: 1 } }]),
    });
    this.foamMat = new THREE.ShaderMaterial({
      vertexShader: foamVertex, fragmentShader: foamFragment, transparent: true, depthWrite: false, fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uLight: { value: 1 } }]),
    });
    this.mistMat = mist.clone();
    this.loaded = Promise.all([PaintedShore.preload(kind), props.loaded]).then(([{ gltfs, lupines }]) => {
      // the loaded scenes are cached for every later run ("Row again"): work on copies
      this.templates = gltfs.map((g, i) => this.prepare(g.scene.clone(), lupines, i));
      this.ready = true;
    }).catch((e) => console.warn(`Painted ${kind} could not be loaded, keeping the generated bank`, e));
  }

  private prepare(root: THREE.Object3D, lupines: THREE.Texture | null, variant: number) {
    root.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const src = mesh.material as THREE.MeshStandardMaterial;
      // the light is painted in: unlit, but fogged and tinted with the phase
      // one material per painting (side view and the two views along the river)
      let mat = this.materials.get(src);
      if (!mat) {
        mat = new THREE.MeshBasicMaterial({ map: src.map, fog: true, side: THREE.DoubleSide });
        this.materials.set(src, mat);
      }
      mesh.material = mat;
    });
    root.updateMatrixWorld(true);
    this.replaceRock(root, variant);
    this.addWaterfalls(root);
    if (lupines) this.addLupines(root, lupines);
    return root;
  }

  /**
   * The rock in the water was painted with the bank, seen only from across the river, so it smears
   * from the boat: swap it for the painted prop (variant a: the low puffins' rock, b: the basalt
   * sea stack), which is painted from all sides.
   */
  private replaceRock(root: THREE.Object3D, variant: number) {
    const old = root.getObjectByName('PuffinRock');
    if (!old) return;
    const id = variant === 0 ? 'Rock_A' : 'Rock_B';
    const model = this.props.get(id);
    if (!model) return;
    old.visible = false;
    const box = new THREE.Box3().setFromObject(old);
    const rock = new THREE.Group();
    rock.name = 'Rock';
    for (const p of model.parts) rock.add(new THREE.Mesh(p.geometry, p.material));
    // about the old rock's footprint; waterline at y = 0
    const scale = variant === 0 ? 1.45 : 1.15;
    rock.scale.setScalar(scale);
    rock.position.set((box.min.x + box.max.x) / 2, 0, (box.min.z + box.max.z) / 2);
    rock.rotation.y = variant === 0 ? 0.4 : -0.3;
    root.add(rock);
    root.updateMatrixWorld(true);
    // where the puffins sit: spots on the top of the rock (the low rock's flat top, the sea stack's
    // highest column), found by casting rays down onto it; kept as plain numbers (clone copies userData)
    const top = (model.size.y + model.minY) * scale;
    const reach = variant === 0 ? 1.7 : 0.45;
    const ray = new THREE.Raycaster();
    const spots: number[][] = [];
    for (let n = 0; n < 60 && spots.length < (variant === 0 ? 5 : 2); n++) {
      const a = n * 2.39996, r = reach * Math.sqrt((n + 0.5) / 60);
      const x = rock.position.x + Math.cos(a) * r, z = rock.position.z + Math.sin(a) * r;
      ray.set(new THREE.Vector3(x, 60, z), new THREE.Vector3(0, -1, 0));
      const hit = ray.intersectObject(rock, true)[0];
      if (!hit || hit.point.y < top * 0.8 || !hit.face || hit.face.normal.clone().transformDirection(hit.object.matrixWorld).y < 0.6) continue;
      if (spots.some(([sx, , sz]) => Math.hypot(sx - x, sz - z) < 0.8)) continue;   // room for the bigger birds
      spots.push([x, hit.point.y, z]);
    }
    root.userData.perch = spots;
  }

  /** World positions of the puffins' spots on the rocks of the sections around the boat, per section. */
  perches(): Perch[] {
    const out: Perch[] = [];
    for (const [k, g] of this.live) {
      const spots = g.userData.perch as number[][] | undefined;
      if (!spots?.length) continue;
      g.updateMatrixWorld();
      out.push({ key: k, side: -1, spots: spots.map(([x, y, z]) => new THREE.Vector3(x, y, z).applyMatrix4(g.matrixWorld)) });
    }
    return out;
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
        // spray thrown up where the water hits the river (one shared, animated point cloud)
        const spray = new THREE.Points(this.sprayGeometry(), this.sprayMat);
        spray.position.set(marker.position.x + 0.9, 0.1, marker.position.z);
        spray.frustumCulled = false;
        spray.renderOrder = 4;
        root.add(spray);
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
    const falls = ['Fall_Lower', 'Fall_Upper'].map((n) => root.getObjectByName(n)).filter((o) => !!o);
    if (!this.lupineMat) this.lupineMat = this.makeLupineMat(tex);
    const ray = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    const per = new Map<number, THREE.Matrix4[]>(LUPINE_TILES.map((t) => [t, []]));
    let seed = 7;
    const r = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
    for (let n = 0; n < 560; n++) {
      // section-local: on the open, low shore they spread up the slopes; along the tall cliffs the
      // rays hit the cliff tops (too high) except on the ledge at the water; none where a
      // waterfall comes down
      const z = -r() * SHORE_SECTION;
      if (falls.some((f) => Math.abs(z - f.position.z) < f.scale.x * 0.5 + 4)) continue;
      const x = -14 - (0.4 + r() * 16);
      ray.set(new THREE.Vector3(x, 200, z), down);
      const hit = ray.intersectObject(bank, true)[0];
      if (!hit || hit.point.y < 0.3 || hit.point.y > 7 || !hit.face || hit.face.normal.clone().transformDirection(hit.object.matrixWorld).y < 0.7) continue;
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

  private makeLupineMat(tex: THREE.Texture) {
    const mat = new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, fog: true });
    const time = this.lupineTime;
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = time;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;')
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          vec4 basePos = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
          float sway = sin(uTime * 1.6 + basePos.x * 0.35 + basePos.z * 0.22) + 0.4 * sin(uTime * 3.1 + basePos.z);
          transformed.x += sway * 0.07 * position.y * position.y;`);
    };
    return mat;
  }

  /** Keep the sections around the boat; tint the painted light with the phase. */
  update(p: { time: number; boatZ: number; ahead: number; behind: number; tint: THREE.Color; light: number }) {
    if (!this.templates.length) return;
    const cur = Math.floor(-p.boatZ / SHORE_SECTION);
    const min = cur - Math.ceil(p.behind / SHORE_SECTION), max = cur + Math.ceil(p.ahead / SHORE_SECTION);
    for (const [k, g] of this.live) if (k < min || k > max) { this.group.remove(g); this.live.delete(k); }
    for (let k = min; k <= max; k++) {
      if (this.live.has(k)) continue;
      // a, a mirrored, b, b mirrored, … (both variants have the same profile at their ends)
      const n = this.templates.length;
      const g = this.templates[((Math.floor(k / 2) % n) + n) % n].clone();
      // even sections as painted, odd ones mirrored along the river
      if (k % 2 === 0) g.position.z = -k * SHORE_SECTION;
      else { g.scale.z = -1; g.position.z = -(k + 1) * SHORE_SECTION; }
      this.group.add(g);
      this.live.set(k, g);
    }
    for (const m of this.materials.values()) m.color.copy(p.tint).multiplyScalar(p.light);
    this.lupineMat?.color.copy(p.tint).multiplyScalar(p.light);
    this.lupineTime.value = p.time;
    this.updateSpray(Math.min(0.1, Math.max(0, p.time - this.lastTime)));
    this.lastTime = p.time;
    this.sprayMat.color.setRGB(0.96, 0.98, 1).multiplyScalar(p.light);
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
