import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import natureUrl from '../../assets/models/nature.glb?url';

/** One drawable piece of a model (models can have e.g. bark + leaves). */
export interface Part { geometry: THREE.BufferGeometry; material: THREE.Material }
export interface Model { parts: Part[]; size: THREE.Vector3; minY: number }

export type ModelId =
  | 'Rock_Medium_1' | 'Rock_Medium_2' | 'Rock_Medium_3' | 'Pebble_Round_2' | 'Pebble_Square_2'
  | 'Grass_Common_Short' | 'Grass_Common_Tall' | 'Grass_Wispy_Tall'
  | 'Flower_3_Group' | 'Flower_4_Group' | 'Plant_7_Big' | 'Bush_Common' | 'Bush_Common_Flowers'
  | 'Pine_1' | 'Pine_3' | 'CommonTree_1'
  // derived variants
  | 'Lupine' | 'Iceberg_1' | 'Iceberg_2';

/**
 * CC0 models from Quaternius' "Stylized Nature MegaKit" (see CREDITS.md), bundled into one
 * compressed GLB by scripts/models/build.mjs. Each model is split into parts with its node
 * transform baked in, ready for InstancedMesh.
 */
export class NatureKit {
  private models = new Map<ModelId, Model>();
  /** materials whose colour follows the phase (ash greys the plants) */
  readonly foliage: THREE.MeshStandardMaterial[] = [];
  readonly rock: THREE.MeshStandardMaterial[] = [];
  readonly ice: THREE.MeshStandardMaterial;

  private constructor(root: THREE.Object3D) {
    const byName = new Map<string, THREE.Material>();
    root.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m && !byName.has(m.name)) byName.set(m.name, m);
    });
    // unify the look: fully matte, crisp cut-outs for foliage
    for (const m of byName.values() as Iterable<THREE.MeshStandardMaterial>) {
      m.roughness = 1;
      m.metalness = 0;
      if (m.alphaTest > 0) { m.alphaTest = 0.5; m.side = THREE.DoubleSide; this.foliage.push(m); }
      else this.rock.push(m);
    }

    root.updateMatrixWorld(true);
    for (const node of root.children) {
      const parts: Part[] = [];
      const inv = new THREE.Matrix4().copy(node.matrixWorld).invert();
      node.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const g = mesh.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld));
        parts.push({ geometry: g, material: mesh.material as THREE.Material });
      });
      this.models.set(node.name as ModelId, this.measure(parts));
    }

    // The bush comes with red autumn leaves – give it the green ones
    const green = byName.get('Leaves_NormalTree');
    const bush = this.models.get('Bush_Common');
    if (green && bush) bush.parts.forEach((p) => { p.material = green; });

    // Lupines: the pink flower group recoloured purple
    const flowers = this.models.get('Flower_3_Group');
    if (flowers) {
      const parts = flowers.parts.map((p) => {
        const m = (p.material as THREE.MeshStandardMaterial).clone();
        if (m.name === 'Flowers') { m.color.set(0x9a6ad8); this.foliage.push(m); }
        return { geometry: p.geometry, material: m };
      });
      this.models.set('Lupine', this.measure(parts));
    }

    // Icebergs: rocks with a glacier-ice material
    this.ice = new THREE.MeshStandardMaterial({ color: 0xdff4fb, emissive: 0x2a6f86, emissiveIntensity: 0.25, roughness: 0.35, metalness: 0, flatShading: true });
    for (const [src, id] of [['Rock_Medium_1', 'Iceberg_1'], ['Rock_Medium_3', 'Iceberg_2']] as const) {
      const m = this.models.get(src);
      if (m) this.models.set(id, this.measure(m.parts.map((p) => ({ geometry: p.geometry, material: this.ice }))));
    }
  }

  private measure(parts: Part[]): Model {
    const box = new THREE.Box3();
    for (const p of parts) { p.geometry.computeBoundingBox(); box.union(p.geometry.boundingBox!); }
    return { parts, size: box.getSize(new THREE.Vector3()), minY: box.min.y };
  }

  get(id: ModelId): Model | undefined { return this.models.get(id); }

  private static loading: Promise<NatureKit> | null = null;
  static load(): Promise<NatureKit> {
    this.loading ??= (async () => {
      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);
      const gltf = await loader.loadAsync(natureUrl);
      return new NatureKit(gltf.scene);
    })();
    return this.loading;
  }
}

/** Collects transforms per model and turns them into InstancedMeshes (one per part). */
export class Scatter {
  private items = new Map<ModelId, THREE.Matrix4[]>();
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();

  constructor(private kit: NatureKit) {}

  /** Place a model with its base at `y` (scale is uniform unless `stretchY` is given). */
  add(id: ModelId, x: number, y: number, z: number, scale: number, rotY = 0, stretchY = 1, tilt = 0) {
    const model = this.kit.get(id);
    if (!model) return;
    const list = this.items.get(id) ?? [];
    this.e.set(tilt, rotY, tilt * 0.5);
    this.q.setFromEuler(this.e);
    this.s.set(scale, scale * stretchY, scale);
    this.p.set(x, y - model.minY * scale * stretchY, z);
    list.push(this.m.compose(this.p, this.q, this.s).clone());
    this.items.set(id, list);
  }

  build(group: THREE.Group, shadows: { cast: boolean }) {
    for (const [id, mats] of this.items) {
      const model = this.kit.get(id)!;
      for (const part of model.parts) {
        const inst = new THREE.InstancedMesh(part.geometry, part.material, mats.length);
        mats.forEach((mt, i) => inst.setMatrixAt(i, mt));
        inst.castShadow = shadows.cast;
        inst.receiveShadow = true;
        inst.computeBoundingSphere();
        group.add(inst);
      }
    }
  }
}
