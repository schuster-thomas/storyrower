import * as THREE from 'three';
import type { NatureKit } from './NatureKit';
import { Scatter } from './NatureKit';
import type { QualityProfile } from './quality';

// ---------- deterministic value noise (world coordinates → seamless across chunks) ----------
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
 * Ground height at a world position. Low, mossy banks right at the river, rolling hills
 * further out. Pure function of x/z, so neighbouring chunks always line up.
 */
export function terrainHeight(x: number, z: number, riverHalf: number) {
  const d = Math.abs(x) - riverHalf;               // distance from the water's edge
  const bank = smooth(-1.5, 2.5, d) * 1.1 - 0.5;   // slopes up out of the water
  const hills = (noise(x * 0.025, z * 0.025) * 0.7 + noise(x * 0.06, z * 0.06) * 0.3) * 16 * smooth(6, 40, d);
  const bumps = noise(x * 0.2, z * 0.2) * 0.4 * smooth(0, 3, d);
  return bank + hills + bumps;
}

// Soft, slightly desaturated palette that sits well with the painted kit textures
const C = {
  grass: new THREE.Color(0x7fae55),
  meadow: new THREE.Color(0x9cbf62),
  moss: new THREE.Color(0x5e8a44),
  rock: new THREE.Color(0x857f76),
  lupine: new THREE.Color(0x9a7ac8),
  sand: new THREE.Color(0xa8a089),
};

export interface TerrainMaterials {
  ground: THREE.MeshStandardMaterial;   // vertexColors
  basalt: THREE.MeshStandardMaterial;
  tree: THREE.MeshStandardMaterial;
  trunk: THREE.MeshStandardMaterial;
  rock: THREE.MeshStandardMaterial;
  lupine: THREE.MeshStandardMaterial;
  fall: THREE.MeshBasicMaterial;
}

export function createTerrainMaterials(): TerrainMaterials {
  return {
    ground: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }),
    basalt: new THREE.MeshStandardMaterial({ color: 0x777980, flatShading: true, roughness: 0.9 }),
    tree: new THREE.MeshStandardMaterial({ color: 0x3f7d45, flatShading: true, roughness: 1 }),
    trunk: new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 1 }),
    rock: new THREE.MeshStandardMaterial({ color: 0x8a8580, flatShading: true, roughness: 1 }),
    lupine: new THREE.MeshStandardMaterial({ color: 0x8e66c4, flatShading: true, roughness: 0.9 }),
    fall: new THREE.MeshBasicMaterial({ color: 0xeaf6ff, transparent: true, opacity: 0.85 }),
  };
}

/** Greybox props, used until the model kit has loaded. */
export const PROPS = {
  tree: new THREE.ConeGeometry(1.4, 4.5, 6),
  trunk: new THREE.CylinderGeometry(0.25, 0.3, 1.2, 5),
  rock: new THREE.DodecahedronGeometry(1, 0),
  column: new THREE.CylinderGeometry(1, 1, 1, 6).translate(0, 0.5, 0),
  lupine: new THREE.ConeGeometry(0.18, 0.9, 5).translate(0, 0.45, 0),
};
const SHARED = new Set<THREE.BufferGeometry>(Object.values(PROPS));

/** Seeded random per chunk so the world looks the same every time. */
function rand(seed: number) {
  let s = (seed * 9301 + 49297) % 233280;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

export interface ChunkOptions { kit: NatureKit | null; shadows: boolean }

/**
 * Builds one chunk of riverside landscape: two smooth terrain strips (left/right) and the
 * props on them. With the model kit: rocks and pebbles at the shore, grass tufts, lupines and
 * buttercups, bushes, a few trees, boulder cliffs and icebergs in the shallows.
 */
export function buildChunk(index: number, length: number, riverHalf: number, q: QualityProfile, m: TerrainMaterials, opts: ChunkOptions): THREE.Group {
  const r = rand(index + 1000);
  const group = new THREE.Group();
  const zCenter = -index * length - length / 2;
  group.position.z = zCenter;
  const width = 90;
  const [segX, segZ] = q.terrainSegments;

  for (const side of [-1, 1]) {
    const g = new THREE.PlaneGeometry(width, length, segX * 2, segZ * 2);
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    const col = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      // vertices denser near the water
      const u = (pos.getX(i) + width / 2) / width;
      const x = side * (riverHalf - 2 + width * u ** 1.7);
      const z = pos.getZ(i) + zCenter;
      const y = terrainHeight(x, z, riverHalf);
      pos.setXYZ(i, x, y, pos.getZ(i));
      // colour per vertex: sand at the water, moss on the bank, meadow/grass, rock where steep or high
      const d = Math.abs(x) - riverHalf;
      const slope = Math.abs(terrainHeight(x + 1.5, z, riverHalf) - y) + Math.abs(terrainHeight(x, z + 1.5, riverHalf) - y);
      col.copy(C.grass).lerp(C.meadow, noise(x * 0.05, z * 0.05) * 0.8);
      col.lerp(C.moss, smooth(4, 0.5, d) * 0.7);
      if (d < 12) col.lerp(C.lupine, smooth(0.62, 0.8, noise(x * 0.12 + 50, z * 0.12)) * 0.55);
      col.lerp(C.rock, Math.max(smooth(1.2, 2.6, slope), smooth(9, 14, y)) * 0.85);
      col.lerp(C.sand, smooth(0.8, -0.2, d));
      colors.set([col.r, col.g, col.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    // Mirroring the left strip flips the triangle winding – flip it back so it faces up
    if (side < 0 && g.index) {
      const idx = g.index.array as Uint16Array | Uint32Array;
      for (let i = 0; i < idx.length; i += 3) { const t = idx[i + 1]; idx[i + 1] = idx[i + 2]; idx[i + 2] = t; }
      g.index.needsUpdate = true;
    }
    g.computeVertexNormals();
    const mesh = new THREE.Mesh(g, m.ground);
    mesh.receiveShadow = opts.shadows;
    group.add(mesh);
  }

  const ground = (x: number, lz: number) => terrainHeight(x, lz + zCenter, riverHalf);
  if (opts.kit) scatterKit(group, opts.kit, r, ground, length, riverHalf, q, opts.shadows);
  else scatterGreybox(group, m, r, ground, length, riverHalf, q);
  return group;
}

function scatterKit(group: THREE.Group, kit: NatureKit, r: () => number, ground: (x: number, z: number) => number,
  length: number, riverHalf: number, q: QualityProfile, shadows: boolean) {
  const s = new Scatter(kit);
  const side = () => (r() < 0.5 ? -1 : 1);
  const pick = <T,>(a: readonly T[]) => a[Math.floor(r() * a.length)];
  const rocks = ['Rock_Medium_1', 'Rock_Medium_2', 'Rock_Medium_3'] as const;
  const density = q.lupines / 40; // 0.3 … 1

  // Shore: rocks half in the water, pebbles
  for (let i = 0; i < 7; i++) {
    const sd = side(), x = sd * (riverHalf - 0.6 + r() * 2.2), z = (r() - 0.5) * length;
    s.add(pick(rocks), x, ground(x, z) - 0.35, z, 0.35 + r() * 0.45, r() * 6.28);
  }
  for (let i = 0; i < 10 * density; i++) {
    const sd = side(), x = sd * (riverHalf + r() * 2.5), z = (r() - 0.5) * length;
    s.add(r() < 0.5 ? 'Pebble_Round_2' : 'Pebble_Square_2', x, ground(x, z) - 0.05, z, 1.2 + r() * 1.6, r() * 6.28);
  }
  // Grass tufts along the bank and in the meadow
  for (let i = 0; i < 46 * density; i++) {
    const sd = side(), x = sd * (riverHalf + 0.6 + r() ** 1.6 * 22), z = (r() - 0.5) * length;
    s.add(pick(['Grass_Common_Short', 'Grass_Common_Short', 'Grass_Common_Tall', 'Grass_Wispy_Tall'] as const), x, ground(x, z) - 0.05, z, 0.9 + r() * 0.8, r() * 6.28);
  }
  // Lupine and buttercup patches
  for (let p = 0; p < 4; p++) {
    const sd = side(), cx = sd * (riverHalf + 2 + r() * 12), cz = (r() - 0.5) * length;
    const kind = r() < 0.75 ? 'Lupine' : 'Flower_4_Group';
    for (let k = 0; k < 8 * density; k++) {
      const x = cx + (r() - 0.5) * 5, z = cz + (r() - 0.5) * 5;
      s.add(kind, x, ground(x, z) - 0.05, z, 0.8 + r() * 0.6, r() * 6.28);
    }
  }
  // Bushes and a few trees (Iceland is not a forest)
  for (let i = 0; i < 3 * density + 1; i++) {
    const sd = side(), x = sd * (riverHalf + 4 + r() * 20), z = (r() - 0.5) * length;
    s.add(r() < 0.6 ? 'Bush_Common' : 'Bush_Common_Flowers', x, ground(x, z) - 0.1, z, 0.8 + r() * 0.6, r() * 6.28);
  }
  for (let i = 0; i < q.trees / 2; i++) {
    const sd = side(), x = sd * (riverHalf + 10 + r() * 28), z = (r() - 0.5) * length;
    s.add(pick(['Pine_1', 'Pine_3', 'CommonTree_1'] as const), x, ground(x, z) - 0.2, z, 0.5 + r() * 0.4, r() * 6.28);
  }
  // Boulder cliffs: big rocks stacked into walls further out
  for (const sd of [-1, 1]) {
    if (r() > 0.55) continue;
    const baseX = sd * (riverHalf + 18 + r() * 10);
    const n = 5 + Math.floor(r() * 4);
    for (let k = 0; k < n; k++) {
      const z = (k / n - 0.5) * length * 0.9 + (r() - 0.5) * 3;
      const x = baseX + sd * r() * 4;
      s.add(pick(rocks), x, ground(x, z) - 1.5, z, 3.2 + r() * 2.8, r() * 6.28, 1.2 + r() * 0.9);
    }
  }
  // Icebergs drifting in the shallows, never in the boat's lane
  if (r() < 0.35) {
    const sd = side(), x = sd * (riverHalf - 2.2 - r() * 1.5), z = (r() - 0.5) * length;
    s.add(r() < 0.5 ? 'Iceberg_1' : 'Iceberg_2', x, -0.6, z, 0.5 + r() * 0.5, r() * 6.28, 0.8);
  }
  s.build(group, { cast: shadows });
}

function scatterGreybox(group: THREE.Group, m: TerrainMaterials, r: () => number, ground: (x: number, z: number) => number,
  length: number, riverHalf: number, q: QualityProfile) {
  const mtx = new THREE.Matrix4(), quat = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), eul = new THREE.Euler();
  const trees = new THREE.InstancedMesh(PROPS.tree, m.tree, q.trees);
  const trunks = new THREE.InstancedMesh(PROPS.trunk, m.trunk, q.trees);
  for (let i = 0; i < q.trees; i++) {
    const side = r() < 0.5 ? -1 : 1;
    const x = side * (riverHalf + 3 + r() * 30), z = (r() - 0.5) * length, h = 0.6 + r() * 0.7, y = ground(x, z);
    trees.setMatrixAt(i, mtx.compose(p.set(x, y + 3.2 * h, z), quat.identity(), sc.set(h, h, h)));
    trunks.setMatrixAt(i, mtx.compose(p.set(x, y + 0.6 * h, z), quat.identity(), sc.set(h, h, h)));
  }
  const rocks = new THREE.InstancedMesh(PROPS.rock, m.rock, 6);
  for (let i = 0; i < 6; i++) {
    const side = r() < 0.5 ? -1 : 1, k = 0.5 + r() * 1.3, x = side * (riverHalf - 0.3 + r() * 3), z = (r() - 0.5) * length;
    rocks.setMatrixAt(i, mtx.compose(p.set(x, ground(x, z) + 0.1, z), quat.setFromEuler(eul.set(r(), r(), r())), sc.set(k, k * 0.7, k)));
  }
  group.add(trees, trunks, rocks);
}

/** Free a chunk's own geometry (shared prop and kit geometries stay). */
export function disposeChunk(group: THREE.Group) {
  group.traverse((o) => {
    const inst = o as THREE.InstancedMesh;
    if (inst.isInstancedMesh) { inst.dispose(); return; } // instance buffers only; geometry is shared
    const g = (o as THREE.Mesh).geometry;
    if (g && !SHARED.has(g)) g.dispose();
  });
}
