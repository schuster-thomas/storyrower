// Rigs a Tripo3D model for animation and downloads the rigged GLB to assets/raw/tripo/.
//   node scripts/tripo/rig.mjs <model_task_id> --name rower [--spec mixamo|tripo]
import { createTask, download, waitFor } from './tripo.mjs';

const [id, ...rest] = process.argv.slice(2);
const opt = (f, d) => (rest.includes(f) ? rest[rest.indexOf(f) + 1] : d);
const name = opt('--name', id);

const check = await waitFor(await createTask({ type: 'animate_prerigcheck', original_model_task_id: id }));
console.log('prerig check:', JSON.stringify(check.output ?? check.result));
const rig = await createTask({ type: 'animate_rig', original_model_task_id: id, out_format: 'glb', spec: opt('--spec', 'mixamo') });
console.log(`rig task ${rig}`);
const t = await waitFor(rig, (s) => process.stdout.write(`\r${s.status} ${s.progress ?? 0}%   `));
console.log();
for (const p of await download(t, `${name}.rigged`)) console.log(`✓ ${p}`);
