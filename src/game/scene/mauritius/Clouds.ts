import * as THREE from 'three';
import puffsUrl from '../../../assets/painted/ash-puffs.webp';
import { NO_REFLECTION } from '../Water';

/** Where the big clouds hang, relative to the boat: over the open sea, ahead and to the left. */
const CLOUDS: { x: number; y: number; dz: number; size: number; tile: number }[] = [
  { x: -330, y: 175, dz: -560, size: 290, tile: 0 },
  { x: -150, y: 215, dz: -690, size: 240, tile: 1 },
  { x: -480, y: 140, dz: -430, size: 250, tile: 2 },
  { x: -40, y: 250, dz: -780, size: 200, tile: 3 },
  { x: -260, y: 125, dz: -330, size: 160, tile: 1 },
];

/**
 * Big towering cumulus over the open sea on the left (as in the mock-up), so the sky there isn't
 * empty: painted puffs (the same atlas as the sky's clouds), drifting slowly. Slate grey under the
 * storm (the cloud ceiling then takes over), glowing warm when the sun is low.
 */
export class SeaClouds {
  readonly group = new THREE.Group();
  /** drift: phase of the slow sway */
  private sprites: { sprite: THREE.Sprite; drift: number }[] = [];
  private mats: THREE.SpriteMaterial[] = [];
  private textures: THREE.Texture[] = [];
  private grey = new THREE.Color(0x4a5466);
  private glow = new THREE.Color(1.45, 0.82, 0.62);   // sunset: lit pink-orange from below
  private tmp = new THREE.Color();

  constructor() {
    new THREE.TextureLoader().loadAsync(puffsUrl).then((atlas) => {
      atlas.colorSpace = THREE.SRGBColorSpace;
      for (let i = 0; i < 4; i++) {
        const t = atlas.clone();
        t.repeat.set(0.25, 1);
        t.offset.set(i * 0.25, 0);
        t.needsUpdate = true;
        this.textures.push(t);
        this.mats.push(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, fog: false }));
      }
      for (const c of CLOUDS) {
        const sprite = new THREE.Sprite(this.mats[c.tile]);
        // the puffs are tall: spread them out into wide, towering cumulus
        sprite.scale.set(c.size, c.size * 0.55, 1);
        sprite.renderOrder = -7;   // behind the painted coast, in front of the storm ceiling
        sprite.layers.set(NO_REFLECTION);
        this.sprites.push({ sprite, drift: Math.random() * Math.PI * 2 });
        this.group.add(sprite);
      }
      atlas.dispose();
    }).catch(() => { /* no clouds then */ });
  }

  /**
   * @param storm 0–1 (they grey over, the cloud ceiling takes their place)
   * @param horizon colour of the haze at the horizon (evening glow)
   * @param evening 0–1 how low the sun is
   */
  update(f: { dt: number; boatZ: number; storm: number; horizon: THREE.Color; light: number; evening: number }) {
    for (const [i, c] of this.sprites.entries()) {
      const at = CLOUDS[i];
      // they sway slowly back and forth over the sea (a steady drift would carry them over the mountain)
      c.drift += f.dt * 0.012;
      c.sprite.position.set(at.x + Math.sin(c.drift) * 70, at.y, f.boatZ + at.dz);
    }
    // bright white, a touch of the horizon colour; slate under the storm; warm in the evening
    this.tmp.setRGB(1.3, 1.3, 1.34).lerp(this.grey, Math.min(1, f.storm * 1.2)).lerp(f.horizon, 0.12).lerp(this.glow, f.evening * 0.75);
    for (const m of this.mats) {
      m.color.copy(this.tmp).multiplyScalar(Math.max(0.5, Math.min(1, f.light)));
      m.opacity = 0.95 * (1 - Math.max(0, f.storm - 0.6) * 1.5);
    }
  }

  dispose() {
    for (const m of this.mats) m.dispose();
    for (const t of this.textures) t.dispose();
  }
}
