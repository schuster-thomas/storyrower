// Painted assets of the "Tokyo Super Row" level, generated with the OpenAI image API in the style of
// the level's mock-up (screenshots/tokyo_super_row_1.png), then cut into game textures.
//   node scripts/tokyo/assets.mjs                 – generate what is missing, then pack everything
//   node scripts/tokyo/assets.mjs sakura --force  – regenerate one asset
//   node scripts/tokyo/assets.mjs --pack          – only pack (no API calls)
// Raw PNGs: assets/raw/levels/tokyo/ (not committed). Game files: src/assets/levels/tokyo/.
//
// Sprite sheets hold four separate objects on a transparent background; they are packed into a
// 4 × 1 atlas of 512 px tiles plus a JSON with each object's aspect ratio (width / height), so the
// game can size the cards without distorting them.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { openAiKey } from '../openai-key.mjs';

const RAW = 'assets/raw/levels/tokyo';
const OUT = 'src/assets/levels/tokyo';
const REF = 'screenshots/tokyo_super_row_1.png';

const STYLE = 'Painted in exactly the style, palette and light of the reference image (premium stylised console adventure game art in the spirit of Mario Kart 8: clean readable shapes, saturated natural colours, soft painterly detail, bright spring morning light).';
const MODEL = ' Seen from the front at a three-quarter angle at eye level, the whole object visible, standing alone on a plain white background, evenly lit, no shadow, no ground, no people, no text. Painted in exactly the style of the reference image (premium stylised console game art, clean readable shapes, rich colours).';
const CUTOUT ='Fully transparent background, no ground plane, no cast shadow, no water, no text, no logos, no people.';

/** id → how it is generated and packed */
const ASSETS = [
  {
    id: 'far', kind: 'panorama', size: '3072x1024',
    prompt: `${STYLE} A very wide panoramic backdrop seen from a river in Tokyo, far away on the horizon: in the left-centre a large, majestic, perfectly shaped snow-capped volcanic cone (classic Japanese sacred mountain look) with long gentle blue-violet slopes and a bright white snow cap with streaks; low hazy blue-green hills on the far left; on the right half a long, low, hazy pale-blue silhouette of a distant modern city skyline (many small high-rise towers, no recognisable buildings, no tower with antenna). Soft atmospheric haze at the base, colours getting paler with distance. The ridge and skyline fill the lower 55% of the image; everything above is a perfectly flat, uniform, pure magenta (#FF00FF) background – no clouds, no sky gradient, no magenta in the subject. The bottom edge is a straight horizontal line of distant haze. No text, no logos, no water, no boats.`,
  },
  {
    id: 'sakura', kind: 'atlas', position: 'bottom',
    prompt: `${STYLE} Four separate Japanese cherry trees (sakura) in full bloom in a row, evenly spaced with clear transparent gaps, not touching: each has a dark, gnarled, characterful trunk and wide, layered, cloud-like canopies of soft pink blossoms (light pink to deeper pink, a few white highlights), some branches reaching far out to one side; different shapes: one wide and spreading, one tall, one leaning to the right, one smaller and round. Each stands upright on the base of its trunk. ${CUTOUT}`,
  },
  {
    id: 'garden', kind: 'atlas', position: 'bottom',
    prompt: `${STYLE} Four separate elements of a traditional Japanese garden in a row, evenly spaced with clear transparent gaps, not touching, each seen from the front at eye level and standing upright on its base: (1) a five-storey wooden pagoda with dark grey curved tiled roofs and vermilion red posts and a golden spire, tall and slender; (2) a small wooden tea pavilion on a stone base with a dark curved tiled roof, warm wooden walls, sliding paper screens and a small veranda; (3) a tall grey stone lantern (ishidoro) with a curved cap; (4) a carefully pruned Japanese black pine with cloud-shaped flat green foliage pads on a twisting trunk. ${CUTOUT}`,
  },
  {
    id: 'shrubs', kind: 'atlas', position: 'bottom',
    prompt: `${STYLE} Four separate low garden plants in a row, evenly spaced with clear transparent gaps, not touching, each wider than tall and standing on its base: (1) a rounded bush of bright pink azaleas covered in blossoms; (2) a rounded bush of magenta-pink azaleas; (3) a clump of neatly clipped round green box shrubs with a few pink flowers; (4) a small low cherry blossom bush with pink flowers. ${CUTOUT}`,
  },
  {
    // high-rises between the river and the volcano (a ring of its own, in front of the far panorama)
    id: 'skyline', kind: 'panorama', size: '3072x1024',
    prompt: `${STYLE} A very wide panoramic band of a dense modern Tokyo skyline seen from far away across a river, softly hazy: many high-rise towers of different heights and shapes (blue glass towers, white office towers, beige apartment blocks), a few taller towers in the middle and on the right, all with regular window grids, pale blue haze making the furthest ones lighter. The skyline fills the lower 45% of the image and its bottom edge is a straight horizontal line of low hazy buildings. Everything above the rooftops is a perfectly flat, uniform, pure magenta (#FF00FF) background – no clouds, no sky gradient, no mountains, no magenta in the subject. No red-and-white lattice tower, no text, no logos, no water.`,
  },
  {
    id: 'pagoda', kind: 'single', size: '1024x1536',
    prompt: `${STYLE} One tall five-storey Japanese pagoda standing alone, seen from the front at a slight angle: bright vermilion red posts, beams and balconies with white plaster panels, five wide sweeping roofs in weathered green-grey copper with upturned corners and small bronze bells, a tall dark bronze spire with nine rings on top, on a low grey stone base. Like a famous mountain pagoda overlooking cherry trees, but standing alone. It fills the full height of the image. ${CUTOUT}`,
  },
  {
    id: 'dragon-concept', kind: 'raw', size: '1536x1024', ref: 'screenshots/tokyo/03-monster-lasers-v6-dragon-large-fuji.png',
    prompt: 'A single original fantasy dragon for a 3D model reference, full body, seen from the front three-quarter view in a neutral T-pose-like flying pose with both large bat-like wings spread wide and fully visible, on a plain white background, evenly lit, no shadows. Deep crimson red scales with darker red back plates, a golden-bronze armoured belly, two large curved ivory horns swept back, a spiky frill, glowing magenta eyes, open jaws with white fangs, muscular arms and legs with dark claws, a long spiked tail. Painterly stylised premium console game look (like the reference image). Nothing else in the image, no text.',
  },
  {
    // more variety for the garden than cherry trees: maples, a willow over the water, bamboo
    id: 'trees', kind: 'atlas', position: 'bottom', size: '1536x1024',
    prompt: `${STYLE} Four separate, fairly small trees of a Japanese garden in a row, each in its own quarter of the image with WIDE empty transparent gaps between them – no leaves or branches may reach into a neighbour's quarter – each standing upright on the base of its trunk: (1) a Japanese maple (momiji) with a layered, airy crown of bright red-orange leaves; (2) a Japanese maple with fresh light-green spring leaves and a gracefully curved trunk; (3) a weeping willow with long hanging curtains of fresh green leaves, as wide as tall; (4) a tall clump of green bamboo stalks with feathery leaves, taller than wide. ${CUTOUT}`,
  },
  // concepts for Tripo3D models (scripts/tripo/tripo.mjs image …): small buildings for the garden
  { id: 'house-concept', kind: 'raw', size: '1024x1024', prompt: `A small traditional Japanese wooden garden house (machiya style) with dark grey curved ceramic roof tiles, warm brown timber walls, white plaster panels, paper sliding doors and a small engawa veranda on a low stone base.${MODEL}` },
  { id: 'pagoda3-concept', kind: 'raw', size: '1024x1536', prompt: `A slender three-storey Japanese pagoda (sanjunoto) of dark natural wood with white plaster panels, three wide dark grey tiled roofs with upturned corners and a bronze spire with rings, on a stone base.${MODEL}` },
  { id: 'shrine-concept', kind: 'raw', size: '1024x1024', prompt: `A small Shinto shrine building: a vermilion red wooden hall with a sweeping dark green copper roof with crossed chigi beams on top, a short flight of wooden steps, a straw rope with white paper streamers over the entrance, on a stone base.${MODEL}` },
  {
    id: 'tower', kind: 'single', size: '1024x1536',
    prompt: `${STYLE} One tall, slender steel lattice observation and broadcast tower standing alone, seen from the front at a distance: four splayed legs that taper upwards, painted in alternating bands of international orange-red and white, a two-storey observation deck about one third up and a smaller deck about two thirds up, then a thin antenna mast at the top. Original design, no logos, no signs. It fills the full height of the image. ${CUTOUT}`,
  },
];

const args = process.argv.slice(2);
const force = args.includes('--force');
const packOnly = args.includes('--pack');
const only = args.filter((a) => !a.startsWith('--'));
mkdirSync(RAW, { recursive: true });
mkdirSync(OUT, { recursive: true });

async function generate(a) {
  const panorama = a.kind === 'panorama';
  const form = new FormData();
  // gpt-image-2: bigger sizes but no transparency (the panorama is keyed out of magenta);
  // gpt-image-1.5 for the cut-outs with a real transparent background
  form.append('model', panorama ? 'gpt-image-2' : 'gpt-image-1.5');
  form.append('prompt', a.prompt);
  form.append('image[]', new Blob([readFileSync(a.ref ?? REF)], { type: 'image/png' }), 'reference.png');
  form.append('size', a.size ?? '1536x1024');
  if (!panorama && a.kind !== 'raw') form.append('background', 'transparent');
  form.append('quality', 'high');
  form.append('output_format', 'png');
  const res = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${openAiKey()}` }, body: form });
  const json = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${json.error?.message ?? JSON.stringify(json).slice(0, 300)}`);
  writeFileSync(`${RAW}/${a.id}.png`, Buffer.from(json.data[0].b64_json, 'base64'));
}

/** Flat magenta background → alpha, with despill (same as scripts/backdrops/process.mjs). */
async function keyMagenta(src) {
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const spill = Math.max(0, Math.min(r, b) - g);
    const key = Math.min(1, Math.max(0, (spill - 50) / 130));
    data[i + 3] = Math.round(255 * (1 - key));
    if (spill > 8) { data[i] = r - spill * 0.85; data[i + 2] = b - spill * 0.85; }
  }
  return sharp(data, { raw: info }).png().toBuffer();
}

/** Alpha below `cutoff` → 0 (soft haze some generations leave), the rest stretched back to 0–255. */
function cleanAlpha(data, cutoff = 24) {
  for (let k = 3; k < data.length; k += 4) {
    const a = data[k];
    data[k] = a < cutoff ? 0 : Math.round(((a - cutoff) / (255 - cutoff)) * 255);
  }
}

/**
 * Transparent pixels keep whatever colour the generator left there (often a bright glow), which
 * texture filtering would bleed into the edges: fill them with the colour of the nearest opaque
 * pixels instead (a few dilation passes, the rest gets the average colour).
 */
async function bleed(png) {
  const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const filled = new Uint8Array(w * h);
  let sr = 0, sg = 0, sb = 0, n = 0;
  for (let i = 0; i < w * h; i++) if (data[i * 4 + 3] > 0) { filled[i] = 1; sr += data[i * 4]; sg += data[i * 4 + 1]; sb += data[i * 4 + 2]; n++; }
  for (let pass = 0; pass < 12; pass++) {
    const next = filled.slice();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (filled[i]) continue;
      let r = 0, g = 0, b = 0, c = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const j = yy * w + xx;
        if (!filled[j]) continue;
        r += data[j * 4]; g += data[j * 4 + 1]; b += data[j * 4 + 2]; c++;
      }
      if (c) { data[i * 4] = r / c; data[i * 4 + 1] = g / c; data[i * 4 + 2] = b / c; next[i] = 1; }
    }
    filled.set(next);
  }
  if (n) for (let i = 0; i < w * h; i++) if (!filled[i]) { data[i * 4] = sr / n; data[i * 4 + 1] = sg / n; data[i * 4 + 2] = sb / n; }
  return sharp(data, { raw: info });
}

/** The four widest objects (split at transparent column gaps) → 2048 × 512 atlas + aspects. */
async function packAtlas(a) {
  const raw = `${RAW}/${a.id}.png`;
  const { data, info } = await sharp(raw).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  cleanAlpha(data);
  const cover = Array.from({ length: info.width }, (_, x) => {
    let n = 0;
    for (let y = 0; y < info.height; y += 2) if (data[(y * info.width + x) * 4 + 3] > 40) n++;
    return n;
  });
  const runs = [];
  let start = -1;
  for (let x = 0; x <= info.width; x++) {
    const on = x < info.width && cover[x] > 2;
    if (on && start < 0) start = x;
    if (!on && start >= 0) { runs.push([start, x]); start = -1; }
  }
  const merged = [];
  for (const r of runs) {
    const last = merged[merged.length - 1];
    if (last && r[0] - last[1] < 6) last[1] = r[1]; else merged.push([...r]);
  }
  const parts = merged.sort((p, q) => (q[1] - q[0]) - (p[1] - p[0])).slice(0, 4).sort((p, q) => p[0] - q[0]);
  const clean = sharp(data, { raw: info });
  const cleanPng = await clean.png().toBuffer();
  const tiles = [];
  const aspects = [];
  for (const [i, [l, r]] of parts.entries()) {
    const left = Math.max(0, l - 2), width = Math.min(info.width, r + 2) - left;
    const trimmed = await sharp(await sharp(cleanPng).extract({ left, top: 0, width, height: info.height }).png().toBuffer()).trim({ threshold: 1 }).png().toBuffer();
    const meta = await sharp(trimmed).metadata();
    aspects.push(+(meta.width / meta.height).toFixed(3));
    const tile = await sharp(trimmed).resize(512, 512, { fit: 'contain', position: a.position === 'bottom' ? 'bottom' : 'centre', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    tiles.push({ input: tile, left: i * 512, top: 0 });
  }
  const atlas = await sharp({ create: { width: 2048, height: 512, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(tiles).png().toBuffer();
  await (await bleed(atlas)).webp({ quality: 86, alphaQuality: 90 }).toFile(`${OUT}/${a.id}.webp`);
  return aspects;
}

async function pack(a) {
  const raw = `${RAW}/${a.id}.png`;
  if (!existsSync(raw)) { console.log(`– ${a.id}: missing`); return null; }
  if (a.kind === 'raw') return null;   // only a reference for other tools (Tripo3D)
  if (a.kind === 'atlas') return { aspects: await packAtlas(a) };
  if (a.kind === 'panorama') {
    const keyed = await keyMagenta(raw);
    const info = await sharp(await sharp(keyed).trim({ threshold: 1 }).png().toBuffer()).resize({ width: 3072, withoutEnlargement: true })
      .webp({ quality: 82, alphaQuality: 90, effort: 6 }).toFile(`${OUT}/${a.id}.webp`);
    return { aspect: +(info.width / info.height).toFixed(3) };
  }
  const { data, info } = await sharp(raw).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  cleanAlpha(data);
  const trimmed = await sharp(await sharp(data, { raw: info }).png().toBuffer()).trim({ threshold: 1 }).png().toBuffer();
  const resized = await sharp(trimmed).resize({ height: 1024, withoutEnlargement: true }).png().toBuffer();
  const out = await (await bleed(resized)).webp({ quality: 86, alphaQuality: 90 }).toFile(`${OUT}/${a.id}.webp`);
  return { aspect: +(out.width / out.height).toFixed(3) };
}

if (!packOnly) {
  const todo = ASSETS.filter((a) => (only.length ? only.includes(a.id) : true)).filter((a) => force || !existsSync(`${RAW}/${a.id}.png`));
  console.log(`${todo.length} asset(s) to generate`);
  await Promise.all(todo.map(async (a) => {
    const t0 = Date.now();
    try { await generate(a); console.log(`✓ ${a.id} (${((Date.now() - t0) / 1000).toFixed(0)} s)`); } catch (e) { console.log(`✗ ${a.id}: ${e.message}`); }
  }));
}

const manifestPath = `${OUT}/assets.json`;
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
for (const a of ASSETS) {
  const m = await pack(a);
  if (m) { manifest[a.id] = m; console.log(`✓ packed ${a.id}`, JSON.stringify(m)); }
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
