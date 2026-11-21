import * as THREE from 'three';
import { placeModel, type Model } from '../models';
import type { Water } from '../Water';
import type { WorldHost } from '../World';
import { beachX } from './Beach';
import { lengthScale, type MauritiusKit } from './kit';

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** How the windsurf rig sits on the surfer model (found by eye: the model's arms reach across the board). */
const RIG = { x: -0.6, y: 0.05, z: 0.35, yaw: 0.6, lean: -0.22, boardYaw: 0 };

/**
 * The windsurfer's course relative to the boat (x, z; negative z = ahead): in from off-screen on
 * the left, out into the distance, a loop there, and away to the left out of the picture.
 */
const SURF_COURSE = new THREE.CatmullRomCurve3([
  [-50, -20], [-26, -34], [-11, -50], [-8, -66], [-17, -80], [-30, -74], [-27, -57], [-42, -46], [-85, -40],
].map(([x, z]) => new THREE.Vector3(x, 0, z)));
const SURF_SPEED = 7;   // m/s along the course

interface Swimmer { obj: THREE.Group; x: number; z: number; heading: number; drift: number; kick: number; on: boolean }
interface Runner { obj: THREE.Group; x: number; z: number; speed: number; on: boolean; t: number; spray: number }

/** A copy of a normalised model, `length` metres long, its front turned to +z (yaw in radians). */
function figure(m: Model, length: number, frontYaw: number, shadows: boolean) {
  const outer = new THREE.Group();
  const s = lengthScale(m, length);
  const inner = placeModel(m, s, 0, 0, 0, frontYaw, shadows);
  outer.add(inner);
  return outer;
}

/**
 * People enjoying the lagoon while the weather is fine: snorkelers in pairs floating face down in
 * the shallows – low in the water, a big yellow snorkel sticking up, an orange snorkel buoy on a line
 * behind each, their fins splashing (a lying figure alone reads as a flat slab from the boat) –, a speedboat towing a water-skier that overtakes the rower on the
 * open-sea side, and a windsurfer with a bright sail who comes in from the left, sails a loop out ahead and
 * leaves to the left again. When the clouds gather nobody new comes out.
 */
export class Visitors {
  readonly group = new THREE.Group();
  private swimmers: Swimmer[] = [];
  private boat: Runner | null = null;
  private skier: THREE.Group | null = null;
  private rope: THREE.Mesh;
  private surfer: Runner | null = null;
  private next = 14;
  private turn = 0;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  /** shared by every snorkeler's snorkel, buoy and line */
  private gear: { dispose(): void }[] = [];
  /** the windsurfer's mast, sail and boom (in the board's frame) */
  private rig: THREE.Group | null = null;

  constructor(private host: WorldHost, kit: MauritiusKit, private water: Water) {
    const { snorkeler, speedboat, skier, surfer } = kit.models;
    const shadows = host.shadows;
    // the snorkeler's head points to +x in the model
    if (snorkeler) for (let i = 0; i < 4; i++) {
      const obj = figure(snorkeler, 1.85, -Math.PI / 2, shadows);
      obj.add(...this.snorkelGear(i === 0));
      obj.visible = false;
      this.group.add(obj);
      this.swimmers.push({ obj, x: 0, z: 0, heading: 0, drift: 0, kick: Math.random(), on: false });
    }
    // the speedboat's bow points to +z; the skier's ski tips to -z
    if (speedboat) {
      const obj = figure(speedboat, 6.2, 0, shadows);
      obj.visible = false;
      this.group.add(obj);
      this.boat = { obj, x: 0, z: 0, speed: 0, on: false, t: 0, spray: 0 };
    }
    if (skier) {
      this.skier = figure(skier, 1.75, Math.PI, shadows);
      this.skier.visible = false;
      this.group.add(this.skier);
    }
    if (surfer) {
      const obj = figure(surfer, 2.1, 0, shadows);
      this.rig = this.windsurfRig();
      this.rig.position.set(RIG.x, RIG.y, RIG.z);
      this.rig.rotation.set(0, RIG.yaw, RIG.lean);
      obj.add(this.rig);
      obj.visible = false;
      this.group.add(obj);
      this.surfer = { obj, x: 0, z: 0, speed: 0, on: false, t: 0, spray: 0 };
    }
    this.rope = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1, 4, 1, true), new THREE.MeshBasicMaterial({ color: 0xf6e7a8 }));
    this.rope.geometry.translate(0, 0.5, 0);
    this.rope.geometry.rotateX(Math.PI / 2);
    this.rope.visible = false;
    this.group.add(this.rope);
  }

  /**
   * What makes a snorkeler readable from a distance: a big J-shaped yellow snorkel standing up from
   * the head (+z), and an orange torpedo buoy floating on a line behind the fins.
   */
  private snorkelGear(first: boolean): THREE.Object3D[] {
    if (first) {
      const tube = new THREE.CylinderGeometry(0.045, 0.045, 0.62, 8);
      tube.translate(0, 0.31, 0);
      const buoy = new THREE.CapsuleGeometry(0.14, 0.55, 4, 10);
      buoy.rotateX(Math.PI / 2);
      const line = new THREE.CylinderGeometry(0.008, 0.008, 1, 3);
      line.translate(0, 0.5, 0);
      line.rotateX(Math.PI / 2);
      const yellow = new THREE.MeshStandardMaterial({ color: 0xffd21a, emissive: 0x6b4a00, roughness: 0.4 });
      const orange = new THREE.MeshStandardMaterial({ color: 0xff5a14, emissive: 0x5a1400, roughness: 0.35 });
      const rope = new THREE.MeshBasicMaterial({ color: 0xf2f2f2 });
      this.gear.push(tube, buoy, line, yellow, orange, rope);
    }
    const [tube, buoy, line, yellow, orange, rope] = this.gear as [THREE.BufferGeometry, THREE.BufferGeometry, THREE.BufferGeometry, THREE.Material, THREE.Material, THREE.Material];
    const snorkel = new THREE.Mesh(tube, yellow);
    snorkel.position.set(0.09, 0.12, 0.62);
    snorkel.rotation.x = -0.15;
    const float = new THREE.Mesh(buoy, orange);
    float.position.set(0.25, 0.04, -2.6);
    const tether = new THREE.Mesh(line, rope);
    tether.position.set(0.05, 0.12, -0.25);
    tether.scale.set(1, 1, 2.36);
    tether.lookAt(0.25, 0.04, -2.6);
    return [snorkel, float, tether];
  }

  /**
   * Mast, sail and boom for the surfer – she becomes a windsurfer. Built in a frame where the sail
   * lies in the y–z plane: the tack at the origin, the mast raked back towards −z, the boom running
   * back to the clew; the group is then placed in front of her chest.
   */
  private windsurfRig() {
    const rig = new THREE.Group();
    // the sail: a fan of triangles from the tack, with a little camber, in bright panels
    const outline: [number, number][] = [[0.1, 0.25], [4.7, -0.55], [4.0, -0.95], [3.1, -1.45], [2.2, -1.95], [1.65, -2.35], [0.95, -1.9], [0.35, -0.9]];   // [y, z]
    const pos: number[] = [], col: number[] = [];
    const panel = [new THREE.Color(0xff3b2f), new THREE.Color(0xffffff), new THREE.Color(0xffc21a), new THREE.Color(0x1a8cff)];
    for (let i = 1; i < outline.length - 1; i++) {
      for (const [y, z] of [outline[0], outline[i], outline[i + 1]]) {
        const camber = Math.sin(Math.min(1, Math.max(0, -z / 2.3)) * Math.PI) * 0.22;
        pos.push(camber, y, z);
        const c = panel[Math.min(panel.length - 1, Math.floor((y / 4.8) * panel.length))];
        col.push(c.r, c.g, c.b);
      }
    }
    const sailGeo = new THREE.BufferGeometry();
    sailGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    sailGeo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    sailGeo.computeVertexNormals();
    const sailMat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.55, emissive: 0x222222 });
    const sail = new THREE.Mesh(sailGeo, sailMat);
    sail.castShadow = this.host.shadows;
    // mast along the luff, boom from the mast to the clew
    const metal = new THREE.MeshStandardMaterial({ color: 0x2a2a30, roughness: 0.4, metalness: 0.3 });
    const stick = (from: THREE.Vector3, to: THREE.Vector3, r: number) => {
      const g = new THREE.CylinderGeometry(r, r, 1, 6);
      g.translate(0, 0.5, 0);
      g.rotateX(Math.PI / 2);
      this.gear.push(g);
      const m = new THREE.Mesh(g, metal);
      m.position.copy(from);
      m.lookAt(to);
      m.scale.set(1, 1, from.distanceTo(to));
      return m;
    };
    rig.add(sail, stick(new THREE.Vector3(0, 0.1, 0.25), new THREE.Vector3(0, 4.75, -0.57), 0.035));
    for (const side of [-1, 1]) rig.add(stick(new THREE.Vector3(0, 1.55, 0.0), new THREE.Vector3(side * 0.25, 1.62, -1.1), 0.025), stick(new THREE.Vector3(side * 0.25, 1.62, -1.1), new THREE.Vector3(0, 1.66, -2.3), 0.025));
    this.gear.push(sailGeo, sailMat, metal);
    return rig;
  }

  /** A speedboat right now (the "visitors" beat), unless one is out already. */
  speedboatNow(boatZ: number) { if (this.boat && !this.boat.on && !this.surfer?.on) this.launchBoat(boatZ); else this.next = Math.min(this.next, 3); }

  /** The speedboat and the windsurfer share the open water on the left: only one of them is out at a time. */
  private get leftBusy() { return !!(this.boat?.on || this.surfer?.on); }

  private launchBoat(boatZ: number) {
    const b = this.boat!;
    b.on = true; b.t = 0;
    b.x = -rnd(24, 34); b.z = boatZ + 45; b.speed = rnd(17, 21);
    b.obj.visible = true;
    if (this.skier) this.skier.visible = true;
    this.rope.visible = !!this.skier;
    this.host.sound('speedboat', 40);
  }

  private launchSurfer(boatZ: number) {
    const s = this.surfer!;
    s.on = true; s.t = 0;
    // the course starts off-screen on the left: she never pops up in view
    s.speed = SURF_COURSE.getLength() / SURF_SPEED;   // seconds for the whole course
    const p = SURF_COURSE.getPointAt(0);
    s.x = p.x; s.z = boatZ + p.z;
    s.obj.visible = true;
  }

  update(f: { dt: number; time: number; boatZ: number; speed: number; swell: number; visitors: number }) {
    const { dt, time } = f;
    const surface = (x: number, z: number) => this.water.surfaceAt(x, z, time, f.swell);
    const out = f.visitors > 0.5;

    // ---------- snorkelers: scattered over the lagoon ahead, drifting ----------
    for (const s of this.swimmers) {
      if (!s.on || s.z > f.boatZ + 25) {
        s.on = false;
        s.obj.visible = false;
        if (!out) continue;
        // a new one further ahead, between the boat's lane and the beach
        // in pairs: the second of each pair swims close to its buddy
        const buddy = this.swimmers[this.swimmers.indexOf(s) ^ 1];
        if (buddy?.on && buddy.z < f.boatZ - 40) {
          s.z = buddy.z + rnd(-2.5, 2.5);
          s.x = buddy.x + rnd(1.8, 3) * (Math.random() < 0.5 ? -1 : 1);
          s.heading = buddy.heading + rnd(-0.4, 0.4);
        } else {
          s.z = f.boatZ - rnd(90, 320);
          s.x = rnd(8, beachX(s.z) - 5);
          s.heading = rnd(0, Math.PI * 2);
        }
        s.drift = rnd(0.2, 0.5);
        s.on = true;
        s.obj.visible = true;
      }
      s.heading += Math.sin(time * 0.2 + s.kick * 9) * dt * 0.15;
      s.x += Math.sin(s.heading) * s.drift * dt;
      s.z += Math.cos(s.heading) * s.drift * dt;
      // they stay clear of the rowing lane and off the beach: turn back when they get close
      const lo = 7.5, hi = beachX(s.z) - 4;
      if ((s.x < lo && Math.sin(s.heading) < 0) || (s.x > hi && Math.sin(s.heading) > 0)) s.heading = -s.heading;
      s.x = Math.max(lo - 0.5, Math.min(hi + 0.5, s.x));
      s.obj.position.set(s.x, surface(s.x, s.z) - 0.06, s.z);
      s.obj.rotation.set(Math.sin(time * 1.3 + s.kick * 5) * 0.04, s.heading, Math.sin(time * 1.1 + s.kick) * 0.06);
      // the fins kick little splashes now and then
      s.kick += dt * 3.2;
      if (s.kick >= 1) {
        s.kick -= 1;
        const side = Math.random() < 0.5 ? -0.15 : 0.15;
        const feet = this.tmp.set(side, 0, -1).applyAxisAngle(this.tmp2.set(0, 1, 0), s.heading).add(s.obj.position);
        feet.y = 0;
        this.host.effects.bladeSplash(feet, 0.55);
      }
    }

    // ---------- now and then a speedboat with a water-skier, or a surfer ----------
    if (out) {
      this.next -= dt;
      if (this.next <= 0 && this.leftBusy) this.next = 2;   // wait until the other one has gone
      if (this.next <= 0) {
        this.next = rnd(35, 55);
        this.turn++;
        if (this.turn % 2 === 1 && this.boat && !this.boat.on) this.launchBoat(f.boatZ);
        else if (this.surfer && !this.surfer.on) this.launchSurfer(f.boatZ);
      }
    }
    const b = this.boat;
    if (b?.on) {
      b.t += dt;
      b.z -= b.speed * dt;
      b.x += Math.sin(b.t * 0.12) * dt * 0.8;
      const y = surface(b.x, b.z);
      b.obj.position.set(b.x, y - 0.25, b.z);
      b.obj.rotation.set(-0.07 + Math.sin(time * 2.1) * 0.015, Math.PI, Math.sin(time * 1.7) * 0.02);
      // spray at the stern
      b.spray -= dt;
      if (b.spray <= 0) {
        b.spray = 0.07;
        this.host.effects.bladeSplash(this.tmp.set(b.x + rnd(-0.8, 0.8), 0, b.z + 3), 1.3);
      }
      if (this.skier) {
        // 20 m behind on the rope, carving from side to side and leaning into the turns
        const swing = Math.sin(b.t * 0.55);
        const sx = b.x + swing * 7, sz = b.z + 20 + Math.abs(swing) * -1.5;
        this.skier.position.set(sx, surface(sx, sz) - 0.05, sz);
        this.skier.rotation.set(0, Math.PI - Math.cos(b.t * 0.55) * 0.25, Math.cos(b.t * 0.55) * 0.35);
        if (Math.random() < dt * 14) this.host.effects.bladeSplash(this.tmp.set(sx, 0, sz + 0.6), 0.9);
        // the rope from the pylon to the handle
        const from = this.tmp.set(b.x, b.obj.position.y + 1.4, b.z + 1.2);
        const to = this.tmp2.set(sx, this.skier.position.y + 0.95, sz - 0.5);
        this.rope.position.copy(from);
        this.rope.lookAt(to);
        this.rope.scale.set(1, 1, from.distanceTo(to));
      }
      if (b.z < f.boatZ - 420) {
        b.on = false; b.obj.visible = false; this.rope.visible = false;
        if (this.skier) this.skier.visible = false;
      }
    }
    const s = this.surfer;
    if (s?.on) {
      s.t += dt;
      const u = Math.min(1, s.t / s.speed);
      const p = SURF_COURSE.getPointAt(u, this.tmp);
      // her real velocity: along the course, plus the boat's speed (the course moves with the boat)
      const tan = SURF_COURSE.getTangentAt(u, this.tmp2);
      const vx = tan.x * SURF_SPEED, vz = tan.z * SURF_SPEED - f.speed;
      s.x = p.x; s.z = f.boatZ + p.z;
      // how hard she turns (for leaning into the loop)
      const ahead = SURF_COURSE.getTangentAt(Math.min(1, u + 0.02));
      const turn = Math.max(-1, Math.min(1, (tan.x * ahead.z - tan.z * ahead.x) * 25));
      // basic animation: bobbing on the swell, the board pitching, the rig swinging and pumping,
      // leaning out harder in the turn
      s.obj.position.set(s.x, surface(s.x, s.z) - 0.1 + Math.sin(time * 2.3) * 0.04, s.z);
      s.obj.rotation.set(Math.sin(time * 1.7) * 0.04, Math.atan2(vx, vz) + RIG.boardYaw, Math.sin(time * 1.1) * 0.05 - turn * 0.18);
      if (this.rig) {
        this.rig.rotation.y = RIG.yaw + Math.sin(time * 0.9) * 0.12 + turn * 0.25;
        this.rig.rotation.z = RIG.lean + Math.sin(time * 1.3) * 0.06 - Math.abs(turn) * 0.08;
        this.rig.rotation.x = Math.sin(time * 2.6) * 0.04;
      }
      s.spray -= dt;
      if (s.spray <= 0) {
        s.spray = 0.08;
        const tail = this.tmp.set(-vx, 0, -vz).normalize().multiplyScalar(1.1).add(s.obj.position);
        tail.y = 0;
        this.host.effects.bladeSplash(tail, 0.6 + Math.abs(turn) * 0.5);
        if (Math.random() < 0.3) this.host.effects.puddle(tail);
      }
      if (u >= 1) { s.on = false; s.obj.visible = false; }
    }
  }

  dispose() {
    this.rope.geometry.dispose(); (this.rope.material as THREE.Material).dispose();
    for (const g of this.gear) g.dispose();
  }
}
