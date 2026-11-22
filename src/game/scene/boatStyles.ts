import * as T from 'three';
import type { BoatStyle } from '../../wardrobe/store';
import { buildNoveltyBoat } from './noveltyBoats';
import { fitThemedPaddles } from './themedPaddles';
import { buildStadiumBoat } from './stadiumBoat';
import { buildLogBoat } from './logBoat';

/** Alternate hulls share the original rig, oar pivots and stroke animation. Y is up. */
export function fitBoat(root: T.Object3D, style: BoatStyle): () => void {
  if (style === 'default') return () => {};
  const parent = root.getObjectByName('Boat') ?? root;
  const group = new T.Group();
  group.name = 'CustomHull';
  parent.add(group);
  const hidden: T.Object3D[] = [];
  const replaced: { mesh: T.Mesh; material: T.Material | T.Material[] }[] = [];
  const reshaped: { mesh: T.Mesh; geometry: T.BufferGeometry }[] = [];
  const materials = new Set<T.Material>();
  const mat = (color: number, roughness = .65) => {
    const m = new T.MeshStandardMaterial({ color, roughness, flatShading: true });
    materials.add(m); return m;
  };
  const wood = [mat(0x8f4924), mat(0xa85b2b), mat(0xb96c32), mat(0x995024)];
  const trim = mat(0xe3a34c, .4), dark = mat(0x292d31), rope = mat(0xcda15a);
  const red = [mat(0xf52b30, .48), mat(0xe82429, .48), mat(0xff3e3e, .48)];
  const mesh = (geometry: T.BufferGeometry, material: T.Material, name: string) => {
    const obj = new T.Mesh(geometry, material); obj.name = name; group.add(obj); return obj;
  };
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, material: T.Material, name: string) => {
    const obj = mesh(new T.BoxGeometry(w, h, d), material, name); obj.position.set(x, y, z); return obj;
  };
  const tube = (points: T.Vector3[], radius: number, material: T.Material, name: string, closed = false) =>
    mesh(new T.TubeGeometry(new T.CatmullRomCurve3(points, closed), Math.max(24, points.length * 3), radius, 8, closed), material, name);
  const v = (x: number, y: number, z: number) => new T.Vector3(x, y, z);
  parent.traverse(obj => {
    if (/^(Hull|Strut|Backstay)/.test(obj.name) && obj.visible) { hidden.push(obj); obj.visible = false; }
    if (style === 'wooden' && /^(Shaft|Neck|Handle|Blade)([._]?\d+)*$/.test(obj.name) && (obj as T.Mesh).isMesh) {
      const part = obj as T.Mesh; replaced.push({ mesh: part, material: part.material }); part.material = trim;
      if (obj.name.startsWith('Blade')) {
        reshaped.push({ mesh: part, geometry: part.geometry });
        const paddle = new T.Shape();
        paddle.moveTo(-1.1, -.09); paddle.lineTo(-.65, -.25); paddle.lineTo(.65, -.43);
        paddle.quadraticCurveTo(1.05, -.43, 1.08, 0); paddle.quadraticCurveTo(1.05, .43, .65, .43);
        paddle.lineTo(-.65, .25); paddle.lineTo(-1.1, .09); paddle.closePath();
        part.geometry = new T.ExtrudeGeometry(paddle, { depth: .05, bevelEnabled: false, curveSegments: 4 });
        part.geometry.translate(0, 0, -.025);
      }
    }
  });

  let removeNovelty: (() => void) | undefined;
  if (style === 'log') {
    removeNovelty = buildLogBoat(group, parent);
  } else if (style === 'stadium') {
    removeNovelty = buildStadiumBoat(group, parent);
  } else if (style === 'duck' || style === 'banana' || style === 'bathtub' || style === 'pizza' || style === 'snail') {
    removeNovelty = buildNoveltyBoat(group, parent, style);
  } else if (style === 'wooden') {
    // Open, pointed clinker hull: each strake overlaps the previous one.
    const count = 40, rows = 6;
    const width = (t: number) => .72 * Math.pow(Math.sin(Math.PI * t), .72) + .012;
    const edge = (t: number) => .34 + .15 * Math.pow(Math.abs(2 * t - 1), 3);
    for (let row = 0; row < rows; row++) {
      const vertices: number[] = [], indices: number[] = [];
      for (let i = 0; i <= count; i++) {
        const t = i / count, z = -1.65 + t * 3.5;
        for (const r of [row / rows, (row + 1) / rows]) {
          const angle = r * Math.PI;
          vertices.push(width(t) * Math.cos(angle), edge(t) - .65 * Math.sin(angle), z);
        }
        if (i < count) { const a = i * 2; indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      }
      const geometry = new T.BufferGeometry();
      geometry.setAttribute('position', new T.Float32BufferAttribute(vertices, 3)); geometry.setIndex(indices); geometry.computeVertexNormals();
      // Both faces are visible inside an open boat.
      wood[row % wood.length].side = T.DoubleSide;
      mesh(geometry, wood[row % wood.length], 'ClinkerPlank');
    }
    for (const side of [-1, 1]) {
      tube(Array.from({ length: 41 }, (_, i) => { const t = i / 40; return v(side * width(t), edge(t), -1.65 + 3.5 * t); }), .045, trim, 'GoldenGunwale');
      for (let row = 1; row < 6; row++) {
        const a = row * Math.PI / 6;
        tube(Array.from({ length: 41 }, (_, i) => { const t = i / 40; return v(side * width(t) * Math.cos(a / 2), edge(t) - .65 * Math.sin(a / 2), -1.65 + 3.5 * t); }), .012, wood[0], 'PlankSeam');
      }
      for (let i = 3; i < 38; i += 4) {
        const t = i / 40;
        const rivet = mesh(new T.SphereGeometry(.018, 6, 4), trim, 'BrassRivet'); rivet.position.set(side * width(t), edge(t) + .025, -1.65 + 3.5 * t);
      }
    }
    // A continuous fitted sole meets the faceted hull at every station. No gaps through
    // which the water plane can show; its height also clears the preview's wave crests.
    const floorY = .14;
    const floorWidth = (t: number) => {
      const angle = Math.asin((edge(t) - floorY) / .65);
      const step = Math.PI / rows, band = Math.floor(angle / step);
      const blend = ((edge(t) - floorY) / .65 - Math.sin(band * step))
        / (Math.sin((band + 1) * step) - Math.sin(band * step));
      return width(t) * T.MathUtils.lerp(Math.cos(band * step), Math.cos((band + 1) * step), blend);
    };
    for (let plank = 0; plank < 9; plank++) {
      const vertices: number[] = [], indices: number[] = [];
      for (let i = 0; i <= count; i++) {
        const t = i / count, w = floorWidth(t);
        vertices.push(w * (plank / 9 * 2 - 1), floorY, -1.65 + 3.5 * t,
          w * ((plank + 1) / 9 * 2 - 1), floorY, -1.65 + 3.5 * t);
        if (i < count) { const a = i * 2; indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
      }
      const geometry = new T.BufferGeometry();
      geometry.setAttribute('position', new T.Float32BufferAttribute(vertices, 3)); geometry.setIndex(indices); geometry.computeVertexNormals();
      mesh(geometry, wood[plank % 4], 'FittedFloorboard');
    }
    for (const z of [-.65, .95]) box(width((z + 1.65) / 3.5) * 1.85, .075, .22, 0, .21, z, trim, 'WoodenBench');
    for (const side of [-1, 1]) tube([v(side * .65, .31, .49), v(side * .92, .48, .49)], .035, trim, 'OarlockMount');
    tube([v(0, .47, 1.85), v(0, .05, 1.81), v(0, -.26, 1.65)], .035, trim, 'Stem');
    const coil = Array.from({ length: 241 }, (_, i) => {
      const a = i / 240 * Math.PI * 10, r = .07 + i / 240 * .21;
      return v(Math.cos(a) * r, floorY + .027, 1.10 + Math.sin(a) * r);
    });
    tube(coil, .022, rope, 'CoiledRope');
  } else {
    group.scale.set(.86, 1, 1.15);
    // Broad oval tube, with individually shaded welded chambers and a dark inset floor.
    const stations = 64, sides = 12, vertices: number[] = [], indices: number[] = [];
    const point = (a: number, b: number) => v((.79 + .235 * Math.cos(b)) * Math.sin(a), .16 + .235 * Math.sin(b), .08 + (1.46 + .235 * Math.cos(b)) * Math.cos(a));
    for (let i = 0; i <= stations; i++) for (let j = 0; j <= sides; j++) vertices.push(...point(i / stations * Math.PI * 2, j / sides * Math.PI * 2).toArray());
    const geometry = new T.BufferGeometry();
    for (let i = 0; i < stations; i++) {
      const start = indices.length;
      for (let j = 0; j < sides; j++) { const a = i * (sides + 1) + j, b = a + sides + 1; indices.push(a, b, a + 1, a + 1, b, b + 1); }
      geometry.addGroup(start, indices.length - start, Math.floor(i / 4) % red.length);
    }
    geometry.setAttribute('position', new T.Float32BufferAttribute(vertices, 3)); geometry.setIndex(indices); geometry.computeVertexNormals();
    const inflatable = new T.Mesh(geometry, red); inflatable.name = 'InflatableChambers'; group.add(inflatable);
    const floor = mesh(new T.CylinderGeometry(1, 1, .075, 32), dark, 'RubberFloor'); floor.scale.set(.69, 1, 1.35); floor.position.set(0, .035, .08);
    for (let i = -4; i <= 4; i++) box(1.16, .018, .018, 0, .084, i * .25, dark, 'FloorRib');
    // Foot stretcher stays aligned with the rig's fixed ankles (±.11, .16, .66),
    // compensating for the inflatable hull's narrower, longer proportions.
    const brace = mat(0x79838b, .4), footpad = mat(0x41484e), webbing = mat(0x171b20);
    box(1.48, .09, .12, 0, .14, .70 / 1.15, brace, 'FootBraceCrossbar');
    for (const side of [-1, 1]) {
      box(.16, .14, .23, side * .66, .14, .70 / 1.15, dark, 'FootBraceMount');
      const x = side * .11 / .86;
      const plate = box(.20 / .86, .035, .35 / 1.15, x, .235, .79 / 1.15, footpad, 'AngledFootrest');
      plate.rotation.x = -Math.PI / 5;
      box(.21 / .86, .065, .035, x, .15, .64 / 1.15, dark, 'HeelStop');
      // Wide webbing loops over the instep, with a contrasting adjustment buckle.
      tube([v(x - .105 / .86, .23, .79 / 1.15), v(x - .075 / .86, .31, .79 / 1.15),
        v(x, .345, .79 / 1.15), v(x + .075 / .86, .31, .79 / 1.15),
        v(x + .105 / .86, .23, .79 / 1.15)], .023, webbing, 'FootStrap');
      box(.055, .025, .06, x + side * .075 / .86, .315, .79 / 1.15, brace, 'FootStrapBuckle');
    }
    tube(Array.from({ length: 65 }, (_, i) => { const a = i / 64 * Math.PI * 2; return v(1.025 * Math.sin(a), .20, .08 + 1.70 * Math.cos(a)); }), .024, dark, 'PerimeterLifeline', true);
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2;
      tube(Array.from({ length: 25 }, (_, j) => point(a, j / 24 * Math.PI * 2).add(v(Math.sin(a) * .003, .003, Math.cos(a) * .003))), .007, red[1], 'WeldedSeam', true);
      const ring = mesh(new T.TorusGeometry(.058, .014, 6, 12), dark, 'RopeEyelet'); ring.position.set(1.018 * Math.sin(a), .22, .08 + 1.69 * Math.cos(a)); ring.rotation.y = a;
    }
    box(.30, .21, .12, 0, .04, 1.77, dark, 'BowRubberPatch');
    for (const side of [-1, 1]) tube([v(side * .87, .31, .49 / 1.15), v(side * .92 / .86, .48, .49 / 1.15)], .035, dark, 'OarlockMount');
  }
  const removePaddles = style === 'duck' || style === 'inflatable' ? fitThemedPaddles(parent, style) : undefined;
  return () => {
    removePaddles?.();
    removeNovelty?.();
    group.removeFromParent();
    hidden.forEach(obj => { obj.visible = true; });
    replaced.forEach(({ mesh, material }) => { mesh.material = material; });
    reshaped.forEach(({ mesh, geometry }) => { mesh.geometry.dispose(); mesh.geometry = geometry; });
    group.traverse(obj => { if ((obj as T.Mesh).isMesh) (obj as T.Mesh).geometry.dispose(); });
    materials.forEach(material => material.dispose());
  };
}
