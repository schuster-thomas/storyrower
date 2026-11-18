// Puts the boat preview renders into one contact sheet: node scripts/blender/contact.mjs <dir>
import sharp from 'sharp';
import { readdirSync } from 'node:fs';
const dir = process.argv[2] ?? 'assets/raw/boat';
const files = readdirSync(dir).filter((f) => f.startsWith('preview-') && f.endsWith('.png')).sort();
const W = 640, H = 360, cols = 4;
const tiles = await Promise.all(files.map(async (f, i) => ({ input: await sharp(`${dir}/${f}`).resize(W, H).png().toBuffer(), left: (i % cols) * W, top: Math.floor(i / cols) * H })));
await sharp({ create: { width: W * cols, height: H * Math.ceil(files.length / cols), channels: 3, background: '#333' } }).composite(tiles).png().toFile(`${dir}/contact.png`);
console.log(files.join(' '));
