import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { leftShore } from '../Fjord';
import type { Card } from '../Cards';
import { placeModel, TILE, type Kit } from './kit';
import { rng } from './textures';

/**
 * The garden bank of one 100 m stretch, modelled in 3D: an old granite wall out of the water, a
 * rolling moss lawn with a raked gravel path, garden rocks, wooded hills with cherry groves behind;
 * cherry trees mixed with maples, willows, bamboo and pines as painted cut-outs (not all pink), stone
 * lanterns, tea houses, small garden houses, a shrine and now and then a pagoda as 3D models (Tripo3D).
 */

export const LAWN = 1.9;   // lawn level above the water (top of the wall)
const STEP = 2.5;
export const PATH_D = 7.2; // centre of the gravel path, metres inland

export interface GardenMaterials {
  wall: THREE.MeshStandardMaterial; lawn: THREE.MeshStandardMaterial; gravel: THREE.MeshStandardMaterial;
  forest: THREE.MeshStandardMaterial; rock: THREE.MeshStandardMaterial;
}

export function gardenMaterials(kit: Kit): GardenMaterials {
  return {
    wall: new THREE.MeshStandardMaterial({ map: kit.tex.wallStone, roughness: 0.95 }),
    lawn: new THREE.MeshStandardMaterial({ map: kit.tex.lawn, vertexColors: true, roughness: 1 }),
    gravel: new THREE.MeshStandardMaterial({ map: kit.tex.gravel, roughness: 1 }),
    forest: new THREE.MeshStandardMaterial({ map: kit.tex.forest, vertexColors: true, roughness: 1 }),
    rock: new THREE.MeshStandardMaterial({ color: 0xa49c8c, roughness: 0.95, flatShading: true }),
  };
}

function noise1(x: number) {
  const i = Math.floor(x), f = x - i;
  const h = (n: number) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
  const u = f * f * (3 - 2 * f);
  return h(i) * (1 - u) + h(i + 1) * u;
}
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Height of the garden at `d` metres inland (the same everywhere it is used: terrain, trees, models). */
export function gardenY(d: number, z: number) {
  if (d < 0.35) return LAWN * smooth(-0.35, 0.35, d);
  // soft moss mounds in the garden, flat along the path
  const mounds = (noise1(d * 0.18 + z * 0.06) - 0.4) * 1.4 * smooth(10, 16, d) * (1 - smooth(34, 44, d));
  const path = Math.abs(d - PATH_D) < 1.6 ? 0 : 1;
  const hills = smooth(32, 130, d) * (10 + noise1(z * 0.013 + 3) * 22) + smooth(130, 280, d) * (14 + noise1(z * 0.009 + 9) * 30);
  return LAWN + 0.05 + Math.max(0, mounds) * path + hills + noise1(d * 0.4 + z * 0.3) * 0.12 * smooth(1, 3, d);
}

/** A surface over (d, z) on the left bank, textured in world metres (or along the river). */
function surface(z0: number, length: number, ds: number[], y: (d: number, z: number) => number, tile: [number, number], color?: (d: number, z: number) => THREE.Color, along = false) {
  const rows = Math.round(length / STEP) + 1;
  const pos: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = [];
  for (let r = 0; r < rows; r++) {
    const z = z0 - r * STEP, shore = leftShore(z);
    let acc = 0;
    ds.forEach((d, k) => {
      const yy = y(d, z);
      if (k > 0) acc += Math.hypot(d - ds[k - 1], yy - y(ds[k - 1], z));
      const x = -(shore + d);
      pos.push(x, yy, z);
      uv.push(along ? -z / tile[0] : x / tile[0], along ? acc / tile[1] : -z / tile[1]);
      if (color) { const c = color(d, z); col.push(c.r, c.g, c.b); }
    });
  }
  const n = ds.length;
  for (let r = 0; r < rows - 1; r++) for (let k = 0; k < n - 1; k++) {
    const a = r * n + k, b = a + 1, c = a + n, e = c + 1;
    idx.push(a, c, b, b, c, e);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (color) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export interface GardenCards { sakura: Card[]; garden: Card[]; shrubs: Card[]; trees: Card[] }

/** Tiles of the 'trees' atlas (scripts/tokyo/assets.mjs). */
const RED_MAPLE = 0, GREEN_MAPLE = 1, WILLOW = 2, BAMBOO = 3;

export function buildGarden(index: number, chunk: number, kit: Kit, m: GardenMaterials, shadows: boolean, keepClear: (z: number) => boolean) {
  const z0 = -index * chunk;
  const r = rng(index * 5.3 + 7);
  const group = new THREE.Group();
  const cards: GardenCards = { sakura: [], garden: [], shrubs: [], trees: [] };
  /** one garden tree: a cherry now and then, otherwise maples, pines, willows or bamboo */
  const tree = (x: number, y: number, z: number, scale: number, mix: [number, number, number, number, number, number]) => {
    // mix: shares of cherry, red maple, green maple, willow, bamboo, pine
    let k = r() * mix.reduce((a, b) => a + b, 0), i = 0;
    while (i < mix.length - 1 && k > mix[i]) k -= mix[i++];
    const flip = r() < 0.5, seed = r();
    if (i === 0) cards.sakura.push({ x, y, z, tile: 1 + Math.floor(r() * 3), height: (10 + r() * 5) * scale, flip, sway: 0.6, seed });
    else if (i === 5) cards.garden.push({ x, y, z, tile: 3, height: (5.5 + r() * 3) * scale, flip, sway: 0.15, seed });
    else {
      const tile = [RED_MAPLE, GREEN_MAPLE, WILLOW, BAMBOO][i - 1];
      const h = [6.5 + r() * 2.5, 7 + r() * 3, 8 + r() * 3, 9 + r() * 4][i - 1] * scale;
      cards.trees.push({ x, y, z, tile, height: h, flip, sway: tile === WILLOW ? 0.9 : tile === BAMBOO ? 0.5 : 0.4, seed });
    }
  };
  const lx = (d: number, z: number) => -(leftShore(z) + d);
  const at = (d: number, z: number) => [lx(d, z), gardenY(d, z), z] as const;

  // ---------- ground ----------
  // the wall: from under the water up to the lawn (its face is the inner-most strip)
  const wall = surface(z0, chunk, [-0.35, 0.3], (d) => (d < 0 ? -1.8 : LAWN), TILE.wallStone, undefined, true);
  const tint = new THREE.Color(), light = new THREE.Color(1.08, 1.06, 0.98), dark = new THREE.Color(0.8, 0.86, 0.78);
  const lawnCol = (d: number, z: number) => tint.copy(dark).lerp(light, noise1(d * 0.15 + z * 0.09)).clone();
  const lawn = surface(z0, chunk, [0.3, 0.8, 2, 3.5, PATH_D - 1.6, PATH_D + 1.6, 10, 13, 16, 20, 25, 31, 38], gardenY, TILE.lawn, lawnCol);
  const hillCol = (d: number, z: number) => tint.setRGB(1, 1, 1).lerp(new THREE.Color(1.1, 0.92, 1.0), noise1(z * 0.05 + d * 0.02) * 0.4).clone();
  const hills = surface(z0, chunk, [36, 45, 60, 80, 105, 135, 170, 210, 260, 320], gardenY, TILE.forest, hillCol);
  const path = surface(z0, chunk, [PATH_D - 1.25, PATH_D + 1.25], (d, z) => gardenY(d, z) + 0.04, TILE.gravel, undefined, true);
  for (const [g, mat] of [[wall, m.wall], [lawn, m.lawn], [hills, m.forest], [path, m.gravel]] as const) {
    const mesh = new THREE.Mesh(g, mat);
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  // garden rocks: on the wall's edge and along the path
  const rocks: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 14; k++) {
    const z = z0 - r() * chunk, d = r() < 0.5 ? 0.6 + r() * 0.8 : PATH_D + (r() < 0.5 ? -1 : 1) * (1.6 + r() * 0.8);
    const g = new THREE.IcosahedronGeometry(0.4 + r() * 0.5, 0);
    g.scale(1.3, 0.6 + r() * 0.4, 1.1);
    g.rotateY(r() * 6);
    const [x, y] = at(d, z);
    g.translate(x, y + 0.08, z);
    rocks.push(g);
  }
  const rockMesh = new THREE.Mesh(mergeGeometries(rocks)!, m.rock);
  rocks.forEach((g) => g.dispose());
  rockMesh.castShadow = shadows;
  group.add(rockMesh);

  // ---------- plants (painted cut-outs) ----------
  // trees right at the wall – cherries leaning over the water, willows, maples, pines
  for (let z = z0 - r() * 6; z > z0 - chunk; z -= 7 + r() * 8) {
    if (keepClear(z)) continue;
    const d = 0.9 + r() * 2.2;
    tree(lx(d, z), LAWN, z, 1.05, [0.42, 0.12, 0.12, 0.18, 0, 0.16]);
  }
  // azaleas along the wall and the path
  for (let z = z0 - r() * 4; z > z0 - chunk; z -= 3.5 + r() * 5) {
    const d = r() < 0.55 ? 0.6 + r() * 1.4 : PATH_D + 1.9 + r() * 1.5;
    const [x, y] = at(d, z);
    cards.shrubs.push({ x, y: y - 0.05, z, tile: Math.floor(r() * 4), height: 1.2 + r() * 0.9, flip: r() < 0.5, seed: r() });
  }
  // the garden behind the path: pines, maples, bamboo, a few cherries
  for (let z = z0 - r() * 8; z > z0 - chunk; z -= 7 + r() * 8) {
    const d = 11 + r() * 22;
    const [x, y] = at(d, z);
    tree(x, y, z, 1, [0.25, 0.15, 0.15, 0.05, 0.15, 0.25]);
  }
  // the wooded hills: green trees with cherry groves in between
  for (let k = 0; k < 14; k++) {
    const z = z0 - r() * chunk, d = 38 + r() * 90;
    const [x, y] = at(d, z);
    tree(x, y - 0.5, z, 1.35, [0.45, 0.1, 0.3, 0, 0.05, 0.1]);
  }

  // ---------- 3D models ----------
  const { lantern, teahouse, house, shrine, pagoda, pagoda3 } = kit.models;
  const used: number[] = [];   // z of the buildings placed so far, so they don't stand in each other
  const spot = (from: number, to: number) => {
    for (let n = 0; n < 8; n++) { const z = z0 - from - r() * (to - from); if (used.every((u) => Math.abs(u - z) > 18)) { used.push(z); return z; } }
    return null;
  };
  // stone lanterns along the path (and at the wall now and then)
  for (let z = z0 - 5 - r() * 15; z > z0 - chunk; z -= 22 + r() * 18) {
    const d = r() < 0.7 ? PATH_D - 1.9 : 0.9;
    const [x, y] = at(d, z);
    if (lantern) group.add(placeModel(lantern, 2.4 + r() * 0.4, x, y - 0.05, z, r() * 6, shadows));
    else cards.garden.push({ x, y, z, tile: 2, height: 2.5, seed: r() });
  }
  // pagodas: the tall vermilion one every 600 m, a small three-storey one in between
  const tall = index % 6 === 1, small = index % 6 === 4;
  if ((tall && pagoda) || (small && pagoda3)) {
    const z = spot(30, 70);
    if (z != null) {
      const d = tall ? 19 + r() * 6 : 13 + r() * 5;
      const [x, y] = at(d, z);
      group.add(placeModel((tall ? pagoda : pagoda3)!, tall ? 27 + r() * 4 : 15 + r() * 3, x, y - 0.3, z, r() * 6, shadows));
    }
  }
  // a shrine now and then, facing the river
  if (shrine && index % 5 === 1) {
    const z = spot(15, 85);
    if (z != null) { const [x, y] = at(15 + r() * 4, z); group.add(placeModel(shrine, 6.5, x, y - 0.3, z, (r() - 0.5) * 0.4, shadows)); }
  }
  // tea houses and small garden houses, their verandas towards the river
  const houses = (r() < 0.6 ? 1 : 0) + (r() < 0.5 ? 1 : 0);
  for (let k = 0; k < houses; k++) {
    const z = spot(10, 90);
    if (z == null) continue;
    const useTea = (k === 0 && r() < 0.5) || !house;
    const model = useTea ? teahouse : house;
    const [x, y] = at(14 + r() * 8, z);
    if (model) group.add(placeModel(model, useTea ? 6.5 : 5.5 + r(), x, y - 0.3, z, (r() - 0.5) * 0.5, shadows));
  }
  return { group, cards };
}
