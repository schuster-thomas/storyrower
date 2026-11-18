// Generates style frames and model sheets with the OpenAI image API.
//   node scripts/concepts/generate.mjs                  – all missing items
//   node scripts/concepts/generate.mjs frame-idyll --force
// Raw PNGs go to assets/raw/concepts/ (not committed); compact JPEG copies to docs/art/.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { openAiKey } from '../openai-key.mjs';
import { ITEMS, STYLE } from './spec.mjs';

const MODEL = process.env.IMAGE_MODEL || 'gpt-image-2';
const RAW = 'assets/raw/concepts';
const OUT = 'docs/art';

const args = process.argv.slice(2);
const force = args.includes('--force');
const only = args.filter((a) => !a.startsWith('--'));
mkdirSync(RAW, { recursive: true });
mkdirSync(OUT, { recursive: true });
const key = openAiKey();

async function generate(item) {
  const form = new FormData();
  form.append('model', MODEL);
  form.append('prompt', `${STYLE}\n\n${item.prompt}\n\nThe attached images are style and content references only (palette, mood, level of stylisation); do not copy their composition.`);
  for (const ref of item.refs ?? []) form.append('image[]', new Blob([readFileSync(ref)], { type: 'image/png' }), 'reference.png');
  form.append('size', item.size);
  form.append('quality', 'high');
  form.append('output_format', 'png');
  form.append('n', '1');
  const res = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form });
  const json = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${json.error?.message ?? JSON.stringify(json).slice(0, 300)}`);
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error('no image in response');
  const png = Buffer.from(b64, 'base64');
  writeFileSync(`${RAW}/${item.id}.png`, png);
  await sharp(png).jpeg({ quality: 86, mozjpeg: true }).toFile(`${OUT}/${item.id}.jpg`);
  return json.usage;
}

const todo = ITEMS.filter((i) => (only.length ? only.includes(i.id) : true)).filter((i) => force || !existsSync(`${RAW}/${i.id}.png`));
console.log(`model ${MODEL}, ${todo.length} image(s) to generate`);
const queue = [...todo];
await Promise.all(Array.from({ length: 3 }, async () => {
  while (queue.length) {
    const it = queue.shift();
    const t0 = Date.now();
    try {
      const usage = await generate(it);
      console.log(`✓ ${it.id} (${((Date.now() - t0) / 1000).toFixed(0)} s${usage ? `, ${usage.total_tokens} tokens` : ''})`);
    } catch (e) {
      console.log(`✗ ${it.id}: ${e.message}`);
    }
  }
}));
