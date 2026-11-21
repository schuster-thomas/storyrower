import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Card } from '../Cards';
import { glacierFront } from '../Fjord';
import { placeModel } from '../models';
import { rng } from '../tokyo/textures';
import type { MauritiusKit } from './kit';

/**
 * One 100 m stretch of the Mauritius coast on the right of the boat, modelled in 3D: a wide white
 * sand beach rising gently from the lagoon, black basalt rocks at the waterline, a strip of beach
 * scrub, then low land densely covered with a palm forest (the hills behind are in the painted
 * panorama). Palms and tropical plants are painted cut-outs; sun loungers under straw parasols,
 * a beach bar and fishing pirogues are Tripo3D models.
 * On the left there is no land at all – only the open sea (the water's open-sea mode).
 */

export const CHUNK = 100;
/** The beach lies this much further out than the shared bank line: a wide lagoon, not a river. */
export const BEACH_OFFSET = 5;
/** x of the waterline on the right. */
export const beachX = (z: number) => glacierFront(z) + BEACH_OFFSET;
const STEP = 2.5;
/** metres one texture tile covers */
const TILE = { sand: 7, scrub: 9, jungle: 34 };

function noise1(x: number) {
  const i = Math.floor(x), f = x - i;
  const h = (n: number) => { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
  const u = f * f * (3 - 2 * f);
  return h(i) * (1 - u) + h(i + 1) * u;
}
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Height of the land `d` metres inland from the waterline (negative d: the sandy bottom of the lagoon). */
export function beachY(d: number, z: number) {
  if (d < 0) return Math.max(-2.5, d * 0.3);
  const beach = 0.04 + Math.min(d, 30) * 0.055 + (noise1(z * 0.05) - 0.5) * 0.25 * smooth(5, 12, d);
  const back = smooth(28, 40, d) * (0.6 + noise1(z * 0.07 + 2) * 0.8);
  const land = smooth(40, 130, d) * (1.5 + noise1(z * 0.02 + 5) * 3);
  return beach + back + land;
}

export interface BeachMaterials { sand: THREE.MeshStandardMaterial; scrub: THREE.MeshStandardMaterial; jungle: THREE.MeshStandardMaterial; rock: THREE.MeshStandardMaterial }

export function beachMaterials(kit: MauritiusKit): BeachMaterials {
  return {
    sand: new THREE.MeshStandardMaterial({ map: kit.tex.sand, vertexColors: true, roughness: 1 }),
    scrub: new THREE.MeshStandardMaterial({ map: kit.tex.scrub, vertexColors: true, roughness: 1 }),
    jungle: new THREE.MeshStandardMaterial({ map: kit.tex.jungle, vertexColors: true, roughness: 1 }),
    rock: new THREE.MeshStandardMaterial({ color: 0x3b3a3d, roughness: 0.85, flatShading: true }),
  };
}

/** A surface over (d, z) on the right bank, textured in world metres. */
function surface(z0: number, length: number, ds: number[], tile: number, color: (d: number, z: number) => THREE.Color) {
  const rows = Math.round(length / STEP) + 1;
  const pos: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = [];
  for (let r = 0; r < rows; r++) {
    const z = z0 - r * STEP, x0 = beachX(z);
    for (const d of ds) {
      const x = x0 + d;
      pos.push(x, beachY(d, z), z);
      uv.push(x / tile, -z / tile);
      const c = color(d, z);
      col.push(c.r, c.g, c.b);
    }
  }
  const n = ds.length;
  for (let r = 0; r < rows - 1; r++) for (let k = 0; k < n - 1; k++) {
    const a = r * n + k, b = a + 1, c = a + n, e = c + 1;
    idx.push(a, b, c, b, e, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Something floating in the lagoon (a pirogue): it rides the waves (MauritiusWorld). */
export interface Floater { obj: THREE.Object3D; x: number; z: number; sink: number; seed: number }

export interface BeachChunk {
  index: number;
  group: THREE.Group;
  cards: { palms: Card[]; tropic: Card[] };
  floaters: Floater[];
}

/** Tiles of the 'palms' atlas (scripts/mauritius/assets.mjs): leaning right, straight, leaning left, short. */
const LEAN_RIGHT = 0, STRAIGHT = 1, LEAN_LEFT = 2, SHORT = 3;

export function buildBeachChunk(index: number, m: BeachMaterials, kit: MauritiusKit, shadows: boolean): BeachChunk {
  const z0 = -index * CHUNK;
  const r = rng(index * 3.7 + 11);
  const group = new THREE.Group();
  const cards: BeachChunk['cards'] = { palms: [], tropic: [] };
  const floaters: Floater[] = [];
  const at = (d: number, z: number) => [beachX(z) + d, beachY(d, z), z] as const;

  // ---------- ground ----------
  const tint = new THREE.Color();
  const wet = new THREE.Color(0.78, 0.74, 0.7), dry = new THREE.Color(1.04, 1.02, 0.98);
  const sandCol = (d: number, z: number) => tint.copy(wet).lerp(dry, smooth(0.2, 2.2, d)).multiplyScalar(0.94 + noise1(z * 0.13 + d * 0.3) * 0.08).clone();
  const greenCol = (d: number, z: number) => tint.setRGB(1, 1, 1).lerp(new THREE.Color(0.82, 0.9, 0.78), noise1(z * 0.04 + d * 0.03)).clone();
  // the floor of the palm forest: in shade, mostly hidden by the palms
  const forestCol = (d: number, z: number) => tint.setRGB(0.62, 0.68, 0.6).lerp(new THREE.Color(0.5, 0.58, 0.5), noise1(z * 0.05 + d * 0.04)).clone();
  const sand = surface(z0, CHUNK, [-7, -3, -1, 0, 0.8, 2, 4, 7, 11, 15, 19, 23, 27, 30.5], TILE.sand, sandCol);
  const scrub = surface(z0, CHUNK, [30.5, 32.5, 35, 38.5, 42], TILE.scrub, greenCol);
  const jungle = surface(z0, CHUNK, [42, 50, 62, 80, 105, 140, 190, 260, 360], TILE.jungle, forestCol);
  for (const [g, mat] of [[sand, m.sand], [scrub, m.scrub], [jungle, m.jungle]] as const) {
    const mesh = new THREE.Mesh(g, mat);
    mesh.receiveShadow = true;
    group.add(mesh);
  }

  // black basalt rocks in clusters at the waterline, a few out in the shallows
  const rocks: THREE.BufferGeometry[] = [];
  const rock = (d: number, z: number, size: number) => {
    const g = new THREE.IcosahedronGeometry(size, 0);
    g.scale(1.25, 0.65 + r() * 0.35, 1.05);
    g.rotateY(r() * 6);
    const [x, y] = at(d, z);
    g.translate(x, Math.max(y, -0.6) + size * 0.25, z);
    rocks.push(g);
  };
  for (let k = 0, n = 1 + Math.floor(r() * 2); k < n; k++) {
    const zc = z0 - 10 - r() * (CHUNK - 20), dc = -1.5 + r() * 3;
    for (let i = 0, cnt = 3 + Math.floor(r() * 5); i < cnt; i++) rock(dc + (r() - 0.5) * 4, zc + (r() - 0.5) * 7, 0.45 + r() * 1.1);
  }
  for (let i = 0; i < 3; i++) if (r() < 0.6) rock(-3 - r() * 6, z0 - r() * CHUNK, 0.35 + r() * 0.6);
  const rockMesh = new THREE.Mesh(mergeGeometries(rocks)!, m.rock);
  rocks.forEach((g) => g.dispose());
  rockMesh.castShadow = shadows;
  rockMesh.receiveShadow = true;
  group.add(rockMesh);

  // ---------- palms and plants (painted cut-outs) ----------
  const palm = (d: number, z: number, height: number, tile = Math.floor(r() * 4)) => {
    const [x, y] = at(d, z);
    cards.palms.push({ x, y: y - 0.15, z, tile, height: tile === SHORT ? height * 0.75 : height, flip: r() < 0.5, sway: 0.55, seed: r() });
  };
  // the front row at the back of the beach, now and then one out on the sand, leaning towards the water
  for (let z = z0 - r() * 6; z > z0 - CHUNK; z -= 4 + r() * 6) {
    if (r() < 0.25) {
      const [x, y] = at(12 + r() * 12, z);
      cards.palms.push({ x, y: y - 0.1, z, tile: r() < 0.5 ? LEAN_LEFT : LEAN_RIGHT, height: 11 + r() * 3, flip: false, sway: 0.6, seed: r() });
    } else palm(27 + r() * 7, z, 12 + r() * 5);
  }
  // a dense palm forest behind, taller further back
  for (let k = 0; k < 40; k++) palm(34 + r() * 40, z0 - r() * CHUNK, 13 + r() * 6, r() < 0.5 ? STRAIGHT : Math.floor(r() * 4));
  for (let k = 0; k < 34; k++) palm(70 + r() * 110, z0 - r() * CHUNK, 16 + r() * 6, r() < 0.7 ? STRAIGHT : Math.floor(r() * 4));
  // hibiscus, bougainvillea, banana plants and ferns between the beach and the palms, and under them
  for (let z = z0 - r() * 3; z > z0 - CHUNK; z -= 1.8 + r() * 2.5) {
    const d = 29 + r() * 22, tile = Math.floor(r() * 4);
    const [x, y] = at(d, z);
    cards.tropic.push({ x, y: y - 0.1, z, tile, height: tile === 2 ? 3 + r() * 1.5 : 1.6 + r() * 1.6, flip: r() < 0.5, sway: tile === 2 ? 0.5 : 0.25, seed: r() });
  }

  // ---------- models ----------
  const { loungers, hut, pirogue } = kit.models;
  const used: number[] = [];
  const spot = (from: number, to: number, gap = 14) => {
    for (let n = 0; n < 8; n++) { const z = z0 - from - r() * (to - from); if (used.every((u) => Math.abs(u - z) > gap)) { used.push(z); return z; } }
    return null;
  };
  // sun loungers under a straw parasol, facing the lagoon
  if (loungers) for (let k = 0, n = 1 + Math.floor(r() * 3); k < n; k++) {
    const z = spot(5, 95);
    if (z == null) continue;
    const [x, y] = at(9 + r() * 8, z);
    group.add(placeModel(loungers, 2.8, x, y - 0.05, z, -Math.PI / 2 + (r() - 0.5) * 0.5, shadows));
  }
  // a beach bar now and then
  if (hut && index % 3 === 1) {
    const z = spot(20, 80, 18);
    if (z != null) { const [x, y] = at(22 + r() * 4, z); group.add(placeModel(hut, 4.4, x, y - 0.2, z, -Math.PI / 2 + (r() - 0.5) * 0.6, shadows)); }
  }
  // colourful fishing pirogues at anchor in the lagoon, pointing into the wind
  if (pirogue && index % 2 === 0) {
    const z = z0 - 15 - r() * 70, d = -3.5 - r() * 3.5;
    const obj = placeModel(pirogue, 1.25, beachX(z) + d, 0, z, 0.3 + r() * 0.4, shadows);
    floaters.push({ obj, x: beachX(z) + d, z, sink: 0.42, seed: r() * 10 });
    group.add(obj);
  }
  return { index, group, cards, floaters };
}

export function disposeBeachChunk(c: BeachChunk) {
  c.group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    // the models' geometry is shared
    if (mesh.isMesh && !mesh.userData.shared) mesh.geometry.dispose();
  });
}
