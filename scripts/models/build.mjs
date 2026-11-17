// Bundles the selected CC0 models from the Quaternius "Stylized Nature MegaKit" into one
// compressed GLB for the game (shared textures, meshopt geometry, WebP textures).
//   node scripts/models/build.mjs
// Expects the extracted pack in assets/raw/packs/nature-megakit/ (see README).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync } from 'node:fs';

const SRC = 'assets/raw/packs/nature-megakit/glTF';
const TMP = 'assets/raw/build';
const OUT = 'src/assets/models/nature.glb';

/** Models used in the Iceland level. Node names in the GLB match these ids. */
export const MODELS = [
  'Rock_Medium_1', 'Rock_Medium_2', 'Rock_Medium_3',
  'Pebble_Round_2', 'Pebble_Square_2',
  'Grass_Common_Short', 'Grass_Common_Tall', 'Grass_Wispy_Tall',
  'Flower_3_Group', 'Flower_4_Group', 'Plant_7_Big',
  'Bush_Common', 'Bush_Common_Flowers',
  'Pine_1', 'Pine_3', 'CommonTree_1',
];

if (!existsSync(SRC)) throw new Error(`Pack not found in ${SRC}`);
mkdirSync(TMP, { recursive: true });
mkdirSync('src/assets/models', { recursive: true });

const run = (args) => execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['gltf-transform', ...args], { stdio: 'pipe', shell: process.platform === 'win32' });

// 1) merge all selected models into one document (one scene per model → merged into a single scene)
const inputs = MODELS.map((m) => `${SRC}/${m}.gltf`);
run(['merge', ...inputs, `${TMP}/merged.glb`, '--merge-scenes']);
// 2) dedupe shared textures/materials, shrink textures, compress geometry – keep every model as its own node
run(['optimize', `${TMP}/merged.glb`, OUT,
  '--compress', 'meshopt', '--texture-compress', 'webp', '--texture-size', '512',
  '--join', 'false', '--flatten', 'false', '--instance', 'false', '--simplify', 'false', '--palette', 'false']);
console.log(`✓ ${OUT}: ${(statSync(OUT).size / 1024).toFixed(0)} KB, ${MODELS.length} models`);
