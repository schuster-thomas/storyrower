// 3D models of "Mauritius Shark Madness": Tripo3D image-to-model from the painted concepts
// (scripts/mauritius/assets.mjs), then compressed for the game (meshopt geometry, WebP textures).
//   node scripts/mauritius/models.mjs              – make what is missing, then compress everything
//   node scripts/mauritius/models.mjs shark --force – remake one model
// Raw models: assets/raw/tripo/mauritius-<id>.pbr_model.glb (not committed).
// Game files: src/assets/levels/mauritius/models/<id>.glb
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { createTask, download, upload, waitFor } from '../tripo/tripo.mjs';

const CONCEPTS = 'assets/raw/levels/mauritius';
const RAW = 'assets/raw/tripo';
const OUT = 'src/assets/levels/mauritius/models';

/** id → concept image, polygon budget and texture size */
const MODELS = [
  { id: 'shark', ref: 'shark-concept.png', faces: 9000, tex: 1024 },
  { id: 'speedboat', ref: 'speedboat-concept.png', faces: 7000, tex: 1024 },
  // the concept's tow rope was erased by hand (the game draws its own rope)
  { id: 'skier', ref: 'skier-ref.png', faces: 5000, tex: 512 },
  { id: 'surfer', ref: 'surfer-concept.png', faces: 5000, tex: 512 },
  { id: 'snorkeler', ref: 'snorkeler-concept.png', faces: 4000, tex: 512 },
  { id: 'loungers', ref: 'loungers-concept.png', faces: 4000, tex: 512 },
  { id: 'hut', ref: 'hut-concept.png', faces: 4000, tex: 512 },
  { id: 'pirogue', ref: 'pirogue-concept.png', faces: 3000, tex: 512 },
];

const args = process.argv.slice(2);
const force = args.includes('--force');
const only = args.filter((a) => !a.startsWith('--'));
mkdirSync(OUT, { recursive: true });
const rawPath = (id) => `${RAW}/mauritius-${id}.pbr_model.glb`;

const todo = MODELS.filter((m) => (only.length ? only.includes(m.id) : true)).filter((m) => force || !existsSync(rawPath(m.id)));
console.log(`${todo.length} model(s) to make`);
await Promise.all(todo.map(async (m) => {
  try {
    const id = await createTask({ type: 'image_to_model', file: await upload(`${CONCEPTS}/${m.ref}`), face_limit: m.faces });
    console.log(`… ${m.id}: task ${id}`);
    const t = await waitFor(id);
    await download(t, `mauritius-${m.id}`);
    console.log(`✓ ${m.id}`);
  } catch (e) { console.log(`✗ ${m.id}: ${e.message}`); }
}));

const run = (a) => execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['gltf-transform', ...a], { stdio: 'pipe', shell: process.platform === 'win32' });
for (const m of MODELS) {
  if (!existsSync(rawPath(m.id))) continue;
  const out = `${OUT}/${m.id}.glb`;
  run(['optimize', rawPath(m.id), out, '--compress', 'meshopt', '--texture-compress', 'webp', '--texture-size', String(m.tex), '--simplify', 'false']);
  console.log(`✓ ${out}: ${(statSync(out).size / 1024).toFixed(0)} KB`);
}
