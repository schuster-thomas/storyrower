import * as THREE from 'three';
import farUrl from '../../assets/backdrops/far-mountains.webp';
import waveUrl from '../../assets/backdrops/tidal-wave.webp';

type Key = 'far' | 'wave';
const URLS: Record<Key, string> = { far: farUrl, wave: waveUrl };

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
  /** 0–1 how present the tidal wave is */
  wave: number;
  /** 0 = wave right behind the boat, 1 = far away */
  threat: number;
}

/**
 * Painted 2.5D layers: a mountain panorama all around the fjord (snowy peaks, green slopes on the
 * left, an ice cap on the right) and the tidal wave. The volcano has its own module (Volcano.ts).
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
  private wave!: THREE.Sprite;
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

    // Tidal wave: always faces the camera
    this.wave = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.wave, transparent: true, depthWrite: false }));
    this.wave.center.set(0.5, 0.08);
    this.wave.visible = false;
    this.group.add(this.wave);

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

    // Tidal wave sprite behind the boat
    this.wave.visible = f.wave > 0.02;
    if (this.wave.visible) {
      const dist = 14 + f.threat * 70 + (1 - f.wave) * 120;
      const w = 220; // wide enough to fill the view behind the boat
      const h = (w / this.aspect('wave')) * (0.55 + f.wave * 0.75);
      this.wave.scale.set(w, h, 1);
      this.wave.position.set(0, -1.2, f.boatZ + dist);
      this.wave.material.color.setRGB(light, light, light).lerp(new THREE.Color(1, 1, 1), 0.3);
    }
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
