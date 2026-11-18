// Paint-over for a painted river-bank section: the image model repaints the blockout render of
// scripts/blender/painted_shore.py in the game's art style, keeping the composition, so the
// painting can be projected back onto the geometry.
//   node scripts/painted/paint.mjs cliffs|glacier   → assets/raw/painted/<kind>/painted.png
//   STYLE_REF=<png> adds an earlier painting as a style reference (consistent look between sections)
import { readFileSync, writeFileSync } from 'node:fs';
import { openAiKey } from '../openai-key.mjs';

const kind = process.argv[2] ?? 'cliffs';
const DIR = `assets/raw/painted/${kind}`;
const img = (f) => new Blob([readFileSync(f)], { type: 'image/png' });

const MEANING = {
  cliffs: 'Meaning of the colours: on the left an open, low shore: rolling green slopes of grass and moss with scattered dark rocks and boulders rising gently from the river; dark grey striped walls = tall hexagonal basalt column cliffs with moss on the ledges; green = bright moss and grass with small rocks and tufts; the thin green strip right at the waterline = a low rocky ledge covered in grass and moss; the very dark vertical strips = a dark, wet rock gully with moss where a stream runs down in wet weather – paint it as dark wet rock, NOT as a waterfall, no white water; light grey top = snow fields on dark rock; the small grey rock in the water = a dark mossy boulder with a green top. IMPORTANT: no flowers anywhere and no waterfalls – they are added separately later.',
  glacier: 'This is the front of a classic Icelandic glacier ending in the water. Meaning of the colours: light blue walls = a jagged wall of glacier ice and serac towers in bright turquoise and blue, with vertical cracks, layered old ice and a few darker blue caves; dark blue strips = deep crevasses; white tops = snow-covered ice surfaces rising behind the front; grey strip = a dark moraine band of gravel on the ice. Small ice chunks floating at the foot of the wall.',
}[kind];

const prompt = [
  'The first image is a flat-coloured 3D blockout render of a river bank in Iceland, seen from a boat on the river.',
  'Repaint it as a finished, richly detailed background painting for a premium stylised console game (in the spirit of Mario Kart 8), in exactly the style, palette and lighting of the other reference images.',
  'The bank is a continuous stretch of a long river: it runs out of the picture at BOTH the left and the right edge. Fill the full width with land exactly as in the blockout – no sky, no water and no end of the land at the left or right side, it is not an island.',
  'CRITICAL: keep the composition pixel-accurate – every silhouette, edge, the skyline, the waterline and the position of every feature must stay exactly where it is. Same perspective, same framing, nothing added in front, nothing moved. Only replace the flat colours with painted detail.',
  MEANING,
  'Calm turquoise river water with soft reflections. Bright fresh morning light, soft shadows. Keep the sky plain and light. No people, no boats, no birds, no text.',
].join(' ');

const form = new FormData();
form.append('model', 'gpt-image-2');
form.append('prompt', prompt);
form.append('image[]', img(`${DIR}/blockout.png`), 'blockout.png');
form.append('image[]', img('assets/raw/concepts/frame-idyll.png'), 'style.png');
form.append('image[]', img('screenshots/Vulkanrudern im isländischen Abenteuerland.png'), 'mockup.png');
if (process.env.STYLE_REF) form.append('image[]', img(process.env.STYLE_REF), 'previous.png');
form.append('size', '3072x1024');
form.append('quality', 'high');
form.append('n', '1');
const t0 = Date.now();
const res = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${openAiKey()}` }, body: form });
const json = await res.json();
if (!res.ok) { console.error(`✗ ${res.status} ${json.error?.message}`); process.exit(1); }
writeFileSync(`${DIR}/painted.png`, Buffer.from(json.data[0].b64_json, 'base64'));
console.log(`✓ ${DIR}/painted.png (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
