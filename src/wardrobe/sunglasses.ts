import * as T from 'three';

export function makeSunglasses() {
  const group = new T.Group();
  const gold = new T.MeshStandardMaterial({ color: 0xcda45d, metalness: .65, roughness: .28 });
  const glass = new T.MeshPhysicalMaterial({ color: 0x222522, roughness: .21, clearcoat: 1, side: T.DoubleSide });
  for (const side of [-1, 1]) {
    const outline = new T.Shape();
    outline.moveTo(-.022, .010);
    outline.bezierCurveTo(-.012, .018, .020, .017, .024, .007);
    outline.bezierCurveTo(.025, -.008, .016, -.022, .004, -.021);
    outline.bezierCurveTo(-.010, -.021, -.025, -.001, -.022, .010);
    const lens = new T.Group();
    lens.position.x = side * .027;
    lens.scale.x = -side;
    lens.rotation.y = side * .12;
    lens.add(new T.Mesh(new T.ShapeGeometry(outline, 16), glass));
    const rimPath = new T.CatmullRomCurve3(outline.getPoints(12).slice(0,-1).map(p=>new T.Vector3(p.x,p.y,.001)),true);
    lens.add(new T.Mesh(new T.TubeGeometry(rimPath,64,.0012,6,true),gold));
    const arm = new T.Mesh(new T.BoxGeometry(.0025,.0025,.061),gold);
    arm.position.set(side*.049,.008,-.03);
    group.add(lens,arm);
  }
  for(const height of [.008,.015]){
    const bridge = new T.Mesh(new T.BoxGeometry(.015,.002,.003),gold);
    bridge.position.y = height;
    group.add(bridge);
  }
  group.position.set(-.008,.111,.087);
  return group;
}
