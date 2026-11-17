// Turns the raw generated PNGs into compact WebP layers for the game:
// trims transparent margins, resizes to a sensible maximum and compresses with alpha.
//   node scripts/backdrops/process.mjs
import sharp from 'sharp';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { LAYERS } from './spec.mjs';

const IN = 'assets/raw/backdrops';
const OUT = 'src/assets/backdrops';
const MAX_WIDTH = { mountains: 1536, 'volcano-calm': 1024, 'volcano-erupting': 1024, 'cliff-waterfalls': 1280, 'cliff-green': 1280, 'iceberg-a': 512, 'iceberg-b': 512, 'tidal-wave': 1280 };
mkdirSync(OUT, { recursive: true });

let total = 0;
for (const l of LAYERS) {
  const src = `${IN}/${l.id}.png`;
  if (!existsSync(src)) { console.log(`– ${l.id}: missing`); continue; }
  const trimmed = await sharp(src).trim({ threshold: 1 }).png().toBuffer();
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
