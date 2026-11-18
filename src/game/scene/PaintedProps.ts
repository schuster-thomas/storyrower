import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import iceUrl from '../../assets/painted/ice.glb?url';
import rocksUrl from '../../assets/painted/rocks.glb?url';
import type { Model, ModelSource } from './NatureKit';

/**
 * Icebergs and rocks in the water, painted like the river banks but from all sides
 * (scripts/blender/props.py → scripts/painted/props.mjs): every face carries the painting of the
 * view that sees it best. Unlit like the banks, so they share the painted light, and tinted with
 * the story phase. The icebergs bob gently on the swell.
 *
 * Models (waterline at y = 0):
 *   Ice_A tabular berg · Ice_B pinnacle · Ice_C chunk · Ice_D small block
 *   Rock_A low rock with a flat top (the puffins' rock) · Rock_B basalt sea stack · Rock_C boulder · Rock_D ledge
 */
export type PropId = 'Ice_A' | 'Ice_B' | 'Ice_C' | 'Ice_D' | 'Rock_A' | 'Rock_B' | 'Rock_C' | 'Rock_D';

/**
 * A copy of a loaded mesh's geometry with its world transform baked in (for InstancedMesh). Loaded
 * positions are quantized (normalized int16 – the node carries the scale), so they become floats
 * first; baking the scale into the int16 values would clamp them to ±1.
 */
export function bakeGeometry(mesh: THREE.Mesh) {
  const geometry = mesh.geometry.clone();
  const pos = geometry.attributes.position;
  const f = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) f.set([pos.getX(i), pos.getY(i), pos.getZ(i)], i * 3);
  geometry.setAttribute('position', new THREE.BufferAttribute(f, 3));
  return geometry.applyMatrix4(mesh.matrixWorld);
}

export class PaintedProps implements ModelSource {
  ready = false;
  readonly loaded: Promise<void>;
  private models = new Map<string, Model>();
  private materials: THREE.MeshBasicMaterial[] = [];
  private time = { value: 0 };
  private swell = { value: 0.1 };

  private static loading: Promise<THREE.Object3D[]> | null = null;
  static preload(): Promise<THREE.Object3D[]> {
    if (!this.loading) {
      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);
      this.loading = Promise.all([iceUrl, rocksUrl].map((u) => loader.loadAsync(u).then((g) => g.scene)));
      this.loading.catch(() => { this.loading = null; });
    }
    return this.loading;
  }

  constructor() {
    this.loaded = PaintedProps.preload().then((scenes) => {
      for (const root of scenes) this.collect(root);
      this.ready = true;
    }).catch((e) => console.warn('Painted props could not be loaded, the river stays without them', e));
  }

  get(id: string): Model | undefined { return this.models.get(id); }

  private collect(root: THREE.Object3D) {
    root.updateMatrixWorld(true);
    const own = new Map<THREE.Material, THREE.MeshBasicMaterial>();
    for (const node of root.children) {
      const parts: Model['parts'] = [];
      node.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const src = mesh.material as THREE.MeshStandardMaterial;
        let mat = own.get(src);
        if (!mat) {
          mat = this.material(src.map, node.name.startsWith('Ice'));
          own.set(src, mat);
        }
        // a copy with the node transform baked in (the loaded scene is cached)
        parts.push({ geometry: bakeGeometry(mesh), material: mat });
      });
      if (!parts.length) continue;
      const box = new THREE.Box3();
      for (const p of parts) { p.geometry.computeBoundingBox(); box.union(p.geometry.boundingBox!); }
      this.models.set(node.name, { parts, size: box.getSize(new THREE.Vector3()), minY: box.min.y });
    }
  }

  /** How far an iceberg at (x, z) has risen at time t – the same as its vertex shader (for the puffins on it). */
  static bob(x: number, z: number, t: number, swell: number) {
    const ph = x * 0.37 + z * 0.21;
    return Math.sin(t * 0.9 + ph) * 0.06 * (0.5 + swell * 2);
  }

  /** unlit painted material; icebergs bob and sway a little, each with its own rhythm (see bob()) */
  private material(map: THREE.Texture | null, bob: boolean) {
    const mat = new THREE.MeshBasicMaterial({ map, fog: true });
    if (bob) {
      const time = this.time, swell = this.swell;
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uTime = time;
        shader.uniforms.uSwell = swell;
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform float uSwell;')
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            #ifdef USE_INSTANCING
              vec4 base = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
              float ph = base.x * 0.37 + base.z * 0.21;
              float amp = 0.5 + uSwell * 2.0;
              transformed.y += sin(uTime * 0.9 + ph) * 0.06 * amp;
              transformed.y += (position.x * sin(uTime * 0.7 + ph * 1.3) + position.z * sin(uTime * 0.6 + ph)) * 0.012 * amp;
            #endif`);
      };
    }
    this.materials.push(mat);
    return mat;
  }

  /** Painted light, tinted with the phase (same as the banks). */
  update(p: { time: number; swell: number; tint: THREE.Color; light: number }) {
    this.time.value = p.time;
    this.swell.value = p.swell;
    for (const m of this.materials) m.color.copy(p.tint).multiplyScalar(p.light);
  }
}
