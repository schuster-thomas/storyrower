import * as THREE from 'three';
import { type GLTF, GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { fitOutfit } from '../../wardrobe/fit';
import { outfitFile, type Outfit } from '../../wardrobe/store';
import boatUrl from '../../assets/models/boat.glb?url';

/**
 * Racing single scull with the rigged rower (scripts/blender/boat.py). The model carries one
 * "Stroke" clip – catch at 0, finish at 35 %, next catch at 100 % – that is scrubbed with the
 * phase of the real stroke, so the rower moves exactly in time with the person on the machine.
 */
export class Boat {
  readonly group = new THREE.Group();
  ready = false;
  /** Resolves once the model is in the group (also when loading failed, so nothing waits forever). */
  readonly loaded: Promise<void>;

  private mixer: THREE.AnimationMixer | null = null;
  private duration = 1;
  /** blade centres (right, left) for splashes */
  private blades: THREE.Object3D[] = [];

  private static loading: Promise<GLTF> | null = null;
  /** Start downloading the model early (setup screen); every game reuses it. */
  static preload(): Promise<GLTF> {
    if (!this.loading) {
      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);
      this.loading = loader.loadAsync(boatUrl).then(gltf => {
        const body = gltf.scene.getObjectByName('Rower') as THREE.SkinnedMesh;
        const positions = body.geometry.getAttribute('position');
        const joints = body.geometry.getAttribute('skinIndex');
        const weights = body.geometry.getAttribute('skinWeight');
        const torsoBones = body.skeleton.bones.map(bone => /Hips$|Spine\d*$/.test(bone.name));
        // Carry the lower rib cage width through the waist and blend into the pelvis.
        for (let i = 0; i < positions.count; i++) {
          const y = positions.getY(i);
          const waist = THREE.MathUtils.smoothstep(y, -.22, .06)
            * (1 - THREE.MathUtils.smoothstep(y, .16, .36));
          const underarm = THREE.MathUtils.smoothstep(y, .22, .39)
            * (1 - THREE.MathUtils.smoothstep(y, .45, .57));
          if (!waist && !underarm) continue;
          let influence = 0;
          for (let j = 0; j < 4; j++) {
            if (torsoBones[joints.getComponent(i, j)]) influence += weights.getComponent(i, j);
          }
          const x = positions.getX(i);
          const flank = THREE.MathUtils.smoothstep(Math.abs(x), .09, .19);
          const widthChange = .42 * waist - .20 * underarm * flank;
          positions.setX(i, x * (1 + widthChange * influence));
        }
        positions.needsUpdate = true;
        return gltf;
      });
      this.loading.catch(() => { this.loading = null; }); // allow a retry
    }
    return this.loading;
  }

  private root?: THREE.Object3D;
  private removeOutfit?: () => void;
  private disposed = false;

  setOutfit(outfit: Outfit) {
    this.outfit = outfit;
    this.removeOutfit?.();
    if (this.root) this.removeOutfit = fitOutfit(this.root, outfit);
  }

  dispose() {
    this.disposed = true;
    this.removeOutfit?.();
    this.mixer?.stopAllAction();
  }

  constructor(shadows: boolean, private outfit: Outfit = outfitFile()) {
    this.loaded = Boat.preload().then((gltf) => {
      // each game gets its own copy (the skeleton must be cloned with the skinned mesh)
      if (this.disposed) return;
      const root = cloneSkinned(gltf.scene);
      this.root = root;
      this.setOutfit(this.outfit);
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = shadows;
        // the boat is always in view, and the bounds of the quantised (meshopt) parts and of the
        // skinned rower don't match what is drawn – never cull it
        mesh.frustumCulled = false;
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
    }).catch((e) => console.warn('Boat model could not be loaded', e));
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
