import * as THREE from 'three';
import { placeModel, type Model } from '../models';
import type { Water } from '../Water';
import type { WorldHost } from '../World';
import { beachX } from './Beach';
import { lengthScale, type MauritiusKit } from './kit';

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

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
 * People enjoying the lagoon while the weather is fine: snorkelers floating face down in the
 * shallows (their fins splash), a speedboat towing a water-skier that overtakes the rower on the
 * open-sea side, and a surfer gliding past. When the clouds gather nobody new comes out.
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

  constructor(private host: WorldHost, kit: MauritiusKit, private water: Water) {
    const { snorkeler, speedboat, skier, surfer } = kit.models;
    const shadows = host.shadows;
    // the snorkeler's head points to +x in the model
    if (snorkeler) for (let i = 0; i < 4; i++) {
      const obj = figure(snorkeler, 1.85, -Math.PI / 2, shadows);
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
      const obj = figure(surfer, 2.8, 0, shadows);
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

  /** A speedboat right now (the "visitors" beat), unless one is out already. */
  speedboatNow(boatZ: number) { if (this.boat && !this.boat.on) this.launchBoat(boatZ); else this.next = Math.min(this.next, 3); }

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
    s.x = -rnd(14, 26); s.z = boatZ - 230; s.speed = rnd(4.5, 6);
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
        s.z = f.boatZ - rnd(90, 320);
        s.x = rnd(7, beachX(s.z) - 6);
        s.heading = rnd(0, Math.PI * 2);
        s.drift = rnd(0.2, 0.5);
        s.on = true;
        s.obj.visible = true;
      }
      s.heading += Math.sin(time * 0.2 + s.kick * 9) * dt * 0.15;
      s.x += Math.sin(s.heading) * s.drift * dt;
      s.z += Math.cos(s.heading) * s.drift * dt;
      s.obj.position.set(s.x, surface(s.x, s.z) - 0.12, s.z);
      s.obj.rotation.set(Math.sin(time * 1.3 + s.kick * 5) * 0.04, s.heading, Math.sin(time * 1.1 + s.kick) * 0.06);
      // the fins kick little splashes now and then
      s.kick += dt * 1.6;
      if (s.kick >= 1) {
        s.kick -= 1;
        const feet = this.tmp.set(0, 0, -0.95).applyAxisAngle(this.tmp2.set(0, 1, 0), s.heading).add(s.obj.position);
        feet.y = 0;
        this.host.effects.bladeSplash(feet, 0.35);
      }
    }

    // ---------- now and then a speedboat with a water-skier, or a surfer ----------
    if (out) {
      this.next -= dt;
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
      s.z += s.speed * dt;
      s.x += Math.sin(s.t * 0.4) * dt * 1.5;
      s.obj.position.set(s.x, surface(s.x, s.z) - 0.02, s.z);
      s.obj.rotation.set(Math.sin(time * 1.4) * 0.04, Math.PI / 2 + Math.sin(s.t * 0.4) * 0.2, Math.sin(time * 1.1) * 0.06);
      s.spray -= dt;
      if (s.spray <= 0) { s.spray = 0.1; this.host.effects.bladeSplash(this.tmp.set(s.x, 0, s.z - 1.2), 0.8); }
      if (s.z > f.boatZ + 30) { s.on = false; s.obj.visible = false; }
    }
  }

  dispose() { this.rope.geometry.dispose(); (this.rope.material as THREE.Material).dispose(); }
}
