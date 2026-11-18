// Shared helpers for painted sprites: generate an image with a transparent background and pack the
// separate objects in it (found at the transparent gaps between them) into a 4 × 1 atlas.
import { readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { openAiKey } from '../openai-key.mjs';

/** gpt-image-1.5 with a transparent background and one style reference → raw PNG */
export async function generateSprites(out, prompt, styleRef) {
  const form = new FormData();
  form.append('model', 'gpt-image-1.5');
  form.append('prompt', prompt);
  form.append('image[]', new Blob([readFileSync(styleRef)], { type: 'image/png' }), 'style.png');
  form.append('size', '1536x1024');
  form.append('background', 'transparent');
  form.append('quality', 'high');
  const res = await fetch('https://api.openai.com/v1/images/edits', { method: 'POST', headers: { Authorization: `Bearer ${openAiKey()}` }, body: form });
  const json = await res.json();
  if (!res.ok) { console.error(`✗ ${res.status} ${json.error?.message}`); process.exit(1); }
  writeFileSync(out, Buffer.from(json.data[0].b64_json, 'base64'));
  console.log(`✓ ${out}`);
}

/**
 * Finds the objects at the transparent gaps between them (column alpha coverage), takes the four
 * widest, trims each and packs them into a 4 × 1 atlas of 512 × 512 tiles.
 * @param position 'bottom' (things standing on the ground) or 'centre'
 * @param cutoff alpha below this counts as background (some generations leave a soft haze around
 *   the objects); the alpha above it is stretched back to 0–255
 */
export async function packAtlas(raw, out, position = 'bottom', cutoff = 24) {
  const { data, info } = await sharp(raw).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
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
    if (last && r[0] - last[1] < 24) last[1] = r[1]; else merged.push([...r]);
  }
  const parts = merged.sort((p, q) => (q[1] - q[0]) - (p[1] - p[0])).slice(0, 4).sort((p, q) => p[0] - q[0]);
  console.log('objects', parts.map(([l, r]) => r - l).join(', '), 'px wide');
  const tiles = [];
  for (const [i, [l, r]] of parts.entries()) {
    const part = await sharp(raw).extract({ left: Math.max(0, l - 4), top: 0, width: Math.min(info.width, r + 4) - Math.max(0, l - 4), height: info.height }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const { width: pw, height: ph } = part.info;
    let x0 = pw, x1 = 0, y0 = ph, y1 = 0;
    for (let y = 0; y < ph; y++) for (let x = 0; x < pw; x++) {
      const k = (y * pw + x) * 4 + 3;
      const a = part.data[k];
      part.data[k] = a < cutoff ? 0 : Math.round(((a - cutoff) / (255 - cutoff)) * 255);
      if (part.data[k] > 0) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    }
    const trimmed = await sharp(part.data, { raw: part.info }).extract({ left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 }).png().toBuffer();
    const tile = await sharp(trimmed).resize(512, 512, { fit: 'contain', position: position === 'bottom' ? 'bottom' : 'centre', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
    tiles.push({ input: tile, left: i * 512, top: 0 });
  }
  await sharp({ create: { width: 2048, height: 512, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(tiles).webp({ quality: 85, alphaQuality: 90 }).toFile(out);
  console.log(`✓ ${out}`);
}
