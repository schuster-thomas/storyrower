import * as THREE from 'three';
import { glacierFront, leftShore } from '../Fjord';
import type { Card } from '../Cards';
import { buildCity, cityMaterials, WALL_TOP, type CityMaterials, type FacadeSpot } from './City';
import { buildGarden, gardenMaterials, gardenY, PATH_D, type GardenMaterials } from './Garden';
import type { Kit } from './kit';
import { bridgeGeometry, smallToriiGeometry } from './Structures';
import { rng } from './textures';

export type { FacadeSpot } from './City';

/**
 * One 100 m stretch of the Tokyo river, modelled in 3D: the Japanese garden on the left
 * (Garden.ts), the city waterfront on the right (City.ts), every 400 m an arched vermilion bridge
 * with lanterns and blossoming trees at both ends, and now and then a tunnel of small torii over
 * the garden path. The bank lines are the shared ones (Fjord.ts), so the water's shallows fit.
 */

export const CHUNK = 100;

export interface TokyoMaterials {
  painted: THREE.MeshStandardMaterial;   // vertex-coloured structures (bridges, torii)
  torii: THREE.BufferGeometry;
  city: CityMaterials;
  garden: GardenMaterials;
}

export function createTokyoMaterials(kit: Kit): TokyoMaterials {
  return {
    painted: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55 }),
    torii: smallToriiGeometry(),
    city: cityMaterials(kit),
    garden: gardenMaterials(kit),
  };
}

export interface TokyoChunk {
  index: number;
  group: THREE.Group;
  /** the city side shakes in the quake */
  city: THREE.Group;
  cards: { sakura: Card[]; garden: Card[]; shrubs: Card[]; trees: Card[] };
  facades: FacadeSpot[];
}

export function buildTokyoChunk(index: number, m: TokyoMaterials, kit: Kit, shadows: boolean): TokyoChunk {
  const z0 = -index * CHUNK;
  const r = rng(index * 7.13 + 1);
  const group = new THREE.Group();
  const bridge = index % 4 === 2;
  const zb = z0 - 50;
  const keepClear = (z: number) => bridge && Math.abs(z - zb) < 10;

  const garden = buildGarden(index, CHUNK, kit, m.garden, shadows, keepClear);
  const city = buildCity(index, CHUNK, m.city, shadows);
  group.add(garden.group, city.group);
  const cards = garden.cards;
  const rx = (d: number, z: number) => glacierFront(z) + d;
  const lx = (d: number, z: number) => -(leftShore(z) + d);

  // cherry trees on the city promenade
  for (let z = z0 - r() * 20; z > z0 - CHUNK; z -= 22 + r() * 22) {
    if (keepClear(z)) continue;
    cards.sakura.push({ x: rx(4 + r() * 3, z), y: WALL_TOP, z, tile: 1 + Math.floor(r() * 3), height: 8.5 + r() * 3, flip: r() < 0.5, sway: 0.6, seed: r() });
  }

  // a tunnel of small torii over the garden path
  if (index % 5 === 3) {
    const zs: number[] = [];
    for (let z = z0 - 25; z > z0 - 75; z -= 1.7) zs.push(z);
    const tunnel = new THREE.InstancedMesh(m.torii, m.painted, zs.length);
    const mat4 = new THREE.Matrix4();
    zs.forEach((z, i) => {
      // the path runs along the river: each gate stands across it, facing along z
      mat4.makeRotationY(Math.PI / 2).setPosition(lx(PATH_D, z), gardenY(PATH_D, z) - 0.05, z);
      tunnel.setMatrixAt(i, mat4);
    });
    tunnel.castShadow = shadows;
    group.add(tunnel);
  }

  // an arched bridge every 400 m, framed by lanterns and blossoming trees
  if (bridge) {
    const mesh = new THREE.Mesh(bridgeGeometry(-leftShore(zb) - 1.2, glacierFront(zb) + 1.2), m.painted);
    mesh.position.z = zb;
    mesh.castShadow = shadows;
    group.add(mesh);
    for (const s of [-1, 1]) {
      const x = (d: number, z: number) => (s < 0 ? lx(d, z) : rx(d, z)), y = s < 0 ? gardenY(1.2, zb) : WALL_TOP;
      for (const dz of [-3.4, 3.4]) cards.garden.push({ x: x(1.2, zb + dz), y, z: zb + dz, tile: 2, height: 2.6, seed: r() });
      cards.sakura.push({ x: x(2.5, zb - 10), y, z: zb - 10, tile: 3, height: 12, flip: s > 0, sway: 0.6, seed: r() });
      cards.sakura.push({ x: x(2.5, zb + 10), y, z: zb + 10, tile: 2, height: 11, flip: s < 0, sway: 0.6, seed: r() });
    }
  }

  return { index, group, city: city.group, cards, facades: city.facades };
}

export function disposeTokyoChunk(c: TokyoChunk) {
  c.group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if ((mesh as unknown as THREE.InstancedMesh).isInstancedMesh) (mesh as unknown as THREE.InstancedMesh).dispose();
    // the torii geometry and the models' geometry are shared
    else if (mesh.isMesh && !mesh.userData.shared) mesh.geometry.dispose();
  });
}
