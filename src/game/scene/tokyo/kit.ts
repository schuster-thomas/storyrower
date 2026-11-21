import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import facadeGlass from '../../../assets/levels/tokyo/tex/facade-glass.webp';
import facadeOffice from '../../../assets/levels/tokyo/tex/facade-office.webp';
import facadeFlats from '../../../assets/levels/tokyo/tex/facade-flats.webp';
import facadeTeal from '../../../assets/levels/tokyo/tex/facade-teal.webp';
import podium from '../../../assets/levels/tokyo/tex/podium.webp';
import roof from '../../../assets/levels/tokyo/tex/roof.webp';
import wallStone from '../../../assets/levels/tokyo/tex/wall-stone.webp';
import wallCity from '../../../assets/levels/tokyo/tex/wall-city.webp';
import paving from '../../../assets/levels/tokyo/tex/paving.webp';
import lawn from '../../../assets/levels/tokyo/tex/lawn.webp';
import gravel from '../../../assets/levels/tokyo/tex/gravel.webp';
import forest from '../../../assets/levels/tokyo/tex/forest.webp';
import pagodaUrl from '../../../assets/levels/tokyo/models/pagoda.glb?url';
import teahouseUrl from '../../../assets/levels/tokyo/models/teahouse.glb?url';
import lanternUrl from '../../../assets/levels/tokyo/models/lantern.glb?url';
import houseUrl from '../../../assets/levels/tokyo/models/house.glb?url';
import shrineUrl from '../../../assets/levels/tokyo/models/shrine.glb?url';
import pagoda3Url from '../../../assets/levels/tokyo/models/pagoda3.glb?url';

/**
 * The building kit of the Tokyo banks: tileable painted textures (scripts/tokyo/textures.mjs),
 * repeated in metres so windows and stones keep their size from every angle, and a few Tripo3D
 * models (pagodas, tea house, garden house, shrine, stone lantern).
 */

const TEX = { facadeGlass, facadeOffice, facadeFlats, facadeTeal, podium, roof, wallStone, wallCity, paving, lawn, gravel, forest };
export type TexKey = keyof typeof TEX;
const MODELS = { pagoda: pagodaUrl, pagoda3: pagoda3Url, teahouse: teahouseUrl, house: houseUrl, shrine: shrineUrl, lantern: lanternUrl };
export type ModelKey = keyof typeof MODELS;

/** Metres one texture tile covers (width along the surface, height). */
export const TILE: Record<TexKey, [number, number]> = {
  facadeGlass: [12, 14.4], facadeOffice: [13, 14.4], facadeFlats: [12, 12], facadeTeal: [12, 14.4],
  podium: [14, 5.5], roof: [8, 8], wallStone: [6.5, 4.3], wallCity: [6.5, 4.3], paving: [4, 4], lawn: [7, 7], gravel: [3, 3], forest: [28, 28],
};

/** A model normalised to height 1, standing on y = 0, centred – its meshes share geometry and material. */
export interface Model { parts: { geometry: THREE.BufferGeometry; material: THREE.Material }[]; width: number; depth: number }

export interface Kit { tex: Record<TexKey, THREE.Texture>; models: Partial<Record<ModelKey, Model>> }

let loading: Promise<Kit> | null = null;
export function loadKit(): Promise<Kit> {
  if (!loading) {
    const tl = new THREE.TextureLoader();
    const gl = new GLTFLoader();
    gl.setMeshoptDecoder(MeshoptDecoder);
    const tex = Promise.all((Object.keys(TEX) as TexKey[]).map((k) => tl.loadAsync(TEX[k]).then((t) => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = 8;
      return [k, t] as const;
    }))).then((p) => Object.fromEntries(p) as Record<TexKey, THREE.Texture>);
    // a model that failed to load is simply left out (cards stand in)
    const models = Promise.all((Object.keys(MODELS) as ModelKey[]).map((k) => gl.loadAsync(MODELS[k]).then((g) => [k, normalise(g.scene)] as const, () => [k, null] as const)))
      .then((p) => Object.fromEntries(p.filter(([, m]) => m)) as Partial<Record<ModelKey, Model>>);
    loading = Promise.all([tex, models]).then(([t, m]) => ({ tex: t, models: m }));
    loading.catch(() => { loading = null; });
  }
  return loading;
}

function normalise(root: THREE.Object3D): Model {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const s = 1 / size.y;
  const parts: Model['parts'] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const g = m.geometry.clone().applyMatrix4(m.matrixWorld).translate(-c.x, -box.min.y, -c.z).scale(s, s, s);
    const mat = (m.material as THREE.MeshStandardMaterial).clone();
    mat.roughness = Math.max(0.5, mat.roughness);
    mat.metalness = Math.min(0.2, mat.metalness);
    parts.push({ geometry: g, material: mat });
  });
  return { parts, width: size.x * s, depth: size.z * s };
}

/** A copy of a model `height` metres tall (shares geometry and materials). */
export function placeModel(m: Model, height: number, x: number, y: number, z: number, rotY: number, shadows: boolean) {
  const g = new THREE.Group();
  for (const p of m.parts) {
    const mesh = new THREE.Mesh(p.geometry, p.material);
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    mesh.userData.shared = true;
    g.add(mesh);
  }
  g.scale.setScalar(height);
  g.position.set(x, y, z);
  g.rotation.y = rotY;
  return g;
}

/**
 * An axis-aligned box whose side faces are textured in metres (u along the face, v up, starting at
 * `v0` metres so stacked boxes continue the same facade). Top and bottom map in x/z metres.
 */
export function boxUV(w: number, h: number, d: number, cx: number, y0: number, cz: number, tile: [number, number], v0 = 0, topTile?: [number, number]) {
  const g = new THREE.BoxGeometry(w, h, d);
  const pos = g.attributes.position as THREE.BufferAttribute, uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const face = Math.floor(i / 4);   // +x, -x, +y, -y, +z, -z
    const v = (v0 + y + h / 2) / tile[1];
    if (face === 0) uv.setXY(i, (-z + d / 2) / tile[0], v);
    else if (face === 1) uv.setXY(i, (z + d / 2) / tile[0], v);
    else if (face === 4) uv.setXY(i, (x + w / 2) / tile[0], v);
    else if (face === 5) uv.setXY(i, (-x + w / 2) / tile[0], v);
    else { const t = topTile ?? tile; uv.setXY(i, (x + cx) / t[0], (z + cz) / t[1]); }
  }
  g.translate(cx, y0 + h / 2, cz);
  return g;
}
