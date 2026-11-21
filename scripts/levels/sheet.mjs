// Contact sheet of images for a quick look: node scripts/levels/sheet.mjs out.png <tile width> <file …>
import sharp from 'sharp';
const [out, w, ...files] = process.argv.slice(2);
const W = Number(w), cols = 3;
const tiles = await Promise.all(files.map(async (f) => sharp(f).flatten({ background: '#7a8a99' }).resize(W, Math.round(W * 0.66), { fit: 'contain', background: '#7a8a99' }).png().toBuffer()));
const H = Math.round(W * 0.66), rows = Math.ceil(files.length / cols);
await sharp({ create: { width: W * cols, height: H * rows, channels: 3, background: '#333' } })
  .composite(tiles.map((input, i) => ({ input, left: (i % cols) * W, top: Math.floor(i / cols) * H }))).png().toFile(out);
