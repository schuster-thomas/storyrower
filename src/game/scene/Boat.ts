import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import boatUrl from '../../assets/models/boat.glb?url';

/**
 * Racing single scull with the rigged rower (scripts/blender/boat.py). The model carries one
 * "Stroke" clip – catch at 0, finish at 35 %, next catch at 100 % – that is scrubbed with the
 * phase of the real stroke, so the rower moves exactly in time with the person on the machine.
 */
export class Boat {
  readonly group = new THREE.Group();
  ready = false;
  onReady: (() => void) | null = null;

  private mixer: THREE.AnimationMixer | null = null;
  private duration = 1;
  /** blade centres (right, left) for splashes */
  private blades: THREE.Object3D[] = [];

  constructor(shadows: boolean) {
    const loader = new GLTFLoader();
    loader.setMeshoptDecoder(MeshoptDecoder);
    loader.loadAsync(boatUrl).then((gltf) => {
      const root = gltf.scene;
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = shadows;
        // skinned meshes keep their bind-pose bounds, which don't match the seated pose
        if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) mesh.frustumCulled = false;
      });
      this.blades = ['BladeR', 'BladeL'].map((n) => root.getObjectByName(n)).filter((o): o is THREE.Object3D => !!o);
      // Blender exports one clip per animated object (oars, feathering, seat, rig) – play them as one
      const tracks = gltf.animations.flatMap((a) => a.tracks);
      const clip = tracks.length ? new THREE.AnimationClip('Stroke', -1, tracks) : null;
      if (clip) {
        this.mixer = new THREE.AnimationMixer(root);
        this.mixer.clipAction(clip).play();
        this.duration = clip.duration;
      }
      this.group.add(root);
      this.ready = true;
      this.onReady?.();
    }).catch((e) => console.warn('Boat model could not be loaded, keeping the greybox boat', e));
  }

  setShadows(on: boolean) {
    this.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) o.castShadow = on; });
  }

  /** Pose the rower and oars: 0 = catch, 0.35 = finish, 1 = back at the catch. */
  update(phase: number) {
    if (!this.mixer) return;
    this.mixer.setTime(Math.min(0.9999, Math.max(0, phase)) * this.duration);
  }

  /** World positions of both blade centres. */
  bladePositions(out: THREE.Vector3[]) {
    this.blades.forEach((b, i) => { out[i] ??= new THREE.Vector3(); b.getWorldPosition(out[i]); });
    return out.slice(0, this.blades.length);
  }
}
