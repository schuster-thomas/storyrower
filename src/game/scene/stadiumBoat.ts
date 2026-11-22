import * as T from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** A miniature football stadium fitted around the shared rower's fixed seat, feet and pins. */
export function buildStadiumBoat(group: T.Group, rig: T.Object3D) {
  const materials: T.Material[] = [], extra: T.Group[] = [], hidden: T.Object3D[] = [];
  const mat = (color: number, roughness = .6, metalness = 0) => {
    const material = new T.MeshStandardMaterial({ color, roughness, metalness });
    materials.push(material); return material;
  };
  const concrete = mat(0xb0b2b3, .96), rim = mat(0xc7c8c5, .93), interior = mat(0x73797b, .92);
  const recess = mat(0x555c60, .95);
  const concretePixels = new Uint8Array(128 * 128 * 4);
  for (let i = 0; i < 128 * 128; i++) {
    const sample = Math.sin(i * 127.1) * 43758.5453;
    const gray = 224 + (sample - Math.floor(sample)) * 31;
    concretePixels.set([gray, gray, gray, 255], i * 4);
  }
  const concreteTexture = new T.DataTexture(concretePixels, 128, 128);
  concreteTexture.colorSpace = T.SRGBColorSpace; concreteTexture.wrapS = concreteTexture.wrapT = T.RepeatWrapping;
  concreteTexture.magFilter = concreteTexture.minFilter = T.LinearFilter; concreteTexture.needsUpdate = true;
  for (const material of [concrete, rim]) {
    material.map = concreteTexture; material.bumpMap = concreteTexture; material.bumpScale = .003;
  }
  const red = mat(0xe83d45), blue = mat(0x2872c5), yellow = mat(0xffd125);
  const white = mat(0xfffdf0), steel = mat(0x9caeba, .3, .65), rubber = mat(0x252c32);
  const green = mat(0x418934, .95), lightGreen = mat(0x519740, .95);
  const v = (x: number, y: number, z: number) => new T.Vector3(x, y, z);
  const mesh = (geometry: T.BufferGeometry, material: T.Material | T.Material[], name: string, parent: T.Object3D = group) => {
    const part = new T.Mesh(geometry, material); part.name = name; parent.add(part); return part;
  };
  const box = (x: number, y: number, z: number, w: number, h: number, d: number, material: T.Material, name: string) => {
    const part = mesh(new T.BoxGeometry(w, h, d), material, name); part.position.set(x, y, z); return part;
  };
  const tube = (points: T.Vector3[], radius: number, material: T.Material, name: string) =>
    mesh(new T.TubeGeometry(new T.CatmullRomCurve3(points), Math.max(12, points.length * 3), radius, 8, false), material, name);
  const signedPower = (value: number, exponent: number) => Math.sign(value) * Math.abs(value) ** exponent;
  const outline = (a: number, x: number, z: number) => v(x * signedPower(Math.sin(a), .60), 0, z * signedPower(Math.cos(a), .60));

  // A closed structural ring with an open, dry pitch inset, rather than a solid slab.
  const stations = 96, vertices: number[] = [], indices: number[] = [], uvs: number[] = [];
  // The exterior flares out with the seating tiers: a stadium bowl on a narrow base.
  // The interior shelf stays below the seats so their pans and backs remain fully visible.
  const profile = [[1.02, 1.96, .44], [.79, 1.73, .045], [.76, 1.70, -.025],
    [.70, 1.66, .145], [.70, 1.66, .225], [.95, 1.89, .225], [.95, 1.89, .44]];
  for (let i = 0; i <= stations; i++) for (const [x, z, y] of profile) {
    const p = outline(i / stations * Math.PI * 2, x, z); vertices.push(p.x, y, p.z); uvs.push(i / stations * 12, y * 4);
  }
  const hull = new T.BufferGeometry();
  for (let band = 0; band < profile.length; band++) {
    const start = indices.length;
    for (let i = 0; i < stations; i++) {
      const a = i * profile.length + band, b = i * profile.length + (band + 1) % profile.length;
      indices.push(a, b, a + profile.length, b, b + profile.length, a + profile.length);
    }
    hull.addGroup(start, indices.length - start, band === 0 || band === 1 ? 0 : band === 6 ? 1 : 2);
  }
  hull.setAttribute('position', new T.Float32BufferAttribute(vertices, 3)); hull.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2)); hull.setIndex(indices); hull.computeVertexNormals();
  mesh(hull, [concrete, rim, interior], 'StadiumHull');
  const facadePoint = (a: number, y: number, inset = 0) => {
    const t = (y - .045) / (.44 - .045), p = outline(a, .79 + .23 * t + inset, 1.73 + .23 * t + inset);
    p.y = y; return p;
  };
  const facadePanels: T.BufferGeometry[] = [], buttresses: T.BufferGeometry[] = [];
  for (let bay = 0; bay < 40; bay++) {
    const a = bay / 40 * Math.PI * 2, half = Math.PI / 40 * .70;
    const corners = [facadePoint(a - half, .12, .006), facadePoint(a + half, .12, .006),
      facadePoint(a + half, .35, .006), facadePoint(a - half, .35, .006)];
    const panel = new T.BufferGeometry(); panel.setAttribute('position', new T.Float32BufferAttribute(corners.flatMap(p => p.toArray()), 3));
    panel.setIndex([0, 2, 1, 0, 3, 2]); panel.computeVertexNormals(); facadePanels.push(panel);
    const support = new T.TubeGeometry(new T.LineCurve3(facadePoint(a - Math.PI / 40, .055, .012), facadePoint(a - Math.PI / 40, .435, .012)), 1, .019, 4, false);
    buttresses.push(support);
  }
  recess.side = T.DoubleSide;
  const panels = mergeGeometries(facadePanels), columns = mergeGeometries(buttresses);
  if (panels) mesh(panels, recess, 'RecessedConcreteBays');
  if (columns) mesh(columns, rim, 'SlopedStadiumButtresses');
  [...facadePanels, ...buttresses].forEach(geometry => geometry.dispose());

  // The clipped striped pitch covers the water surface, including the rounded ends.
  for (let strip = 0; strip < 10; strip++) {
    const z0 = -1.65 + strip * .33, z1 = z0 + .33;
    const stripShape = new T.Shape();
    const halfWidth = (z: number) => .70 * Math.pow(Math.max(0, 1 - Math.abs(z / 1.66) ** (2 / .60)), .60 / 2);
    stripShape.moveTo(-halfWidth(z0), z0);
    for (let i = 0; i <= 8; i++) { const z = z0 + (z1 - z0) * i / 8; stripShape.lineTo(halfWidth(z), z); }
    for (let i = 8; i >= 0; i--) { const z = z0 + (z1 - z0) * i / 8; stripShape.lineTo(-halfWidth(z), z); }
    stripShape.closePath();
    const geometry = new T.ExtrudeGeometry(stripShape, { depth: .035, bevelEnabled: false });
    geometry.rotateX(Math.PI / 2); geometry.translate(0, .15, 0);
    mesh(geometry, strip % 2 ? green : lightGreen, 'PitchStripe');
  }
  const line = (x1: number, z1: number, x2: number, z2: number) =>
    tube([v(x1, .157, z1), v(x2, .157, z2)], .008, white, 'PitchMarking');
  const rectangle = (x: number, z0: number, z1: number) => {
    line(-x, z0, x, z0); line(-x, z1, x, z1); line(-x, z0, -x, z1); line(x, z0, x, z1);
  };
  rectangle(.53, -1.36, 1.36); line(-.53, 0, .53, 0);
  tube(Array.from({ length: 49 }, (_, i) => { const a = i / 48 * Math.PI * 2; return v(Math.cos(a) * .28, .157, Math.sin(a) * .28); }), .008, white, 'CenterCircle');
  const penaltyHalfWidth = .33;
  for (const side of [-1, 1]) {
    rectangle(penaltyHalfWidth, side * .92, side * 1.36); rectangle(.18, side * 1.17, side * 1.36);
  }

  // Batch each team's seats and backrests into one mesh to keep tablet draw calls low.
  for (const side of [-1, 1]) {
    const parts: T.BufferGeometry[] = [], steps: T.BufferGeometry[] = [];
    for (let tier = 0; tier < 2; tier++) for (let seat = 0; seat < 13; seat++) {
      const z = -1.38 + seat * .23;
      const curveAt = (s: number) => Math.pow(1 - Math.abs(s / 1.96) ** (2 / .60), .60 / 2);
      const radius = .755 + tier * .135, x = side * radius * curveAt(z), y = .275 + tier * .080;
      const angle = Math.atan(side * radius * (curveAt(z + .005) - curveAt(z - .005)) / .01);
      const place = (geometry: T.BufferGeometry, dx = 0, dy = 0, dz = 0) =>
        geometry.translate(dx, dy, dz).rotateY(angle).translate(x, y, z);
      parts.push(place(new T.BoxGeometry(.105, .028, .155)));
      const back = new T.Shape();
      back.moveTo(-.077, 0); back.lineTo(.077, 0); back.lineTo(.077, .060);
      back.quadraticCurveTo(.077, .085, .052, .085); back.lineTo(-.052, .085);
      back.quadraticCurveTo(-.077, .085, -.077, .060); back.closePath();
      const backGeometry = new T.ExtrudeGeometry(back, { depth: .018, bevelEnabled: true, bevelSize: .004, bevelThickness: .003, bevelSegments: 1, curveSegments: 3 });
      backGeometry.rotateY(Math.PI / 2);
      parts.push(place(backGeometry, side * .044, .012));
      steps.push(place(new T.BoxGeometry(.135, .045 + tier * .08, .22), 0, -.038 - tier * .04));
    }
    // Extruded backs are non-indexed; normalize the indexed seat pans before merging.
    const normalized = parts.map(part => part.index ? part.toNonIndexed() : part);
    const geometry = mergeGeometries(normalized); if (geometry) mesh(geometry, side < 0 ? red : blue, side < 0 ? 'RedGrandstand' : 'BlueGrandstand');
    const terraces = mergeGeometries(steps); if (terraces) mesh(terraces, concrete, 'SteppedSeatingTerraces');
    parts.forEach(part => part.dispose());
    normalized.forEach((part, i) => { if (part !== parts[i]) part.dispose(); });
    steps.forEach(part => part.dispose());
  }

  // A football goal's 3:1 opening: broad, low and square-cornered, with a deep net.
  const goalHalfWidth = penaltyHalfWidth, goalBase = .16, goalTop = goalBase + goalHalfWidth * 2 / 3, goalBackTop = goalTop - .025, goalFrontZ = -1.32, goalBackZ = -1.50;
  for (const x of [-goalHalfWidth, goalHalfWidth]) {
    tube([v(x, goalBase, goalFrontZ), v(x, goalTop, goalFrontZ)], .012, white, 'GoalPost');
    tube([v(x, goalBase, goalBackZ), v(x, goalBackTop, goalBackZ)], .007, white, 'GoalBack');
    tube([v(x, goalBase, goalFrontZ), v(x, goalBase, goalBackZ)], .007, white, 'GoalGroundSupport');
    tube([v(x, goalTop, goalFrontZ), v(x, goalBackTop, goalBackZ)], .007, white, 'GoalNetSupport');
  }
  tube([v(-goalHalfWidth, goalTop, goalFrontZ), v(goalHalfWidth, goalTop, goalFrontZ)], .012, white, 'GoalCrossbar');
  tube([v(-goalHalfWidth, goalBackTop, goalBackZ), v(goalHalfWidth, goalBackTop, goalBackZ)], .007, white, 'GoalBack');
  // Equal mesh spacing and gentle slack make the panels read as fabric, not a cage.
  const cords: T.BufferGeometry[] = [];
  const addCord = (points: T.Vector3[]) => {
    cords.push(new T.TubeGeometry(new T.CatmullRomCurve3(points), Math.max(12, points.length * 2), .00135, 4, false));
  };
  const grid = (columns: number, rows: number, point: (u: number, w: number) => T.Vector3) => {
    for (let i = 1; i < columns; i++) addCord(Array.from({ length: rows + 1 }, (_, j) => point(i / columns, j / rows)));
    for (let j = 1; j < rows; j++) addCord(Array.from({ length: columns + 1 }, (_, i) => point(i / columns, j / rows)));
  };
  const meshColumns = Math.round(goalHalfWidth * 2 / .034), rows = Math.round((goalBackTop - goalBase) / .034);
  const depthRows = Math.round((goalFrontZ - goalBackZ) / .034);
  const roofY = (t: number) => T.MathUtils.lerp(goalTop, goalBackTop, t);
  grid(meshColumns, rows, (u, w) => v(T.MathUtils.lerp(-goalHalfWidth, goalHalfWidth, u),
    T.MathUtils.lerp(goalBase, goalBackTop, w), goalBackZ - .010 * Math.sin(Math.PI * u) * Math.sin(Math.PI * w)));
  grid(meshColumns, depthRows, (u, t) => v(T.MathUtils.lerp(-goalHalfWidth, goalHalfWidth, u),
    roofY(t) - .007 * Math.sin(Math.PI * u) * Math.sin(Math.PI * t), T.MathUtils.lerp(goalFrontZ, goalBackZ, t)));
  for (const side of [-1, 1]) grid(depthRows, rows, (t, w) => v(
    side * (goalHalfWidth + .006 * Math.sin(Math.PI * t) * Math.sin(Math.PI * w)),
    T.MathUtils.lerp(goalBase, roofY(t), w), T.MathUtils.lerp(goalFrontZ, goalBackZ, t)));
  addCord([v(-goalHalfWidth, goalBase, goalBackZ), v(0, goalBase, goalBackZ), v(goalHalfWidth, goalBase, goalBackZ)]);
  const netMaterial = mat(0xe5e3d9, .85);
  const netGeometry = mergeGeometries(cords); if (netGeometry) mesh(netGeometry, netMaterial, 'GoalNet');
  cords.forEach(cord => cord.dispose());
  yellow.side = T.DoubleSide;
  for (const side of [-1, 1]) for (const end of [-1, 1]) {
    const x = side * .55, z = end * 1.38;
    tube([v(x, .15, z), v(x, .375, z)], .009, white, 'CornerFlagPole');
    const flag = new T.BufferGeometry(); flag.setAttribute('position', new T.Float32BufferAttribute([
      x, .375, z, x - side * .12, .345, z, x, .305, z], 3)); flag.computeVertexNormals();
    mesh(flag, yellow, 'CornerFlag');
  }

  // Visible support under the original rig's fixed ankles at ±.11, .16, .66.
  box(0, .145, .70, 1.20, .09, .12, steel, 'FootBraceCrossbar');
  for (const side of [-1, 1]) {
    box(side * .53, .165, .70, .14, .12, .21, interior, 'FootBraceMount');
    const x = side * .11;
    const plate = box(x, .235, .79, .20, .035, .35, rubber, 'AngledFootrest'); plate.rotation.x = -Math.PI / 5;
    box(x, .17, .64, .21, .065, .035, steel, 'HeelStop');
    tube([v(x - .105, .23, .79), v(x - .075, .31, .79), v(x, .345, .79),
      v(x + .075, .31, .79), v(x + .105, .23, .79)], .022, rubber, 'FootStrap');
    box(x + side * .075, .315, .79, .045, .025, .055, steel, 'FootStrapBuckle');
    // Stadium-mounted riggers connect directly to the existing animated oar pins.
    tube([v(side * .79, .32, .31), v(side * .92, .48, .49), v(side * .79, .32, .67)], .026, steel, 'StadiumOarlock');
    box(side * .79, .31, .49, .14, .055, .48, steel, 'StadiumOarlockMount');
  }

  for (const side of ['R', 'L']) {
    const feather = rig.getObjectByName('Feather' + side); if (!feather) continue;
    feather.traverse(obj => { if ((obj as T.Mesh).isMesh && /^Blade/.test(obj.name) && obj.visible) { hidden.push(obj); obj.visible = false; } });
    const paddle = new T.Group(); paddle.name = 'RefereeCardPaddle'; paddle.position.set(1.75, -.02, 0); feather.add(paddle); extra.push(paddle);
    const shape = new T.Shape();
    shape.moveTo(-.29, -.145); shape.lineTo(.27, -.145); shape.quadraticCurveTo(.30, -.145, .30, -.115);
    shape.lineTo(.30, .115); shape.quadraticCurveTo(.30, .145, .27, .145); shape.lineTo(-.29, .145);
    shape.quadraticCurveTo(-.32, .145, -.32, .115); shape.lineTo(-.32, -.115); shape.quadraticCurveTo(-.32, -.145, -.29, -.145); shape.closePath();
    const geometry = new T.ExtrudeGeometry(shape, { depth: .028, bevelEnabled: true, bevelSize: .008, bevelThickness: .005, bevelSegments: 1, curveSegments: 4 }); geometry.translate(0, 0, -.014);
    mesh(geometry, side === 'R' ? yellow : red, side === 'R' ? 'YellowCardBlade' : 'RedCardBlade', paddle);
  }
  return () => {
    hidden.forEach(obj => { obj.visible = true; });
    for (const paddle of extra) {
      paddle.removeFromParent(); paddle.traverse(obj => { if ((obj as T.Mesh).isMesh) (obj as T.Mesh).geometry.dispose(); });
    }
    materials.forEach(material => material.dispose()); concreteTexture.dispose();
  };
}
