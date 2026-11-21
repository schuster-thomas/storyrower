// Start-page tile for "Mauritius Shark Madness", in the style of the Iceland tile (src/assets/ui/iceland-card.webp).
//   node scripts/mauritius/card.mjs [--force]   → src/assets/ui/mauritius-card.webp (727 × 281, like the Iceland tile)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { openAiKey } from '../openai-key.mjs';

const RAW = 'assets/raw/levels/mauritius/card.png';
mkdirSync('assets/raw/levels/mauritius', { recursive: true });
if (!existsSync(RAW) || process.argv.includes('--force')) {
  const style = await sharp('src/assets/ui/iceland-card.webp').png().toBuffer();
  const form = new FormData();
  form.append('model', 'gpt-image-2');
  form.append('prompt', 'A wide landscape illustration for a game menu tile, in exactly the style, palette, light and composition of the first reference image (premium stylised console game art, clean readable shapes, saturated natural colours, soft painterly detail), but showing the scenery of the second reference image: a tropical lagoon on the south-west coast of Mauritius. Left: the open turquoise and deep blue sea with surf on a reef far out, and a dark grey shark fin cutting through the water in the middle distance. Right: a huge basalt monolith mountain with sheer cliffs and green slopes (like Le Morne Brabant), a white sand beach with leaning coconut palms and two sun loungers under a straw parasol. Crystal-clear turquoise water with light patterns on the sandy bottom. One small rower in a white racing single scull in the middle of the lagoon, seen from behind, small. Bright sunny morning, blue sky with soft white clouds. No text, no logos, no UI, no frame.');
  form.append('image[]', new Blob([style], { type: 'image/png' }), 'style.png');
  form.append('image[]', new Blob([readFileSync('screenshots/mauritius/01-lagoon.png')], { type: 'image/png' }), 'scene.png');
  form.append('size', '2048x768');
  form.append('quality', 'high');
  form.append('output_format', 'png');
  const res = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${openAiKey()}` }, body: form });
  const json = await res.json();
  if (!res.ok) { console.error(`✗ ${res.status} ${json.error?.message}`); process.exit(1); }
  writeFileSync(RAW, Buffer.from(json.data[0].b64_json, 'base64'));
  console.log(`✓ ${RAW}`);
}
await sharp(RAW).resize(727, 281, { fit: 'cover' }).webp({ quality: 82 }).toFile('src/assets/ui/mauritius-card.webp');
console.log('✓ src/assets/ui/mauritius-card.webp');
