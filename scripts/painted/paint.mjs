// Paint-over for a painted river-bank section: the image model repaints a blockout render of
// scripts/blender/painted_shore.py in the game's art style, keeping the composition, so the
// painting can be projected back onto the geometry.
//   node scripts/painted/paint.mjs cliffs|glacier [side|up|down]
//     side (default): the view across the river   → assets/raw/painted/<kind>/painted.png
//     up / down: views along the river (for the faces pointing up- or downstream; they get the
//     side painting as a reference for materials and colours) → painted-up.png / painted-down.png
//   node scripts/painted/paint.mjs garden|city[-b] [side|up|down]   the banks of "Tokyo Super Row"
//     (style references: the level's mock-ups in screenshots/)
//   node scripts/painted/paint.mjs volcano   the volcano at the end of the valley
//     (blockout from scripts/blender/volcano.py, flat magenta background that is keyed out later)
//   STYLE_REF=<png> adds another painting as a style reference
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { openAiKey } from '../openai-key.mjs';

const kind = process.argv[2] ?? 'cliffs';          // cliffs | glacier | garden | city (+ -b)
const [base, variant] = kind.split('-');
const view = process.argv[3] ?? 'side';
const DIR = `assets/raw/painted/${kind}`;
const img = (f) => new Blob([readFileSync(f)], { type: 'image/png' });
const TOKYO = base === 'garden' || base === 'city';
const PLACE = TOKYO ? 'Tokyo in cherry-blossom season' : 'Iceland';

const MEANING = {
  cliffs: 'Meaning of the colours: an open, low shore: rolling green slopes of grass and moss with scattered dark rocks and boulders rising gently from the river; dark grey striped walls = tall hexagonal basalt column cliffs with moss on the ledges; green = bright moss and grass with small rocks and tufts; the thin green strip right at the waterline = a low rocky ledge covered in grass and moss; the very dark vertical strips = a dark, wet rock gully with moss where a stream runs down in wet weather – paint it as dark wet rock, NOT as a waterfall, no white water; light grey top = snow fields on dark rock; the small grey rock in the water = a dark mossy boulder with a green top. IMPORTANT: no flowers anywhere and no waterfalls – they are added separately later.',
  glacier: 'This is the front of a classic Icelandic glacier ending in the water. Meaning of the colours: light blue walls = a jagged wall of glacier ice and serac towers in bright turquoise and blue, with vertical cracks, layered old ice and a few darker blue caves; dark blue strips = deep crevasses; white tops = snow-covered ice surfaces rising behind the front; grey strip = a dark moraine band of gravel on the ice. Small ice chunks floating at the foot of the wall.',
  garden: 'This is a traditional Japanese garden on the bank of a river in Tokyo, in full cherry-blossom season. Meaning of the colours: the beige-grey band rising straight out of the water = an old retaining wall of irregular, rounded granite blocks with dark joints (like a castle moat wall), a little moss, darker and wet at the waterline; light green = lush, neatly kept lawn and moss garden with a few garden rocks; the thin light beige line = a raked gravel path; the bright hot-pink mounds = round azalea bushes densely covered in pink and magenta blossoms; the dark green domes = carefully pruned Japanese black pines with flat, cloud-shaped foliage pads on twisting trunks; the big light-pink masses = a grove of large old cherry trees in full bloom – layered, cloud-like canopies of soft pink blossoms with dark gnarled trunks and branches visible underneath, some branches reaching towards the water, petals on the lawn; the dark slate shape = a small wooden tea house with a dark curved tiled roof, warm wooden walls and paper sliding screens; the green hills behind = wooded hills dotted with more pink cherry trees, fading into soft haze.',
  city: 'This is the bank of a river in central Tokyo, a modern city waterfront. Meaning of the colours: the beige-grey band at the water = a stone embankment wall; the light grey strip on top = a paved riverside promenade with a white metal railing along the edge and a few small cherry trees in pink bloom; the green strip = a narrow lawn verge with low shrubs; dark grey = a street; the tall boxes are modern high-rise buildings, each its own design with many windows in a clean regular grid: light blue = a blue glass curtain-wall tower with white mullions reflecting the sky and clouds; white = a white office tower with long dark horizontal window bands; sand = a beige apartment block with rows of balconies; teal = a green-teal glass tower with gold floor lines; dark grey tops = flat roofs with small rooftop units. Rich facade detail, stylised but believable modern Tokyo architecture. No signs, no logos, no lettering anywhere.',
}[base] + (variant === 'b' ? {
  cliffs: ' In this stretch the tall cliffs form a horseshoe-shaped amphitheatre of dark hexagonal basalt columns (like Svartifoss) around a broad waterfall gully, and a tall slender basalt sea stack with a green grassy cap stands in the water near the open shore.',
  glacier: ' In this stretch the glacier front drops to a low, broken ice ramp in one place, with many small ice blocks at its foot.',
}[base] : '');

const VIEW = {
  side: `The first image is a flat-coloured 3D blockout render of a river bank in ${PLACE}, seen from a boat across the river. The bank is a continuous stretch of a long river: it runs out of the picture at BOTH the left and the right edge. Fill the full width with land exactly as in the blockout – no sky, no water and no end of the land at the left or right side, it is not an island.`,
  along: `The first image is a flat-coloured 3D blockout render of a river bank in ${PLACE}, seen from a boat on the river looking ALONG the river: the bank recedes into the distance in strong perspective. The last reference image shows the SAME bank painted from the side – match its materials, colours, rock and moss details and light exactly, but NOT its composition: the composition must be the one of the blockout.`,
}[view === 'side' ? 'side' : 'along'];

const VOLCANO = [
  'The first image is a flat-coloured 3D blockout render of a large, broad Icelandic stratovolcano with an ice cap (like Eyjafjallajökull), seen from a boat on a river far away at the end of a valley.',
  'Repaint it as a finished, richly detailed background painting for a premium stylised console game (in the spirit of Mario Kart 8), in exactly the style, palette and lighting of the reference images.',
  'CRITICAL: keep the composition pixel-accurate – the silhouette, the crater rim, every groove and the position of every feature must stay exactly where it is. Same perspective, same framing, nothing added, nothing moved. Only replace the flat colours with painted detail.',
  'Meaning of the colours: dark red at the top = the inside of the crater rim; dark grey-brown right at the crater = ash and dark volcanic rock; white = a thick, bright snow and glacier-ice cap covering the whole upper half, with dark rock ridges poking through and snow fingers reaching down the gullies – paint it as a real Icelandic ice cap with soft blue shadows; brown and ochre = a thin band of rust-coloured volcanic rock and scree; green = lush, bright Icelandic moss and grass covering the lower slopes; the very dark, almost black bands running down from the crater = deep grooves of old, black, solidified lava with rough crusty texture – keep them dark and clearly readable as channels, they will glow with fresh lava later.',
  'The volcano is calm and dormant: NO fire, NO glowing lava, NO smoke plume, NO steam, no clouds around it. Bright fresh morning light from the upper left, soft shadows on the right flanks.',
  'The background is a flat pure magenta (#FF00FF) – keep it exactly that flat magenta everywhere around the volcano, with a clean, sharp silhouette edge. No sky, no other mountains, no water, no text.',
].join(' ');

const prompt = base === 'volcano' ? VOLCANO : [
  VIEW,
  'Repaint it as a finished, richly detailed background painting for a premium stylised console game (in the spirit of Mario Kart 8), in exactly the style, palette and lighting of the reference images.',
  'CRITICAL: keep the composition pixel-accurate – every silhouette, edge, the skyline, the waterline and the position of every feature must stay exactly where it is. Same perspective, same framing, nothing added in front, nothing moved. Only replace the flat colours with painted detail.',
  MEANING,
  TOKYO ? 'Calm turquoise river water with soft reflections and a few floating pink petals. Bright warm spring morning light, soft shadows. Keep the sky plain and light blue. No people, no boats, no birds, no text, no logos.'
    : 'Calm turquoise river water with soft reflections. Bright fresh morning light, soft shadows. Keep the sky plain and light. No people, no boats, no birds, no text.',
].join(' ');

const form = new FormData();
form.append('model', 'gpt-image-2');
form.append('prompt', prompt);
form.append('image[]', img(view === 'side' ? `${DIR}/blockout.png` : `${DIR}/blockout-${view}.png`), 'blockout.png');
form.append('image[]', img(TOKYO ? 'screenshots/tokyo_super_row_1.png' : 'assets/raw/concepts/frame-idyll.png'), 'style.png');
// the first painted volcano (an older backdrop layer) as a look reference, if it is still around
if (base === 'volcano' && existsSync('assets/raw/backdrops/volcano-calm.png')) form.append('image[]', img('assets/raw/backdrops/volcano-calm.png'), 'volcano-style.png');
form.append('image[]', img(TOKYO ? 'screenshots/tokyo/01-cherry-blossom-large-fuji.png' : 'screenshots/Vulkanrudern im isländischen Abenteuerland.png'), 'mockup.png');
const ref = process.env.STYLE_REF ?? (view !== 'side' && existsSync(`${DIR}/painted.png`) ? `${DIR}/painted.png` : null);
if (ref) form.append('image[]', img(ref), 'same-bank.png');
form.append('size', view === 'side' ? '3072x1024' : '1536x1024');
form.append('quality', 'high');
form.append('n', '1');
const t0 = Date.now();
const res = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${openAiKey()}` }, body: form });
const json = await res.json();
if (!res.ok) { console.error(`✗ ${res.status} ${json.error?.message}`); process.exit(1); }
const out = view === 'side' ? `${DIR}/painted.png` : `${DIR}/painted-${view}.png`;
writeFileSync(out, Buffer.from(json.data[0].b64_json, 'base64'));
console.log(`✓ ${out} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
