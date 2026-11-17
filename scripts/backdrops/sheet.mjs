// Contact sheet of all raw layers over a sky colour, for a quick visual review.
//   node scripts/backdrops/sheet.mjs <out.png> [bg]
import sharp from 'sharp';
import { existsSync } from 'node:fs';
import { LAYERS } from './spec.mjs';

const [out = 'assets/raw/sheet.png', bg = '#bfe2f2'] = process.argv.slice(2);
const W = 420, H = 280, cols = 4;
const tiles = [];
for (const [i, l] of LAYERS.entries()) {
  const src = `assets/raw/backdrops/${l.id}.png`;
  if (!existsSync(src)) continue;
  const fitted = await sharp(src).resize({ width: W, height: H, fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const label = Buffer.from(`<svg width="${W}" height="24"><rect width="${W}" height="24" fill="rgba(0,0,0,.55)"/><text x="8" y="17" font-size="15" font-family="Arial" fill="#fff">${l.id}</text></svg>`);
  tiles.push({ input: fitted, left: (i % cols) * W, top: Math.floor(i / cols) * H });
  tiles.push({ input: label, left: (i % cols) * W, top: Math.floor(i / cols) * H });
}
const rows = Math.ceil(LAYERS.length / cols);
await sharp({ create: { width: W * cols, height: H * rows, channels: 4, background: bg } }).composite(tiles).png().toFile(out);
console.log('wrote', out);
