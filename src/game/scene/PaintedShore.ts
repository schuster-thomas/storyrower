import * as THREE from 'three';
import { type GLTF, GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import shoreAUrl from '../../assets/painted/shore-a.glb?url';
import { SHORE_SECTION } from './Fjord';

/**
 * The left shore as painted sections (matte-painting approach, scripts/blender/painted_shore.py):
 * simple geometry with a painting projected onto it, so the light, detail and style come from the
 * painting while the cliffs still pass by with real depth. Sections are 200 m long and alternate
 * normal / mirrored, so neighbours always meet without a seam. The painted waterfalls get an
 * animated overlay (flowing streaks, mist) on top.
 */
export class PaintedShore {
  readonly group = new THREE.Group();
  ready = false;
  readonly loaded: Promise<void>;

  private template: THREE.Object3D | null = null;
  private material: THREE.MeshBasicMaterial | null = null;
  private live = new Map<number, THREE.Object3D>();
  private fallMat: THREE.ShaderMaterial;
  private mistMat: THREE.SpriteMaterial;

  private static loading: Promise<GLTF> | null = null;
  static preload(): Promise<GLTF> {
    if (!this.loading) {
      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);
      this.loading = loader.loadAsync(shoreAUrl);
      this.loading.catch(() => { this.loading = null; });
    }
    return this.loading;
  }

  constructor(fall: THREE.ShaderMaterial, mist: THREE.SpriteMaterial) {
    // a softer copy of the fjord's waterfall shader: the painting already shows the water
    this.fallMat = fall.clone();
    this.fallMat.uniforms.uAlpha.value = 0.5;
    this.mistMat = mist;
    this.loaded = PaintedShore.preload().then((gltf) => {
      const root = gltf.scene;
      root.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const src = mesh.material as THREE.MeshStandardMaterial;
        // the light is painted in: unlit, but fogged and tinted with the phase
        this.material ??= new THREE.MeshBasicMaterial({ map: src.map, fog: true, side: THREE.DoubleSide });
        mesh.material = this.material;
      });
      // waterfall overlays at the markers (scale = width × height of the falling sheet)
      for (const name of ['Fall_Lower', 'Fall_Upper']) {
        const marker = root.getObjectByName(name);
        if (!marker) continue;
        const sheet = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.fallMat);
        sheet.position.copy(marker.position);
        sheet.scale.set(marker.scale.x, marker.scale.y, 1);
        sheet.rotation.y = Math.PI / 2; // face the fjord
        sheet.renderOrder = 2;
        root.add(sheet);
        if (name === 'Fall_Lower') {
          for (let k = 0; k < 3; k++) {
            const m = new THREE.Sprite(this.mistMat);
            const s = 7 + k * 3;
            m.scale.set(s, s * 0.55, 1);
            m.position.set(marker.position.x + 2 + k * 1.5, s * 0.12, marker.position.z + (k - 1) * 2);
            root.add(m);
          }
        }
      }
      this.template = root;
      this.ready = true;
    }).catch((e) => console.warn('Painted shore could not be loaded, keeping the generated slopes', e));
  }

  /** Keep the sections around the boat; tint the painted light with the phase. */
  update(p: { time: number; boatZ: number; ahead: number; behind: number; tint: THREE.Color; light: number }) {
    if (!this.template) return;
    const cur = Math.floor(-p.boatZ / SHORE_SECTION);
    const min = cur - Math.ceil(p.behind / SHORE_SECTION), max = cur + Math.ceil(p.ahead / SHORE_SECTION);
    for (const [k, g] of this.live) if (k < min || k > max) { this.group.remove(g); this.live.delete(k); }
    for (let k = min; k <= max; k++) {
      if (this.live.has(k)) continue;
      const g = this.template.clone();
      // even sections as painted, odd ones mirrored along the fjord
      if (k % 2 === 0) g.position.z = -k * SHORE_SECTION;
      else { g.scale.z = -1; g.position.z = -(k + 1) * SHORE_SECTION; }
      this.group.add(g);
      this.live.set(k, g);
    }
    this.material?.color.copy(p.tint).multiplyScalar(p.light);
    this.fallMat.uniforms.uTime.value = p.time;
    this.fallMat.uniforms.uLight.value = p.light;
  }
}
