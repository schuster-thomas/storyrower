// Where are a stand-up paddler's fists? For a Tripo figure on a board (no paddle) this finds the
// board's axis from its lowest points, the turn (yaw) that lays the board along +z with the person
// facing forward, and both fists in the game's normalised model space after that turn (height 1,
// standing on y = 0, centred on the bounding box – as src/game/scene/models.ts normalises).
//   node scripts/levels/hands.mjs model.glb
import { NodeIO } from '@gltf-transform/core';

const doc = await new NodeIO().read(process.argv[2]);
const raw = [];
for (const mesh of doc.getRoot().listMeshes()) for (const p of mesh.listPrimitives()) {
  const a = p.getAttribute('POSITION');
  for (let i = 0; i < a.getCount(); i++) raw.push(a.getElement(i, []));
}
const lo = [0, 1, 2].map((k) => Math.min(...raw.map((p) => p[k]))), hi = [0, 1, 2].map((k) => Math.max(...raw.map((p) => p[k])));
const H = hi[1] - lo[1], cx = (lo[0] + hi[0]) / 2, cz = (lo[2] + hi[2]) / 2;
const pts = raw.map((p) => [(p[0] - cx) / H, (p[1] - lo[1]) / H, (p[2] - cz) / H]);

// the board: the lowest points; its long axis by principal components in x–z
const board = pts.filter((p) => p[1] < 0.15);
const mx = board.reduce((a, p) => a + p[0], 0) / board.length, mz = board.reduce((a, p) => a + p[2], 0) / board.length;
let sxx = 0, szz = 0, sxz = 0;
for (const p of board) { const dx = p[0] - mx, dz = p[2] - mz; sxx += dx * dx; szz += dz * dz; sxz += dx * dz; }
const axis = 0.5 * Math.atan2(2 * sxz, sxx - szz);   // angle of the long axis from +x
// three.js rotation about y: x' = x cos ψ + z sin ψ, z' = −x sin ψ + z cos ψ; lay the axis along z
let yaw = Math.PI / 2 - axis;
const turn = (p, ψ) => [p[0] * Math.cos(ψ) + p[2] * Math.sin(ψ), p[1], -p[0] * Math.sin(ψ) + p[2] * Math.cos(ψ)];

const measure = (ψ) => {
  const q = pts.map((p) => turn(p, ψ));
  const torso = q.filter((p) => p[1] > 0.6 && p[1] < 0.7);
  const t = [torso.reduce((a, p) => a + p[0], 0) / torso.length, torso.reduce((a, p) => a + p[2], 0) / torso.length];
  // the fists are the forward-most points at their heights (the farthest from the torso can be the hips)
  const front = (a, b) => q.filter((p) => p[1] > a && p[1] < b).reduce((m, p) => (p[2] > m[2] ? p : m));
  return { torso: t, top: front(0.66, 0.85), low: front(0.42, 0.62) };
};
let m = measure(yaw);
// the fists are in front of the body: if they are behind it, turn round
{ const back = measure(yaw + Math.PI); if (back.top[2] - back.torso[1] > m.top[2] - m.torso[1]) { yaw += Math.PI; m = back; } }
const r = (v) => v.map((x) => +x.toFixed(3));
console.log(JSON.stringify({ yaw: +(((yaw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)).toFixed(3), torso: r(m.torso), top: r(m.top), low: r(m.low) }));
