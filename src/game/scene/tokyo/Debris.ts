import * as THREE from 'three';
import { glacierFront } from '../Fjord';
import type { Effects } from '../Effects';
import type { WorldHost } from '../World';
import type { FacadeSpot } from './Banks';
import { puffTexture } from './textures';

const PIECES = 12;
const DUST = 24;
const GRAVITY = 9.8;
const rnd = (a: number, b: number) => a + Math.random() * (b - a);

interface Piece { mesh: THREE.Mesh; vel: THREE.Vector3; spin: THREE.Vector3; active: boolean; inWater: number; dustTimer: number }
interface Dust { sprite: THREE.Sprite; age: number; life: number; size: number; active: boolean }

/**
 * The great quake: slabs of facade break off the high-rises on the city bank and tumble into the
 * river – a cloud of dust where they break off, a dust trail, a big splash where they hit the water,
 * then they sink. Only fronts ahead of the boat (where the camera looks) are used.
 */
export class Debris {
  readonly group = new THREE.Group();
  private pieces: Piece[] = [];
  private dust: Dust[] = [];
  private timer = 2;
  private dustMat: THREE.SpriteMaterial;
  private tmp = new THREE.Vector3();

  constructor(private host: WorldHost, facades: THREE.Material[]) {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < PIECES; i++) {
      const mesh = new THREE.Mesh(geo, facades[i % facades.length]);
      mesh.visible = false;
      mesh.castShadow = true;
      this.pieces.push({ mesh, vel: new THREE.Vector3(), spin: new THREE.Vector3(), active: false, inWater: 0, dustTimer: 0 });
      this.group.add(mesh);
    }
    this.dustMat = new THREE.SpriteMaterial({ map: puffTexture(), color: 0xd8cbb4, transparent: true, depthWrite: false, opacity: 0.7 });
    for (let i = 0; i < DUST; i++) {
      const sprite = new THREE.Sprite(this.dustMat.clone());
      sprite.visible = false;
      this.dust.push({ sprite, age: 0, life: 3, size: 4, active: false });
      this.group.add(sprite);
    }
  }

  private get effects(): Effects { return this.host.effects; }

  /** Break `count` pieces off right away (the first shock of the great quake). */
  volley(spots: FacadeSpot[], boatZ: number, count: number) {
    for (let i = 0; i < count; i++) this.spawn(spots, boatZ, i * 0.5);
  }

  private spawn(spots: FacadeSpot[], boatZ: number, delay = 0) {
    // fronts ahead of the boat that the camera sees well
    const near = spots.filter((s) => s.z < boatZ - 22 && s.z > boatZ - 120);
    const spot = near[Math.floor(Math.random() * near.length)];
    const p = this.pieces.find((x) => !x.active);
    if (!spot || !p) return;
    const w = rnd(3, Math.min(9, spot.width * 0.7)), h = rnd(2.5, 5.5), d = rnd(0.7, 1.4);
    p.mesh.scale.set(d, h, w);
    p.mesh.position.set(spot.x + 0.3, 2.4 + rnd(spot.height * 0.35, spot.height * 0.85), spot.z + rnd(-spot.width / 3, spot.width / 3));
    p.mesh.rotation.set(0, 0, 0);
    p.vel.set(-rnd(5, 9), rnd(0, 2.5), rnd(-1, 1));
    p.spin.set(rnd(-0.8, 0.8), rnd(-0.4, 0.4), rnd(0.6, 1.6));
    p.active = true;
    p.inWater = 0;
    p.dustTimer = -delay;
    p.mesh.visible = delay <= 0;
    p.mesh.userData.delay = delay;
    this.puff(p.mesh.position, 8, 3);
  }

  private puff(at: THREE.Vector3, size: number, life: number) {
    const d = this.dust.find((x) => !x.active) ?? this.dust.reduce((o, x) => (x.age / x.life > o.age / o.life ? x : o));
    d.active = true; d.age = 0; d.life = life; d.size = size;
    d.sprite.position.copy(at);
    d.sprite.visible = true;
  }

  update(f: { dt: number; boatZ: number; quake: number; light: number; spots: FacadeSpot[] }) {
    // aftershocks keep breaking pieces off, more in hard sections
    if (f.quake > 0) {
      this.timer -= f.dt * f.quake;
      if (this.timer <= 0) { this.timer = rnd(2.2, 4.5); this.spawn(f.spots, f.boatZ); }
    }
    for (const p of this.pieces) {
      if (!p.active) continue;
      const delay = p.mesh.userData.delay as number;
      if (delay > 0) { p.mesh.userData.delay = delay - f.dt; if (delay - f.dt <= 0) p.mesh.visible = true; continue; }
      const m = p.mesh;
      if (p.inWater > 0) {
        // sinking, slowly tipping over
        p.inWater += f.dt;
        m.position.y -= f.dt * 0.9;
        m.rotation.z += f.dt * 0.2;
        if (p.inWater > 4.5) { p.active = false; m.visible = false; }
        continue;
      }
      p.vel.y -= GRAVITY * f.dt;
      m.position.addScaledVector(p.vel, f.dt);
      m.rotation.x += p.spin.x * f.dt; m.rotation.y += p.spin.y * f.dt; m.rotation.z += p.spin.z * f.dt;
      p.dustTimer += f.dt;
      if (p.dustTimer > 0.12) { p.dustTimer = 0; this.puff(m.position, 3, 1.6); }
      const overLand = m.position.x > glacierFront(m.position.z) + 0.5;
      if (overLand && m.position.y < 2.4 + m.scale.y / 2) {
        // came down on the promenade: stays there in a cloud of dust
        m.position.y = 2.4 + m.scale.y / 2;
        p.inWater = 0.01; p.vel.set(0, 0, 0);
        this.puff(m.position, 9, 3);
        this.host.sound('debris', Math.abs(m.position.z - f.boatZ));
        continue;
      }
      if (m.position.y < 0.5) {
        p.inWater = 0.01;
        this.tmp.set(m.position.x, 0, m.position.z);
        this.effects.impact(this.tmp, 16, 2.6);
        const dist = Math.abs(m.position.z - f.boatZ);
        this.host.sound('debris', dist);
        if (dist < 45) { this.host.shake(0.35); this.host.rock(0.06); }
      }
    }
    for (const d of this.dust) {
      if (!d.active) continue;
      d.age += f.dt;
      const k = d.age / d.life;
      if (k >= 1) { d.active = false; d.sprite.visible = false; continue; }
      d.sprite.scale.setScalar(d.size * (0.5 + Math.sqrt(k) * 1.2));
      d.sprite.position.y += f.dt * 0.8;
      const mat = d.sprite.material as THREE.SpriteMaterial;
      mat.opacity = 0.65 * (1 - k) * Math.min(1, k * 8);
      mat.color.setRGB(0.85 * f.light, 0.8 * f.light, 0.71 * f.light);
    }
  }

  dispose() {
    this.pieces[0]?.mesh.geometry.dispose();
    this.dustMat.map?.dispose();
    this.dustMat.dispose();
    for (const d of this.dust) (d.sprite.material as THREE.Material).dispose();
  }
}
