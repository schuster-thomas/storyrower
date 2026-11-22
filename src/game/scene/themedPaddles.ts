import * as T from 'three';

/** Blade replacements attach to the original feather joints, preserving stroke and splash positions. */
export function fitThemedPaddles(rig: T.Object3D, style: 'duck' | 'inflatable') {
  const attached: T.Group[] = [];
  const hidden: T.Object3D[] = [];
  const materials = new Set<T.Material>();
  const mat = (color: number, roughness = .55) => {
    const material = new T.MeshStandardMaterial({ color, roughness, flatShading: true });
    materials.add(material); return material;
  };
  const orange = mat(0xff961f), crease = mat(0xd66617), red = mat(0xf43036, .4);
  const white = mat(0xfff9eb), tread = mat(0xc51e2b);
  const v = (x: number, y: number, z: number) => new T.Vector3(x, y, z);
  for (const side of ['R', 'L']) {
    const feather = rig.getObjectByName('Feather' + side);
    if (!feather) continue;
    feather.traverse(obj => {
      if ((obj as T.Mesh).isMesh && /^Blade/.test(obj.name) && obj.visible) { hidden.push(obj); obj.visible = false; }
    });
    const paddle = new T.Group(); paddle.name = style === 'duck' ? 'WebbedFootPaddle' : 'FlipFlopPaddle';
    paddle.position.set(1.75, -.02, 0); feather.add(paddle); attached.push(paddle);
    const mesh = (geometry: T.BufferGeometry, material: T.Material, name: string) => {
      const part = new T.Mesh(geometry, material); part.name = name; paddle.add(part); return part;
    };
    const tube = (points: T.Vector3[], radius: number, material: T.Material, name: string) =>
      mesh(new T.TubeGeometry(new T.CatmullRomCurve3(points), Math.max(16, points.length * 3), radius, 6, false), material, name);
    if (style === 'duck') {
      const foot = new T.Shape();
      foot.moveTo(-.29, -.045); foot.lineTo(-.08, -.075);
      foot.quadraticCurveTo(.05, -.17, .25, -.23);
      foot.quadraticCurveTo(.33, -.24, .32, -.18);
      foot.lineTo(.23, -.09); foot.lineTo(.37, -.045);
      foot.quadraticCurveTo(.43, 0, .37, .045);
      foot.lineTo(.23, .09); foot.lineTo(.32, .18);
      foot.quadraticCurveTo(.33, .24, .25, .23);
      foot.quadraticCurveTo(.05, .17, -.08, .075); foot.lineTo(-.29, .045); foot.closePath();
      const geometry = new T.ExtrudeGeometry(foot, { depth: .036, bevelEnabled: true, bevelSize: .012, bevelThickness: .009, bevelSegments: 1, curveSegments: 5 });
      geometry.translate(0, 0, -.018);
      mesh(geometry, orange, 'OrangeWebbedFoot');
      // Raised creases on both faces keep the three toes legible during feathering.
      for (const face of [-1, 1]) for (const toe of [-1, 0, 1]) {
        tube([v(-.15, 0, face * .032), v(.06, toe * .055, face * .032),
          v(toe === 0 ? .33 : .25, toe * .17, face * .032)], .007, crease, 'WebbingCrease');
      }
    } else {
      // A left/right pair of oversized beach sandals: narrow heels, broad rounded toes.
      const sole = new T.Shape();
      sole.moveTo(-.32, -.065);
      sole.bezierCurveTo(-.35, -.14, -.23, -.16, -.12, -.13);
      sole.bezierCurveTo(.01, -.13, .10, -.22, .25, -.19);
      sole.bezierCurveTo(.40, -.17, .41, .08, .28, .17);
      sole.bezierCurveTo(.18, .24, .05, .17, -.10, .13);
      sole.bezierCurveTo(-.24, .11, -.34, .14, -.32, -.065);
      sole.closePath();
      const geometry = new T.ExtrudeGeometry(sole, { depth: .052, bevelEnabled: true,
        bevelSize: .012, bevelThickness: .008, bevelSegments: 2, curveSegments: 10 });
      geometry.translate(0, 0, -.026);
      mesh(geometry, red, 'RedFlipFlopSole');
      for (const edge of [-1, 1]) {
        tube([v(-.12, edge * .13, .036), v(-.015, edge * .105, .12),
          v(.145, .015, .065)], .026, white, 'WhiteYStrap');
      }
      tube([v(.145, .015, .025), v(.145, .015, .065)], .020, white, 'ToePost');
      // Rubber grip lines remain visible when the blade turns over during recovery.
      for (let i = 0; i < 6; i++) {
        const x = -.22 + i * .09, w = i < 2 ? .09 : .13;
        tube([v(x - .02, -w, -.036), v(x + .02, 0, -.036), v(x - .02, w, -.036)], .007, tread, 'SoleTread');
      }
      tube([v(-.34, 0, 0), v(-.27, 0, 0)], .025, white, 'FlipFlopSocket');
      // Opposing oar pivots need a half-turn so both sandals show their straps
      // on the same side of the stroke, rather than one showing its underside.
      if (side === 'L') paddle.rotation.x = Math.PI;
    }
  }
  return () => {
    hidden.forEach(obj => { obj.visible = true; });
    for (const paddle of attached) {
      paddle.removeFromParent();
      paddle.traverse(obj => { if ((obj as T.Mesh).isMesh) (obj as T.Mesh).geometry.dispose(); });
    }
    materials.forEach(material => material.dispose());
  };
}
