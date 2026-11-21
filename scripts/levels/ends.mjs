// Which way does a model point? Prints the cross-section (x and y extent) and the highest point near
// each end of its longest axis – e.g. a pointed bow vs. a wide stern, a tall tail fin vs. a snout.
//   node scripts/levels/ends.mjs model.glb
import { NodeIO } from '@gltf-transform/core';
const doc = await new NodeIO().read(process.argv[2]);
const pts = [];
for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
  const a = p.getAttribute('POSITION');
  for (let i = 0; i < a.getCount(); i++) pts.push(a.getElement(i, []));
}
const ext = [0, 1, 2].map((k) => Math.max(...pts.map((p) => p[k])) - Math.min(...pts.map((p) => p[k])));
const axis = ext[0] > ext[2] ? 0 : 2, names = 'xyz';
const lo = Math.min(...pts.map((p) => p[axis])), hi = Math.max(...pts.map((p) => p[axis]));
for (const [label, test] of [['min', (v) => v < lo + (hi - lo) * 0.15], ['max', (v) => v > hi - (hi - lo) * 0.15]]) {
  const s = pts.filter((p) => test(p[axis]));
  const span = (k) => (Math.max(...s.map((p) => p[k])) - Math.min(...s.map((p) => p[k]))).toFixed(3);
  console.log(`${names[axis]} ${label} end: ${s.length} pts, across ${span(axis === 0 ? 2 : 0)}, height ${span(1)}, top ${Math.max(...s.map((p) => p[1])).toFixed(3)}`);
}
const top = pts.reduce((m, p) => (p[1] > m[1] ? p : m));
console.log(`highest point at ${names[axis]} = ${top[axis].toFixed(3)}`);
