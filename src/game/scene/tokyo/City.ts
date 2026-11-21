import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { glacierFront } from '../Fjord';
import { boxUV, TILE, type Kit, type TexKey } from './kit';
import { rng } from './textures';

/**
 * The city bank of one 100 m stretch, modelled in 3D: a granite embankment wall, a paved promenade
 * with a white railing, street lamps and a hedge, then three rows of high-rises – each a shop-front
 * podium, a tower (sometimes with a setback) in one of four facade styles, a roof with a parapet
 * and rooftop units. Everything is textured in metres, so it holds up at the grazing angles of the
 * river. One merged mesh per material.
 */

export const WALL_TOP = 2.4;
const STEP = 2.5;
const FACADES: TexKey[] = ['facadeGlass', 'facadeOffice', 'facadeFlats', 'facadeTeal'];

export interface CityMaterials {
  wall: THREE.MeshStandardMaterial; paving: THREE.MeshStandardMaterial; podium: THREE.MeshStandardMaterial;
  roof: THREE.MeshStandardMaterial; facades: THREE.MeshStandardMaterial[]; metal: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial; hedge: THREE.MeshStandardMaterial; street: THREE.MeshStandardMaterial; lamp: THREE.MeshBasicMaterial;
}

export function cityMaterials(kit: Kit): CityMaterials {
  const std = (map: THREE.Texture, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ map, roughness: 0.85, ...extra });
  return {
    wall: std(kit.tex.wallCity),
    paving: std(kit.tex.paving),
    podium: std(kit.tex.podium, { roughness: 0.6 }),
    roof: std(kit.tex.roof),
    // glass reads best a little glossy; the painted reflections do the rest
    facades: FACADES.map((k) => std(kit.tex[k], { roughness: k === 'facadeFlats' || k === 'facadeOffice' ? 0.7 : 0.35, metalness: k === 'facadeGlass' || k === 'facadeTeal' ? 0.15 : 0 })),
    metal: new THREE.MeshStandardMaterial({ color: 0xeef1f4, roughness: 0.35, metalness: 0.4 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x3a4148, roughness: 0.6, metalness: 0.3 }),
    hedge: std(kit.tex.lawn, { color: 0x6f9a50 }),
    street: new THREE.MeshStandardMaterial({ color: 0x8a8a88, roughness: 0.95 }),
    lamp: new THREE.MeshBasicMaterial({ color: 0xfff4d6 }),
  };
}

export interface FacadeSpot { x: number; z: number; width: number; height: number; style: number }

/** A strip along the bank: (d inland, y) per sample, x = shore + d, textured in metres. */
function strip(z0: number, length: number, pts: [number, number][], tile: [number, number], along = true) {
  const rows = Math.round(length / STEP) + 1;
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let r = 0; r < rows; r++) {
    const z = z0 - r * STEP, x0 = glacierFront(z);
    let acc = 0;
    pts.forEach(([d, y], k) => {
      if (k > 0) acc += Math.hypot(d - pts[k - 1][0], y - pts[k - 1][1]);
      pos.push(x0 + d, y, z);
      uv.push(along ? -z / tile[0] : (x0 + d) / tile[0], along ? acc / tile[1] : -z / tile[1]);
    });
  }
  const n = pts.length;
  for (let r = 0; r < rows - 1; r++) for (let k = 0; k < n - 1; k++) {
    const a = r * n + k, b = a + 1, c = a + n, e = c + 1;
    idx.push(a, b, c, b, e, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function buildCity(index: number, chunk: number, m: CityMaterials, shadows: boolean) {
  const z0 = -index * chunk;
  const r = rng(index * 3.7 + 11);
  const group = new THREE.Group();
  const facades: FacadeSpot[] = [];
  const by = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const add = (mat: THREE.Material, g: THREE.BufferGeometry) => { const l = by.get(mat) ?? []; l.push(g); by.set(mat, l); };
  const rx = (d: number, z: number) => glacierFront(z) + d;

  // the embankment wall (slightly battered), its coping, the promenade, hedge and street
  add(m.wall, strip(z0, chunk, [[-0.35, -1.8], [0.3, WALL_TOP]], TILE.wallCity));
  add(m.paving, strip(z0, chunk, [[0.3, WALL_TOP + 0.02], [9, WALL_TOP + 0.02]], TILE.paving, false));
  add(m.hedge, strip(z0, chunk, [[9, WALL_TOP], [9.05, WALL_TOP + 0.75], [10.4, WALL_TOP + 0.8], [10.45, WALL_TOP]], [3, 3]));
  add(m.street, strip(z0, chunk, [[10.45, WALL_TOP], [260, WALL_TOP]], [10, 10]));
  // the railing: posts every 2.5 m and two rails
  for (let z = z0; z > z0 - chunk; z -= 2.5) add(m.metal, boxUV(0.09, 1.05, 0.09, rx(0.6, z), WALL_TOP, z, [1, 1]));
  for (const h of [1.03, 0.55]) {
    const pts: THREE.Vector3[] = [];
    for (let z = z0; z >= z0 - chunk; z -= STEP) pts.push(new THREE.Vector3(rx(0.6, z), WALL_TOP + h, z));
    add(m.metal, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.045, 5));
  }
  // street lamps along the promenade
  for (let z = z0 - 10; z > z0 - chunk; z -= 25) {
    add(m.dark, boxUV(0.16, 4.2, 0.16, rx(1.4, z), WALL_TOP, z, [1, 1]));
    add(m.dark, boxUV(0.9, 0.12, 0.2, rx(1.15, z), WALL_TOP + 4.1, z, [1, 1]));
    const bulb = new THREE.SphereGeometry(0.22, 10, 8);
    bulb.translate(rx(0.8, z), WALL_TOP + 3.95, z);
    add(m.lamp, bulb);
  }

  // three rows of high-rises; the gaps between them are side streets
  const rows: [number, number, number, number][] = [[13, 16, 24, 58], [34, 44, 40, 85], [70, 95, 60, 125]];
  rows.forEach(([dMin, dMax, hMin, hMax], row) => {
    let z = z0 - 2 - r() * 5;
    while (true) {
      const w = 13 + r() * 13;
      if (z - w < z0 - chunk + 1) break;
      const zc = z - w / 2, d0 = dMin + r() * (dMax - dMin), depth = 16 + r() * 10;
      const height = hMin + r() * (hMax - hMin);
      const style = Math.floor(r() * 4);
      const cx = rx(d0, zc) + depth / 2;
      const fac = m.facades[style], tile = TILE[FACADES[style]];
      // podium with shop fronts
      add(m.podium, boxUV(depth + 0.6, 5.5, w + 0.6, cx, WALL_TOP, zc, TILE.podium, 0, TILE.roof));
      // the tower, sometimes with a setback near the top
      const setback = r() < 0.4 ? height * (0.62 + r() * 0.15) : height;
      add(fac, boxUV(depth, setback - 5.5, w, cx, WALL_TOP + 5.5, zc, tile, 0, TILE.roof));
      let top = WALL_TOP + setback, tw = w, td = depth;
      if (setback < height) {
        tw = w - 4; td = depth - 4;
        add(m.roof, boxUV(depth + 0.2, 0.5, w + 0.2, cx, top, zc, [2, 0.5], 0, TILE.roof));
        add(fac, boxUV(td, height - setback, tw, cx, top + 0.5, zc, tile, setback - 5.5, TILE.roof));
        top = WALL_TOP + height + 0.5;
      }
      // parapet and roof, rooftop units
      add(m.roof, boxUV(td + 0.4, 0.9, tw + 0.4, cx, top, zc, [2, 0.9], 0, TILE.roof));
      const units = 1 + Math.floor(r() * 3);
      for (let k = 0; k < units; k++) add(m.dark, boxUV(2 + r() * 3, 1.5 + r() * 2, 2 + r() * 3, cx + (r() - 0.5) * td * 0.5, top + 0.9, zc + (r() - 0.5) * tw * 0.5, [3, 3]));
      if (row === 0 && height > 18) facades.push({ x: rx(d0, zc), z: zc, width: w, height, style });
      z -= w + 4 + r() * 8;
    }
  });

  for (const [mat, list] of by) {
    const merged = mergeGeometries(list.map((g) => (g.index ? g.toNonIndexed() : g)))!;
    list.forEach((g) => g.dispose());
    const mesh = new THREE.Mesh(merged, mat);
    mesh.castShadow = shadows && mat !== m.street && mat !== m.paving;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return { group, facades };
}
