// Compresses the exported boat + rower (scripts/blender/boat.py) for the game:
// meshopt geometry, 1k WebP textures, animation kept.
//   node scripts/boat/build.mjs
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, statSync } from 'node:fs';

const SRC = 'assets/raw/boat/boat.glb';
const OUT = 'src/assets/models/boat.glb';
mkdirSync('src/assets/models', { recursive: true });
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
execFileSync(npx, ['gltf-transform', 'optimize', SRC, 'assets/raw/boat/boat.opt.glb',
  '--compress', 'meshopt', '--texture-compress', 'webp', '--texture-size', '1024',
  '--join', 'false', '--flatten', 'false', '--instance', 'false', '--simplify', 'false', '--palette', 'false',
  '--prune', 'false'], // keep the empty marker nodes (waterfall positions, blade centres)
{ stdio: 'pipe', shell: process.platform === 'win32' });
copyFileSync('assets/raw/boat/boat.opt.glb', OUT);
console.log(`✓ ${OUT} ${(statSync(OUT).size / 1024).toFixed(0)} KB (raw ${(statSync(SRC).size / 1024).toFixed(0)} KB)`);
