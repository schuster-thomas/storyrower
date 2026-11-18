// Builds the volcano layers for the game from the painted volcano (scripts/blender/volcano.py →
// scripts/painted/paint.mjs volcano):
//   src/assets/painted/volcano.webp       the painting, magenta background keyed out
//   src/assets/painted/volcano-mask.webp  lava channels / flow distance / crater (lossless)
//   src/assets/painted/volcano.json       where the crater sits in the image, scale
//   src/assets/painted/ash-puffs.webp     4 painted ash-cloud puffs for the plume (generated once)
//   node scripts/painted/volcano.mjs [--force]   (--force regenerates the puffs)
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import sharp from 'sharp';
import { generateSprites, packAtlas } from './atlas.mjs';

const DIR = 'assets/raw/painted/volcano';
const OUT = 'src/assets/painted';
mkdirSync(OUT, { recursive: true });

/** Turns the flat magenta background into alpha and removes magenta fringes. */
async function keyMagenta(src) {
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const spill = Math.max(0, Math.min(r, b) - g);
    const key = Math.min(1, Math.max(0, (spill - 50) / 130));
    data[i + 3] = Math.round(255 * (1 - key));
    if (spill > 8) { data[i] = r - spill * 0.85; data[i + 2] = b - spill * 0.85; }
  }
  return sharp(data, { raw: info }).png().toBuffer();
}

// painting and mask keep the full frame, so they stay aligned with each other and with volcano.json
await sharp(await keyMagenta(`${DIR}/painted.png`)).resize({ width: 2048 })
  .webp({ quality: 84, alphaQuality: 90, effort: 6 }).toFile(`${OUT}/volcano.webp`);
await sharp(`${DIR}/mask.png`).resize({ width: 1024 }).removeAlpha()
  .webp({ lossless: true }).toFile(`${OUT}/volcano-mask.webp`);
copyFileSync(`${DIR}/volcano.json`, `${OUT}/volcano.json`);

const puffs = `${DIR}/ash-puffs.png`;
if (!existsSync(puffs) || process.argv.includes('--force')) {
  await generateSprites(puffs, 'Four separate, roughly round, billowing puffs of thick volcanic ash cloud in a row, evenly spaced with clear transparent gaps, not touching. Stylised painterly game art (premium console game in the spirit of Mario Kart 8): soft, chunky cauliflower-like volumes with clear light and shadow, neutral light grey with white highlights on the upper left and soft mid-grey shading underneath – no colour tint, no fire, no glow (they are tinted in the game). Fully transparent background, no ground, no text.',
    'assets/raw/concepts/frame-eruption.png');
}
await packAtlas(puffs, `${OUT}/ash-puffs.webp`, 'centre', 110);

for (const f of ['volcano.webp', 'volcano-mask.webp', 'ash-puffs.webp']) console.log(`${f}: ${(statSync(`${OUT}/${f}`).size / 1024).toFixed(0)} KB`);
