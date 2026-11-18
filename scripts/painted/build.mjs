// Compresses a projected painted section for the game (meshopt geometry, WebP texture).
//   node scripts/painted/build.mjs [name]   (assets/raw/painted/shore.glb → src/assets/painted/<name>.glb)
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, statSync } from 'node:fs';

const name = process.argv[2] ?? 'shore-a';
const SRC = 'assets/raw/painted/shore.glb';
const OUT = `src/assets/painted/${name}.glb`;
mkdirSync('src/assets/painted', { recursive: true });
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
execFileSync(npx, ['gltf-transform', 'optimize', SRC, 'assets/raw/painted/shore.opt.glb',
  '--compress', 'meshopt', '--texture-compress', 'webp', '--texture-size', '4096',
  '--join', 'false', '--flatten', 'false', '--instance', 'false', '--simplify', 'false', '--palette', 'false'],
{ stdio: 'pipe', shell: process.platform === 'win32' });
copyFileSync('assets/raw/painted/shore.opt.glb', OUT);
console.log(`✓ ${OUT} ${(statSync(OUT).size / 1024).toFixed(0)} KB`);
