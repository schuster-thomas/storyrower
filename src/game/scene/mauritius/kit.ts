import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { normalise, type Model } from '../models';
import sand from '../../../assets/levels/mauritius/tex/sand.webp';
import scrub from '../../../assets/levels/mauritius/tex/scrub.webp';
import jungle from '../../../assets/levels/mauritius/tex/jungle.webp';
import loungersUrl from '../../../assets/levels/mauritius/models/loungers.glb?url';
import hutUrl from '../../../assets/levels/mauritius/models/hut.glb?url';
import pirogueUrl from '../../../assets/levels/mauritius/models/pirogue.glb?url';
import speedboatUrl from '../../../assets/levels/mauritius/models/speedboat.glb?url';
import skierUrl from '../../../assets/levels/mauritius/models/skier.glb?url';
import surferUrl from '../../../assets/levels/mauritius/models/surfer.glb?url';
import snorkelerUrl from '../../../assets/levels/mauritius/models/snorkeler.glb?url';
import sharkUrl from '../../../assets/levels/mauritius/models/shark.glb?url';

/**
 * The building kit of the Mauritius coast: tileable painted ground textures (scripts/mauritius/assets.mjs),
 * repeated in metres, and the Tripo3D models (scripts/mauritius/models.mjs) – beach furniture and
 * boats, the people out on the lagoon and the shark.
 */

const TEX = { sand, scrub, jungle };
export type TexKey = keyof typeof TEX;
const MODELS = { loungers: loungersUrl, hut: hutUrl, pirogue: pirogueUrl, speedboat: speedboatUrl, skier: skierUrl, surfer: surferUrl, snorkeler: snorkelerUrl };
export type ModelKey = keyof typeof MODELS;

export interface MauritiusKit {
  tex: Record<TexKey, THREE.Texture>;
  /** normalised to height 1 (a model that failed to load is left out) */
  models: Partial<Record<ModelKey, Model>>;
  /** the shark as loaded (Shark.ts builds its own swimming material) */
  shark: THREE.Object3D | null;
}

let loading: Promise<MauritiusKit> | null = null;
export function loadKit(): Promise<MauritiusKit> {
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
    const models = Promise.all((Object.keys(MODELS) as ModelKey[]).map((k) => gl.loadAsync(MODELS[k]).then((g) => [k, normalise(g.scene)] as const, () => [k, null] as const)))
      .then((p) => Object.fromEntries(p.filter(([, m]) => m)) as Partial<Record<ModelKey, Model>>);
    const shark = gl.loadAsync(sharkUrl).then((g) => g.scene as THREE.Object3D, () => null);
    loading = Promise.all([tex, models, shark]).then(([t, m, s]) => ({ tex: t, models: m, shark: s }));
    loading.catch(() => { loading = null; });
  }
  return loading;
}

/** Scale for a normalised model so that its longest side is `length` metres. */
export const lengthScale = (m: Model, length: number) => length / Math.max(1, m.width, m.depth);
