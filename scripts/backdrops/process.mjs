// Turns the raw generated PNGs into compact WebP layers for the game:
// trims transparent margins, resizes to a sensible maximum and compresses with alpha.
//   node scripts/backdrops/process.mjs
import sharp from 'sharp';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { LAYERS } from './spec.mjs';

const IN = 'assets/raw/backdrops';
const OUT = 'src/assets/backdrops';
/** Turns the flat magenta background of a chroma layer into alpha and removes magenta fringes. */
async function keyMagenta(src) {
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const spill = Math.max(0, Math.min(r, b) - g);              // how magenta the pixel is
    const key = Math.min(1, Math.max(0, (spill - 50) / 130));    // 1 = pure background
    data[i + 3] = Math.round(255 * (1 - key));
    if (spill > 8) { data[i] = r - spill * 0.85; data[i + 2] = b - spill * 0.85; } // despill
  }
  return sharp(data, { raw: info }).png().toBuffer();
}

const MAX_WIDTH = { 'far-mountains': 3072, 'tidal-wave': 1280 };
mkdirSync(OUT, { recursive: true });

let total = 0;
for (const l of LAYERS) {
  const src = `${IN}/${l.id}.png`;
  if (!existsSync(src)) { console.log(`– ${l.id}: missing`); continue; }
  const input = l.chroma ? await keyMagenta(src) : src;
  let trimmed = await sharp(input).trim({ threshold: 1 }).png().toBuffer();
  if (l.cropBottom) {
    // cut off painted water at the foot of a layer (the game draws its own)
    const { width, height } = await sharp(trimmed).metadata();
    trimmed = await sharp(trimmed).extract({ left: 0, top: 0, width, height: Math.round(height * (1 - l.cropBottom)) }).png().toBuffer();
  }
  const out = `${OUT}/${l.id}.webp`;
  const info = await sharp(trimmed)
    .resize({ width: MAX_WIDTH[l.id] ?? 1024, withoutEnlargement: true })
    .webp({ quality: 82, alphaQuality: 90, effort: 6 })
    .toFile(out);
  const kb = statSync(out).size / 1024;
  total += kb;
  console.log(`✓ ${l.id}: ${info.width}×${info.height}, ${kb.toFixed(0)} KB`);
}
console.log(`total ${(total / 1024).toFixed(2)} MB`);
