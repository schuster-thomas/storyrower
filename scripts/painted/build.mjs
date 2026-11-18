// Compresses a projected painted section for the game (meshopt geometry, WebP texture).
//   node scripts/painted/build.mjs cliffs|glacier   (assets/raw/painted/<kind>/section.glb → src/assets/painted/<kind>.glb)
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, statSync } from 'node:fs';

const kind = process.argv[2] ?? 'cliffs';
const SRC = `assets/raw/painted/${kind}/section.glb`;
const TMP = `assets/raw/painted/${kind}/section.opt.glb`;
const OUT = `src/assets/painted/${kind}.glb`;
mkdirSync('src/assets/painted', { recursive: true });
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
execFileSync(npx, ['gltf-transform', 'optimize', SRC, TMP,
  '--compress', 'meshopt', '--texture-compress', 'webp', '--texture-size', '4096',
  '--join', 'false', '--flatten', 'false', '--instance', 'false', '--simplify', 'false', '--palette', 'false'],
{ stdio: 'pipe', shell: process.platform === 'win32' });
copyFileSync(TMP, OUT);
console.log(`✓ ${OUT} ${(statSync(OUT).size / 1024).toFixed(0)} KB`);
