// Painted cut-out sprites for things that must stand upright (they would lie flat if projected
// onto the ground): lupine clumps. Generated with a transparent background, split into tiles and
// packed into an atlas.
//   node scripts/painted/sprites.mjs [--force]   → src/assets/painted/lupines.webp (4 tiles side by side)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { openAiKey } from '../openai-key.mjs';

const RAW = 'assets/raw/painted/sprites';
mkdirSync(RAW, { recursive: true });
const raw = `${RAW}/lupines.png`;
if (!existsSync(raw) || process.argv.includes('--force')) {
  const form = new FormData();
  form.append('model', 'gpt-image-1.5');
  form.append('prompt', 'Four separate clumps of Nootka lupines in a row, evenly spaced with clear gaps, not touching: each clump is a bushy cluster of tall flower spikes in purple, violet and blue (a few pinkish) on dense green palmate leaves, about as tall as wide, standing upright on its base. Painted in exactly the style, palette and light of the reference image (premium stylised game art, soft painterly detail, bright morning light). Fully transparent background, no ground, no shadow, no text.');
  form.append('image[]', new Blob([readFileSync('assets/raw/painted/cliffs/painted.png')], { type: 'image/png' }), 'style.png');
  form.append('size', '1536x1024');
  form.append('background', 'transparent');
  form.append('quality', 'high');
  const res = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${openAiKey()}` }, body: form });
  const json = await res.json();
  if (!res.ok) { console.error(`✗ ${res.status} ${json.error?.message}`); process.exit(1); }
  writeFileSync(raw, Buffer.from(json.data[0].b64_json, 'base64'));
  console.log(`✓ ${raw}`);
}
// find the clumps at the transparent gaps between them (column alpha coverage), take the four
// widest, trim each and pack them into a 4 × 1 atlas of 512 × 512 tiles (bottom-aligned)
const { data, info } = await sharp(raw).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const cover = Array.from({ length: info.width }, (_, x) => {
  let n = 0;
  for (let y = 0; y < info.height; y += 2) if (data[(y * info.width + x) * 4 + 3] > 40) n++;
  return n;
});
const runs = [];
let start = -1;
for (let x = 0; x <= info.width; x++) {
  const on = x < info.width && cover[x] > 2;
  if (on && start < 0) start = x;
  if (!on && start >= 0) { runs.push([start, x]); start = -1; }
}
const merged = [];
for (const r of runs) {
  const last = merged[merged.length - 1];
  if (last && r[0] - last[1] < 24) last[1] = r[1]; else merged.push([...r]);
}
const clumps = merged.sort((p, q) => (q[1] - q[0]) - (p[1] - p[0])).slice(0, 4).sort((p, q) => p[0] - q[0]);
console.log('clumps', clumps.map(([l, r]) => r - l).join(', '), 'px wide');
const tiles = [];
for (const [i, [l, r]] of clumps.entries()) {
  const part = await sharp(raw).extract({ left: Math.max(0, l - 4), top: 0, width: Math.min(info.width, r + 4) - Math.max(0, l - 4), height: info.height }).png().toBuffer();
  const trimmed = await sharp(part).trim({ threshold: 1 }).png().toBuffer();
  const tile = await sharp(trimmed).resize(512, 512, { fit: 'contain', position: 'bottom', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  tiles.push({ input: tile, left: i * 512, top: 0 });
}
mkdirSync('src/assets/painted', { recursive: true });
await sharp({ create: { width: 2048, height: 512, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite(tiles).webp({ quality: 85, alphaQuality: 90 }).toFile('src/assets/painted/lupines.webp');
console.log('✓ src/assets/painted/lupines.webp');
