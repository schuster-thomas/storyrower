import * as THREE from 'three';
import farUrl from '../../assets/backdrops/far-mountains.webp';

type Key = 'far';
const URLS: Record<Key, string> = { far: farUrl };

const RADIUS = 800;      // distance of the mountain panorama
const SQUASH = 0.65;     // keep the peaks low on the horizon

export interface BackdropFrame {
  dt: number;
  boatZ: number;
  camera: THREE.Camera;
  /** colour of the haze at the horizon (fog colour) */
  horizon: THREE.Color;
  /** 0–1 overall light level (darker under the ash cloud) */
  light: number;
  smoke: number;
}

/**
 * Painted 2.5D layers: a mountain panorama all around the fjord (snowy peaks, green slopes on the
 * left, an ice cap on the right). The volcano and the tidal wave have their own modules.
 * Textures load in the background; until then the 3D greybox stand-ins stay visible.
 */
export class Backdrop {
  readonly group = new THREE.Group();
  /** Fires once all textures are ready – the scene then hides its greybox stand-ins. */
  onReady: (() => void) | null = null;
  ready = false;

  private tex = {} as Record<Key, THREE.Texture>;
  private far = new THREE.Group();            // follows the boat (horizon)
  private mountainMat!: THREE.MeshBasicMaterial;
  private tmp = new THREE.Color();

  /** Resolves once the layers are built (also when loading failed, so nothing waits forever). */
  readonly loaded: Promise<void>;

  private static loading: Promise<Record<Key, THREE.Texture>> | null = null;
  /** Start loading the textures early (setup screen); every game shares them. */
  static preload(): Promise<Record<Key, THREE.Texture>> {
    if (!this.loading) {
      const loader = new THREE.TextureLoader();
      const keys = Object.keys(URLS) as Key[];
      this.loading = Promise.all(keys.map((k) => loader.loadAsync(URLS[k]).then((t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 4;
        return [k, t] as const;
      }))).then((pairs) => Object.fromEntries(pairs) as Record<Key, THREE.Texture>);
      this.loading.catch(() => { this.loading = null; }); // allow a retry
    }
    return this.loading;
  }

  constructor() {
    this.group.add(this.far);
    this.loaded = Backdrop.preload().then((tex) => { this.tex = tex; this.build(); })
      .catch((e) => console.warn('Painted layers could not be loaded, keeping the greybox stand-ins', e));
  }

  private aspect(k: Key) { const img = this.tex[k].image as { width: number; height: number }; return img.width / img.height; }

  private build() {
    // Mountain panorama on a cylinder around the boat: the painting covers the front half,
    // its mirror image the back half, so the seams match and the camera can swing freely.
    const far = this.tex.far;
    far.wrapS = THREE.MirroredRepeatWrapping;
    far.repeat.x = 2;
    this.mountainMat = new THREE.MeshBasicMaterial({ map: far, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide });
    const height = ((Math.PI * RADIUS) / this.aspect('far')) * SQUASH;
    // u = 0.25 (middle of the painting) straight ahead; mirrored in x so the glacier is on the right
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(RADIUS, RADIUS, height, 96, 1, true, Math.PI / 2, Math.PI * 2), this.mountainMat);
    ring.scale.x = -1;
    ring.position.y = height / 2 - 14;
    ring.renderOrder = -5;
    this.far.add(ring);


    this.ready = true;
    this.onReady?.();
  }

  update(f: BackdropFrame) {
    if (!this.ready) return;
    this.far.position.set(0, 0, f.boatZ);

    // Grading: distant layers fade into the haze, everything darkens under the ash cloud
    const light = Math.max(0.35, f.light);
    this.tmp.setRGB(light, light, light).lerp(f.horizon, 0.3);
    this.mountainMat.color.copy(this.tmp).lerp(f.horizon, 0.15 + f.smoke * 0.35);

  }

  dispose() {
    // the textures are shared by every game (see preload) and stay loaded
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      (m.material as THREE.Material | undefined)?.dispose?.();
    });
  }
}
