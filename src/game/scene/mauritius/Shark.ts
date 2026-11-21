import * as THREE from 'three';
import type { WorldHost } from '../World';

const LENGTH = 6.2;        // a big great white (m)
const FIN_OUT = 0.85;      // how far the dorsal fin sticks out of the water while it circles
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (x: number) => { const c = Math.max(0, Math.min(1, x)); return c * c * (3 - 2 * c); };

type Mode = 'circle' | 'beside' | 'lunge';

/**
 * The shark (Tripo3D model from a painted concept, jaws open): first only its dorsal fin, circling
 * far out on the left; with the thunderstorm the circles close in round the boat; in the attack it
 * swims right beside the boat and lunges out of the water at the rower, snapping – closer when the
 * rower falls behind the targets. After the escape it dives away. The body swims with a sideways
 * wave in the vertex shader that grows towards the tail (no rig needed).
 */
export class Shark {
  readonly group = new THREE.Group();
  private model = new THREE.Group();
  private swim = { value: 0 };
  private amp = { value: 0.06 };
  private finTop = 0.18;     // model space (length 1): top of the dorsal fin above the body axis
  private ready = false;
  private pos = new THREE.Vector3(-80, -3, -120);
  private prev = new THREE.Vector3();
  private heading = 0;
  private theta = Math.random() * Math.PI * 2;
  private mode: Mode = 'circle';
  private modeT = 0;
  private lungeIn = 4;
  private lunge = { from: new THREE.Vector3(), bit: false, splashed: false };
  private foamT = 0;
  private disposables: { dispose(): void }[] = [];

  constructor(private host: WorldHost, src: THREE.Object3D | null) {
    this.group.add(this.model);
    this.group.visible = false;
    if (src) this.build(src);
  }

  /** Bake the model to length 1 along z, head towards +z (Object3D.lookAt faces +z), body axis at y = 0. */
  private build(src: THREE.Object3D) {
    const meshes: THREE.Mesh[] = [];
    src.updateMatrixWorld(true);
    src.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    const turn = new THREE.Matrix4().makeRotationY(Math.PI);   // the Tripo model's head points to -z
    const box = new THREE.Box3();
    const geos = meshes.map((m) => {
      const g = m.geometry.clone().applyMatrix4(m.matrixWorld).applyMatrix4(turn);
      g.computeBoundingBox();
      box.union(g.boundingBox!);
      return g;
    });
    const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const s = 1 / size.z;
    let top = 0;
    meshes.forEach((m, i) => {
      const g = geos[i].translate(-c.x, -c.y, -c.z).scale(s, s, s);
      g.computeBoundingBox();
      top = Math.max(top, g.boundingBox!.max.y);
      this.disposables.push(g);
      const mat = (m.material as THREE.MeshStandardMaterial).clone();
      mat.roughness = Math.max(0.45, mat.roughness);
      mat.metalness = Math.min(0.1, mat.metalness);
      const swim = this.swim, amp = this.amp;
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.uSwim = swim;
        sh.uniforms.uAmp = amp;
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uSwim;\nuniform float uAmp;')
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            // a sideways wave running down the body, strongest at the tail (z = -0.5)
            float k = clamp(0.62 - transformed.z, 0.0, 1.2);
            transformed.x += sin(uSwim + transformed.z * 5.5) * uAmp * k * k;`);
      };
      this.disposables.push(mat);
      const mesh = new THREE.Mesh(g, mat);
      mesh.castShadow = false;
      mesh.frustumCulled = false;
      this.model.add(mesh);
    });
    this.finTop = top;
    this.model.scale.setScalar(LENGTH);
    this.ready = true;
  }

  /** the shark bursts out of the water the moment the attack begins */
  attackNow() { this.lungeIn = Math.min(this.lungeIn, 0.6); }

  /**
   * @param presence 0–1 (falls after the escape: it dives away)
   * @param near 0–1 how close it circles (1 = the attack: right beside the boat)
   * @param attack 0–1 how often it lunges
   * @param threat 0 = the rower is behind the targets (it comes very close), 1 = well on target
   */
  update(f: { dt: number; time: number; boatZ: number; presence: number; age: number; near: number; attack: number; threat: number }) {
    const vis = this.ready && f.presence > 0.01 && f.age >= 0;
    this.group.visible = vis;
    if (!vis) { this.mode = 'circle'; return; }
    const t = f.time, dt = f.dt;
    this.prev.copy(this.pos);
    const finY = FIN_OUT - this.finTop * LENGTH;   // body axis height that shows only the fin
    const leave = 1 - f.presence;
    const danger = 1 - f.threat;
    let pitch = 0, roll = 0;
    this.modeT += dt;

    if (f.near < 1 || leave > 0) {
      // circling: far out on the left at first, then round the boat
      this.mode = 'circle';
      const n = Math.min(1, f.near + danger * 0.12);
      const cx = lerp(-75, -2, n), cz = lerp(120, 14, n), r = lerp(32, 13, n);
      this.theta += (dt * lerp(4.5, 7.5, n)) / r;
      const tx = cx + Math.cos(this.theta) * r - leave * 60;
      const tz = f.boatZ - cz + Math.sin(this.theta) * r - leave * 80;
      // it surfaces when it is first seen, and dives away at the end
      const rise = smooth(f.age / 4);
      const ty = lerp(-4, finY, rise) - leave * 7;
      const k = 1 - Math.exp(-dt * (this.modeT < 0.1 ? 50 : 2.5));
      this.pos.set(lerp(this.pos.x, tx, k), lerp(this.pos.y, ty, k), lerp(this.pos.z, tz, k));
    } else if (this.mode !== 'lunge') {
      // the attack: beside the boat on the left, weaving, nearer when the rower is behind the targets
      this.mode = 'beside';
      const tx = -(4.2 + f.threat * 4.5) + Math.sin(t * 0.7) * 1.2;
      const tz = f.boatZ - 7 + Math.sin(t * 0.45) * 6;
      const k = 1 - Math.exp(-dt * 1.4);
      this.pos.set(lerp(this.pos.x, tx, k), lerp(this.pos.y, finY + 0.05, k), lerp(this.pos.z, tz, k));
      this.lungeIn -= dt * (0.5 + f.attack);
      if (this.lungeIn <= 0) {
        this.mode = 'lunge'; this.modeT = 0;
        this.lunge.from.copy(this.pos); this.lunge.bit = false; this.lunge.splashed = false;
        this.lungeIn = rnd(4, 7);
      }
    }
    if (this.mode === 'lunge') {
      // it shoots up out of the water towards the rower, snaps, and crashes back
      const L = 1.7, k = Math.min(1, this.modeT / L);
      const up = Math.sin(Math.min(1, k / 0.8) * Math.PI);
      const reach = -(2.6 + f.threat * 2.2);
      this.pos.x = lerp(this.lunge.from.x, reach, Math.sin(Math.min(1, k / 0.7) * Math.PI * 0.5) * (1 - smooth((k - 0.7) / 0.3) * 0.6));
      this.pos.y = lerp(finY, 1.0, up);
      this.pos.z = f.boatZ - 4.5 + Math.sin(t * 0.45) * 1.5;
      pitch = -up * 0.55;
      roll = up * 0.5;
      if (!this.lunge.bit && k > 0.38) {
        this.lunge.bit = true;
        this.host.sound('bite', 3);
        this.host.shake(0.5);
        this.spray(this.headWorld(new THREE.Vector3()), 3, 1.2);
      }
      if (!this.lunge.splashed && k > 0.82) {
        this.lunge.splashed = true;
        this.host.sound('splash', 4);
        this.spray(new THREE.Vector3(this.pos.x, 0, this.pos.z), 10, 2.2);
        this.host.shake(0.7);
        this.host.rock(0.25);
      }
      if (k >= 1) { this.mode = 'beside'; this.modeT = 0; }
    }

    // face where it swims (its world velocity, the boat's speed included)
    const vx = this.pos.x - this.prev.x, vz = this.pos.z - this.prev.z;
    if (Math.hypot(vx, vz) > 0.002) {
      const want = Math.atan2(vx, vz);
      let d = want - this.heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.heading += d * Math.min(1, dt * (this.mode === 'lunge' ? 3 : 5));
    }
    if (this.mode === 'lunge') {
      // turn the head to the boat while it lunges
      const toBoat = Math.atan2(-this.pos.x, f.boatZ - this.pos.z);
      let d = toBoat - this.heading;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.heading += d * Math.min(1, dt * 4);
    }
    this.model.position.copy(this.pos);
    this.model.rotation.set(0, 0, 0);
    this.model.rotateY(this.heading);
    this.model.rotateX(pitch);
    this.model.rotateZ(roll + Math.sin(t * 1.3) * 0.05);
    const speed = Math.hypot(vx, vz) / Math.max(dt, 1e-3);
    this.swim.value += dt * (4 + Math.min(6, speed * 0.4));
    this.amp.value = this.mode === 'lunge' ? 0.1 : 0.06;

    // spray where the fin cuts the surface
    this.foamT -= dt;
    if (this.foamT <= 0 && this.pos.y > finY - 0.5 && this.pos.y < 0.4) {
      this.foamT = 0.09;
      const fin = new THREE.Vector3(0, 0, 0.12).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.heading).add(this.pos);
      fin.y = 0;
      this.host.effects.bladeSplash(fin, 0.55);
    }
  }

  /** A burst of spray (droplets only – the impact ring of distant hits would cover the boat this close). */
  private spray(at: THREE.Vector3, bursts: number, spread: number) {
    const p = new THREE.Vector3();
    for (let i = 0; i < bursts; i++) {
      p.set(at.x + rnd(-spread, spread), 0, at.z + rnd(-spread * 1.5, spread * 1.5));
      this.host.effects.bladeSplash(p, rnd(2, 3.2));
    }
  }

  private headWorld(out: THREE.Vector3) {
    return out.set(0, 0.05, 0.48).applyMatrix4(this.model.matrixWorld);
  }

  dispose() { this.disposables.forEach((d) => d.dispose()); }
}
