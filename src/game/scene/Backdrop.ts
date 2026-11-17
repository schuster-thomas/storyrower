import * as THREE from 'three';
import mountainsUrl from '../../assets/backdrops/mountains.webp';
import volcanoCalmUrl from '../../assets/backdrops/volcano-calm.webp';
import volcanoEruptUrl from '../../assets/backdrops/volcano-erupting.webp';
import cliffFallsUrl from '../../assets/backdrops/cliff-waterfalls.webp';
import cliffGreenUrl from '../../assets/backdrops/cliff-green.webp';
import icebergAUrl from '../../assets/backdrops/iceberg-a.webp';
import icebergBUrl from '../../assets/backdrops/iceberg-b.webp';
import waveUrl from '../../assets/backdrops/tidal-wave.webp';

type Key = 'mountains' | 'volcanoCalm' | 'volcanoErupt' | 'cliffFalls' | 'cliffGreen' | 'icebergA' | 'icebergB' | 'wave';
const URLS: Record<Key, string> = {
  mountains: mountainsUrl, volcanoCalm: volcanoCalmUrl, volcanoErupt: volcanoEruptUrl,
  cliffFalls: cliffFallsUrl, cliffGreen: cliffGreenUrl, icebergA: icebergAUrl, icebergB: icebergBUrl, wave: waveUrl,
};

/** Seeded random per chunk, so cards come back the same way. */
function rand(seed: number) {
  let s = (seed * 7919 + 104729) % 233280;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

interface Card { index: number; group: THREE.Group }

export interface BackdropFrame {
  dt: number;
  boatZ: number;
  camera: THREE.Camera;
  /** colour of the haze at the horizon (fog colour) */
  horizon: THREE.Color;
  /** 0–1 overall light level (darker under the ash cloud) */
  light: number;
  lava: number;
  smoke: number;
  /** 0–1 how present the tidal wave is */
  wave: number;
  /** 0 = wave right behind the boat, 1 = far away */
  threat: number;
}

/**
 * Painted 2.5D layers (generated in the style of the original mock-up):
 * a mountain panorama on the horizon, the volcano (calm ↔ erupting), cliff cards with
 * waterfalls along the banks, icebergs drifting near the shore and the tidal wave.
 * Textures load in the background; until then the 3D greybox stand-ins stay visible.
 */
export class Backdrop {
  readonly group = new THREE.Group();
  /** Fires once all textures are ready – the scene then hides its greybox stand-ins. */
  onReady: (() => void) | null = null;
  ready = false;
  /** Painted cliff cards / iceberg sprites along the banks – off: the 3D model kit does this now. */
  cardsEnabled = false;

  private tex = {} as Record<Key, THREE.Texture>;
  private far = new THREE.Group();            // follows the boat (horizon)
  private mountainMat!: THREE.MeshBasicMaterial;
  private volcanoCalm!: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private volcanoErupt!: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private wave!: THREE.Sprite;
  private cardMats: THREE.MeshBasicMaterial[] = [];
  private icebergMats: THREE.SpriteMaterial[] = [];
  private cards: Card[] = [];
  private tmp = new THREE.Color();

  constructor(private chunkLength: number, private riverHalf: number) {
    this.group.add(this.far);
    const loader = new THREE.TextureLoader();
    const keys = Object.keys(URLS) as Key[];
    let loaded = 0;
    for (const k of keys) {
      loader.load(URLS[k], (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 4;
        this.tex[k] = t;
        if (++loaded === keys.length) this.build();
      });
    }
  }

  private aspect(k: Key) { const img = this.tex[k].image as { width: number; height: number }; return img.width / img.height; }

  private build() {
    // Mountain panorama: three copies side by side (middle one mirrored) on the horizon
    this.mountainMat = new THREE.MeshBasicMaterial({ map: this.tex.mountains, transparent: true, depthWrite: false, fog: false });
    const mw = 760, mh = mw / this.aspect('mountains');
    for (let i = -1; i <= 1; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(mw, mh), this.mountainMat);
      m.position.set(i * mw * 0.92, mh / 2 - 12, -760);
      if (i === 0) m.scale.x = -1;
      m.renderOrder = -5;
      this.far.add(m);
    }

    // Volcano: calm and erupting versions on top of each other, cross-faded by the lava level
    const vw = 420;
    const plane = (k: Key) => {
      const mat = new THREE.MeshBasicMaterial({ map: this.tex[k], transparent: true, depthWrite: false, fog: false });
      const h = vw / this.aspect(k);
      const g = new THREE.PlaneGeometry(vw, h).translate(0, h / 2, 0);
      const mesh = new THREE.Mesh(g, mat);
      mesh.position.set(150, -14, -640);
      mesh.renderOrder = -4;
      this.far.add(mesh);
      return mesh;
    };
    this.volcanoCalm = plane('volcanoCalm');
    this.volcanoErupt = plane('volcanoErupt');

    // Cliff cards share two materials
    this.cardMats = (['cliffFalls', 'cliffGreen'] as Key[]).map((k) =>
      new THREE.MeshBasicMaterial({ map: this.tex[k], transparent: true, alphaTest: 0.35, side: THREE.DoubleSide }));
    this.icebergMats = (['icebergA', 'icebergB'] as Key[]).map((k) =>
      new THREE.SpriteMaterial({ map: this.tex[k], transparent: true, alphaTest: 0.3 }));

    // Tidal wave: always faces the camera
    this.wave = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tex.wave, transparent: true, depthWrite: false }));
    this.wave.center.set(0.5, 0.08);
    this.wave.visible = false;
    this.group.add(this.wave);

    this.ready = true;
    this.onReady?.();
  }

  // ---------- cards along the river (rebuilt per chunk like the terrain) ----------

  private buildCards(index: number): Card {
    const r = rand(index);
    const group = new THREE.Group();
    const zCenter = -index * this.chunkLength - this.chunkLength / 2;
    for (const side of [-1, 1]) {
      if (r() < 0.45) {
        const k = r() < 0.55 ? 0 : 1;
        const mat = this.cardMats[k];
        const aspect = this.aspect(k === 0 ? 'cliffFalls' : 'cliffGreen');
        const w = 55 + r() * 25;
        const h = w / aspect;
        const card = new THREE.Mesh(new THREE.PlaneGeometry(w, h).translate(0, h / 2, 0), mat);
        // angled towards the river and the camera; mirrored on the right so falls face the water
        card.position.set(side * (this.riverHalf + 32 + r() * 18), -2.5, zCenter + (r() - 0.5) * 10);
        card.rotation.y = -side * 0.55;
        if (side > 0) card.scale.x = -1;
        group.add(card);
      }
      // icebergs drift near the shore, never in the boat's lane
      if (r() < 0.22) {
        const k = r() < 0.5 ? 0 : 1;
        const s = new THREE.Sprite(this.icebergMats[k]);
        const w = 2.2 + r() * 2.3;
        s.scale.set(w, w / this.aspect(k === 0 ? 'icebergA' : 'icebergB'), 1);
        s.center.set(0.5, 0.18); // sit a little in the water
        s.position.set(side * (this.riverHalf - 1.2 - r() * 1.2), 0, zCenter + (r() - 0.5) * this.chunkLength);
        group.add(s);
      }
    }
    this.group.add(group);
    return { index, group };
  }

  update(f: BackdropFrame, chunkMin: number, chunkMax: number) {
    if (!this.ready) return;
    this.far.position.set(0, 0, f.boatZ);

    // cards: keep the ones in range, add missing (max one per frame)
    this.cards = this.cards.filter((c) => {
      if (c.index >= chunkMin && c.index <= chunkMax) return true;
      this.group.remove(c.group);
      c.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose(); });
      return false;
    });
    for (let i = chunkMin; i <= chunkMax && this.cardsEnabled; i++) {
      if (this.cards.some((c) => c.index === i)) continue;
      this.cards.push(this.buildCards(i));
      break;
    }

    // Grading: distant layers fade into the haze, everything darkens under the ash cloud
    const light = Math.max(0.35, f.light);
    this.tmp.setRGB(light, light, light).lerp(f.horizon, 0.35);
    this.mountainMat.color.copy(this.tmp).lerp(f.horizon, 0.25);
    this.volcanoCalm.material.color.copy(this.tmp);
    this.volcanoErupt.material.color.setRGB(1, 1, 1).lerp(this.tmp, 0.4);
    const erupt = Math.min(1, Math.max(0, (f.lava - 0.35) / 0.4));
    this.volcanoCalm.material.opacity = 1 - erupt;
    this.volcanoErupt.material.opacity = erupt;
    this.volcanoCalm.visible = erupt < 0.99;
    this.volcanoErupt.visible = erupt > 0.01;
    // the volcano looms closer as the story escalates
    this.volcanoCalm.position.z = this.volcanoErupt.position.z = -640 + f.lava * 160;
    for (const m of this.cardMats) m.color.setRGB(light, light, light).lerp(new THREE.Color(0x8a837a), f.smoke * 0.35);
    for (const m of this.icebergMats) m.color.setRGB(light, light, light);

    // Tidal wave sprite behind the boat
    this.wave.visible = f.wave > 0.02;
    if (this.wave.visible) {
      const dist = 14 + f.threat * 70 + (1 - f.wave) * 120;
      const w = 140; // wider than the river view, so the image edges hide behind the banks
      const h = (w / this.aspect('wave')) * (0.55 + f.wave * 0.75);
      this.wave.scale.set(w, h, 1);
      this.wave.position.set(0, -1.2, f.boatZ + dist);
      this.wave.material.color.setRGB(light, light, light).lerp(new THREE.Color(1, 1, 1), 0.3);
    }
  }

  dispose() {
    for (const t of Object.values(this.tex)) t.dispose();
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      (m.material as THREE.Material | undefined)?.dispose?.();
    });
  }
}
