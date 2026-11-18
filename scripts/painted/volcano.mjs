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

/**
 * The image model sometimes stretches the volcano a little vertically. The lava mask comes from the
 * blockout, so fit the painting back onto it: per column, the top of the silhouette in the painting
 * vs. the blockout gives y_blockout = a · y_painting + b (least squares), then resample the rows.
 */
async function alignToBlockout(keyed) {
  const p = await sharp(keyed).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const b = await sharp(`${DIR}/blockout.png`).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H } = p.info;
  const topP = (x) => { for (let y = 0; y < H; y++) if (p.data[(y * W + x) * 4 + 3] > 128) return y; return -1; };
  const topB = (x) => {
    for (let y = 0; y < H; y++) {
      const i = (y * W + x) * 4;
      if (!(b.data[i] > 200 && b.data[i + 1] < 60 && b.data[i + 2] > 200)) return y;
    }
    return -1;
  };
  const pairs = [];
  for (let x = Math.round(W * 0.08); x < W * 0.92; x += 4) {
    const yp = topP(x), yb = topB(x);
    if (yp > 0 && yb > 0 && yb < H * 0.86) pairs.push([yp, yb]);
  }
  const n = pairs.length;
  const sx = pairs.reduce((s, q) => s + q[0], 0), sy = pairs.reduce((s, q) => s + q[1], 0);
  const sxx = pairs.reduce((s, q) => s + q[0] * q[0], 0), sxy = pairs.reduce((s, q) => s + q[0] * q[1], 0);
  const a = (n * sxy - sx * sy) / (n * sxx - sx * sx), off = (sy - a * sx) / n;
  const err = Math.sqrt(pairs.reduce((s, [yp, yb]) => s + (a * yp + off - yb) ** 2, 0) / n);
  console.log(`align: y_blockout = ${a.toFixed(4)} · y_painting + ${off.toFixed(1)}  (rms ${err.toFixed(1)} px over ${n} columns)`);
  const out = Buffer.alloc(p.data.length);
  for (let y = 0; y < H; y++) {
    const src = (y - off) / a;                     // row in the painting that lands on row y
    const y0 = Math.floor(src), f = src - y0;
    if (y0 < 0 || y0 + 1 >= H) continue;           // outside: transparent
    for (let x = 0; x < W; x++) {
      for (let c = 0; c < 4; c++) {
        out[(y * W + x) * 4 + c] = Math.round(p.data[(y0 * W + x) * 4 + c] * (1 - f) + p.data[((y0 + 1) * W + x) * 4 + c] * f);
      }
    }
  }
  return sharp(out, { raw: p.info }).png().toBuffer();
}

// painting and mask keep the full frame, so they stay aligned with each other and with volcano.json
await sharp(await alignToBlockout(await keyMagenta(`${DIR}/painted.png`))).resize({ width: 2048 })
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
