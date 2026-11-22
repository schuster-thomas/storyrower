import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { placeModel, type Model } from '../models';
import type { Water } from '../Water';
import type { WorldHost } from '../World';
import { lengthScale, type MauritiusKit } from './kit';

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/**
 * The stand-up paddlers – one woman, one man – each come out once or twice per workout, one at a
 * time, while the weather is fine: far ahead on the left over open water (the beach is on the
 * right), and never together with the speedboat or the windsurfer, who use the same water.
 */
const PADDLER_TIMES = [1, 2];       // appearances per paddler (picked per workout)
const PADDLER_FIRST = [12, 25];     // seconds of fine weather before the first one
const PADDLER_GAP = [70, 130];      // seconds of fine weather between one passing and the next
const PADDLER_AHEAD = [170, 220];   // where one appears (m ahead of the boat)
const PADDLER_X = [-17, -10];       // … and how far left (the rowing lane is around x = 0)
const FADE_IN = 3;                  // seconds a paddler takes to appear (or to fade away)
/**
 * Phases of the paddlers' baked stroke (scripts/blender/paddler.py, 0–1): the blade goes in, the
 * pull (the board surges), the blade comes out.
 */
const BLADE_IN = 0.05, PULL_FROM = 0.1, PULL_TO = 0.55, BLADE_OUT = 0.6;

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

/**
 * A stand-up paddler (a rigged model playing its stroke): `speed` along the heading, `stroke` the
 * phase of the paddle stroke (0–1), `side` the side the paddle is on (±1 along the figure's x; facing
 * +z the right is −x), `fade` 0–1 while appearing, `times` the appearances still to come,
 * `leaving` fading away far out when the clouds gather.
 */
interface Paddler {
  obj: THREE.Object3D; mixer: THREE.AnimationMixer; duration: number; mats: THREE.Material[];
  /** the blade's centre (a marker on the paddle bone) */
  blade: THREE.Object3D | null;
  x: number; z: number; heading: number; speed: number; stroke: number; side: number; fade: number; on: boolean;
  times: number; leaving: boolean;
}
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
 * People enjoying the lagoon while the weather is fine: now and then a stand-up paddler out on the
 * water (upright figures read from the low rowing camera, people lying in the water didn't), a speedboat
 * towing a water-skier that overtakes the rower on the open-sea side, and a windsurfer with a
 * bright sail who comes in from the left, sails a loop out ahead and leaves to the left again.
 * They take turns on the open water on the left – only one of them is out at a time. When the
 * clouds gather nobody new comes out.
 */
export class Visitors {
  readonly group = new THREE.Group();
  private paddlers: Paddler[] = [];
  /** seconds of fine weather until the next paddler may come out, and who came out last */
  private paddlerNext = rnd(PADDLER_FIRST[0], PADDLER_FIRST[1]);
  private lastPaddler = -1;
  private boat: Runner | null = null;
  private skier: THREE.Group | null = null;
  private rope: THREE.Mesh;
  private surfer: Runner | null = null;
  private next = 14;
  private turn = 0;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  /** geometry and materials of the windsurf rig */
  private gear: { dispose(): void }[] = [];
  /** the windsurfer's mast, sail and boom (in the board's frame) */
  private rig: THREE.Group | null = null;

  constructor(private host: WorldHost, kit: MauritiusKit, private water: Water) {
    const { speedboat, skier, surfer } = kit.models;
    const shadows = host.shadows;
    // stand-up paddlers: the two rigged models, each with its own skeleton and its own materials
    // (to fade in). The models face +z, the board's underside at y = 0; the woman paddles on her
    // right, the man on his left.
    for (let k = 0; k < kit.paddlers.length; k++) {
      const gltf = kit.paddlers[k];
      const obj = cloneSkinned(gltf.scene);
      const mats: THREE.Material[] = [];
      obj.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = shadows;
        mesh.receiveShadow = true;
        // the bounds of a skinned (and quantised) mesh don't follow its pose
        mesh.frustumCulled = false;
        const own = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((m) => m.clone());
        mesh.material = Array.isArray(mesh.material) ? own : own[0];
        mats.push(...own);
      });
      const mixer = new THREE.AnimationMixer(obj);
      const clip = new THREE.AnimationClip('Stroke', -1, gltf.animations.flatMap((a) => a.tracks));
      mixer.clipAction(clip).play();
      obj.visible = false;
      this.group.add(obj);
      this.paddlers.push({ obj, mixer, duration: clip.duration || 1, mats, blade: obj.getObjectByName('Blade') ?? null, x: 0, z: 0, heading: 0, speed: 0, stroke: Math.random(), side: k === 0 ? -1 : 1, fade: 1, on: false, times: Math.random() < 0.5 ? PADDLER_TIMES[0] : PADDLER_TIMES[1], leaving: false });
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
  speedboatNow(boatZ: number) { if (this.boat && !this.leftBusy) this.launchBoat(boatZ); else this.next = Math.min(this.next, 3); }

  /** The speedboat, the windsurfer and the paddlers share the open water on the left: one at a time. */
  private get leftBusy() { return !!(this.boat?.on || this.surfer?.on || this.paddlers.some((p) => p.on)); }

  /** A paddler far ahead on the left, fading in out of the haze. */
  private launchPaddler(p: Paddler, boatZ: number) {
    p.times--;
    p.on = true;
    p.leaving = false;
    p.z = boatZ - rnd(PADDLER_AHEAD[0], PADDLER_AHEAD[1]);
    p.x = rnd(PADDLER_X[0], PADDLER_X[1]);
    // paddling along the shore, one way or the other – seen from the side, from ahead or behind
    p.heading = (Math.random() < 0.5 ? 0 : Math.PI) + rnd(-0.7, 0.7);
    p.speed = rnd(0.15, 0.3);
    p.fade = 0;
    for (const m of p.mats) { m.transparent = true; m.opacity = 0; m.needsUpdate = true; }
    p.obj.visible = true;
  }

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

    // ---------- stand-up paddlers: one at a time, now and then ----------
    if (out && !this.leftBusy) {
      this.paddlerNext -= dt;
      const ready = this.paddlers.filter((p) => p.times > 0);
      if (this.paddlerNext <= 0 && ready.length) {
        // the woman and the man take turns
        const p = ready.find((q) => this.paddlers.indexOf(q) !== this.lastPaddler) ?? ready[0];
        this.lastPaddler = this.paddlers.indexOf(p);
        this.launchPaddler(p, f.boatZ);
        this.paddlerNext = rnd(PADDLER_GAP[0], PADDLER_GAP[1]);
      }
    }
    for (const p of this.paddlers) {
      if (!p.on) continue;
      if (p.z > f.boatZ + 25) { p.on = false; p.obj.visible = false; continue; }
      // the clouds gather: one still far out heads for the beach – it fades away in the haze (and
      // keeps its turn for the evening)
      if (!out && !p.leaving && p.z < f.boatZ - 120) { p.leaving = true; p.times++; }
      const fade = p.leaving ? Math.max(0, p.fade - dt / FADE_IN) : Math.min(1, p.fade + dt / FADE_IN);
      if (fade !== p.fade) {
        p.fade = fade;
        const see = p.fade < 1;
        // (transparent switches the shader variant: recompile only when it changes)
        for (const m of p.mats) { if (m.transparent !== see) { m.transparent = see; m.needsUpdate = true; } m.opacity = p.fade; }
      }
      if (p.leaving && p.fade <= 0) { p.on = false; p.obj.visible = false; continue; }
      // the stroke (baked: both hands on the paddle, the blade in far ahead, pulled back along the
      // board to the feet, out, and forward again above the water)
      const before = p.stroke;
      p.stroke = (p.stroke + dt / p.duration) % 1;
      const k = p.stroke;
      p.mixer.setTime(k * p.duration);
      // the board glides only a little, surging with each pull
      const pull = k >= PULL_FROM && k < PULL_TO;
      const surge = pull ? Math.sin(((k - PULL_FROM) / (PULL_TO - PULL_FROM)) * Math.PI) : 0;
      p.heading += Math.sin(time * 0.12 + p.x) * dt * 0.04 - p.side * surge * dt * 0.03;
      p.x += Math.sin(p.heading) * p.speed * (0.4 + surge) * dt;
      p.z += Math.cos(p.heading) * p.speed * (0.4 + surge) * dt;
      p.x = Math.max(PADDLER_X[0] - 3, Math.min(PADDLER_X[1] + 2, p.x));
      p.obj.position.set(p.x, surface(p.x, p.z) - 0.06 + Math.sin(time * 1.9 + p.x) * 0.02, p.z);
      p.obj.rotation.set(Math.sin(time * 1.3 + p.z) * 0.02, p.heading, Math.sin(time * 1.1 + p.x) * 0.03 + p.side * 0.02);
      if (p.blade && p.fade > 0.5 && ((before < BLADE_IN && k >= BLADE_IN) || (before < BLADE_OUT && k >= BLADE_OUT))) {
        // the blade going in (splash) and coming out (a swirl stays behind)
        p.obj.updateMatrixWorld(true);
        const blade = p.blade.getWorldPosition(this.tmp);
        blade.y = 0;
        if (k < 0.3) this.host.effects.bladeSplash(blade, 0.55); else this.host.effects.puddle(blade);
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
    for (const p of this.paddlers) { p.mixer.stopAllAction(); for (const m of p.mats) m.dispose(); }
  }
}
