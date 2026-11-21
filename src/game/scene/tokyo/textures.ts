import * as THREE from 'three';

/** Small canvas textures of the Tokyo world: dust puffs and cherry petals (plus a seeded random). */

/** Deterministic random numbers, so every run (and every chunk) looks the same. */
export function rng(seed: number) {
  let s = (Math.floor(seed * 9301 + 49297) >>> 0) || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 100000) / 100000; };
}

/** Soft round puff (dust clouds, glows). */
export function puffTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** A cherry petal: a soft pink teardrop with a notch. */
export function petalTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createLinearGradient(0, 8, 0, 60);
  grad.addColorStop(0, '#fff3f7'); grad.addColorStop(1, '#f7a8c4');
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(32, 60);
  g.bezierCurveTo(6, 44, 8, 12, 24, 6);
  g.lineTo(32, 14);
  g.lineTo(40, 6);
  g.bezierCurveTo(56, 12, 58, 44, 32, 60);
  g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
