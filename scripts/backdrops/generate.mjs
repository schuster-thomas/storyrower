// Generates the painted backdrop layers with the OpenAI image API.
//   node scripts/backdrops/generate.mjs            – generate all missing layers
//   node scripts/backdrops/generate.mjs volcano-calm --force
// Raw PNGs go to assets/raw/backdrops/ (not committed); run process.mjs afterwards.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { openAiKey } from '../openai-key.mjs';
import { LAYERS, STYLE, STYLE_V2 } from './spec.mjs';

// gpt-image-2 has no transparent backgrounds yet; 1.5 does
const MODEL = process.env.IMAGE_MODEL || 'gpt-image-1.5';
const OUT = 'assets/raw/backdrops';
const REFERENCE = 'screenshots/Vulkanrudern im isländischen Abenteuerland.png';

const args = process.argv.slice(2);
const force = args.includes('--force');
const only = args.filter((a) => !a.startsWith('--'));
mkdirSync(OUT, { recursive: true });
const key = openAiKey();
const reference = new Blob([readFileSync(REFERENCE)], { type: 'image/png' });

async function generate(layer) {
  const form = new FormData();
  // chroma layers: gpt-image-2 (larger sizes) on a flat magenta background, keyed out by process.mjs
  form.append('model', layer.chroma ? 'gpt-image-2' : MODEL);
  form.append('prompt', `${layer.chroma ? STYLE_V2 : STYLE}\n\nSubject: ${layer.prompt}`);
  form.append('image[]', layer.ref ? new Blob([readFileSync(layer.ref)], { type: 'image/png' }) : reference, 'reference.png');
  form.append('size', layer.size);
  if (!layer.chroma) form.append('background', 'transparent');
  form.append('quality', 'high');
  form.append('output_format', 'png');
  form.append('n', '1');
  const res = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form });
  const json = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${json.error?.message ?? JSON.stringify(json).slice(0, 300)}`);
  const b64 = json.data?.[0]?.b64_json;
  if (!b64) throw new Error('no image in response');
  writeFileSync(`${OUT}/${layer.id}.png`, Buffer.from(b64, 'base64'));
  return json.usage;
}

const todo = LAYERS.filter((l) => (only.length ? only.includes(l.id) : true)).filter((l) => force || !existsSync(`${OUT}/${l.id}.png`));
console.log(`model ${MODEL}, ${todo.length} layer(s) to generate`);
// a few in parallel to save time
const queue = [...todo];
await Promise.all(Array.from({ length: 3 }, async () => {
  while (queue.length) {
    const l = queue.shift();
    const t0 = Date.now();
    try {
      const usage = await generate(l);
      console.log(`✓ ${l.id} (${((Date.now() - t0) / 1000).toFixed(0)} s${usage ? `, ${usage.total_tokens} tokens` : ''})`);
    } catch (e) {
      console.log(`✗ ${l.id}: ${e.message}`);
    }
  }
}));
