import * as T from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** A single hollow tree trunk, with a dry carved floor and branch-mounted oak-leaf oars. */
export function buildLogBoat(group: T.Group, rig: T.Object3D) {
  const materials: T.Material[] = [], textures: T.Texture[] = [], attachments: T.Group[] = [];
  const hidden: T.Object3D[] = [], repainted: { part: T.Mesh; material: T.Material | T.Material[] }[] = [];
  const v = (x: number, y: number, z: number) => new T.Vector3(x, y, z);
  const hash = (x: number, y: number) => { const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return n - Math.floor(n); };
  const texture = (rings: boolean) => {
    const size = 256, pixels = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      let rgb: number[];
      if (rings) {
        const dx = (x - 123) / 128, dy = (y - 137) / 128, a = Math.atan2(dy, dx);
        const radius = Math.hypot(dx, dy) * (1 + .018 * Math.sin(a * 7) + .012 * Math.cos(a * 11));
        const line = Math.pow((1 + Math.sin(radius * 112 + Math.sin(radius * 23) * .7)) / 2, 13);
        rgb = [207 - line * 63, 157 - line * 62, 94 - line * 43];
      } else {
        const ridge = Math.sin(x * .31 + Math.sin(y * .037 + x * .012) * 1.6);
        const crack = T.MathUtils.smoothstep(-ridge, .65, .95);
        const grain = hash(Math.floor(x / 5), Math.floor(y / 23)) * 21 + hash(x, y) * 12;
        rgb = [111 + grain - crack * 49, 70 + grain * .65 - crack * 36, 39 + grain * .43 - crack * 21];
      }
      const offset = (y * size + x) * 4;
      pixels.set([...rgb.map(c => Math.max(0, Math.min(255, c + (hash(x, y) - .5) * 9))), 255], offset);
    }
    const map = new T.DataTexture(pixels, size, size); map.colorSpace = T.SRGBColorSpace;
    map.wrapS = map.wrapT = T.RepeatWrapping; map.magFilter = T.LinearFilter;
    map.minFilter = T.LinearMipmapLinearFilter; map.generateMipmaps = true; map.needsUpdate = true;
    textures.push(map); return map;
  };
  const mat = (color: number, roughness = .8, map?: T.Texture) => {
    const material = new T.MeshStandardMaterial({ color, roughness, map, bumpMap: map, bumpScale: map ? .009 : 0 });
    materials.push(material); return material;
  };
  const bark = mat(0xffffff, .95, texture(false)), cut = mat(0xffffff, .85, texture(true));
  const wood = mat(0xc69760), darkWood = mat(0x93633e), moss = mat(0x557c2b), mossLight = mat(0x7d9338);
  const stem = mat(0xead6ad), cap = mat(0xc87928), leafGreen = mat(0x538c28, .6), vein = mat(0xc1b45b);
  const mesh = (geometry: T.BufferGeometry, material: T.Material | T.Material[], name: string, parent: T.Object3D = group) => {
    const part = new T.Mesh(geometry, material); part.name = name; parent.add(part); return part;
  };
  const tube = (points: T.Vector3[], radius: number, material: T.Material, name: string, parent: T.Object3D = group) =>
    mesh(new T.TubeGeometry(new T.CatmullRomCurve3(points), Math.max(12, points.length * 3), radius, 8, false), material, name, parent);
  const box = (x: number, y: number, z: number, w: number, h: number, d: number, material: T.Material, name: string) => {
    const part = mesh(new T.BoxGeometry(w, h, d), material, name); part.position.set(x, y, z); return part;
  };
  const radiusAt = (z: number) => .69 * (1 + .022 * Math.sin(z * 4) + .012 * Math.cos(z * 9));
  const openingAt = (z: number) => .47 * Math.sqrt(Math.max(0, 1 - Math.abs(z / (z > 0 ? 1.70 : 1.38)) ** 6));
  const stations = 96, sides = 48, ringSize = sides + 5;
  const positions: number[] = [], uvs: number[] = [], indices: number[] = [];
  for (let i = 0; i <= stations; i++) {
    const z = -1.87 + i / stations * 3.74, radius = radiusAt(z), opening = openingAt(z);
    const start = Math.asin(opening / radius), edgeY = .13 + .51 * Math.cos(start);
    for (let j = 0; j <= sides; j++) {
      const a = start + (Math.PI * 2 - start * 2) * j / sides;
      const ridges = .009 * Math.sin(a * 23 + z * 1.2) + .005 * Math.cos(a * 11 - z * 2);
      positions.push((radius + ridges) * Math.sin(a), .13 + (.51 + ridges) * Math.cos(a), z);
      uvs.push(a / (Math.PI * 2) * 2, z * .4);
    }
    for (const [x, y] of [[-opening + Math.min(.045, opening * .3), edgeY - .025],
      [-opening * .86, .145], [opening * .86, .145], [opening - Math.min(.045, opening * .3), edgeY - .025]]) {
      positions.push(x, y, z); uvs.push(x * 2, z * .5);
    }
  }
  const geometry = new T.BufferGeometry();
  for (let band = 0; band < ringSize; band++) {
    const offset = indices.length;
    for (let i = 0; i < stations; i++) {
      const a = i * ringSize + band, b = i * ringSize + (band + 1) % ringSize;
      indices.push(a, a + ringSize, b, b, a + ringSize, b + ringSize);
    }
    geometry.addGroup(offset, indices.length - offset, band < sides ? 0 : 1);
  }
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3)); geometry.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices); geometry.computeVertexNormals(); mesh(geometry, [bark, wood], 'LogHull');
  for (const side of [-1, 1]) {
    const z = side * 1.875, radius = radiusAt(z);
    const end = mesh(new T.CircleGeometry(radius - .018, 64), cut, 'TreeGrowthRings');
    end.scale.y = .51 / radius; end.position.set(0, .13, z); if (side < 0) end.rotation.y = Math.PI;
    const outer = mesh(new T.RingGeometry(radius - .022, radius + .012, 64), bark, 'BarkEndRim');
    outer.scale.y = .51 / radius; outer.position.copy(end.position); outer.rotation.copy(end.rotation);
    for (let i = 0; i < 4; i++) {
      const a = .45 + i * 1.55, r = radius * (.67 + i * .035);
      tube([v(Math.sin(a) * r, .13 + Math.cos(a) * r * .51 / radius, z + side * .003),
        v(Math.sin(a + .018) * radius * .95, .13 + Math.cos(a + .018) * .485, z + side * .003)], .007, darkWood, 'EndGrainCrack');
    }
  }
  // Pale, carved opening edges contrast with the bark without covering the cut log ends.
  for (const side of [-1, 1]) {
    tube(Array.from({ length: 65 }, (_, i) => {
      const z = -1.38 + i / 64 * 3.08, opening = openingAt(z);
      return v(side * opening, .13 + .51 * Math.sqrt(1 - (opening / radiusAt(z)) ** 2), z);
    }), .018, wood, 'CarvedCockpitEdge');
    // Forked branch riggers penetrate the bark and support the original oar pivots.
    for (const z of [.22, .76]) tube([v(side * .57, .38, z), v(side * .76, .43, .49), v(side * .92, .48, .49)], .043, bark, 'BranchOarlock');
  }
  box(0, .19, -.45, .86, .065, .20, wood, 'CarvedLogSeat');
  box(0, .16, .70, .86, .08, .13, darkWood, 'LogFootBrace');
  for (const side of [-1, 1]) {
    const x = side * .11, plate = box(x, .235, .79, .20, .035, .35, darkWood, 'AngledFootrest'); plate.rotation.x = -Math.PI / 5;
    tube([v(x - .105, .23, .79), v(x - .07, .32, .79), v(x, .345, .79),
      v(x + .07, .32, .79), v(x + .105, .23, .79)], .020, darkWood, 'FootStrap');
  }
  // Merge small moss clumps by color so the decorative texture stays inexpensive on tablets.
  for (let shade = 0; shade < 2; shade++) {
    const clumps: T.BufferGeometry[] = [];
    for (let i = 0; i < 22; i++) {
      const z = i < 12 ? -1.62 + Math.sin(i * 2.3) * .14 : 1.77 + Math.sin(i * 2.3) * .035;
      const x = Math.sin(i * 3.1 + shade) * .40, y = .13 + .51 * Math.sqrt(1 - (x / radiusAt(z)) ** 2);
      clumps.push(new T.SphereGeometry(1, 10, 6).scale(.04 + hash(i, shade) * .03, .022, .055).translate(x, y + .009, z));
    }
    const merged = mergeGeometries(clumps); if (merged) mesh(merged, shade ? mossLight : moss, 'MossPatch');
    clumps.forEach(part => part.dispose());
  }
  for (const [x, z, size] of [[.40, -1.61, 1], [.51, -1.40, .65], [-.46, 1.55, .65]]) {
    const y = .13 + .51 * Math.sqrt(1 - (x / radiusAt(z)) ** 2);
    const stalk = mesh(new T.CylinderGeometry(.018 * size, .022 * size, .12 * size, 8), stem, 'MushroomStem'); stalk.position.set(x, y + .06 * size, z);
    const mushroom = mesh(new T.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), cap, 'MushroomCap');
    mushroom.scale.set(.10 * size, .065 * size, .10 * size); mushroom.position.set(x, y + .11 * size, z);
    const underside = mesh(new T.CircleGeometry(.10 * size, 16), stem, 'MushroomGills'); underside.rotation.x = Math.PI / 2; underside.position.copy(mushroom.position);
  }
  rig.traverse(obj => {
    if ((obj as T.Mesh).isMesh && /^(Shaft|Neck|Handle)([._]?\d+)*$/.test(obj.name)) {
      const part = obj as T.Mesh; repainted.push({ part, material: part.material }); part.material = wood;
    }
  });
  for (const side of ['R', 'L']) {
    const feather = rig.getObjectByName('Feather' + side); if (!feather) continue;
    feather.traverse(obj => { if ((obj as T.Mesh).isMesh && /^Blade/.test(obj.name) && obj.visible) { hidden.push(obj); obj.visible = false; } });
    const paddle = new T.Group(); paddle.name = 'OakLeafPaddle'; paddle.position.set(1.75, -.02, 0); feather.add(paddle); attachments.push(paddle);
    const leaf = new T.Shape(); leaf.moveTo(-.31, 0); leaf.quadraticCurveTo(-.23, -.05, -.21, -.05);
    leaf.quadraticCurveTo(-.25, -.13, -.15, -.12); leaf.quadraticCurveTo(-.18, -.20, -.07, -.17);
    leaf.quadraticCurveTo(-.06, -.25, .04, -.18); leaf.quadraticCurveTo(.10, -.25, .15, -.15);
    leaf.quadraticCurveTo(.24, -.17, .26, -.07); leaf.quadraticCurveTo(.35, -.07, .40, 0);
    leaf.quadraticCurveTo(.35, .07, .26, .07); leaf.quadraticCurveTo(.24, .17, .15, .15);
    leaf.quadraticCurveTo(.10, .25, .04, .18); leaf.quadraticCurveTo(-.06, .25, -.07, .17);
    leaf.quadraticCurveTo(-.18, .20, -.15, .12); leaf.quadraticCurveTo(-.25, .13, -.21, .05);
    leaf.quadraticCurveTo(-.23, .05, -.31, 0); leaf.closePath();
    const blade = new T.ExtrudeGeometry(leaf, { depth: .024, bevelEnabled: true, bevelSize: .006, bevelThickness: .005, bevelSegments: 1, curveSegments: 5 }); blade.translate(0, 0, -.012);
    mesh(blade, leafGreen, 'OakLeafBlade', paddle);
    for (const face of [-1, 1]) {
      tube([v(-.34, 0, face * .020), v(.05, 0, face * .020), v(.38, 0, face * .020)], .009, vein, 'LeafMidrib', paddle);
      for (let i = 0; i < 5; i++) for (const edge of [-1, 1]) {
        const x = -.18 + i * .095;
        tube([v(x, 0, face * .020), v(x + .07, edge * (.105 + Math.sin(i / 5 * Math.PI) * .055), face * .020)], .005, vein, 'OakLeafVein', paddle);
      }
    }
  }
  return () => {
    hidden.forEach(part => { part.visible = true; }); repainted.forEach(({ part, material }) => { part.material = material; });
    for (const paddle of attachments) { paddle.removeFromParent(); paddle.traverse(obj => { if ((obj as T.Mesh).isMesh) (obj as T.Mesh).geometry.dispose(); }); }
    materials.forEach(material => material.dispose()); textures.forEach(map => map.dispose());
  };
}
