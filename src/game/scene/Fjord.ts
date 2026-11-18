import * as THREE from 'three';
import { type NatureKit, Scatter } from './NatureKit';
import type { PaintedProps } from './PaintedProps';

// ---------- shape of the fjord (pure functions of world z, mirrored in the water shader) ----------

/** Painted bank sections are 120 m long and alternate normal / mirrored, so both bank lines are
 * symmetric about every multiple of 120 m (same functions in scripts/blender/painted_shore.py).
 * The river is narrow – about 30 m – so the landscape is right beside the boat. */
export const SHORE_SECTION = 120;
const bankWave = (z: number) => { const w = (2 * Math.PI * z) / (2 * SHORE_SECTION); return 1.5 * Math.cos(w) + 0.8 * Math.cos(3 * w); };
/** Distance from the boat's lane (x = 0) to the left bank (basalt cliffs). */
export const leftShore = (z: number) => 14 + bankWave(z);
/** Distance from the boat's lane to the glacier front on the right. */
export const glacierFront = (z: number) => 16 + bankWave(z);
/** The same two functions in GLSL, for the water shader (shallows, glacier milk, foam). */
export const FJORD_GLSL = /* glsl */ `
  float bankWave(float z) { float w = 6.2831853 * z / 240.0; return 1.5 * cos(w) + 0.8 * cos(3.0 * w); }
  float leftShore(float z) { return 14.0 + bankWave(z); }
  float glacierFront(float z) { return 16.0 + bankWave(z); }
`;

// ---------- deterministic noise ----------
function hash(x: number, y: number) {
  const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function noise(x: number, y: number) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/**
 * Height of the left shore at `d` metres inland: a basalt cliff straight out of the water,
 * then angular terraces (flat mossy treads, steep rock risers) climbing to snowy tops.
 */
function slopeHeight(d: number, z: number) {
  if (d < 0) return -4;
  // shore cliff of basalt columns: each ~5 m column has its own height
  const cliff = 5 + 9 * noise(z * 0.02, 3.1) + hash(Math.floor(z / 5), 1.3) * 3;
  const raw = cliff * smooth(0, 2, d) + Math.max(0, d - 2) * (0.55 + 0.35 * noise(z * 0.006, 7.7)) + noise(d * 0.03, z * 0.02) * 26 * smooth(8, 50, d);
  const step = 7 + 5 * noise(z * 0.01, 5.2);
  // wobbly terrace edges, so the steps don't run in straight lines
  const t = raw / step + (noise(d * 0.06, z * 0.05) - 0.5) * 0.5;
  const k = Math.floor(t), f = t - k;
  // most of each step is a gently tilted tread, the last 30 % a steep riser
  return Math.max(cliff * smooth(0, 2, d), (k + 0.12 * f + 0.88 * smooth(0.7, 1, f)) * step);
}

/** Height of the glacier `e` metres behind its front: an ice cliff, seracs, then a rising ice field. */
function glacierHeight(e: number, x: number, z: number) {
  if (e < 0) return -4;
  // ice cliff split into serac columns of different heights
  const front = 16 + 12 * noise(z * 0.015, 1.7) + hash(Math.floor(z / 7), 4.4) * 9;
  // blocky seracs near the front, smoother further back
  const block = hash(Math.floor(x / 9), Math.floor(z / 9)) * 9 * (1 - smooth(40, 140, e));
  const field = Math.max(0, e - 3) * 0.16 + noise(x * 0.01, z * 0.01) * 25 * smooth(60, 200, e);
  return front * smooth(0, 1.5, e) + block * smooth(1, 6, e) + field;
}

// ---------- palette ----------
const C = {
  moss: [new THREE.Color(0x76a83c), new THREE.Color(0x8fb84a), new THREE.Color(0x63933a)],
  mossDark: new THREE.Color(0x4c7333),
  basalt: [new THREE.Color(0x6d6862), new THREE.Color(0x7c766e), new THREE.Color(0x5f5b56)],
  wet: new THREE.Color(0x2f3236),
  snow: new THREE.Color(0xf3f7fa),
  iceTop: new THREE.Color(0xeaf6fb),
  iceWall: new THREE.Color(0x38b8ee),
  iceDeep: new THREE.Color(0x1456b0),
  moraine: new THREE.Color(0x5e5a55),
};

export interface FjordMaterials { land: THREE.MeshStandardMaterial; ice: THREE.MeshStandardMaterial; fall: THREE.ShaderMaterial; mist: THREE.SpriteMaterial }

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
  uniform float uAlpha;
  varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  void main() {
    float along = vUv.y, across = vUv.x;   // along = 0 at the foot of the fall
    float streaks = noise(vec2(across * 12.0, along * 4.0 + uTime * 2.4)) * 0.6 + noise(vec2(across * 34.0, along * 10.0 + uTime * 3.6)) * 0.4;
    float edge = smoothstep(0.0, 0.2, across) * smoothstep(1.0, 0.8, across);
    float lip = smoothstep(1.0, 0.94, along);
    float foamBottom = smoothstep(0.22, 0.0, along);
    float alpha = clamp(edge * lip * (0.62 + streaks * 0.45) + foamBottom * 0.5 * edge, 0.0, 0.97);
    vec3 col = mix(vec3(0.74, 0.87, 0.95), vec3(1.0), streaks) * uLight;
    gl_FragColor = vec4(col, alpha * uAlpha);
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

function mistTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0.85)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.4)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createFjordMaterials(): FjordMaterials {
  return {
    land: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, flatShading: true }),
    ice: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, flatShading: true, emissive: 0x1a78b0, emissiveIntensity: 0.4 }),
    fall: new THREE.ShaderMaterial({
      vertexShader: fallVertex, fragmentShader: fallFragment, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uLight: { value: 1 }, uAlpha: { value: 1 } }]),
    }),
    mist: new THREE.SpriteMaterial({ map: mistTexture(), transparent: true, depthWrite: false, opacity: 0.7 }),
  };
}

/** Per-quality grid resolution of one chunk side: [inland samples, samples along z]. */
export type FjordDetail = [number, number];

/**
 * Builds a flat-shaded triangle strip surface over (d, z) where d runs inland from the
 * shore. `place` turns (d, z) into a world x and height; `paint` picks a colour per face.
 */
function surface(rows: number, cols: number, z0: number, length: number, dMax: number,
  place: (d: number, z: number) => [number, number],
  paint: (cx: number, cy: number, cz: number, ny: number, col: number) => THREE.Color) {
  const P: [number, number, number][] = [];
  for (let j = 0; j <= cols; j++) {
    const z = z0 - (j / cols) * length;
    for (let i = 0; i <= rows; i++) {
      const d = -6 + (dMax + 6) * (i / rows) ** 1.7;   // finer near the water
      const [x, y] = place(d, z);
      P.push([x, y, z]);
    }
  }
  const pos: number[] = [], col: number[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  const tri = (p: number, q: number, r: number, column: number) => {
    a.fromArray(P[p]); b.fromArray(P[q]); c.fromArray(P[r]);
    n.crossVectors(e1.subVectors(b, a), e2.subVectors(c, a)).normalize();
    const k = paint((a.x + b.x + c.x) / 3, (a.y + b.y + c.y) / 3, (a.z + b.z + c.z) / 3, Math.abs(n.y), column);
    // wind every face so it points up (the two shores run in opposite directions)
    for (const v of n.y < 0 ? [a, c, b] : [a, b, c]) { pos.push(v.x, v.y, v.z); col.push(k.r, k.g, k.b); }
  };
  const W = rows + 1;
  for (let j = 0; j < cols; j++) for (let i = 0; i < rows; i++) {
    const p00 = j * W + i, p10 = p00 + 1, p01 = p00 + W, p11 = p01 + 1;
    tri(p00, p01, p10, j); tri(p10, p01, p11, j);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

const tmp = new THREE.Color();

/** Left shore: mossy basalt terraces with snow; risers striped like basalt columns. */
function buildSlopes(z0: number, length: number, [rows, cols]: FjordDetail) {
  return surface(rows, cols, z0, length, 320,
    (d, z) => [-leftShore(z) - d, slopeHeight(d, z)],
    (x, y, z, ny, column) => {
      const v = hash(Math.floor(x / 6), Math.floor(z / 6));
      const snowLine = 38 + noise(x * 0.02, z * 0.02) * 34;
      if (y < 0.8) return tmp.copy(C.wet);
      if (ny > 0.72) {
        if (y > snowLine && v > 0.25) return tmp.copy(C.snow);
        if (v > 0.9) return tmp.copy(C.basalt[1]).lerp(C.mossDark, 0.3);   // bare rock poking through
        return tmp.copy(C.moss[Math.floor(v * 3)]).lerp(C.mossDark, noise(x * 0.05, z * 0.05) * 0.5);
      }
      // risers: alternating columns, a little moss creeping over the edge
      const k = C.basalt[column % 3];
      return tmp.copy(k).lerp(C.mossDark, ny > 0.45 ? 0.55 : 0);
    });
}

/** Right side: glacier front with blue walls, white serac tops and a dark moraine stripe. */
function buildGlacier(z0: number, length: number, [rows, cols]: FjordDetail) {
  return surface(rows, cols, z0, length, 360,
    (e, z) => { const x = glacierFront(z) + e; return [x, glacierHeight(e, x, z)]; },
    (x, y, z, ny) => {
      if (y < 0.5) return tmp.copy(C.iceDeep);
      const e = x - glacierFront(z);
      const moraine = Math.abs(e - 150 - 40 * Math.sin(z * 0.004)) < 7 + noise(z * 0.05, 2) * 6;
      if (ny > 0.7) return moraine ? tmp.copy(C.moraine) : tmp.copy(C.iceTop).lerp(C.iceWall, noise(x * 0.08, z * 0.08) * 0.25);
      // walls: deep blue near the water, turquoise higher up, every serac column a little different
      const col = hash(Math.floor(z / 7), 4.4);
      return tmp.copy(C.iceDeep).lerp(C.iceWall, smooth(-4, 20, y) * (0.6 + col * 0.4)).lerp(C.iceTop, ny * 0.35 + (col > 0.8 ? 0.25 : 0));
    });
}

/** Spots where puffins sit (world space), one group per rock or iceberg; side: −1 left bank, 1 glacier side. */
export interface Perch { key: number; spots: THREE.Vector3[]; side: -1 | 1 }

export interface FjordChunkOptions {
  kit: NatureKit | null; detail: FjordDetail; shadows: boolean;
  /** painted icebergs and rocks (they replace the kit's stand-ins once loaded) */
  props?: PaintedProps | null;
  /** the left shore comes from painted sections (PaintedShore): skip the generated slopes there */
  paintedLeft?: boolean;
  /** the glacier comes from painted sections too: skip the generated one */
  paintedRight?: boolean;
}

/** One stretch of the fjord: both shores, waterfalls with mist, icebergs and shore rocks. */
export function buildFjordChunk(index: number, length: number, m: FjordMaterials, o: FjordChunkOptions): THREE.Group {
  const group = new THREE.Group();
  const z0 = -index * length;
  const glacier = new THREE.Mesh(buildGlacier(z0, length, [Math.round(o.detail[0] * 1.2), o.detail[1]]), m.ice);
  glacier.matrixAutoUpdate = false;
  if (!o.paintedRight) group.add(glacier);
  if (!o.paintedLeft) {
    const slopes = new THREE.Mesh(buildSlopes(z0, length, o.detail), m.land);
    slopes.matrixAutoUpdate = false;
    group.add(slopes);
  }

  let seed = index * 7919 + 13;
  const r = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };

  // Waterfalls pour over the shore cliff into the fjord
  if (r() < 0.55 && !o.paintedLeft) {
    const z = z0 - (0.2 + r() * 0.6) * length;
    const top = slopeHeight(3.2, z) + 0.5;
    const w = 4 + r() * 5;
    const fall = new THREE.Mesh(new THREE.PlaneGeometry(w, top + 1).translate(0, (top + 1) / 2 - 1, 0), m.fall);
    fall.rotation.y = Math.PI / 2;
    fall.position.set(-leftShore(z) + 0.4, 0, z);
    fall.renderOrder = 2;
    group.add(fall);
    for (let k = 0; k < 3; k++) {
      const mist = new THREE.Sprite(m.mist);
      const s = w * (1.6 + k * 0.6);
      mist.scale.set(s, s * 0.6, 1);
      mist.position.set(-leftShore(z) + 2 + k * 1.5, s * 0.15, z + (k - 1) * 1.5);
      group.add(mist);
    }
  }

  const perches: Perch[] = [];
  group.userData.perches = perches;
  if (o.props?.ready) {
    const s = new Scatter(o.props);
    const props = o.props;
    // waterline at y = 0 (the models are built that way); `add` places the base, so lift by minY
    const put = (id: string, x: number, z: number, scale: number, rot: number) =>
      s.add(id, x, (props.get(id)?.minY ?? 0) * scale, z, scale, rot);
    // ice calved from the glacier: mostly chunks and small blocks near its front, now and then a
    // big tabular berg or a pinnacle; a few small blocks drift further out (never in the boat's lane)
    const bergs = 3 + Math.floor(r() * 3);
    for (let k = 0; k < bergs; k++) {
      const z = z0 - r() * length;
      const pick = r();
      const id = pick < 0.12 ? 'Ice_A' : pick < 0.24 ? 'Ice_B' : pick < 0.62 ? 'Ice_C' : 'Ice_D';
      const x = Math.max(5, glacierFront(z) - 2.5 - r() * (id === 'Ice_D' ? 9 : 5));
      const scale = 0.75 + r() * 0.5;
      put(id, x, z, scale, r() * Math.PI * 2);
      // now and then a puffin or two rests on a flat berg (Puffins.ts lets them take off)
      const model = props.get(id);
      if (model && (id === 'Ice_A' || id === 'Ice_C') && r() < 0.35) {
        const top = (model.size.y + model.minY) * scale * 0.9;
        const spots = [new THREE.Vector3(x, top, z)];
        if (id === 'Ice_A' && r() < 0.6) spots.push(new THREE.Vector3(x + 0.6, top, z - 0.9));
        perches.push({ key: index * 16 + k + 1e6, spots, side: 1 });
      }
    }
    // a rock now and then at the foot of the cliffs
    for (let k = 0; k < 2; k++) {
      if (r() < 0.45) continue;
      const z = z0 - r() * length;
      put(r() < 0.6 ? 'Rock_C' : 'Rock_D', -leftShore(z) + 1.2 + r() * 2.5, z, 0.8 + r() * 0.5, r() * Math.PI * 2);
    }
    s.build(group, { cast: o.shadows });
  } else if (o.kit) {
    const s = new Scatter(o.kit);
    // icebergs calved from the glacier: many near the ice, a few drifting across; never in the boat's lane
    // small ice chunks calved from the glacier, close to its front (proper icebergs come later)
    const bergs = 2 + Math.floor(r() * 3);
    for (let k = 0; k < bergs; k++) {
      const z = z0 - r() * length;
      const x = glacierFront(z) - 2.5 - r() * 5;
      const big = r();
      s.add(r() < 0.5 ? 'Iceberg_1' : 'Iceberg_2', x, -0.4 - big * 0.3, z, 0.6 + big * big * 2.2, r() * Math.PI * 2, 0.5 + r() * 0.3);
    }
    // dark boulders at the foot of the cliffs
    for (let k = 0; k < (o.paintedLeft ? 0 : 6); k++) {
      const z = z0 - r() * length;
      s.add(r() < 0.5 ? 'Rock_Medium_1' : 'Rock_Medium_2', -leftShore(z) + 0.5 + r() * 2.5, -0.8, z, 1.5 + r() * 2.5, r() * Math.PI * 2, 0.7);
    }
    s.build(group, { cast: o.shadows });
  }
  return group;
}

export function disposeFjordChunk(group: THREE.Group) {
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if ((mesh as unknown as THREE.InstancedMesh).isInstancedMesh) (mesh as unknown as THREE.InstancedMesh).dispose();
    else if (mesh.isMesh) mesh.geometry.dispose();
  });
}
