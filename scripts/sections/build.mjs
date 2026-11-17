// Compresses an exported river section for the game (meshopt geometry, WebP textures) and copies
// its placements JSON next to it.
//   node scripts/sections/build.mjs fjord
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, statSync } from 'node:fs';

const id = process.argv[2] ?? 'fjord';
const SRC = `assets/raw/sections/${id}.glb`;
const OUT_DIR = 'src/assets/sections';
mkdirSync(OUT_DIR, { recursive: true });
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const run = (args) => execFileSync(npx, ['gltf-transform', ...args], { stdio: 'pipe', shell: process.platform === 'win32' });

// textures: the baked terrain keeps 2k, the scans (Poly Haven *_2k maps) are fine at 1k
run(['resize', SRC, `assets/raw/sections/${id}.small.glb`, '--width', '1024', '--height', '1024', '--pattern', '*_2k*']);
run(['optimize', `assets/raw/sections/${id}.small.glb`, `assets/raw/sections/${id}.opt.glb`,
  '--compress', 'meshopt', '--texture-compress', 'webp', '--texture-size', '2048',
  '--join', 'false', '--flatten', 'false', '--instance', 'false', '--simplify', 'false', '--palette', 'false']);
copyFileSync(`assets/raw/sections/${id}.opt.glb`, `${OUT_DIR}/${id}.glb`);
copyFileSync(`assets/raw/sections/${id}.placements.json`, `${OUT_DIR}/${id}.placements.json`);
const kb = (f) => (statSync(f).size / 1024).toFixed(0);
console.log(`✓ ${OUT_DIR}/${id}.glb ${kb(`${OUT_DIR}/${id}.glb`)} KB (raw ${kb(SRC)} KB), placements ${kb(`${OUT_DIR}/${id}.placements.json`)} KB`);
