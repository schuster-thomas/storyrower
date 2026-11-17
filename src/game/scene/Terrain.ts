import * as THREE from 'three';
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
  const bumps = noise(x * 0.2, z * 0.2) * 0.6 * smooth(0, 3, d);
  return bank + hills + bumps;
}

const C = {
  grass: new THREE.Color(0x6aa04c),
  moss: new THREE.Color(0x4f7d3a),
  meadow: new THREE.Color(0x86b25a),
  rock: new THREE.Color(0x77726b),
  lupine: new THREE.Color(0x8e66c4),
  sand: new THREE.Color(0x9a9479),
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
    ground: new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 }),
    basalt: new THREE.MeshStandardMaterial({ color: 0x777980, flatShading: true, roughness: 0.9 }),
    tree: new THREE.MeshStandardMaterial({ color: 0x2f6b3a, flatShading: true, roughness: 1 }),
    trunk: new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 1 }),
    rock: new THREE.MeshStandardMaterial({ color: 0x8a8580, flatShading: true, roughness: 1 }),
    lupine: new THREE.MeshStandardMaterial({ color: 0x8e66c4, flatShading: true, roughness: 0.9 }),
    fall: new THREE.MeshBasicMaterial({ color: 0xeaf6ff, transparent: true, opacity: 0.85 }),
  };
}

/** Shared geometries for instanced props. */
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

/**
 * Builds one chunk of riverside landscape: two terrain strips (left/right), trees, rocks,
 * lupine patches near the water and basalt-column cliffs with occasional waterfalls.
 */
export function buildChunk(index: number, length: number, riverHalf: number, q: QualityProfile, m: TerrainMaterials): THREE.Group {
  const r = rand(index + 1000);
  const group = new THREE.Group();
  const zCenter = -index * length - length / 2;
  group.position.z = zCenter;
  const width = 90;
  const [segX, segZ] = q.terrainSegments;

  for (const side of [-1, 1]) {
    const g = new THREE.PlaneGeometry(width, length, segX, segZ).toNonIndexed();
    g.rotateX(-Math.PI / 2);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const colors = new Float32Array(pos.count * 3);
    // place the strip from just inside the water outwards; vertices are denser near the water
    for (let i = 0; i < pos.count; i++) {
      const u = (pos.getX(i) + width / 2) / width;               // 0 … 1
      const x = side * (riverHalf - 2 + width * u ** 1.7);
      const z = pos.getZ(i) + zCenter;
      pos.setXYZ(i, x, terrainHeight(x, z, riverHalf), pos.getZ(i));
    }
    // colour per triangle: steep or high → rock, near the water → moss/sand, else grass/meadow, lupine patches
    const col = new THREE.Color();
    for (let i = 0; i < pos.count; i += 3) {
      const ys = [pos.getY(i), pos.getY(i + 1), pos.getY(i + 2)];
      const xs = [pos.getX(i), pos.getX(i + 1), pos.getX(i + 2)];
      const zs = [pos.getZ(i) + zCenter, pos.getZ(i + 1) + zCenter, pos.getZ(i + 2) + zCenter];
      const yAvg = (ys[0] + ys[1] + ys[2]) / 3;
      const slope = Math.max(...ys) - Math.min(...ys);
      const d = Math.abs((xs[0] + xs[1] + xs[2]) / 3) - riverHalf;
      const cx = (xs[0] + xs[1] + xs[2]) / 3, cz = (zs[0] + zs[1] + zs[2]) / 3;
      if (d < 0.6) col.copy(C.sand);
      else if (slope > 3.2 || yAvg > 11) col.copy(C.rock).lerp(C.moss, noise(cx * 0.1, cz * 0.1) * 0.4);
      else if (d < 12 && noise(cx * 0.12 + 50, cz * 0.12) > 0.72) col.copy(C.lupine).lerp(C.grass, 0.25);
      else col.copy(C.grass).lerp(C.meadow, noise(cx * 0.05, cz * 0.05)).lerp(C.moss, smooth(4, 0, d) * 0.6);
      for (let k = 0; k < 3; k++) colors.set([col.r, col.g, col.b], (i + k) * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    g.computeVertexNormals();
    group.add(new THREE.Mesh(g, m.ground));
  }

  const mtx = new THREE.Matrix4(), quat = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3(), eul = new THREE.Euler();
  const ground = (x: number, lz: number) => terrainHeight(x, lz + zCenter, riverHalf);

  // Trees (sparse – Iceland is not a forest), on gentle ground only
  const trees = new THREE.InstancedMesh(PROPS.tree, m.tree, q.trees);
  const trunks = new THREE.InstancedMesh(PROPS.trunk, m.trunk, q.trees);
  for (let i = 0; i < q.trees; i++) {
    const side = r() < 0.5 ? -1 : 1;
    const x = side * (riverHalf + 3 + r() * 30);
    const z = (r() - 0.5) * length;
    const h = 0.6 + r() * 0.7;
    const y = ground(x, z);
    trees.setMatrixAt(i, mtx.compose(p.set(x, y + 3.2 * h, z), quat.identity(), sc.set(h, h, h)));
    trunks.setMatrixAt(i, mtx.compose(p.set(x, y + 0.6 * h, z), quat.identity(), sc.set(h, h, h)));
  }
  group.add(trees, trunks);

  // Rocks along the water's edge
  const rockCount = 6;
  const rocks = new THREE.InstancedMesh(PROPS.rock, m.rock, rockCount);
  for (let i = 0; i < rockCount; i++) {
    const side = r() < 0.5 ? -1 : 1;
    const k = 0.5 + r() * 1.3;
    const x = side * (riverHalf - 0.3 + r() * 3);
    const z = (r() - 0.5) * length;
    rocks.setMatrixAt(i, mtx.compose(p.set(x, ground(x, z) + 0.1, z), quat.setFromEuler(eul.set(r(), r(), r())), sc.set(k, k * 0.7, k)));
  }
  group.add(rocks);

  // Lupines: small purple spikes in clusters near the water
  const lup = new THREE.InstancedMesh(PROPS.lupine, m.lupine, q.lupines);
  let li = 0;
  while (li < q.lupines) {
    const side = r() < 0.5 ? -1 : 1;
    const cx = side * (riverHalf + 1.5 + r() * 9);
    const cz = (r() - 0.5) * length;
    const n = Math.min(q.lupines - li, 4 + Math.floor(r() * 6));
    for (let k = 0; k < n; k++, li++) {
      const x = cx + (r() - 0.5) * 3, z = cz + (r() - 0.5) * 3;
      const s = 0.7 + r() * 0.8;
      lup.setMatrixAt(li, mtx.compose(p.set(x, ground(x, z) - 0.05, z), quat.identity(), sc.set(s, s, s)));
    }
  }
  group.add(lup);

  // Basalt column cliffs, sometimes with a waterfall in front
  for (const side of [-1, 1]) {
    if (r() > 0.5) continue;
    const cols = 26;
    const basalt = new THREE.InstancedMesh(PROPS.column, m.basalt, cols);
    const baseX = side * (riverHalf + 16 + r() * 8);
    const zStart = (r() - 0.5) * 8 - length * 0.35;
    const height = 9 + r() * 12;
    let topX = baseX;
    for (let i = 0; i < cols; i++) {
      const row = i % 2;
      const z = zStart + Math.floor(i / 2) * 2.1;
      const x = baseX + side * row * 1.8 + (r() - 0.5) * 0.4;
      const h = height * (0.75 + r() * 0.3) + row * 2;
      const y = ground(x, z) - 0.5;
      basalt.setMatrixAt(i, mtx.compose(p.set(x, y, z), quat.setFromEuler(eul.set(0, r(), 0)), sc.set(1.05, h, 1.05)));
      if (row === 0) topX = x;
    }
    group.add(basalt);
    if (r() < 0.5) {
      const fallH = height * 0.85;
      const fall = new THREE.Mesh(new THREE.PlaneGeometry(2.5 + r() * 2, fallH), m.fall);
      const fz = zStart + 6 + r() * 10;
      fall.position.set(topX - side * 1.2, ground(topX, fz) + fallH / 2 - 0.5, fz);
      fall.rotation.y = -side * Math.PI / 2;
      group.add(fall);
    }
  }
  return group;
}

/** Free a chunk's own geometry (shared prop geometries stay). */
export function disposeChunk(group: THREE.Group) {
  group.traverse((o) => {
    if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
    const g = (o as THREE.Mesh).geometry;
    if (g && !SHARED.has(g)) g.dispose();
  });
}
