// Painted assets of a level, generated with the OpenAI image API in the style of the level's
// mock-up, then cut into game textures (shared by scripts/<level>/assets.mjs).
//
// Kinds:
//   panorama – gpt-image-2 on flat magenta, keyed to alpha, trimmed (a far ring / arc)
//   atlas    – four separate objects on a transparent background → 4 × 1 atlas of 512 px tiles
//              plus each object's aspect ratio (width / height)
//   single   – one object on a transparent background, trimmed, 1024 px high
//   texture  – a seamless tileable texture, resized to `out` px wide (OUT/tex/<id>.webp)
//   raw      – only a reference for other tools (Tripo3D concepts); not packed
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { openAiKey } from '../openai-key.mjs';

async function generate(a, RAW, REF) {
  const panorama = a.kind === 'panorama';
  const form = new FormData();
  // gpt-image-2: bigger sizes but no transparency (the panorama is keyed out of magenta);
  // gpt-image-1.5 for the cut-outs with a real transparent background
  form.append('model', a.model ?? (panorama ? 'gpt-image-2' : 'gpt-image-1.5'));
  form.append('prompt', a.prompt);
  form.append('image[]', new Blob([readFileSync(a.ref ?? REF)], { type: 'image/png' }), 'reference.png');
  form.append('size', a.size ?? '1536x1024');
  if (!panorama && a.kind !== 'raw' && a.kind !== 'texture') form.append('background', 'transparent');
  form.append('quality', 'high');
  if (a.kind !== 'texture') form.append('output_format', 'png');
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
async function packAtlas(a, RAW, OUT) {
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

async function pack(a, RAW, OUT) {
  const raw = `${RAW}/${a.id}.png`;
  if (!existsSync(raw)) { console.log(`– ${a.id}: missing`); return null; }
  if (a.kind === 'raw') return null;   // only a reference for other tools (Tripo3D)
  if (a.kind === 'texture') {
    const meta = await sharp(raw).metadata();
    const w = a.out ?? 512, h = Math.round((w * meta.height) / meta.width);
    await sharp(raw).resize(w, h).webp({ quality: 84 }).toFile(`${OUT}/tex/${a.id}.webp`);
    return null;
  }
  if (a.kind === 'atlas') return { aspects: await packAtlas(a, RAW, OUT) };
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

/**
 * Generate what is missing (or the ids named on the command line; --force regenerates, --pack only
 * packs), then pack everything into OUT and its assets.json.
 */
export async function runAssets({ RAW, OUT, REF, ASSETS }) {
  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const packOnly = args.includes('--pack');
  const only = args.filter((a) => !a.startsWith('--'));
  mkdirSync(RAW, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  if (ASSETS.some((a) => a.kind === 'texture')) mkdirSync(`${OUT}/tex`, { recursive: true });

  if (!packOnly) {
    const todo = ASSETS.filter((a) => (only.length ? only.includes(a.id) : true)).filter((a) => force || !existsSync(`${RAW}/${a.id}.png`));
    console.log(`${todo.length} asset(s) to generate`);
    const queue = [...todo];
    await Promise.all(Array.from({ length: 6 }, async () => {
      while (queue.length) {
        const a = queue.shift();
        const t0 = Date.now();
        try { await generate(a, RAW, REF); console.log(`✓ ${a.id} (${((Date.now() - t0) / 1000).toFixed(0)} s)`); } catch (e) { console.log(`✗ ${a.id}: ${e.message}`); }
      }
    }));
  }

  const manifestPath = `${OUT}/assets.json`;
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : {};
  for (const a of ASSETS) {
    const m = await pack(a, RAW, OUT);
    if (m) { manifest[a.id] = m; console.log(`✓ packed ${a.id}`, JSON.stringify(m)); }
  }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
}
