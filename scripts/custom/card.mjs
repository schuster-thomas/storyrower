// Start-page tile for "Customize trainings", in the style of the Devices tile (src/assets/ui/rower-card.webp).
//   node scripts/custom/card.mjs [--force]   → src/assets/ui/custom-card.webp (727 × 281, like the other tiles)
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { openAiKey } from '../openai-key.mjs';

const RAW = 'assets/raw/ui/custom-card.png';
mkdirSync('assets/raw/ui', { recursive: true });
if (!existsSync(RAW) || process.argv.includes('--force')) {
  const style = await sharp('src/assets/ui/rower-card.webp').png().toBuffer();
  const form = new FormData();
  form.append('model', 'gpt-image-2');
  form.append('prompt', 'A wide illustration for a game menu tile, in exactly the style, palette, light and plain pale-blue background of the reference image (clean stylised 3D product render, soft shadows, light wood and dark navy). Show a tablet standing on a small light-wood stand, slightly turned, its screen showing a big interval-training bar chart: about eight vertical bars of different heights and widths side by side, coloured green for the low bars, amber for the middle ones and red for the tallest, one bar highlighted with a white outline. Next to the tablet a navy stopwatch and three round slider knobs on short tracks (like an equaliser) in teal, as if the bars were being adjusted. Lots of calm empty pale-blue space, the objects in the right two thirds. No text, no numbers, no logos, no UI chrome, no frame.');
  form.append('image[]', new Blob([style], { type: 'image/png' }), 'style.png');
  form.append('size', '2048x768');
  form.append('quality', 'high');
  form.append('output_format', 'png');
  const res = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${openAiKey()}` }, body: form });
  const json = await res.json();
  if (!res.ok) { console.error(`✗ ${res.status} ${json.error?.message}`); process.exit(1); }
  writeFileSync(RAW, Buffer.from(json.data[0].b64_json, 'base64'));
  console.log(`✓ ${RAW}`);
}
await sharp(RAW).resize(727, 281, { fit: 'cover' }).webp({ quality: 82 }).toFile('src/assets/ui/custom-card.webp');
console.log('✓ src/assets/ui/custom-card.webp');
