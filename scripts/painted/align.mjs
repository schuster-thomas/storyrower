// The image model keeps the layout of a blockout only roughly. For the Tokyo banks the geometry is
// therefore fitted to the painting instead of the other way round:
//  1. the painting is moved up or down so its waterline (the foot of the wall) sits exactly where the
//     blockout has it (no stretching – the painting stays as painted), and
//  2. its skyline (the top edge of trees, roofs and towers, row per column) is written to
//     skyline.json; scripts/blender/painted_shore.py --paint then raises the terrain to exactly that
//     silhouette, so every painted tree and tower lands on geometry of the right height.
//   node scripts/painted/align.mjs <dir>
//     <dir>/painted.png is kept as painted-raw.png, the moved one replaces it
import { copyFileSync, existsSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';

const [dir] = process.argv.slice(2);
const paintedPath = `${dir}/painted.png`, rawPath = `${dir}/painted-raw.png`, blockPath = `${dir}/blockout.png`;
if (!existsSync(rawPath)) copyFileSync(paintedPath, rawPath);

const meta = await sharp(rawPath).metadata();
const W = meta.width, H = meta.height;
const load = async (f) => sharp(f).resize(W, H, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const P = await load(rawPath), B = await load(blockPath);
const px = (img, x, y) => { const i = (y * W + x) * 3; return [img.data[i], img.data[i + 1], img.data[i + 2]]; };
const near = (c, ref, tol) => Math.abs(c[0] - ref[0]) + Math.abs(c[1] - ref[1]) + Math.abs(c[2] - ref[2]) < tol;
const isSky = ([r, g, b]) => b > 165 && b - r > 30 && g - r > 8 && g < b + 10;
const isWater = ([r, g, b]) => b - r > 25 && g - r > 15;
const median = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];

// waterlines: blockout = where its flat water colour begins; painting = above the water, the first
// run of 8 rows that are not water (the wall)
const waterB = px(B, 2, H - 3);
const wb = [], wp = [];
for (let x = 0; x < W; x += 8) {
  let y = H - 1; while (y > 0 && near(px(B, x, y), waterB, 30)) y--;
  wb.push(y + 1);
  let run = 0, found = H;
  for (let yy = H - 1; yy > H * 0.3; yy--) { if (isWater(px(P, x, yy))) run = 0; else if (++run >= 8) { found = yy + 8; break; } }
  wp.push(found);
}
const shift = median(wb) - median(wp);   // move the painting down by this many pixels

const out = Buffer.alloc(W * H * 3);
for (let y = 0; y < H; y++) {
  // rows moved in from outside: repeat the sky at the top, the water at the bottom
  const sy = Math.min(H - 1, Math.max(0, y - shift));
  P.data.copy(out, y * W * 3, sy * W * 3, (sy + 1) * W * 3);
}
await sharp(out, { raw: { width: W, height: H, channels: 3 } }).png().toFile(paintedPath);

// skyline of the moved painting: per column, the first row from the top below 5 rows of non-sky
const M = { data: out };
const sky = [];
for (let x = 0; x < W; x++) {
  let run = 0, row = H - 1;
  for (let y = 0; y < H; y++) { if (isSky(px(M, x, y))) run = 0; else if (++run >= 5) { row = y - 4; break; } }
  sky.push(row);
}
// a light smoothing (single stray columns), keeping the shapes of crowns and roofs
const smooth = sky.map((_, x) => median(sky.slice(Math.max(0, x - 3), x + 4)));
writeFileSync(`${dir}/skyline.json`, JSON.stringify({ width: W, height: H, rows: smooth }));
console.log(`✓ ${paintedPath}: moved ${shift} px, skyline ${median(smooth)} px (median row)`);
