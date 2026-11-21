// Start-page tile for "Tokyo Super Row", in the style of the Iceland tile (src/assets/ui/iceland-card.webp).
//   node scripts/tokyo/card.mjs [--force]   → src/assets/ui/tokyo-card.webp (727 × 281, like the Iceland tile)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { openAiKey } from '../openai-key.mjs';

const RAW = 'assets/raw/levels/tokyo/card.png';
mkdirSync('assets/raw/levels/tokyo', { recursive: true });
if (!existsSync(RAW) || process.argv.includes('--force')) {
  const style = await sharp('src/assets/ui/iceland-card.webp').png().toBuffer();
  const form = new FormData();
  form.append('model', 'gpt-image-2');
  form.append('prompt', 'A wide landscape illustration for a game menu tile, in exactly the style, palette, light and composition of the first reference image (premium stylised console game art, clean readable shapes, saturated natural colours, soft painterly detail), but showing the scenery of the second reference image: a river through Tokyo in cherry-blossom season. Left: big pink cherry trees over an old stone wall, a Japanese garden with a stone lantern and a small pagoda. Middle: a red arched footbridge far away and a large snow-capped volcanic cone on the horizon. Right: modern high-rises along the river and a red-and-white lattice observation tower. Pink petals float on turquoise water. One small rower in a white racing single scull in the middle of the river, seen from behind, small. Bright spring morning, blue sky with soft clouds. No text, no logos, no UI, no frame.');
  form.append('image[]', new Blob([style], { type: 'image/png' }), 'style.png');
  form.append('image[]', new Blob([readFileSync('screenshots/tokyo_super_row_1.png')], { type: 'image/png' }), 'scene.png');
  form.append('size', '2048x768');
  form.append('quality', 'high');
  form.append('output_format', 'png');
  const res = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${openAiKey()}` }, body: form });
  const json = await res.json();
  if (!res.ok) { console.error(`✗ ${res.status} ${json.error?.message}`); process.exit(1); }
  writeFileSync(RAW, Buffer.from(json.data[0].b64_json, 'base64'));
  console.log(`✓ ${RAW}`);
}
await sharp(RAW).resize(727, 281, { fit: 'cover' }).webp({ quality: 82 }).toFile('src/assets/ui/tokyo-card.webp');
console.log('✓ src/assets/ui/tokyo-card.webp');
