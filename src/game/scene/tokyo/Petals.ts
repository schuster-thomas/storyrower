import * as THREE from 'three';
import type { Water } from '../Water';
import { petalTexture } from './textures';

const AIR = 700;     // petals drifting through the air around the boat
const FLOAT = 420;   // petals floating on the river
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/**
 * Cherry petals: drifting down through the air around the boat (more in a gust) and floating
 * on the river, riding the same waves as the boat. Both pools travel with the boat.
 */
export class Petals {
  readonly group = new THREE.Group();
  private air: THREE.Points;
  private airVel: Float32Array;
  private float: THREE.InstancedMesh;
  private floatPos: Float32Array;
  private tmp = new THREE.Object3D();
  private gust = 0;
  private tex = petalTexture();

  constructor(private water: Water) {
    const pos = new Float32Array(AIR * 3);
    this.airVel = new Float32Array(AIR * 3);
    for (let i = 0; i < AIR; i++) {
      pos.set([rnd(-30, 30), rnd(0, 26), rnd(-90, 15)], i * 3);
      this.airVel.set([rnd(-0.3, 0.3), rnd(0.5, 1.2), rnd(-0.2, 0.4)], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.air = new THREE.Points(geo, new THREE.PointsMaterial({ map: this.tex, size: 0.32, transparent: true, alphaTest: 0.3, depthWrite: false }));
    this.air.frustumCulled = false;

    const quad = new THREE.PlaneGeometry(0.28, 0.34);
    quad.rotateX(-Math.PI / 2);
    this.float = new THREE.InstancedMesh(quad, new THREE.MeshBasicMaterial({ map: this.tex, transparent: true, alphaTest: 0.35, depthWrite: false, side: THREE.DoubleSide }), FLOAT);
    this.float.frustumCulled = false;
    this.floatPos = new Float32Array(FLOAT * 3);
    for (let i = 0; i < FLOAT; i++) this.floatPos.set([rnd(-14, 15), rnd(0, Math.PI * 2), rnd(-110, 20)], i * 3);
    this.group.add(this.air, this.float);
  }

  /** A gust of wind shakes the trees: a cloud of petals for a few seconds. */
  burst() { this.gust = 1; }

  /**
   * @param amount 0–1 how many petals there are (fewer in the dusty quake, many in the idyll)
   */
  update(f: { dt: number; time: number; boatZ: number; swell: number; amount: number; light: number; share: number }) {
    this.gust = Math.max(0, this.gust - f.dt * 0.18);
    const visible = Math.min(1, f.amount + this.gust);
    const airN = Math.round(AIR * f.share * Math.min(1, 0.35 + visible * 0.65 + this.gust));
    this.air.geometry.setDrawRange(0, airN);
    const mat = this.air.material as THREE.PointsMaterial;
    mat.color.setScalar(Math.min(1.1, f.light));
    this.air.visible = visible > 0.02;
    const pos = this.air.geometry.attributes.position as THREE.BufferAttribute;
    const a = pos.array as Float32Array;
    const wind = 0.6 + this.gust * 3;
    for (let i = 0; i < airN; i++) {
      const k = i * 3;
      a[k] += (this.airVel[k] + Math.sin(f.time * 0.8 + i) * 0.5 + wind * 0.4) * f.dt;
      a[k + 1] -= this.airVel[k + 1] * f.dt * (0.6 + 0.4 * Math.sin(f.time * 2 + i));
      a[k + 2] += this.airVel[k + 2] * f.dt;
      if (a[k + 1] < 0.1) { a[k + 1] = rnd(14, 26); a[k] = rnd(-30, 30); }
      if (a[k] > 32) a[k] -= 62;
      if (a[k + 2] > f.boatZ + 15) a[k + 2] -= 105;
      if (a[k + 2] < f.boatZ - 90) a[k + 2] += 105;
    }
    pos.needsUpdate = true;

    // petals on the water: recycled ahead of the boat once they fall behind
    const floatN = Math.round(FLOAT * f.share * Math.min(1, 0.25 + f.amount * 0.75));
    this.float.count = floatN;
    (this.float.material as THREE.MeshBasicMaterial).color.setScalar(Math.min(1.05, f.light));
    for (let i = 0; i < floatN; i++) {
      const k = i * 3;
      let z = this.floatPos[k + 2];
      if (z > f.boatZ + 20) { z -= 130; this.floatPos[k] = rnd(-14, 15); }
      if (z < f.boatZ - 110) z += 130;
      this.floatPos[k + 2] = z;
      const x = this.floatPos[k];
      // the boat pushes them aside a little
      const push = Math.abs(z - f.boatZ) < 5 && Math.abs(x) < 1.4 ? Math.sign(x || 1) * f.dt * 1.5 : 0;
      this.floatPos[k] = x + push;
      this.tmp.position.set(this.floatPos[k], this.water.surfaceAt(this.floatPos[k], z, f.time, f.swell) + 0.04, z);
      this.tmp.rotation.set(0, this.floatPos[k + 1] + f.time * 0.1, 0);
      this.tmp.updateMatrix();
      this.float.setMatrixAt(i, this.tmp.matrix);
    }
    this.float.instanceMatrix.needsUpdate = true;
  }

  dispose() {
    this.air.geometry.dispose();
    (this.air.material as THREE.Material).dispose();
    this.float.geometry.dispose();
    (this.float.material as THREE.Material).dispose();
    this.float.dispose();
    this.tex.dispose();
  }
}
