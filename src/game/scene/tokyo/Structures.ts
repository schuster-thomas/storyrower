import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Hand-built Japanese structures: the arched vermilion footbridge and the small torii of the shrine path. */

const VERMILION = new THREE.Color(0xd8432b);
const BLACK = new THREE.Color(0x231d1d);
const WOOD = new THREE.Color(0x5a3e2c);
const BRONZE = new THREE.Color(0xb8893a);
const STONE = new THREE.Color(0xa8a49c);
const GIRDER = new THREE.Color(0x6e6c6a);

/** Give every vertex of a geometry one colour (for merged, vertex-coloured meshes). */
function paint(g: THREE.BufferGeometry, color: THREE.Color) {
  const g2 = g.index ? g.toNonIndexed() : g;
  const n = g2.attributes.position.count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([color.r, color.g, color.b], i * 3);
  g2.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g2.deleteAttribute('uv');
  return g2;
}

const box = (w: number, h: number, d: number, x: number, y: number, z: number, color: THREE.Color, rotZ = 0) => {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rotZ) g.rotateZ(rotZ);
  g.translate(x, y, z);
  return paint(g, color);
};

/**
 * A Japanese arched footbridge as in the level's mock-up: a gently arched deck with a thick
 * vermilion edge band over a grey arch girder, a vermilion railing of posts, rails and short
 * balusters with black onion caps (giboshi) on the main posts, two sturdy grey stone piers in the
 * water (clear of the oars) and stone end posts on both banks.
 * Built along x (across the river) from `x0` (left bank) to `x1` (right bank), centred on z = 0.
 */
export function bridgeGeometry(x0: number, x1: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const mid = (x0 + x1) / 2, half = (x1 - x0) / 2;
  const base = 3.6, rise = 3.4, width = 3.6;
  const top = (x: number) => base + rise * Math.max(0, 1 - ((x - mid) / half) ** 2);
  const N = 40;
  const xs = (i: number, n = N, inset = 0) => x0 + inset + (i / n) * (x1 - x0 - 2 * inset);
  /** a band under the arch: from `top - a` down to `top - b`, extruded across the deck */
  const band = (a: number, b: number, depth: number, color: THREE.Color) => {
    const s = new THREE.Shape();
    for (let i = 0; i <= N; i++) { const x = xs(i); if (i === 0) s.moveTo(x, top(x) - a); else s.lineTo(x, top(x) - a); }
    for (let i = N; i >= 0; i--) { const x = xs(i); s.lineTo(x, top(x) - b); }
    const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false, curveSegments: 1 });
    g.translate(0, 0, -depth / 2);
    return paint(g, color);
  };
  parts.push(band(-0.05, 0.6, width, VERMILION));          // the deck with its thick red edge
  parts.push(band(0.6, 1.35, width - 0.5, GIRDER));         // the grey arch girder under it
  parts.push(band(-0.1, -0.05, width - 0.3, WOOD));         // the wooden walking surface
  // the railing on both sides
  for (const z of [-width / 2 + 0.12, width / 2 - 0.12]) {
    const main = 8;
    for (let i = 0; i <= main; i++) {
      const x = xs(i, main, 0.3), end = i === 0 || i === main;
      const h = end ? 1.45 : 1.2;
      parts.push(box(end ? 0.3 : 0.22, h, end ? 0.3 : 0.22, x, top(x) + h / 2, z, VERMILION));
      // black onion cap with a bronze ring
      const cap = new THREE.SphereGeometry(end ? 0.24 : 0.17, 10, 8);
      cap.scale(1, 1.45, 1);
      cap.translate(x, top(x) + h + (end ? 0.26 : 0.19), z);
      parts.push(paint(cap, BLACK));
      parts.push(box(end ? 0.34 : 0.26, 0.06, end ? 0.34 : 0.26, x, top(x) + h + 0.02, z, BRONZE));
    }
    // short balusters between the rails
    for (let i = 0; i <= 36; i++) {
      const x = xs(i, 36, 0.3);
      parts.push(box(0.07, 0.55, 0.07, x, top(x) + 0.3, z, VERMILION));
    }
    for (const lift of [1.08, 0.6, 0.08]) {
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= N; i++) { const x = xs(i, N, 0.3); pts.push(new THREE.Vector3(x, top(x) + lift, z)); }
      parts.push(paint(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, lift > 1 ? 0.09 : 0.06, 6), VERMILION));
    }
  }
  // two stone piers in the water, with a dark cross beam under the girder
  for (const k of [-0.56, 0.56]) {
    const x = mid + k * half;
    const h = top(x) - 1.35 + 1.5;
    parts.push(box(1.5, h, width - 0.2, x, h / 2 - 1.5, 0, STONE));
    parts.push(box(1.8, 0.35, width + 0.2, x, top(x) - 1.4, 0, GIRDER));
  }
  // stone abutments and end posts on both banks
  for (const [x, s] of [[x0, -1], [x1, 1]] as const) {
    parts.push(box(3.2, 5.2, width + 1.4, x + s * 0.9, 1.0, 0, STONE));
    for (const z of [-width / 2 - 0.4, width / 2 + 0.4]) {
      parts.push(box(0.6, 2.2, 0.6, x + s * 0.4, top(x) + 1.1, z, STONE));
      parts.push(box(0.8, 0.25, 0.8, x + s * 0.4, top(x) + 2.3, z, STONE));
    }
  }
  const merged = mergeGeometries(parts)!;
  parts.forEach((p) => p.dispose());
  merged.computeVertexNormals();
  return merged;
}

/** A small shrine torii (about 3.2 m), for the tunnel of gates along the garden path. */
export function smallToriiGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const half = 1.15, h = 3.2;
  for (const x of [-half, half]) {
    const p = new THREE.CylinderGeometry(0.1, 0.12, h, 10);
    p.translate(x, h / 2, 0);
    parts.push(paint(p, VERMILION));
    parts.push(box(0.3, 0.35, 0.3, x, 0.17, 0, BLACK));
  }
  parts.push(box(half * 2 + 0.6, 0.16, 0.16, 0, h - 0.55, 0, VERMILION));
  const kasagi = new THREE.BoxGeometry(half * 2 + 1.1, 0.2, 0.32, 12, 1, 1);
  const pos = kasagi.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) { const u = pos.getX(i) / (half + 0.55); pos.setY(i, pos.getY(i) + 0.22 * u * u * u * u); }
  kasagi.translate(0, h + 0.05, 0);
  parts.push(paint(kasagi, BLACK));
  parts.push(box(half * 2 + 0.8, 0.18, 0.24, 0, h - 0.14, 0, VERMILION));
  const merged = mergeGeometries(parts)!;
  parts.forEach((p) => p.dispose());
  merged.computeVertexNormals();
  return merged;
}
