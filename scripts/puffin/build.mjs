// Puffin models for the game (Tripo3D → scripts/blender/puffin.py → here): meshopt geometry,
// 1024 px WebP texture → src/assets/models/puffin-standing.glb, puffin-flying.glb
//   node scripts/puffin/build.mjs
import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';

for (const pose of ['standing', 'flying']) {
  const out = `src/assets/models/puffin-${pose}.glb`;
  execFileSync(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['gltf-transform', 'optimize', `assets/raw/puffin/${pose}.glb`, out,
    '--compress', 'meshopt', '--texture-compress', 'webp', '--texture-size', '1024', '--simplify', 'false'],
  { stdio: 'pipe', shell: process.platform === 'win32' });
  console.log(`✓ ${out} ${(statSync(out).size / 1024).toFixed(0)} KB`);
}
