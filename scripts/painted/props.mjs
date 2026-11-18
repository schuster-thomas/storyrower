// Painted props in the water (icebergs, rocks): paints the five blockout views of
// scripts/blender/props.py and builds the projected models for the game.
//   node scripts/painted/props.mjs ice|rocks [--force]   paint the views that are missing (or all)
//   (then: blender … props.py -- assets/raw/painted/<kind> --kind <kind> --paint)
//   node scripts/painted/props.mjs ice|rocks fill       background filled with the objects' edge colours
//   node scripts/painted/props.mjs ice|rocks build      → src/assets/painted/<kind>.glb
// The first view ('w', the side the boat usually sees) is painted on its own; the others get it as a
// reference, so the same objects keep the same materials and colours from every side.
import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { openAiKey } from '../openai-key.mjs';

const kind = process.argv[2] ?? 'ice';
const DIR = `assets/raw/painted/${kind}`;
const VIEWS = ['w', 'e', 'n', 's', 'top'];
const img = (f) => new Blob([readFileSync(f)], { type: 'image/png' });

/**
 * Pull-push fill: every magenta background pixel takes the colour of the nearest painted pixels
 * (averaged over a pyramid). Faces at a silhouette – where the painter drew the outline a few pixels
 * off – or faces no view sees well then pick up the object's own colours instead of magenta.
 */
async function fill(src, dst) {
  const { data, info } = await sharp(src).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  let W = info.width, H = info.height;
  let col = new Float32Array(W * H * 3), w = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2];
    const bg = Math.min(r, b) - g > 12;   // also the slightly magenta edge pixels
    w[i] = bg ? 0 : 1;
    col.set([r, g, b], i * 3);
  }
  // first grow the objects outwards pixel by pixel (each empty pixel takes the mean of its painted
  // neighbours): near a silhouette the fill is the object's own edge colour, not a blurred average
  for (let pass = 0; pass < 40; pass++) {
    const grown = [];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (w[i]) continue;
      let n = 0, r = 0, g = 0, b = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const j = yy * W + xx;
        if (!w[j]) continue;
        n++; r += col[j * 3]; g += col[j * 3 + 1]; b += col[j * 3 + 2];
      }
      if (n) grown.push([i, r / n, g / n, b / n]);
    }
    if (!grown.length) break;
    for (const [i, r, g, b] of grown) { col.set([r, g, b], i * 3); w[i] = 1; }
  }
  const levels = [{ W, H, col, w }];
  while (W > 1 || H > 1) {   // pull: average the painted pixels into ever smaller levels
    const w2 = Math.max(1, W >> 1), h2 = Math.max(1, H >> 1);
    const c2 = new Float32Array(w2 * h2 * 3), m2 = new Float32Array(w2 * h2);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, j = Math.min(h2 - 1, y >> 1) * w2 + Math.min(w2 - 1, x >> 1);
      const k = w[i];
      if (!k) continue;
      m2[j] += k;
      for (let c = 0; c < 3; c++) c2[j * 3 + c] += col[i * 3 + c] * k;
    }
    for (let j = 0; j < w2 * h2; j++) if (m2[j]) { for (let c = 0; c < 3; c++) c2[j * 3 + c] /= m2[j]; m2[j] = 1; }
    W = w2; H = h2; col = c2; w = m2;
    levels.push({ W, H, col, w });
  }
  for (let l = levels.length - 2; l >= 0; l--) {   // push: holes take the coarser level's colour
    const f = levels[l], c = levels[l + 1];
    for (let y = 0; y < f.H; y++) for (let x = 0; x < f.W; x++) {
      const i = y * f.W + x;
      if (f.w[i]) continue;
      const j = Math.min(c.H - 1, y >> 1) * c.W + Math.min(c.W - 1, x >> 1);
      for (let k = 0; k < 3; k++) f.col[i * 3 + k] = c.col[j * 3 + k];
      f.w[i] = 1;
    }
  }
  const out = Buffer.alloc(info.width * info.height * 3);
  for (let i = 0; i < out.length; i++) out[i] = Math.round(levels[0].col[i]);
  await sharp(out, { raw: { width: info.width, height: info.height, channels: 3 } }).png().toFile(dst);
}

if (process.argv[3] === 'fill') {
  for (const view of VIEWS) await fill(`${DIR}/painted-${view}.png`, `${DIR}/painted-${view}.fill.png`);
  console.log(`✓ ${DIR}/painted-*.fill.png`);
  process.exit(0);
}

if (process.argv[3] === 'build') {
  const SRC = `${DIR}/props.glb`, TMP = `${DIR}/props.opt.glb`, OUT = `src/assets/painted/${kind}.glb`;
  mkdirSync('src/assets/painted', { recursive: true });
  execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['gltf-transform', 'optimize', SRC, TMP,
    '--compress', 'meshopt', '--texture-compress', 'webp', '--texture-size', '2048',
    '--join', 'false', '--flatten', 'false', '--instance', 'false', '--simplify', 'false', '--palette', 'false', '--prune', 'false'],
  { stdio: 'pipe', shell: process.platform === 'win32' });
  copyFileSync(TMP, OUT);
  console.log(`✓ ${OUT} ${(statSync(OUT).size / 1024).toFixed(0)} KB`);
  process.exit(0);
}

const WHAT = {
  ice: {
    objects: 'four separate small icebergs and ice blocks floating in an Icelandic glacier lagoon',
    meaning: 'Meaning of the colours: white = snow and firn on the tops; light blue = clear glacier ice with crisp faceted surfaces, soft highlights and subtle layering; darker blue = deep cracks, hollows and old compacted blue ice; turquoise towards the bottom = the ice at the waterline glowing turquoise, getting deeper teal below it.',
    style: `assets/raw/painted/glacier/painted.png`,
  },
  rocks: {
    objects: 'four separate rocks standing in an Icelandic river: a low broad rock with a flat mossy top, a tall sea stack of hexagonal basalt columns with green caps, a rounded boulder and a flat ledge rock',
    meaning: 'Meaning of the colours: dark grey = dark basalt with clear cracks and, on the tall stack, the crisp edges of hexagonal basalt columns; green = thick bright moss and grass on the tops; pale yellow = patches of lichen; the very dark band at the bottom = wet, glistening rock at the waterline.',
    style: `assets/raw/painted/cliffs/painted.png`,
  },
}[kind];

const VIEW_TEXT = {
  side: 'seen from the side and slightly above',
  top: 'seen from directly above (top-down view)',
};

for (const view of VIEWS) {
  const out = `${DIR}/painted-${view}.png`;
  if (existsSync(out) && !process.argv.includes('--force')) continue;
  const first = view === VIEWS[0];
  const prompt = [
    `The first image is a flat-coloured 3D blockout render of ${WHAT.objects}, in a row, ${view === 'top' ? VIEW_TEXT.top : VIEW_TEXT.side}.`,
    'Repaint it as finished, richly detailed game art for a premium stylised console game (in the spirit of Mario Kart 8), in exactly the style, palette and lighting of the reference images.',
    'CRITICAL: keep the composition pixel-accurate – every silhouette, edge and feature of every object stays exactly where it is. Same perspective, same framing, nothing added, nothing moved. Only replace the flat colours with painted detail.',
    WHAT.meaning,
    first ? '' : 'The last reference image shows the SAME objects painted from another side – match their materials, colours, detail and light exactly, but keep the composition of the blockout.',
    'Bright fresh morning light from the upper left. The background is a flat pure magenta (#FF00FF) – keep it exactly that flat magenta everywhere around the objects, with clean sharp edges. No water surface, no reflections, no shadows on the background, no text.',
  ].filter(Boolean).join(' ');
  const form = new FormData();
  form.append('model', 'gpt-image-2');
  form.append('prompt', prompt);
  form.append('image[]', img(`${DIR}/blockout-${view}.png`), 'blockout.png');
  form.append('image[]', img('assets/raw/concepts/frame-idyll.png'), 'style.png');
  form.append('image[]', img(WHAT.style), 'bank.png');
  if (!first) form.append('image[]', img(`${DIR}/painted-${VIEWS[0]}.png`), 'same-objects.png');
  form.append('size', '3072x1024');
  form.append('quality', 'high');
  form.append('n', '1');
  const t0 = Date.now();
  const res = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${openAiKey()}` }, body: form });
  const json = await res.json();
  if (!res.ok) { console.error(`✗ ${view}: ${res.status} ${json.error?.message}`); process.exit(1); }
  writeFileSync(out, Buffer.from(json.data[0].b64_json, 'base64'));
  console.log(`✓ ${out} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}
