import * as T from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildPizzaBoat } from './pizzaBoat';

type NoveltyStyle = 'duck' | 'banana' | 'bathtub' | 'pizza' | 'snail';

/** All hulls use the existing rower's seat, foot and oar coordinates. */
export function buildNoveltyBoat(group: T.Group, rig: T.Object3D, style: NoveltyStyle) {
  const materials = new Set<T.Material>();
  const extra: T.Object3D[] = [];
  const hidden: T.Object3D[] = [];
  let removePizza: (() => void) | undefined;
  const repainted: { mesh: T.Mesh; material: T.Material | T.Material[] }[] = [];
  const v = (x: number, y: number, z: number) => new T.Vector3(x, y, z);
  const mat = (color: number, roughness = .5, metalness = 0) => {
    const m = new T.MeshStandardMaterial({ color, roughness, metalness, flatShading: true });
    materials.add(m); return m;
  };
  const yellow = mat(0xffd32c), gold = mat(0xdfa82b, .26, .65), orange = mat(0xf58219);
  const white = mat(0xfffcf3, .28), foam = mat(0xf3faff, .6), black = mat(0x181c25);
  const wood = mat(0xc68a3b), pink = mat(0xf58caa), vanilla = mat(0xffdf9f), chocolate = mat(0x593023);
  const cherry = mat(0xe51d30, .26), wafer = mat(0xe9af5d), waffleLine = mat(0xb87830);
  const mesh = (geo: T.BufferGeometry, material: T.Material, name: string, parent: T.Object3D = group) => {
    const m = new T.Mesh(geo, material); m.name = name; parent.add(m); return m;
  };
  const ellipsoid = (x: number, y: number, z: number, sx: number, sy: number, sz: number, material: T.Material, name: string) => {
    const m = mesh(new T.SphereGeometry(1, 16, 10), material, name); m.position.set(x, y, z); m.scale.set(sx, sy, sz); return m;
  };
  const box = (x: number, y: number, z: number, w: number, h: number, d: number, material: T.Material, name: string) => {
    const m = mesh(new T.BoxGeometry(w, h, d), material, name); m.position.set(x, y, z); return m;
  };
  const tube = (points: T.Vector3[], radius: number, material: T.Material, name: string, parent: T.Object3D = group) =>
    mesh(new T.TubeGeometry(new T.CatmullRomCurve3(points), Math.max(12, points.length * 3), radius, 8, false), material, name, parent);

  /** Closed cross section: outside, base, inner wall and dry floor. */
  const hull = (width: number, length: number, center: number, rimY: number, material: T.Material, pointed = false, customWidth?: (t: number) => number) => {
    const stations = 48;
    const outline = customWidth ?? ((t: number) => width * Math.pow(Math.sin(Math.PI * t), pointed ? .8 : .4) + .012);
    const edgeY = (t: number) => rimY + (pointed ? .42 : .12) * Math.pow(Math.abs(2 * t - 1), 4);
    const vertices: number[] = [], indices: number[] = [];
    for (let i = 0; i <= stations; i++) {
      const t = i / stations, w = outline(t), z = center + (t - .5) * length, y = edgeY(t);
      const ring = [[w, y], [w * .90, -.03], [w * .55, -.16], [-w * .55, -.16], [-w * .90, -.03],
        [-w, y], [-w + Math.min(.095, w * .25), y - .025], [-w * .79, .14], [w * .79, .14], [w - Math.min(.095, w * .25), y - .025]];
      for (const [x, h] of ring) vertices.push(x, h, z);
      if (i === 0 || i === stations) {
        for (const triangle of T.ShapeUtils.triangulateShape(ring.map(([x, h]) => new T.Vector2(x, h)), [])) {
          const [a, b, c] = triangle.map(index => i * ring.length + index);
          indices.push(...(i === 0 ? [a, c, b] : [a, b, c]));
        }
      }
      if (i < stations) for (let j = 0; j < ring.length; j++) {
        const a = i * ring.length + j, b = i * ring.length + (j + 1) % ring.length;
        indices.push(a, b, a + ring.length, b, b + ring.length, a + ring.length);
      }
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(vertices, 3)); geometry.setIndex(indices); geometry.computeVertexNormals();
    // Interior and exterior remain visible at the pointed ends as well.
    (material as T.MeshStandardMaterial).side = T.DoubleSide;
    mesh(geometry, material, 'NoveltyHull');
    const rim = Array.from({ length: 97 }, (_, i) => {
      const t = i <= 48 ? i / 48 : (96 - i) / 48;
      return v((i <= 48 ? 1 : -1) * outline(t), edgeY(t), center + (t - .5) * length);
    });
    rim.push(rim[0].clone());
    tube(rim, .055, material, 'RoundedRim');
    return { outline, edgeY };
  };

  if (style === 'duck') {
    hull(.77, 3.3, -.10, .35, yellow);
    ellipsoid(0, .23, 1.40, .62, .43, .63, yellow, 'DuckHead');
    ellipsoid(0, .14, 1.99, .49, .14, .38, orange, 'DuckBeak');
    tube([v(-.42, .14, 2.10), v(0, .125, 2.29), v(.42, .14, 2.10)], .014, mat(0xbd5316), 'BeakSmile');
    for (const side of [-1, 1]) {
      const eye = ellipsoid(side * .35, .40, 1.88, .105, .14, .035, black, 'DuckEye'); eye.rotation.y = side * .32;
      ellipsoid(side * .35 - .02, .45, 1.915, .026, .04, .018, white, 'EyeHighlight');
      const wing = ellipsoid(side * .73, .23, .05, .22, .32, .73, yellow, 'DuckWing'); wing.rotation.z = side * -.15;
      tube([v(side * .73, .40, -.34), v(side * .85, .35, .05), v(side * .78, .32, .48)], .018, gold, 'WingFeathers');
    }
    ellipsoid(0, .25, -1.60, .25, .15, .38, yellow, 'DuckTail');
    for (const z of [-.65, .70]) box(0, .19, z, 1.12, .07, .18, wood, 'DuckBench');
  } else if (style === 'banana') {
    const { outline, edgeY } = hull(.72, 4.1, .10, .36, yellow, true);
    for (const side of [-1, 1]) {
      tube(Array.from({ length: 49 }, (_, i) => { const t = i / 48; return v(side * outline(t) * .67, -.10, .10 + (t - .5) * 4.1); }), .035, gold, 'BananaRidge');
      for (let i = 0; i < 4; i++) {
        const z = -.90 + i * .48;
        ellipsoid(side * .45, .33, z, .28, .25, .30, i % 2 ? vanilla : pink, 'IceCreamScoop');
        for (let j = 0; j < 4; j++) {
          const sprinkle = box(side * .45 + Math.cos(j * 2.3) * .15, .54 + (j % 2) * .025, z + Math.sin(j * 2.3) * .13, .065, .018, .024, [cherry, chocolate, white][j % 3], 'Sprinkle');
          sprinkle.rotation.y = j * 1.7;
        }
      }
      const drizzle = Array.from({ length: 33 }, (_, i) => { const t = .12 + i / 32 * .76; return v(side * outline(t) * .94, edgeY(t) + .035, .10 + (t - .5) * 4.1); });
      tube(drizzle, .045, chocolate, 'ChocolateSauce');
      for (let i = 0; i < 5; i++) {
        const t = .20 + i * .14, x = side * outline(t), z = .10 + (t - .5) * 4.1;
        tube([v(x, edgeY(t), z), v(x * 1.015, edgeY(t) - .12, z + .025), v(x * .99, edgeY(t) - .20 - (i % 2) * .08, z + .04)], .032, chocolate, 'ChocolateDrip');
      }
    }
    // Whipped cream and a cherry at the stern, behind the rower.
    ellipsoid(0, .49, -1.30, .48, .30, .45, pink, 'SternIceCream');
    const swirl = Array.from({ length: 121 }, (_, i) => {
      const t = i / 120, a = t * Math.PI * 7, r = .36 * (1 - t);
      return v(Math.cos(a) * r, .67 + t * .65, -1.30 + Math.sin(a) * r);
    });
    tube(swirl, .10, white, 'WhippedCreamSwirl');
    ellipsoid(0, 1.43, -1.30, .16, .16, .16, cherry, 'Cherry');
    tube([v(.03, 1.54, -1.30), v(.10, 1.76, -1.31), v(.25, 1.82, -1.30)], .018, cherry, 'CherryStem');
    ellipsoid(0, .68, 2.12, .10, .13, .18, chocolate, 'BananaTip');
  } else if (style === 'pizza') {
    removePizza = buildPizzaBoat(group);
  } else if (style === 'snail') {
    const body = mat(0xe5ba70), freckles = mat(0xc28d49), shell = mat(0xd7792f), spiral = mat(0xffc76a);
    hull(.70, 3.75, .10, .28, body);
    ellipsoid(0, .18, 1.57, .59, .26, .65, body, 'SnailHead');
    // Tilt the shell so its spiral also reads in the initial front view.
    const shellGroup = new T.Group(); shellGroup.name = 'SpiralShell';
    shellGroup.position.set(0, .77, -1.25); shellGroup.rotation.y = -.65; group.add(shellGroup);
    const shellBody = ellipsoid(0, 0, 0, .66, .85, .76, shell, 'SnailShell'); shellGroup.add(shellBody);
    for (const side of [-1, 1]) {
      const points = Array.from({ length: 129 }, (_, i) => {
        const t = i / 128, a = t * Math.PI * 4.5, r = .055 + t * .63;
        return v(side * (.66 * Math.sqrt(Math.max(.05, 1 - (r / .85) ** 2)) + .012),
          .77 + Math.sin(a) * r, -1.12 + Math.cos(a) * r * .94);
      });
      const shellSpiral = tube(points, .036, spiral, 'ShellSpiral');
      shellSpiral.position.set(0, -.77, 1.12); shellGroup.add(shellSpiral);
      for (let i = 0; i < 7; i++) {
        const z = -.85 + i * .40;
        ellipsoid(side * (.62 - Math.max(0, z - .5) * .12), .23, z, .045, .065, .055, freckles, 'SnailFreckle');
      }
      tube([v(side * .31, .32, 1.48), v(side * .39, .56, 1.47), v(side * .42, .78, 1.51)], .045, body, 'EyeStalk');
      ellipsoid(side * .42, .79, 1.52, .125, .14, .125, white, 'SnailEye');
      ellipsoid(side * .42, .80, 1.625, .065, .078, .026, black, 'SnailPupil');
      ellipsoid(side * .42 - .018, .83, 1.648, .018, .023, .008, white, 'SnailEyeHighlight');
    }
    // A recessed dark smile and two cheek marks give the snail a friendly expression.
    tube([v(-.18, .25, 2.18), v(0, .18, 2.235), v(.18, .25, 2.18)], .025, chocolate, 'SnailSmile');
    for (const z of [-.55, .70]) box(0, .18, z, 1.02, .065, .16, wood, 'SnailBench');
  } else {
    const { outline } = hull(.76, 3.45, .04, .46, white);
    // Low foam leaves the upper body, hands and the whole stroke visible.
    for (let i = 0; i < 60; i++) {
      const z = -1.40 + (i % 12) * .25, side = i % 2 ? 1 : -1;
      const width = outline((z - .04) / 3.45 + .5);
      const x = side * width * (.47 + (Math.sin(i * 5.3) + 1) * .075);
      const r = Math.min(.095 + (Math.sin(i * 7.9) + 1) * .035, width * .25);
      ellipsoid(x, .30 + Math.sin(i * 2.7) * .065, z, r, r, r, i % 3 ? foam : white, 'SoapBubble');
    }
    for (let i = 0; i < 12; i++) ellipsoid(Math.sin(i * 4) * .40, .26, 1.02 + (i % 3) * .14, .12, .10, .13, foam, 'BowFoam');
    // Gold claw feet, visible along the outside of the tub.
    for (const side of [-1, 1]) for (const z of [-1.10, 1.15]) {
      tube([v(side * .58, .24, z), v(side * .72, .15, z + .04), v(side * .70, .02, z + .16)], .065, gold, 'ClawFoot');
      ellipsoid(side * .70, .035, z + .17, .12, .07, .15, gold, 'ClawToes');
      ellipsoid(side * .65, .24, z, .10, .13, .10, gold, 'ClawMount');
    }
    // Brass mixer tap sits on the front rim, with two cross handles.
    for (const x of [-.22, .22]) {
      tube([v(x, .43, 1.40), v(x, .70, 1.40)], .04, gold, 'TapPillar');
      ellipsoid(x, .45, 1.40, .09, .035, .09, gold, 'TapBase');
      tube([v(x - .10, .69, 1.40), v(x + .10, .69, 1.40)], .024, gold, 'CrossHandle');
      tube([v(x, .69, 1.31), v(x, .69, 1.49)], .024, gold, 'CrossHandle');
    }
    tube([v(-.22, .58, 1.40), v(.22, .58, 1.40)], .045, gold, 'Mixer');
    tube([v(0, .58, 1.40), v(0, .83, 1.40), v(0, .88, 1.27), v(0, .77, 1.17)], .045, gold, 'CurvedSpout');
    // A miniature rubber duck among the bubbles.
    ellipsoid(.40, .40, .99, .15, .12, .19, yellow, 'RubberDuckBody');
    ellipsoid(.40, .55, 1.06, .105, .115, .11, yellow, 'RubberDuckHead');
    ellipsoid(.40, .53, 1.17, .075, .035, .065, orange, 'RubberDuckBeak');
    for (const side of [-1, 1]) ellipsoid(.40 + side * .067, .58, 1.13, .014, .02, .012, black, 'RubberDuckEye');
  }

  // The standard oar pivots stay fixed; short mounts bridge each novelty hull to them.
  for (const side of [-1, 1]) {
    if (style === 'pizza') {
      // Mount both struts on the actual sloping slice edges, rather than a generic hull width.
      for (const z of [.27, .71]) {
        const edgeX = 1.08 * (1 - (z + 1.97) / 4.1);
        tube([v(side * (edgeX - .025), .28, z), v(side * .92, .48, .49)], .032, wood, 'NoveltyOarlock');
        const mount = box(side * (edgeX - .025), .27, z, .10, .085, .18, wood, 'PizzaOarlockMount');
        mount.rotation.y = -side * Math.atan(1.08 / 4.1);
        for (const offset of [-.045, .045]) ellipsoid(side * (edgeX - .025), .318, z + offset, .012, .007, .012, gold, 'MountBolt');
      }
    } else {
      tube([v(side * .67, .36, .49), v(side * .92, .48, .49)], .032, style === 'bathtub' ? gold : wood, 'NoveltyOarlock');
    }
  }

  if (style !== 'duck') {
    rig.traverse(obj => {
      if (/^(Shaft|Neck|Handle)([._]?\d+)*$/.test(obj.name) && (obj as T.Mesh).isMesh) {
        const part = obj as T.Mesh; repainted.push({ mesh: part, material: part.material }); part.material = wood;
      }
    });
    // Each theme replaces the racing blades on the existing animated feather joints.
    for (const side of ['R', 'L']) {
      const feather = rig.getObjectByName('Feather' + side);
      if (!feather) continue;
      feather.traverse(obj => {
        if ((obj as T.Mesh).isMesh && /^Blade/.test(obj.name) && obj.visible) { hidden.push(obj); obj.visible = false; }
      });
      const paddle = new T.Group(); paddle.name = style === 'banana' ? 'WafflePaddle' : style === 'pizza' ? 'PizzaPeel' : style === 'snail' ? 'LeafPaddle' : 'BathBrush';
      paddle.position.set(1.75, -.02, 0); feather.add(paddle); extra.push(paddle);
      if (style === 'banana') {
        const shape = new T.Shape();
        shape.moveTo(-.27, -.045); shape.lineTo(.16, -.14); shape.quadraticCurveTo(.30, -.12, .29, .02);
        shape.quadraticCurveTo(.28, .16, .16, .14); shape.lineTo(-.27, .045); shape.closePath();
        const geometry = new T.ExtrudeGeometry(shape, { depth: .028, bevelEnabled: false, curveSegments: 4 }); geometry.translate(0, 0, -.014);
        mesh(geometry, wafer, 'WaffleBlade', paddle);
        for (const face of [-1, 1]) for (let i = -2; i <= 2; i++) {
          const x = i * .08, h = .065 + (x + .20) * .15;
          tube([v(x - .045, -h, face * .018), v(x + .045, h, face * .018)], .007, waffleLine, 'WaffleGrid', paddle);
          tube([v(x + .045, -h, face * .018), v(x - .045, h, face * .018)], .007, waffleLine, 'WaffleGrid', paddle);
        }
      } else if (style === 'pizza') {
        const peel = new T.Shape();
        peel.moveTo(-.29, -.045); peel.lineTo(-.14, -.045); peel.lineTo(-.10, -.16);
        peel.quadraticCurveTo(.03, -.21, .29, -.16); peel.lineTo(.31, .16);
        peel.quadraticCurveTo(.03, .21, -.10, .16); peel.lineTo(-.14, .045); peel.lineTo(-.29, .045); peel.closePath();
        const geometry = new T.ExtrudeGeometry(peel, { depth: .03, bevelEnabled: true, bevelSize: .008, bevelThickness: .005, bevelSegments: 1 });
        geometry.translate(0, 0, -.015); mesh(geometry, wood, 'WoodenPizzaPeel', paddle);
        if (side === 'L') paddle.rotation.x = Math.PI;
      } else if (style === 'snail') {
        const leaf = new T.Shape();
        leaf.moveTo(-.29, 0); leaf.bezierCurveTo(-.12, -.07, -.01, -.24, .18, -.16);
        leaf.quadraticCurveTo(.29, -.10, .38, 0); leaf.bezierCurveTo(.16, .21, -.02, .24, -.29, 0); leaf.closePath();
        const geometry = new T.ExtrudeGeometry(leaf, { depth: .025, bevelEnabled: true, bevelSize: .008, bevelThickness: .005, bevelSegments: 1, curveSegments: 8 });
        geometry.translate(0, 0, -.0125); mesh(geometry, mat(0x65ad25), 'GreenLeafBlade', paddle);
        for (const face of [-1, 1]) {
          tube([v(-.29, 0, face * .022), v(.04, .01, face * .022), v(.36, 0, face * .022)], .010, vanilla, 'LeafMidrib', paddle);
          for (let i = 0; i < 4; i++) for (const edge of [-1, 1]) {
            const x = -.15 + i * .10;
            tube([v(x, 0, face * .022), v(x + .07, edge * (.08 + Math.sin(i / 4 * Math.PI) * .055), face * .022)], .006, vanilla, 'LeafVein', paddle);
          }
        }
      } else {
        const brush = mesh(new T.SphereGeometry(1, 16, 8), wood, 'BrushBack', paddle); brush.scale.set(.27, .12, .035);
        const bristles: T.BufferGeometry[] = [];
        for (const face of [-1, 1]) for (let i = 0; i < 45; i++) {
          const a = i * 2.4, r = Math.sqrt((i + .5) / 45);
          const bristle = new T.CylinderGeometry(.009, .009, .065, 5);
          bristle.rotateX(Math.PI / 2); bristle.translate(Math.cos(a) * r * .24, Math.sin(a) * r * .10, face * .0575);
          bristles.push(bristle);
        }
        const combined = mergeGeometries(bristles);
        if (combined) mesh(combined, white, 'BrushBristles', paddle);
        bristles.forEach(geometry => geometry.dispose());
      }
    }
  }

  return () => {
    removePizza?.();
    hidden.forEach(obj => { obj.visible = true; });
    repainted.forEach(({ mesh, material }) => { mesh.material = material; });
    for (const part of extra) {
      part.removeFromParent(); part.traverse(obj => { if ((obj as T.Mesh).isMesh) (obj as T.Mesh).geometry.dispose(); });
    }
    materials.forEach(material => material.dispose());
  };
}
