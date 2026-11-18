// Puts the technique references next to the current boat renders:
//   node scripts/blender/compare.mjs  → assets/raw/boat/compare.jpg
import sharp from 'sharp';
const W = 400;
const tile = (file, r, h, flop = false) => sharp(file).extract(r).resize(W, h).flop(flop).png().toBuffer();
const rows = [];
rows.push({ input: await sharp('docs/art/stroke-front.jpg').extract({ left: 0, top: 250, width: 1536, height: 420 }).resize(1600, 437).png().toBuffer(), left: 0, top: 0 });
for (const [i, f] of ['00', '05', '21', '50'].entries()) rows.push({ input: await tile(`assets/raw/boat-close/preview-handfront-${f}.png`, { left: 200, top: 60, width: 880, height: 560 }, 255), left: i * W, top: 437 });
rows.push({ input: await sharp('docs/art/stroke-side.jpg').extract({ left: 0, top: 340, width: 1536, height: 360 }).resize(1600, 375).png().toBuffer(), left: 0, top: 692 });
for (const [i, f] of ['00', '10', '21', '40'].entries()) rows.push({ input: await tile(`assets/raw/boat/preview-side-${f}.png`, { left: 240, top: 160, width: 800, height: 480 }, 240, true), left: i * W, top: 1067 });
await sharp({ create: { width: 1600, height: 1307, channels: 3, background: '#ddd' } }).composite(rows).jpeg({ quality: 85 }).toFile('assets/raw/boat/compare.jpg');
console.log('assets/raw/boat/compare.jpg');
