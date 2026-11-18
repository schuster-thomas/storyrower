import * as THREE from 'three';
import type { StoryState } from '../../story/story';

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

/** Soft round dot so points don't render as squares. */
function dotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.8)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 32, 32);
  return new THREE.CanvasTexture(c);
}

export interface EffectsContext {
  dt: number;
  time: number;
  boatZ: number;
  /** boat speed in world units/s */
  speed: number;
  /** +1 = camera looks ahead (−z), −1 = camera looks back at the boat */
  viewDir: number;
  /** 0 = wave/danger on top of you, 1 = safe */
  threat: number;
  smoke: number;
  lava: number;
  story: StoryState;
}

interface Bomb { mesh: THREE.Mesh; from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number; active: boolean }
interface Ring { mesh: THREE.Mesh; age: number; active: boolean }

/**
 * Story effects on top of the river world: falling ash, glowing embers, bow spray,
 * lava bombs that splash down near the boat, splash rings and circling puffins.
 * Everything is pooled – nothing is allocated per frame.
 */
export class Effects {
  /** Called when a lava bomb hits the water; distance in world units from the boat. */
  onBombLanded: ((distance: number) => void) | null = null;

  private ash: THREE.Points;
  private ashVel: Float32Array;
  private embers: THREE.Points;
  private spray: THREE.Points;
  private sprayLife: Float32Array;
  private sprayVel: Float32Array;
  private sprayNext = 0;
  private bombs: Bomb[] = [];
  private bombTimer = 1;
  private rings: Ring[] = [];
  private puddles: Ring[] = [];
  private birds = new THREE.Group();
  private birdWings: THREE.Mesh[][] = [];
  private birdScale = 0;

  constructor(scene: THREE.Scene) {
    const dot = dotTexture();
    // Ash: dark flakes falling in a box around the boat
    const ashN = 900;
    const ashPos = new Float32Array(ashN * 3);
    this.ashVel = new Float32Array(ashN);
    for (let i = 0; i < ashN; i++) {
      ashPos.set([rnd(-35, 35), rnd(0, 30), rnd(-70, 15)], i * 3);
      this.ashVel[i] = rnd(1, 3);
    }
    const ashGeo = new THREE.BufferGeometry();
    ashGeo.setAttribute('position', new THREE.BufferAttribute(ashPos, 3));
    this.ash = new THREE.Points(ashGeo, new THREE.PointsMaterial({ map: dot, color: 0x3b3735, size: 0.4, transparent: true, opacity: 0, depthWrite: false }));
    this.ash.frustumCulled = false;

    // Embers: glowing sparks drifting down during the eruption
    const emN = 220;
    const emPos = new Float32Array(emN * 3);
    for (let i = 0; i < emN; i++) emPos.set([rnd(-30, 30), rnd(0, 35), rnd(-80, 20)], i * 3);
    const emGeo = new THREE.BufferGeometry();
    emGeo.setAttribute('position', new THREE.BufferAttribute(emPos, 3));
    this.embers = new THREE.Points(emGeo, new THREE.PointsMaterial({ map: dot, color: 0xff7a2a, size: 0.5, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    this.embers.frustumCulled = false;

    // Bow spray: short-lived white droplets
    const spN = 160;
    this.sprayLife = new Float32Array(spN);
    this.sprayVel = new Float32Array(spN * 3);
    const spGeo = new THREE.BufferGeometry();
    spGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(spN * 3).fill(-999), 3));
    this.spray = new THREE.Points(spGeo, new THREE.PointsMaterial({ map: dot, color: 0xffffff, size: 0.16, transparent: true, opacity: 0.8, depthWrite: false }));
    this.spray.frustumCulled = false;

    // Lava bombs and splash rings
    const bombGeo = new THREE.IcosahedronGeometry(0.9, 0);
    const bombMat = new THREE.MeshStandardMaterial({ color: 0x2a1a14, emissive: 0xff5a14, emissiveIntensity: 2.2, flatShading: true, fog: false });
    for (let i = 0; i < 8; i++) {
      const mesh = new THREE.Mesh(bombGeo, bombMat);
      mesh.visible = false;
      this.bombs.push({ mesh, from: new THREE.Vector3(), to: new THREE.Vector3(), t: 0, dur: 1, active: false });
      scene.add(mesh);
    }
    const ringGeo = new THREE.RingGeometry(0.8, 1.2, 24);
    ringGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 8; i++) {
      const mesh = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false }));
      mesh.visible = false;
      this.rings.push({ mesh, age: 0, active: false });
      scene.add(mesh);
    }

    // Puddles: white swirls the blades leave on the water at the finish
    const puddleGeo = new THREE.RingGeometry(0.18, 0.42, 20, 1, 0, Math.PI * 1.6);
    puddleGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < 12; i++) {
      const mesh = new THREE.Mesh(puddleGeo, new THREE.MeshBasicMaterial({ color: 0xf2fbff, transparent: true, opacity: 0, depthWrite: false }));
      mesh.visible = false;
      this.puddles.push({ mesh, age: 0, active: false });
      scene.add(mesh);
    }

    // Puffins: black body, white belly, orange beak – two flapping wings each
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x1d1d22, flatShading: true });
    const bellyMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, flatShading: true });
    const beakMat = new THREE.MeshStandardMaterial({ color: 0xff7a1a, flatShading: true });
    const wingGeo = new THREE.BufferGeometry();
    wingGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, -0.3, 0, 0, 0.35, 1.4, 0, 0.1]), 3));
    wingGeo.computeVertexNormals();
    for (let i = 0; i < 7; i++) {
      const bird = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.5, 3, 6), bodyMat);
      body.rotation.x = Math.PI / 2;
      const belly = new THREE.Mesh(new THREE.SphereGeometry(0.2, 6, 4), bellyMat);
      belly.position.set(0, -0.08, -0.1);
      const beak = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.25, 4), beakMat);
      beak.rotation.x = -Math.PI / 2;
      beak.position.z = -0.55;
      const wings = [1, -1].map((side) => {
        const w = new THREE.Mesh(wingGeo, new THREE.MeshStandardMaterial({ color: 0x1d1d22, side: THREE.DoubleSide, flatShading: true }));
        w.scale.x = side;
        bird.add(w);
        return w;
      });
      bird.add(body, belly, beak);
      this.birdWings.push(wings);
      this.birds.add(bird);
    }
    scene.add(this.ash, this.embers, this.spray, this.birds);
  }

  /** Draw only a share of the ash/ember/spray particles (graphics level). */
  setParticleShare(share: number) {
    for (const pts of [this.ash, this.embers, this.spray]) {
      const n = (pts.geometry.attributes.position as THREE.BufferAttribute).count;
      pts.geometry.setDrawRange(0, Math.max(1, Math.round(n * share)));
    }
  }

  update(c: EffectsContext) {
    this.updateAsh(c);
    this.updateEmbers(c);
    this.updateSpray(c);
    this.updateBombs(c);
    this.updateRings(c);
    this.updatePuddles(c.dt);
    this.updateBirds(c);
  }

  /** Burst of bombs right away (used by the eruption beat). */
  volley(c: Pick<EffectsContext, 'boatZ' | 'viewDir' | 'threat'>, count: number) {
    for (let i = 0; i < count; i++) this.launchBomb(c, rnd(0, 0.8));
  }

  private updateAsh(c: EffectsContext) {
    const amount = Math.max(c.story.ashfall, c.smoke * 0.6);
    const mat = this.ash.material as THREE.PointsMaterial;
    mat.opacity = Math.min(0.85, amount * 0.9);
    this.ash.visible = mat.opacity > 0.02;
    if (!this.ash.visible) return;
    const pos = this.ash.geometry.attributes.position as THREE.BufferAttribute;
    const a = pos.array as Float32Array;
    for (let i = 0; i < this.ashVel.length; i++) {
      let y = a[i * 3 + 1] - this.ashVel[i] * c.dt;
      let z = a[i * 3 + 2];
      a[i * 3] += Math.sin(c.time * 0.7 + i) * 0.4 * c.dt;
      // keep the flakes in a box that travels with the boat
      if (y < 0) y += 30;
      if (z > c.boatZ + 15) z -= 85;
      if (z < c.boatZ - 70) z += 85;
      a[i * 3 + 1] = y;
      a[i * 3 + 2] = z;
    }
    pos.needsUpdate = true;
  }

  private updateEmbers(c: EffectsContext) {
    const mat = this.embers.material as THREE.PointsMaterial;
    mat.opacity = Math.min(1, c.story.lavaBombs * c.lava * 1.1);
    this.embers.visible = mat.opacity > 0.02;
    if (!this.embers.visible) return;
    const pos = this.embers.geometry.attributes.position as THREE.BufferAttribute;
    const a = pos.array as Float32Array;
    for (let i = 0; i < a.length / 3; i++) {
      let y = a[i * 3 + 1] - (1.5 + (i % 5) * 0.4) * c.dt;
      let z = a[i * 3 + 2];
      a[i * 3] += Math.sin(c.time * 2 + i * 1.3) * 1.2 * c.dt;
      if (y < 0) y += 35;
      if (z > c.boatZ + 20) z -= 100;
      if (z < c.boatZ - 80) z += 100;
      a[i * 3 + 1] = y;
      a[i * 3 + 2] = z;
    }
    pos.needsUpdate = true;
  }

  private updateSpray(c: EffectsContext) {
    const pos = this.spray.geometry.attributes.position as THREE.BufferAttribute;
    const a = pos.array as Float32Array;
    const n = this.sprayLife.length;
    // emit proportional to speed
    let emit = c.speed * c.dt * 2.5;
    while (emit > Math.random()) {
      const i = this.sprayNext;
      this.sprayNext = (this.sprayNext + 1) % n;
      const side = Math.random() < 0.5 ? -1 : 1;
      a.set([side * rnd(0.05, 0.25), 0.18, c.boatZ - 3.9], i * 3);
      this.sprayVel.set([side * rnd(0.8, 2), rnd(1.2, 2.6), rnd(0.5, 2)], i * 3);
      this.sprayLife[i] = rnd(0.5, 0.9);
      emit -= 1;
    }
    for (let i = 0; i < n; i++) {
      if (this.sprayLife[i] <= 0) { a[i * 3 + 1] = -999; continue; }
      this.sprayLife[i] -= c.dt;
      this.sprayVel[i * 3 + 1] -= 9 * c.dt;
      a[i * 3] += this.sprayVel[i * 3] * c.dt;
      a[i * 3 + 1] += this.sprayVel[i * 3 + 1] * c.dt;
      a[i * 3 + 2] += this.sprayVel[i * 3 + 2] * c.dt;
    }
    pos.needsUpdate = true;
  }

  private launchBomb(c: Pick<EffectsContext, 'boatZ' | 'viewDir' | 'threat'>, delay = 0) {
    const b = this.bombs.find((x) => !x.active);
    if (!b) return;
    // Land where the camera can see it: ahead of the boat normally, behind it in the front view.
    // The worse you row (low threat value), the closer they land.
    const dist = 12 + c.threat * 35 + rnd(0, 15);
    const landZ = c.boatZ - c.viewDir * dist;
    b.to.set(rnd(-13, 13), 0, landZ);
    b.from.set(b.to.x + rnd(20, 50), rnd(45, 70), landZ - c.viewDir * rnd(40, 80));
    b.t = -delay;
    b.dur = rnd(1.8, 2.6);
    b.active = true;
  }

  private updateBombs(c: EffectsContext) {
    if (c.story.lavaBombs > 0) {
      this.bombTimer -= c.dt * c.story.lavaBombs;
      if (this.bombTimer <= 0) { this.bombTimer = rnd(1.2, 3); this.launchBomb(c); }
    }
    for (const b of this.bombs) {
      if (!b.active) continue;
      b.t += c.dt;
      if (b.t < 0) { b.mesh.visible = false; continue; }
      const k = b.t / b.dur;
      if (k >= 1) {
        b.active = false;
        b.mesh.visible = false;
        this.splash(b.to);
        this.onBombLanded?.(Math.abs(b.to.z - c.boatZ));
        continue;
      }
      b.mesh.visible = true;
      b.mesh.position.lerpVectors(b.from, b.to, k);
      b.mesh.position.y = b.from.y * (1 - k * k) + Math.sin(Math.PI * k) * 6;
      b.mesh.rotation.x += c.dt * 5;
      b.mesh.rotation.y += c.dt * 3;
    }
  }

  /** Blade entering the water at the catch: a little burst of droplets. */
  bladeSplash(at: THREE.Vector3, strength = 1) {
    const pos = this.spray.geometry.attributes.position as THREE.BufferAttribute;
    const a = pos.array as Float32Array;
    const n = Math.round(6 + strength * 6);
    for (let k = 0; k < n; k++) {
      const i = this.sprayNext;
      this.sprayNext = (this.sprayNext + 1) % this.sprayLife.length;
      a.set([at.x + rnd(-0.25, 0.25), 0.05, at.z + rnd(-0.15, 0.15)], i * 3);
      this.sprayVel.set([rnd(-0.9, 0.9), rnd(1.0, 2.2) * strength, rnd(-0.6, 0.9)], i * 3);
      this.sprayLife[i] = rnd(0.35, 0.6);
    }
  }

  /** Blade leaving the water at the finish: a swirl ("puddle") that stays behind on the water. */
  puddle(at: THREE.Vector3) {
    const p = this.puddles.find((x) => !x.active) ?? this.puddles.reduce((o, x) => (x.age > o.age ? x : o));
    p.active = true;
    p.age = 0;
    p.mesh.position.set(at.x, 0.06, at.z);
    p.mesh.rotation.y = Math.random() * Math.PI;
    p.mesh.visible = true;
  }

  private updatePuddles(dt: number) {
    for (const p of this.puddles) {
      if (!p.active) continue;
      p.age += dt;
      const k = p.age / 3;
      if (k >= 1) { p.active = false; p.mesh.visible = false; continue; }
      p.mesh.scale.setScalar(0.6 + k * 1.4);
      (p.mesh.material as THREE.MeshBasicMaterial).opacity = 0.75 * (1 - k) ** 1.5;
    }
  }

  private splash(at: THREE.Vector3) {
    const r = this.rings.find((x) => !x.active);
    if (!r) return;
    r.active = true;
    r.age = 0;
    r.mesh.position.set(at.x, 0.35, at.z);
    r.mesh.visible = true;
  }

  private updateRings(c: EffectsContext) {
    for (const r of this.rings) {
      if (!r.active) continue;
      r.age += c.dt;
      const k = r.age / 1.6;
      if (k >= 1) { r.active = false; r.mesh.visible = false; continue; }
      r.mesh.scale.setScalar(1 + k * 7);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - k);
    }
  }

  private updateBirds(c: EffectsContext) {
    this.birdScale += ((c.story.birds > 0 ? 1 : 0) - this.birdScale) * Math.min(1, c.dt * 0.8);
    this.birds.visible = this.birdScale > 0.02;
    if (!this.birds.visible) return;
    this.birds.children.forEach((bird, i) => {
      const a = c.time * 0.35 + (i / this.birds.children.length) * Math.PI * 2;
      const r = 14 + (i % 3) * 4;
      const cx = (i % 2 ? 8 : -8);
      bird.position.set(cx + Math.cos(a) * r, 11 + Math.sin(c.time * 0.9 + i) * 1.5 + (i % 3), c.boatZ - 45 + Math.sin(a) * r * 0.6);
      bird.rotation.y = -a;
      bird.scale.setScalar(this.birdScale * 1.4);
      const flap = Math.sin(c.time * 9 + i * 1.7) * 0.6;
      this.birdWings[i][0].rotation.z = flap;
      this.birdWings[i][1].rotation.z = -flap;
    });
  }
}
