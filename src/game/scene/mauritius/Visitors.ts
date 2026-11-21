import * as THREE from 'three';
import { placeModel, type Model } from '../models';
import type { Water } from '../Water';
import type { WorldHost } from '../World';
import { beachX } from './Beach';
import { lengthScale, type MauritiusKit } from './kit';

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/**
 * The stand-up paddler models (no paddle – the game adds one), measured with
 * scripts/levels/hands.mjs: the turn that lays the board along +z with the person facing forward,
 * the torso (x, z) and both fists after that turn, in units of the figure's height. The paddle is
 * held like a real one: the T-grip in the top fist, the shaft through the lower fist.
 */
const PADDLERS = [
  { yaw: 0.026, torso: [0.012, -0.065], top: [-0.031, 0.822, 0.193], low: [0.103, 0.615, 0.088] },
  { yaw: 3.323, torso: [0.137, 0.009], top: [-0.023, 0.769, 0.143], low: [0.341, 0.439, 0.317] },
] as const;
/** hip height (share of the figure's height): the upper body bends forward about it */
const HIP = 0.5;
const PADDLER_HEIGHT = 1.95;    // the figure from the board to the top of the head (m)
const STROKE = 2.2;             // seconds per paddle stroke
const FADE_IN = 3;              // seconds a new paddler takes to appear

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
 * A stand-up paddler: `speed` along the heading, `stroke` the phase of the paddle stroke (0–1),
 * `side` the side the paddle is on (±1, from the model's lower fist), `fade` 0–1 while appearing.
 */
interface Paddler {
  obj: THREE.Group; paddle: THREE.Group; mats: THREE.Material[];
  /** the fists and the hip pivot (y, z) in the figure's frame (board along +z), metres */
  top: THREE.Vector3; low: THREE.Vector3; hip: THREE.Vector2;
  /** how far the upper body is bent forward (radians, a uniform of its materials) */
  bend: { value: number };
  x: number; z: number; heading: number; speed: number; stroke: number; side: number; fade: number; on: boolean;
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
 * People enjoying the lagoon while the weather is fine: stand-up paddlers scattered over the water
 * (upright figures read from the low rowing camera, people lying in the water didn't), a speedboat
 * towing a water-skier that overtakes the rower on the open-sea side, and a windsurfer with a
 * bright sail who comes in from the left, sails a loop out ahead and leaves to the left again.
 * When the clouds gather nobody new comes out.
 */
export class Visitors {
  readonly group = new THREE.Group();
  private paddlers: Paddler[] = [];
  /** the first paddlers are in place (later ones start far ahead) */
  private placed = false;
  private boat: Runner | null = null;
  private skier: THREE.Group | null = null;
  private rope: THREE.Mesh;
  private surfer: Runner | null = null;
  private next = 14;
  private turn = 0;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private down = new THREE.Vector3(0, -1, 0);
  private fwd = new THREE.Vector3(0, 0, 1);
  private q = new THREE.Quaternion();
  /** geometry and materials of the windsurf rig */
  private gear: { dispose(): void }[] = [];
  private paddleParts: { shaft: THREE.BufferGeometry; blade: THREE.BufferGeometry; grip: THREE.BufferGeometry; dark: THREE.Material; blue: THREE.Material } | null = null;
  /** the windsurfer's mast, sail and boom (in the board's frame) */
  private rig: THREE.Group | null = null;

  constructor(private host: WorldHost, kit: MauritiusKit, private water: Water) {
    const { paddler, paddler2, speedboat, skier, surfer } = kit.models;
    const shadows = host.shadows;
    // stand-up paddlers: two models, alternating, each with its own paddle and its own materials (to fade in)
    const sups = [paddler, paddler2];
    for (let i = 0; i < 5; i++) {
      const k = i % 2, m = sups[k] ?? sups[1 - k];
      if (!m) break;
      const scale = PADDLER_HEIGHT;
      const obj = figure(m, scale * Math.max(1, m.width, m.depth), PADDLERS[k].yaw, shadows);
      const cfg = PADDLERS[k];
      const top = new THREE.Vector3(...cfg.top).multiplyScalar(scale), low = new THREE.Vector3(...cfg.low).multiplyScalar(scale);
      // the forward direction and the torso in the model's own (unturned) space, for the shader
      const fx = -Math.sin(cfg.yaw), fz = Math.cos(cfg.yaw);
      const tgx = cfg.torso[0] * Math.cos(cfg.yaw) - cfg.torso[1] * Math.sin(cfg.yaw), tgz = cfg.torso[0] * Math.sin(cfg.yaw) + cfg.torso[1] * Math.cos(cfg.yaw);
      const bend = { value: 0 };
      const mats: THREE.Material[] = [];
      // own materials (to fade in), and the upper body bending forward at the hips
      obj.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const mat = (mesh.material as THREE.Material).clone();
        mat.onBeforeCompile = (sh) => {
          sh.uniforms.uBend = bend;
          sh.vertexShader = sh.vertexShader.replace('#include <common>', `#include <common>
            uniform float uBend;`).replace('#include <begin_vertex>', `#include <begin_vertex>
            {
              // model space: height 0–1; everything above the hips leans forward about them
              vec2 f = vec2(${fx.toFixed(4)}, ${fz.toFixed(4)});
              float a = uBend * smoothstep(${(HIP - 0.08).toFixed(2)}, ${(HIP + 0.06).toFixed(2)}, transformed.y);
              float qy = transformed.y - ${HIP.toFixed(2)};
              float qz = dot(transformed.xz - vec2(${tgx.toFixed(4)}, ${tgz.toFixed(4)}), f);
              float c = cos(a), s = sin(a);
              transformed.y = ${HIP.toFixed(2)} + qy * c - qz * s;
              transformed.xz += f * (qy * s + qz * c - qz);
            }`);
        };
        // three.js shares compiled shaders by the hook's source text, which is the same for both
        // models – without its own key one model would bend the wrong way
        mat.customProgramCacheKey = () => `paddler-bend-${k}`;
        mesh.material = mat;
        mats.push(mat);
      });
      const paddle = this.paddle();
      paddle.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.material = (mesh.material as THREE.Material).clone();
        mats.push(mesh.material);
      });
      obj.add(paddle);
      obj.visible = false;
      this.group.add(obj);
      this.paddlers.push({ obj, paddle, mats, top, low, hip: new THREE.Vector2(HIP * scale, cfg.torso[1] * scale), bend, x: 0, z: 0, heading: 0, speed: 0, stroke: Math.random(), side: Math.sign(cfg.low[0] - cfg.top[0]) || 1, fade: 1, on: false });
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
   * A stand-up paddle held at the very end: the T-grip at the origin (in the fists), the shaft down
   * along −y, the blade at its end. It turns about the hands, so it never leaves them.
   */
  private paddle() {
    if (!this.paddleParts) {
      const shaft = new THREE.CylinderGeometry(0.018, 0.018, 1.7, 5);
      shaft.translate(0, -0.85, 0);
      const blade = new THREE.BoxGeometry(0.2, 0.42, 0.025);
      blade.translate(0, -1.85, 0.02);
      const grip = new THREE.BoxGeometry(0.13, 0.035, 0.035);
      const dark = new THREE.MeshStandardMaterial({ color: 0x23262e, roughness: 0.45 });
      const blue = new THREE.MeshStandardMaterial({ color: 0x1d5fd6, roughness: 0.4 });
      this.gear.push(shaft, blade, grip, dark, blue);
      this.paddleParts = { shaft, blade, grip, dark, blue };
    }
    const p = this.paddleParts;
    const g = new THREE.Group();
    g.add(new THREE.Mesh(p.shaft, p.dark), new THREE.Mesh(p.blade, p.blue), new THREE.Mesh(p.grip, p.dark));
    g.rotation.order = 'YXZ';
    return g;
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

    // ---------- stand-up paddlers: scattered over the lagoon, paddling gently, hardly moving ----------
    for (const p of this.paddlers) {
      if (!p.on || p.z > f.boatZ + 25) {
        p.on = false;
        p.obj.visible = false;
        if (!out) continue;
        // a new one far ahead in the haze – small at first, bigger as the boat comes closer, until it
        // rows past (at the start of the game they are spread over the whole stretch); mostly in the
        // lagoon towards the beach, now and then on the sea side, never in the rowing lane
        p.z = f.boatZ - (this.placed ? rnd(260, 450) : rnd(40, 450));
        p.x = Math.random() < 0.7 ? rnd(9, beachX(p.z) - 4) : -rnd(10, 26);
        p.heading = rnd(0, Math.PI * 2);
        p.speed = rnd(0.1, 0.25);
        // the first ones are simply there when the scene appears (like the palms); later ones fade in far out
        p.fade = this.placed ? 0 : 1;
        for (const m of p.mats) { m.transparent = p.fade < 1; m.opacity = p.fade; m.needsUpdate = true; }
        p.on = true;
        p.obj.visible = true;
      }
      if (p.fade < 1) {
        p.fade = Math.min(1, p.fade + dt / FADE_IN);
        const see = p.fade < 1;
        // (transparent switches the shader variant: recompile only when it changes)
        for (const m of p.mats) { if (m.transparent !== see) { m.transparent = see; m.needsUpdate = true; } m.opacity = p.fade; }
      }
      // the stroke, as in the reference (assets.mjs 'sup-stroke'), driven by the body: (1) reach &
      // catch – bent forward at the hips, the blade goes in in front; (2) pull – straightening up,
      // the blade moves back along the board; (3) exit at the feet; (4) recovery – the blade swings
      // forward out to the side above the water. Both fists stay on the paddle (a little give in the
      // recovery, when the lower hand would turn the shaft).
      const before = p.stroke;
      p.stroke = (p.stroke + dt / STROKE) % 1;
      const k = p.stroke;
      const ease = (x: number) => { const c = Math.max(0, Math.min(1, x)); return c * c * (3 - 2 * c); };
      const lerp = (a: number, b: number, x: number) => a + (b - a) * ease(x);
      let bend: number, roll: number;
      if (k < 0.1) { bend = 0.55; roll = 0; }                                                  // catch
      else if (k < 0.55) { bend = lerp(0.55, 0.05, (k - 0.1) / 0.45); roll = 0; }              // pull
      else if (k < 0.68) { const t = (k - 0.55) / 0.13; bend = lerp(0.05, 0.12, t); roll = lerp(0, 0.35, t); }   // exit
      else { const t = (k - 0.68) / 0.32; bend = lerp(0.12, 0.55, t); roll = lerp(0.35, 0, Math.max(0, t * 1.5 - 0.5)); }   // recovery
      p.bend.value = bend;
      // both fists follow the bend about the hips; the paddle hangs from the top fist through the lower one
      const c = Math.cos(bend), sn = Math.sin(bend);
      const bent = (v: THREE.Vector3, out: THREE.Vector3) => {
        const y = v.y - p.hip.x, z = v.z - p.hip.y;
        return out.set(v.x, p.hip.x + y * c - z * sn, p.hip.y + y * sn + z * c);
      };
      const t1 = bent(p.top, this.tmp), t2 = bent(p.low, this.tmp2);
      p.paddle.position.copy(t1);
      p.paddle.quaternion.setFromUnitVectors(this.down, t2.sub(t1).normalize());
      // recovery: the blade swings out and up to the side, about the top fist
      if (roll) p.paddle.quaternion.premultiply(this.q.setFromAxisAngle(this.fwd, -p.side * roll));
      // the board glides only a little, surging with each pull
      const pull = k >= 0.1 && k < 0.55;
      const surge = pull ? Math.sin(((k - 0.1) / 0.45) * Math.PI) : 0;
      p.heading += Math.sin(time * 0.12 + p.x) * dt * 0.04 - p.side * surge * dt * 0.03;
      p.x += Math.sin(p.heading) * p.speed * (0.4 + surge) * dt;
      p.z += Math.cos(p.heading) * p.speed * (0.4 + surge) * dt;
      if (p.x > 0) p.x = Math.max(8, Math.min(beachX(p.z) - 3, p.x));
      else p.x = Math.min(-8, p.x);
      p.obj.position.set(p.x, surface(p.x, p.z) - 0.06 + Math.sin(time * 1.9 + p.x) * 0.02, p.z);
      p.obj.rotation.set(Math.sin(time * 1.3 + p.z) * 0.02, p.heading, Math.sin(time * 1.1 + p.x) * 0.03 + p.side * 0.02);
      if (p.fade > 0.5 && ((before < 0.1 && k >= 0.1) || (before < 0.58 && k >= 0.58))) {
        // the blade going in (splash) and coming out (a swirl stays behind)
        p.obj.updateMatrixWorld(true);
        const blade = this.tmp.set(0, -1.85, 0).applyMatrix4(p.paddle.matrixWorld);
        blade.y = 0;
        if (k < 0.3) this.host.effects.bladeSplash(blade, 0.55); else this.host.effects.puddle(blade);
      }
    }

    this.placed = true;

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
    for (const p of this.paddlers) for (const m of p.mats) m.dispose();
  }
}
