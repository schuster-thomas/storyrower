// Paint-over for a painted shore section: the image model repaints the blockout render of
// scripts/blender/painted_shore.py in the game's art style, keeping the composition, so the
// painting can be projected back onto the geometry.
//   node scripts/painted/paint.mjs [variant]   → assets/raw/painted/painted[-variant].png
import { readFileSync, writeFileSync } from 'node:fs';
import { openAiKey } from '../openai-key.mjs';

const DIR = 'assets/raw/painted';
const variant = process.argv[2] ? `-${process.argv[2]}` : '';
const img = (f) => new Blob([readFileSync(f)], { type: 'image/png' });

const prompt = [
  'The first image is a flat-coloured 3D blockout render of an Icelandic fjord shore, seen from a boat out on the water.',
  'Repaint it as a finished, richly detailed background painting for a premium stylised console game (in the spirit of Mario Kart 8), in exactly the style, palette and lighting of the other reference images.',
  'CRITICAL: keep the composition pixel-accurate – every silhouette, cliff edge, terrace edge, the skyline of the slopes, the waterline, the position and width of both waterfall strips and the small rock in the water must stay exactly where they are. Same perspective, same framing, nothing added in front, nothing moved. Only replace the flat colours with painted detail.',
  'Meaning of the colours: dark grey striped walls = tall hexagonal basalt column cliffs with moss on the ledges; green = bright moss and grass with small rocks and tufts; purple = a dense field of purple and blue Nootka lupines (tall flower spikes, clearly lupines); white vertical strips = two tiers of a white waterfall with spray and a mist cloud at the foot; light grey top = snow fields on dark rock; the small grey rock in the water = a dark mossy boulder with a green top; blue = calm turquoise fjord water with soft reflections.',
  'Bright fresh morning light from the right, soft shadows, gentle atmospheric haze on the far slopes. Keep the sky plain and light. No people, no boats, no birds, no text.',
].join(' ');

const form = new FormData();
form.append('model', 'gpt-image-2');
form.append('prompt', prompt);
form.append('image[]', img(`${DIR}/blockout.png`), 'blockout.png');
form.append('image[]', img('assets/raw/concepts/frame-idyll.png'), 'style.png');
if (process.env.STYLE_REF) form.append('image[]', img(process.env.STYLE_REF), 'previous.png');
form.append('image[]', img('screenshots/Vulkanrudern im isländischen Abenteuerland.png'), 'mockup.png');
form.append('size', '3072x1024');
form.append('quality', 'high');
form.append('n', '1');
const t0 = Date.now();
const res = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${openAiKey()}` }, body: form });
const json = await res.json();
if (!res.ok) { console.error(`✗ ${res.status} ${json.error?.message}`); process.exit(1); }
writeFileSync(`${DIR}/painted${variant}.png`, Buffer.from(json.data[0].b64_json, 'base64'));
console.log(`✓ ${DIR}/painted${variant}.png (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
