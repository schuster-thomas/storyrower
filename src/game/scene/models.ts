import * as THREE from 'three';

/** Loaded models of a level's world (Tripo3D), normalised so they can be placed by size. */

/** A model normalised to height 1, standing on y = 0, centred – its meshes share geometry and material. */
export interface Model { parts: { geometry: THREE.BufferGeometry; material: THREE.Material }[]; width: number; depth: number }

/** Normalise to height 1, standing on y = 0, centred (geometry baked into world space, materials cloned). */
export function normalise(root: THREE.Object3D): Model {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const s = 1 / size.y;
  const parts: Model['parts'] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const g = m.geometry.clone().applyMatrix4(m.matrixWorld).translate(-c.x, -box.min.y, -c.z).scale(s, s, s);
    const mat = (m.material as THREE.MeshStandardMaterial).clone();
    mat.roughness = Math.max(0.5, mat.roughness);
    mat.metalness = Math.min(0.2, mat.metalness);
    parts.push({ geometry: g, material: mat });
  });
  return { parts, width: size.x * s, depth: size.z * s };
}

/** A copy of a model `height` metres tall (shares geometry and materials). */
export function placeModel(m: Model, height: number, x: number, y: number, z: number, rotY: number, shadows: boolean) {
  const g = new THREE.Group();
  for (const p of m.parts) {
    const mesh = new THREE.Mesh(p.geometry, p.material);
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    mesh.userData.shared = true;
    g.add(mesh);
  }
  g.scale.setScalar(height);
  g.position.set(x, y, z);
  g.rotation.y = rotY;
  return g;
}
