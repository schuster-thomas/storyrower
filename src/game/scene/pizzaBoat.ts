import * as T from 'three';

/** Baked dough, sauce and mozzarella are separate layers around a usable rowing cockpit. */
export function buildPizzaBoat(group: T.Group) {
  const materials: T.Material[] = [], textures: T.Texture[] = [];
  const hash = (x: number, y: number) => {
    const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return n - Math.floor(n);
  };
  const noise = (x: number, y: number) => {
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy;
    const u = fx * fx * (3 - 2 * fx), w = fy * fy * (3 - 2 * fy);
    return T.MathUtils.lerp(T.MathUtils.lerp(hash(ix, iy), hash(ix + 1, iy), u),
      T.MathUtils.lerp(hash(ix, iy + 1), hash(ix + 1, iy + 1), u), w);
  };
  const texture = (kind: 'crust' | 'crumb' | 'cheese' | 'salami') => {
    const size = 128, data = new Uint8Array(size * size * 4);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const broad = noise(x / 13, y / 13), fine = noise(x / 2.5, y / 2.5);
      let rgb: number[];
      if (kind === 'crust') {
        const toast = T.MathUtils.smoothstep(broad * .72 + fine * .28, .62, .89);
        rgb = [226 - toast * 110, 159 - toast * 96, 78 - toast * 61];
      } else if (kind === 'crumb') {
        const pore = fine < .24 ? T.MathUtils.smoothstep(.24 - fine, 0, .14) : 0;
        rgb = [236 - pore * 56 + broad * 8, 198 - pore * 66 + broad * 9, 135 - pore * 57 + broad * 12];
      } else if (kind === 'cheese') {
        const brown = T.MathUtils.smoothstep(broad, .59, .84);
        rgb = [250 - brown * 86, 220 - brown * 125, 146 - brown * 105];
      } else {
        const fat = fine > .73, spice = hash(x, y) > .975;
        rgb = fat ? [237, 177, 128] : spice ? [99, 39, 24] : [173 + broad * 42, 48 + broad * 31, 33 + broad * 21];
      }
      const offset = (y * size + x) * 4, grain = (fine - .5) * 13;
      for (let channel = 0; channel < 3; channel++) data[offset + channel] = Math.max(0, Math.min(255, rgb[channel] + grain));
      data[offset + 3] = 255;
    }
    const map = new T.DataTexture(data, size, size); map.colorSpace = T.SRGBColorSpace;
    map.wrapS = map.wrapT = T.RepeatWrapping; map.magFilter = T.LinearFilter;
    map.minFilter = T.LinearMipmapLinearFilter; map.generateMipmaps = true; map.needsUpdate = true;
    textures.push(map); return map;
  };
  const mat = (color: number, roughness: number, map?: T.Texture) => {
    const material = new T.MeshStandardMaterial({ color, roughness, map,
      bumpMap: map, bumpScale: map ? .008 : 0 });
    materials.push(material); return material;
  };
  const crustMap = texture('crust'), crumbMap = texture('crumb'), cheeseMap = texture('cheese'), salamiMap = texture('salami');
  const dough = mat(0xffffff, .85, crustMap), cheese = mat(0xffffff, .43, cheeseMap);
  const crumb = mat(0xffffff, .9, crumbMap);
  const sauce = mat(0xa72e1e, .65), salami = mat(0xffffff, .40, salamiMap), salamiEdge = mat(0x8b3425, .65);
  const interior = mat(0xba874e, .86), basil = mat(0x3b742b, .6), pepper = mat(0x6c9439, .55);
  const v = (x: number, y: number, z: number) => new T.Vector3(x, y, z);
  const mesh = (geometry: T.BufferGeometry, material: T.Material | T.Material[], name: string) => {
    const part = new T.Mesh(geometry, material); part.name = name; group.add(part); return part;
  };
  const tube = (points: T.Vector3[], radius: number, material: T.Material, name: string) =>
    mesh(new T.TubeGeometry(new T.CatmullRomCurve3(points), Math.max(16, points.length * 3), radius, 8, false), material, name);
  const cockpit = (rx: number, rz: number) => {
    const path = new T.Path(); path.absellipse(0, -.13, rx, rz, 0, Math.PI * 2, true, 0); return path;
  };
  const outline = (inset: number, melted: boolean) => {
    const shape = new T.Shape();
    shape.moveTo(-1.08 + inset, -1.97 + inset);
    shape.quadraticCurveTo(0, -2.15 + inset, 1.08 - inset, -1.97 + inset);
    for (let i = 1; i <= 40; i++) {
      const t = i / 40, ripple = melted ? Math.sin(i * 1.9) * .012 * Math.sin(t * Math.PI) : 0;
      shape.lineTo((1.08 - inset) * (1 - t) + ripple, -1.97 + inset + (4.1 - inset * 2) * t);
    }
    for (let i = 39; i >= 0; i--) {
      const t = i / 40, ripple = melted ? Math.sin(i * 2.3) * .014 * Math.sin(t * Math.PI) : 0;
      shape.lineTo(-(1.08 - inset) * (1 - t) + ripple, -1.97 + inset + (4.1 - inset * 2) * t);
    }
    shape.closePath(); return shape;
  };
  const layer = (shape: T.Shape, height: number, depth: number, material: T.Material, name: string, bevel: number, sideMaterial?: T.Material) => {
    const geometry = new T.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelSize: bevel,
      bevelThickness: bevel, bevelSegments: 2, curveSegments: 32 });
    geometry.rotateX(Math.PI / 2); geometry.translate(0, height, 0);
    // Project side UVs at a consistent scale instead of stretching the top's baked spots down the edge.
    const positions = geometry.getAttribute('position'), normals = geometry.getAttribute('normal'), uv = geometry.getAttribute('uv');
    for (let i = 0; i < positions.count; i++) {
      if (Math.abs(normals.getY(i)) < .7) uv.setXY(i, (positions.getX(i) + positions.getZ(i) * .65) * 1.6, positions.getY(i) * 4);
    }
    return mesh(geometry, sideMaterial ? [material, sideMaterial] : material, name);
  };
  const base = outline(0, false); base.holes.push(cockpit(.40, 1.10));
  layer(base, .265, .20, dough, 'NoveltyHull', .025, crumb);
  const sauceShape = outline(.035, true); sauceShape.holes.push(cockpit(.414, 1.115));
  layer(sauceShape, .294, .018, sauce, 'TomatoSauceLayer', .004);
  const top = outline(.065, true); top.holes.push(cockpit(.425, 1.125));
  layer(top, .325, .027, cheese, 'MeltedMozzarella', .009);
  const floor = new T.Shape(cockpit(.405, 1.105).getPoints(64));
  layer(floor, .145, .025, interior, 'DryPizzaCockpit', .003);

  // Hand-shaped, puffy cornicione instead of a straight uniform rail.
  const vertices: number[] = [], uvs: number[] = [], indices: number[] = [];
  const sections = 64, sides = 14;
  for (let i = 0; i <= sections; i++) {
    const t = i / sections, x = -1.02 + 2.04 * t;
    const radius = .153 + .010 * Math.sin(t * 21) + .006 * Math.cos(t * 43);
    for (let j = 0; j <= sides; j++) {
      const a = j / sides * Math.PI * 2, puff = radius * (1 + .025 * Math.sin(j * 3 + i * .7));
      vertices.push(x, .365 + Math.cos(a) * puff, -1.96 - Math.sin(t * Math.PI) * .09 + Math.sin(a) * puff * 1.18);
      uvs.push(t * 2.5, j / sides);
      if (i < sections && j < sides) {
        const k = i * (sides + 1) + j, n = k + sides + 1;
        indices.push(k, k + 1, n, k + 1, n + 1, n);
      }
    }
  }
  const crust = new T.BufferGeometry(); crust.setAttribute('position', new T.Float32BufferAttribute(vertices, 3));
  crust.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2)); crust.setIndex(indices); crust.computeVertexNormals();
  mesh(crust, dough, 'PuffedBakedCrust');
  for (const side of [-1, 1]) {
    // Rounded ends turn gently into the slice edges, avoiding exposed tube openings.
    const corner = mesh(new T.SphereGeometry(1, 20, 14), dough, 'RoundedCrustCorner');
    corner.position.set(side * 1.015, .365, -1.96); corner.scale.set(.11, .15, .177);
    const edge = Array.from({ length: 49 }, (_, i) => {
      const t = i / 48, z = -1.94 + t * 4.04;
      const width = 1.08 * (1 - (z + 1.97) / 4.1);
      return v(side * (width - .014), .245 + .008 * Math.sin(t * 33), z);
    });
    tube(edge, .026, dough, 'GoldenBakedEdge');
  }

  const topping = (x: number, z: number, r: number, seed: number) => {
    const positions: number[] = [], uv: number[] = [], triangles: number[] = [];
    const rings = 4, segments = 24;
    for (let ring = 0; ring <= rings; ring++) for (let j = 0; j <= segments; j++) {
      const a = j / segments * Math.PI * 2, t = ring / rings;
      const irregular = 1 + .045 * Math.sin(a * 5 + seed) + .025 * Math.cos(a * 9 + seed);
      positions.push(Math.cos(a) * r * t * irregular,
        .006 + Math.pow(t, 5) * (.025 + .007 * Math.sin(a * 3 + seed)), Math.sin(a) * r * t * irregular);
      uv.push(.5 + Math.cos(a) * t * .5, .5 + Math.sin(a) * t * .5);
      if (ring < rings && j < segments) {
        const k = ring * (segments + 1) + j, n = k + segments + 1;
        triangles.push(k, k + 1, n, k + 1, n + 1, n);
      }
    }
    const geometry = new T.BufferGeometry(); geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); geometry.setIndex(triangles); geometry.computeVertexNormals();
    const part = mesh(geometry, salami, 'CuppedPepperoni'); part.position.set(x, .333, z); part.rotation.y = seed;
    const edge = Array.from({ length: 49 }, (_, i) => {
      const a = i / 48 * Math.PI * 2, radius = r * (1 + .045 * Math.sin(a * 5 + seed) + .025 * Math.cos(a * 9 + seed));
      return v(Math.cos(a) * radius, .031 + .007 * Math.sin(a * 3 + seed), Math.sin(a) * radius);
    });
    const rim = tube(edge, .008, salamiEdge, 'CrispedPepperoniEdge'); rim.position.copy(part.position); rim.rotation.y = seed;
  };
  // Irregular spacing and size keep the toppings from looking like a repeated railing.
  const toppings = [[-.72, -1.57, .15], [.61, -1.49, .14], [-.60, -.94, .13], [.54, -.75, .12],
    [-.49, -.32, .12], [.42, .05, .10], [-.36, .42, .105], [.24, .76, .085], [-.07, 1.22, .14], [.025, 1.70, .075]];
  toppings.forEach(([x, z, r], i) => topping(x, z, r, i * 1.71));
  // Soft cheese pools, short drips and scattered herbs, rather than long rigid spikes.
  for (let i = 0; i < 8; i++) {
    const z = -1.45 + i * .43, side = i % 2 ? 1 : -1, x = side * 1.08 * (1 - (z + 1.97) / 4.1);
    tube([v(x - side * .045, .326, z), v(x, .29, z + .018), v(x + side * .006, .18 + (i % 3) * .028, z + .035)], .025, cheese, 'SoftCheeseDrip');
    const leaf = mesh(new T.SphereGeometry(1, 10, 6), basil, 'BasilLeaf');
    leaf.scale.set(.035, .008, .075); leaf.position.set(x - side * .06, .341, z + .16); leaf.rotation.y = i * 2.1;
  }
  for (const [x, z] of [[-.37, -.66], [.63, -1.12], [-.15, 1.49]]) {
    const green = mesh(new T.TorusGeometry(.055, .011, 6, 16, Math.PI * 1.45), pepper, 'RoastedGreenPepper');
    green.rotation.set(Math.PI / 2, .1, z); green.position.set(x, .342, z);
  }
  return () => { materials.forEach(material => material.dispose()); textures.forEach(map => map.dispose()); };
}
