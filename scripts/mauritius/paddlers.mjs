// The stand-up paddlers of "Mauritius Shark Madness", animated: the Tripo figures rigged by Tripo
// (node scripts/tripo/rig.mjs <task> --name mauritius-paddler …, Mixamo bones), then levelled,
// given a paddle and one looping stroke with both hands on it in Blender (scripts/blender/paddler.py),
// then compressed for the game (meshopt geometry, WebP textures, the animation and the "Blade"
// marker kept).
//   node scripts/mauritius/paddlers.mjs
// Raw: assets/raw/tripo/mauritius-<id>.rigged.model.glb (not committed)
// Game: src/assets/levels/mauritius/models/<id>.glb
import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';

const BLENDER = process.env.BLENDER ?? 'C:/Program Files/Blender Foundation/Blender 5.3/blender.exe';
/** id → the side the paddle is on (the woman paddles on her right, the man on his left) */
const PADDLERS = [
  { id: 'paddler', side: 'right' },
  { id: 'paddler2', side: 'left' },
];
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
for (const { id, side } of PADDLERS) {
  const raw = `assets/raw/levels/mauritius/${id}.anim.glb`;
  const log = execFileSync(BLENDER, ['--background', '--factory-startup', '--python', 'scripts/blender/paddler.py', '--',
    `assets/raw/tripo/mauritius-${id}.rigged.model.glb`, raw, side], { encoding: 'utf8', maxBuffer: 64 << 20 });
  for (const line of log.split('\n')) if (/^(LEVEL|BOARD|ARMS|HOLD|PADDLER)/.test(line)) console.log(`  ${id}: ${line.trim()}`);
  const out = `src/assets/levels/mauritius/models/${id}.glb`;
  execFileSync(npx, ['gltf-transform', 'optimize', raw, out,
    '--compress', 'meshopt', '--texture-compress', 'webp', '--texture-size', '512',
    '--join', 'false', '--flatten', 'false', '--instance', 'false', '--simplify', 'false', '--palette', 'false',
    '--prune', 'false'], // keep the "Blade" marker (an empty)
  { stdio: 'pipe', shell: process.platform === 'win32' });
  console.log(`✓ ${out} ${(statSync(out).size / 1024).toFixed(0)} KB`);
}
