import * as T from 'three';
import { mirrorEnvironment } from './shirts';

export function makeGoldChain(body: T.SkinnedMesh, boneIndex: number, lei = false) {
  // Fit the chain against the rest-pose body, before converting to the chest bone's space.
  const surfaceMaterial = new T.MeshBasicMaterial({ side: T.DoubleSide });
  const surface = new T.Mesh(body.geometry, surfaceMaterial);
  const ray = new T.Raycaster();
  const points = Array.from({ length: 64 }, (_, i) => {
    const angle = i * Math.PI / 32;
    const outward = new T.Vector3(Math.sin(angle), 0, Math.cos(angle));
    const height = .46 + (lei ? .19 : .22) * Math.sqrt((1 - Math.cos(angle)) / 2);
    const origin = new T.Vector3(0, height, -.012);
    ray.set(origin, outward);
    const hit = ray.intersectObject(surface, false).filter(entry => entry.distance < .15).at(-1);
    // Stop at the collar even when the ray reaches the sleeve or shoulder.
    const collarRadius = .095 + .035 * Math.max(0, Math.cos(angle));
    const radius = Math.min(hit?.distance ?? collarRadius, collarRadius);
    return origin.addScaledVector(outward, radius + (lei ? .035 : .021));
  });
  surfaceMaterial.dispose();

  const path = new T.CatmullRomCurve3(points, true);
  if (lei) {
    const group = new T.Group();
    const cord = new T.Mesh(new T.TubeGeometry(path, 64, .004, 6, true),
      new T.MeshStandardMaterial({ color: 0x437749 }));
    group.add(cord);
    const count = 23;
    const pose = new T.Object3D();
    const petals = new T.InstancedMesh(new T.SphereGeometry(1, 10, 8),
      new T.MeshStandardMaterial({ roughness: .8 }), count * 5);
    const centers = new T.InstancedMesh(new T.SphereGeometry(.010, 10, 8),
      new T.MeshStandardMaterial({ color: 0xffc845 }), count);
    const colors = [0xff4b8c, 0xff7345, 0xfff0cf, 0xbc59de].map(color => new T.Color(color));
    for (let i = 0; i < count; i++) {
      const center = path.getPointAt(i / count);
      const outward = new T.Vector3(center.x, 0, center.z + .012).normalize();
      const across = new T.Vector3(outward.z, 0, -outward.x);
      pose.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), outward);
      pose.position.copy(center).addScaledVector(outward, .008);
      pose.scale.set(1, 1, 1);
      pose.updateMatrix();
      centers.setMatrixAt(i, pose.matrix);
      for (let j = 0; j < 5; j++) {
        const angle = j * Math.PI * 2 / 5 + i * .38;
        pose.position.copy(center).addScaledVector(across, .017 * Math.cos(angle));
        pose.position.y += .017 * Math.sin(angle);
        pose.scale.set(.014, .014, .007);
        pose.updateMatrix();
        petals.setMatrixAt(i * 5 + j, pose.matrix);
        petals.setColorAt(i * 5 + j, colors[i % colors.length]);
      }
    }
    group.add(petals, centers);
    group.applyMatrix4(body.skeleton.boneInverses[boneIndex].clone().multiply(body.bindMatrix));
    return group;
  }
  const count = 28;
  const group = new T.Group();
  const gold = new T.MeshStandardMaterial({
    color: 0xffc64a, metalness: .77, roughness: .19, envMap: mirrorEnvironment(),
  });
  const links = new T.InstancedMesh(new T.TorusGeometry(1, .30, 8, 18), gold, count);
  const pose = new T.Object3D();
  for (let i = 0; i < count; i++) {
    const fraction = i / count;
    pose.position.copy(path.getPointAt(fraction));
    const tangent = path.getTangentAt(fraction);
    pose.quaternion.setFromUnitVectors(new T.Vector3(1, 0, 0), tangent);
    pose.rotateX(i % 2 ? .52 : -.52);
    pose.scale.set(.018, .013, .013);
    pose.updateMatrix();
    links.setMatrixAt(i, pose.matrix);
  }
  group.add(links);

  const medal = new T.Group();
  const curve = new T.CatmullRomCurve3([
    [.014,.014],[.004,.020],[-.012,.016],[-.016,.008],[-.008,.002],
    [.008,-.002],[.016,-.009],[.011,-.017],[-.003,-.020],[-.016,-.014],
  ].map(([x,y])=>new T.Vector3(x,y,0)));
  medal.add(new T.Mesh(new T.TubeGeometry(curve,48,.0036,8),gold));
  for (const x of [-.004,.004]) {
    const bar = new T.Mesh(new T.CylinderGeometry(.0025,.0025,.049,8),gold);
    bar.position.set(x,0,-.001);
    medal.add(bar);
  }
  medal.position.copy(points[0]).add(new T.Vector3(0,-.043,.013));
  group.add(medal);
  const clasp = new T.Mesh(new T.TorusGeometry(.007, .0028, 8, 16), gold);
  clasp.position.copy(points[0]).lerp(medal.position, .34);
  group.add(clasp);

  group.applyMatrix4(body.skeleton.boneInverses[boneIndex].clone().multiply(body.bindMatrix));
  return group;
}


