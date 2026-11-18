// Reference image of a flying puffin for Tripo3D (image → 3D): wings spread straight out to the
// sides so the game can flap them in the vertex shader. Uses the puffin model sheet for the look.
//   node scripts/tripo/puffin-ref.mjs   → assets/raw/puffin/ref-flying.png
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { openAiKey } from '../openai-key.mjs';

mkdirSync('assets/raw/puffin', { recursive: true });
const form = new FormData();
form.append('model', 'gpt-image-2');
form.append('prompt', 'A single Atlantic puffin in flight, exactly the bird of the reference sheet (same proportions, colours and stylised game-art look): seen from the front and a little above in a three-quarter view, both wings spread out wide and straight to the sides, fully extended and flat like a glider, perfectly symmetric, orange feet tucked back under the tail, beak pointing forward. The whole bird with both wing tips fully inside the image. Plain flat light grey background, no shadow, no text.');
form.append('image[]', new Blob([readFileSync('assets/raw/concepts/sheet-puffin.png')], { type: 'image/png' }), 'sheet.png');
form.append('size', '1536x1024');
form.append('quality', 'high');
const res = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${openAiKey()}` }, body: form });
const json = await res.json();
if (!res.ok) { console.error(`✗ ${res.status} ${json.error?.message}`); process.exit(1); }
writeFileSync('assets/raw/puffin/ref-flying.png', Buffer.from(json.data[0].b64_json, 'base64'));
console.log('✓ assets/raw/puffin/ref-flying.png');
