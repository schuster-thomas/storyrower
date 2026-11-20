import * as THREE from 'three';

/**
 * Gates the boat rows through when something changes:
 * - target gate: two glossy ball buoys with a translucent arch of light over the water and a
 *   frosted glass sign in the middle that shows the new target (split and stroke rate), in the
 *   colour of the coming section;
 * - finish gate: two golden glass spar buoys with lamps and pennants, a checkered glass banner
 *   between them and a burst of confetti when the boat passes.
 *
 * The workout decides *when* the boat passes (the target changes on the workout clock, not at a
 * place), so a gate is put where the boat will be at that moment – from the recent speed – and
 * then drifts unnoticeably so that it really is at the boat when the time comes.
 */

export interface GateInfo {
  /** changes when a new gate is due (e.g. the start time of the coming section) */
  key: string;
  kind: 'target' | 'finish';
  /** real seconds until the boat should pass */
  timeTo: number;
  color: number;
  /** target gate: big split ("2:31") and stroke rate ("26 spm") */
  split?: string;
  spm?: string;
}

/** How long before the change the gate appears (s). */
const LEAD = 16;
/** No further away than this (inside the haze). */
const MAX_AHEAD = 280;
const ARCH_R = 6;        // half the gate width – the oars reach ~3.2 m to each side
const FINISH_HALF = 6.8;

const lighter = (c: number, k: number) => new THREE.Color(c).lerp(new THREE.Color(0xffffff), k);

interface Gate {
  key: string;
  kind: GateInfo['kind'];
  color: number;
  group: THREE.Group;
  z: number;
  fade: number;
  passed: boolean;
  /** materials whose opacity follows the fade, with their full opacity */
  fades: [THREE.Material & { opacity: number }, number][];
  floats: THREE.Object3D[];
  sparkles: THREE.Points;
  sparkleSeed: Float32Array;
  pennants: THREE.Mesh[];
  dispose: () => void;
}

class ArchCurve extends THREE.Curve<THREE.Vector3> {
  constructor(private r: number, private lift: number) { super(); }
  getPoint(t: number, target = new THREE.Vector3()) {
    const a = Math.PI * (1 - t);
    return target.set(Math.cos(a) * this.r, this.lift + Math.sin(a) * this.r, 0);
  }
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Frosted glass sign with the target, drawn once per gate. */
function signTexture(color: number, split: string, spm: string) {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 400;
  const g = c.getContext('2d')!;
  const col = `#${new THREE.Color(color).getHexString()}`;
  g.shadowColor = col; g.shadowBlur = 36;
  roundRect(g, 28, 28, 968, 344, 60);
  g.fillStyle = 'rgba(255, 255, 255, 0.62)';
  g.fill();
  g.lineWidth = 14; g.strokeStyle = col; g.stroke();
  g.shadowBlur = 0;
  g.fillStyle = '#13244b';
  g.textAlign = 'center'; g.textBaseline = 'alphabetic';
  g.font = '900 190px Nunito, system-ui, sans-serif';
  const sw = g.measureText(split).width;
  g.font = '800 64px Nunito, system-ui, sans-serif';
  const uw = g.measureText(' /500 m').width;
  const x0 = 512 - (sw + uw) / 2;
  g.textAlign = 'left';
  g.font = '900 190px Nunito, system-ui, sans-serif';
  g.fillText(split, x0, 222);
  g.font = '800 64px Nunito, system-ui, sans-serif';
  g.fillStyle = '#33415c';
  g.fillText(' /500 m', x0 + sw, 222);
  g.textAlign = 'center';
  g.fillStyle = '#13244b';
  g.font = '900 104px Nunito, system-ui, sans-serif';
  g.fillText(spm, 512, 336);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Checkered glass banner for the finish. */
function checkerTexture() {
  const c = document.createElement('canvas');
  c.width = 1536; c.height = 288;
  const g = c.getContext('2d')!;
  const cols = 16, rows = 3, pad = 18;
  const w = (c.width - 2 * pad) / cols, h = (c.height - 2 * pad) / rows;
  for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
    g.fillStyle = (x + y) % 2 ? 'rgba(24, 26, 40, 0.82)' : 'rgba(255, 252, 240, 0.6)';
    g.fillRect(pad + x * w, pad + y * h, w, h);
  }
  g.shadowColor = '#ffc83d'; g.shadowBlur = 24;
  g.lineWidth = 14; g.strokeStyle = '#ffd25a';
  g.strokeRect(pad, pad, c.width - 2 * pad, c.height - 2 * pad);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

let dotTex: THREE.Texture | null = null;
/** A soft round dot (points are square without a texture). */
function dot() {
  if (dotTex) return dotTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.35, 'rgba(255,255,255,0.85)'); r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
  dotTex = new THREE.CanvasTexture(c);
  return dotTex;
}

function sparkles(count: number, color: number, size: number) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(count * 3), 3));
  const mat = new THREE.PointsMaterial({ color, size: size * 1.6, map: dot(), transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  const seed = new Float32Array(count * 3);
  for (let i = 0; i < seed.length; i++) seed[i] = Math.random();
  return { pts, seed };
}

export class Gates {
  readonly group = new THREE.Group();
  private gates: Gate[] = [];
  private speedAvg = 0;
  private confetti: { pts: THREE.Points; vel: Float32Array; age: number } | null = null;
  /** a gate was passed – the scene flashes, the finish throws confetti */
  onPass: ((kind: GateInfo['kind'], color: number) => void) | null = null;

  update(f: { dt: number; time: number; boatZ: number; speed: number; moving: boolean; info: GateInfo | null; surfaceAt: (x: number, z: number) => number }) {
    const { dt, boatZ } = f;
    if (f.moving && f.speed > 0.3) this.speedAvg += (f.speed - this.speedAvg) * (1 - Math.exp(-dt / 6));
    const info = f.info;
    const current = this.gates.find((g) => !g.passed);

    // the due gate changed (or is gone): the current one has just been passed
    if (current && (!info || info.key !== current.key)) {
      current.passed = true;
      this.onPass?.(current.kind, current.color);
      if (current.kind === 'finish') this.burst(current.z);
    }
    // a new gate is due soon: put it where the boat will be then
    if (info && info.timeTo <= LEAD && !this.gates.some((g) => g.key === info.key)) {
      const v = this.speedAvg > 1 ? this.speedAvg : Math.max(f.speed, 6);
      const g = info.kind === 'finish' ? this.buildFinish(info) : this.buildTarget(info);
      g.z = boatZ - Math.min(MAX_AHEAD, Math.max(12, v * info.timeTo));
      this.gates.push(g);
      this.group.add(g.group);
    }
    // keep the due gate on course to meet the boat exactly on time
    const due = info ? this.gates.find((g) => g.key === info.key && !g.passed) : undefined;
    if (due && info && f.moving) {
      const pred = boatZ - Math.max(0, (this.speedAvg > 1 ? this.speedAvg : f.speed) * info.timeTo);
      const k = info.timeTo < 2 ? 1 - Math.exp(-dt * 4) : 1 - Math.exp(-dt * 0.5);
      due.z += (pred - due.z) * k;
      if (info.timeTo > 0.4) due.z = Math.min(due.z, boatZ - 1.5);
    }

    for (const g of [...this.gates]) {
      g.fade = Math.min(1, g.fade + dt / 1.6);
      // passed and well behind: fade out and go
      const behind = g.z - boatZ;
      const out = g.passed ? Math.max(0, Math.min(1, (behind - 40) / 30)) : 0;
      const a = g.fade * (1 - out);
      for (const [m, full] of g.fades) m.opacity = full * a;
      g.group.visible = a > 0.01;
      g.group.position.set(0, 0, g.z);
      for (const o of g.floats) o.position.y = f.surfaceAt(o.position.x, g.z) + (o.userData.lift as number);
      this.animateSparkles(g, f.time);
      g.pennants.forEach((p, i) => { p.rotation.y = Math.sin(f.time * 5 + i) * 0.35; });
      if (g.passed && behind > 70) { this.group.remove(g.group); g.dispose(); this.gates.splice(this.gates.indexOf(g), 1); }
    }
    this.updateConfetti(dt);
  }

  // ---------- target gate: light arch on ball buoys ----------

  private buildTarget(info: GateInfo): Gate {
    const group = new THREE.Group();
    const color = info.color;
    const fades: Gate['fades'] = [];
    const disposables: { dispose(): void }[] = [];
    const keep = <T extends { dispose(): void }>(x: T) => { disposables.push(x); return x; };
    const fade = <M extends THREE.Material & { opacity: number }>(m: M) => { m.transparent = true; fades.push([m, m.opacity]); return keep(m); };

    // the arch: a soft outer tube and a bright core, unlit so it glows
    const curve = new ArchCurve(ARCH_R, 0.9);
    const outer = new THREE.Mesh(keep(new THREE.TubeGeometry(curve, 64, 0.34, 12)), fade(new THREE.MeshBasicMaterial({ color, opacity: 0.55, depthWrite: false })));
    const core = new THREE.Mesh(keep(new THREE.TubeGeometry(curve, 64, 0.1, 8)), fade(new THREE.MeshBasicMaterial({ color: lighter(color, 0.55), opacity: 0.95 })));
    group.add(outer, core);

    // ball buoys with a white band, floating on the waves
    const buoyMat = fade(new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.35, roughness: 0.3, opacity: 0.95 }));
    const bandMat = fade(new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.2, roughness: 0.4, opacity: 1 }));
    const ball = keep(new THREE.SphereGeometry(0.95, 28, 18));
    const band = keep(new THREE.TorusGeometry(0.93, 0.13, 8, 36));
    const floats: THREE.Object3D[] = [];
    for (const x of [-ARCH_R, ARCH_R]) {
      const b = new THREE.Group();
      const s = new THREE.Mesh(ball, buoyMat);
      const r = new THREE.Mesh(band, bandMat);
      r.rotation.x = Math.PI / 2; r.position.y = -0.1;
      b.add(s, r);
      b.position.x = x; b.userData.lift = 0.45;
      group.add(b); floats.push(b);
    }

    // the frosted glass sign with the new target, readable from both sides
    const tex = keep(signTexture(color, info.split ?? '', info.spm ?? ''));
    const signGeo = keep(new THREE.PlaneGeometry(5.4, 2.1));
    const signMat = fade(new THREE.MeshBasicMaterial({ map: tex, opacity: 1, depthWrite: false }));
    const front = new THREE.Mesh(signGeo, signMat);
    const back = new THREE.Mesh(signGeo, signMat);
    back.rotation.y = Math.PI;
    const sign = new THREE.Group();
    sign.add(front, back);
    sign.position.y = 4.15;
    // two thin hangers up to the arch
    const hangerGeo = keep(new THREE.CylinderGeometry(0.03, 0.03, 1.4, 6));
    const hangerMat = fade(new THREE.MeshBasicMaterial({ color: lighter(color, 0.6), opacity: 0.9 }));
    for (const x of [-1.9, 1.9]) { const h = new THREE.Mesh(hangerGeo, hangerMat); h.position.set(x, 1.75, 0); sign.add(h); }
    group.add(sign);

    const { pts, seed } = sparkles(46, lighter(color, 0.5).getHex(), 0.22);
    keep(pts.geometry); fade(pts.material as THREE.PointsMaterial);
    group.add(pts);
    return { key: info.key, kind: 'target', color, group, z: 0, fade: 0, passed: false, fades, floats, sparkles: pts, sparkleSeed: seed, pennants: [], dispose: () => disposables.forEach((d) => d.dispose()) };
  }

  // ---------- finish gate: golden spar buoys and a checkered glass banner ----------

  private buildFinish(info: GateInfo): Gate {
    const group = new THREE.Group();
    const fades: Gate['fades'] = [];
    const disposables: { dispose(): void }[] = [];
    const keep = <T extends { dispose(): void }>(x: T) => { disposables.push(x); return x; };
    const fade = <M extends THREE.Material & { opacity: number }>(m: M) => { m.transparent = true; fades.push([m, m.opacity]); return keep(m); };
    const gold = fade(new THREE.MeshStandardMaterial({ color: 0xffc83d, emissive: 0xff9d00, emissiveIntensity: 0.55, roughness: 0.22, opacity: 0.86 }));
    const floatMat = fade(new THREE.MeshStandardMaterial({ color: 0xd9532b, roughness: 0.5, opacity: 1 }));
    const lampMat = fade(new THREE.MeshBasicMaterial({ color: 0xfff1c2, opacity: 1 }));
    const poleMat = fade(new THREE.MeshStandardMaterial({ color: 0xc89b3c, roughness: 0.4, metalness: 0.6, opacity: 1 }));
    const flagMat = fade(new THREE.MeshStandardMaterial({ color: 0xe53935, roughness: 0.7, side: THREE.DoubleSide, opacity: 1 }));
    const postGeo = keep(new THREE.CylinderGeometry(0.5, 0.58, 7.6, 24));
    const capGeo = keep(new THREE.SphereGeometry(0.5, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2));
    const floatGeo = keep(new THREE.CylinderGeometry(1.15, 1.25, 0.6, 24));
    const lampGeo = keep(new THREE.SphereGeometry(0.3, 16, 10));
    const poleGeo = keep(new THREE.CylinderGeometry(0.05, 0.05, 1.5, 6));
    const flagGeo = keep(new THREE.BufferGeometry());
    flagGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0, 0, -0.7, 0, 1.5, -0.3, 0]), 3));
    flagGeo.computeVertexNormals();
    const floats: THREE.Object3D[] = [];
    const pennants: THREE.Mesh[] = [];
    for (const x of [-FINISH_HALF, FINISH_HALF]) {
      const b = new THREE.Group();
      const fl = new THREE.Mesh(floatGeo, floatMat);
      const post = new THREE.Mesh(postGeo, gold); post.position.y = 4.1;
      const cap = new THREE.Mesh(capGeo, gold); cap.position.y = 7.9;
      const lamp = new THREE.Mesh(lampGeo, lampMat); lamp.position.y = 8.45;
      const pole = new THREE.Mesh(poleGeo, poleMat); pole.position.y = 9.2;
      const flag = new THREE.Mesh(flagGeo, flagMat); flag.position.set(0, 9.9, 0); flag.scale.x = x < 0 ? -1 : 1;
      b.add(fl, post, cap, lamp, pole, flag);
      b.position.x = x; b.userData.lift = 0.1;
      group.add(b); floats.push(b); pennants.push(flag);
    }
    // the banner sags a little between the posts
    const banGeo = keep(new THREE.PlaneGeometry(FINISH_HALF * 2 - 0.9, 2.2, 24, 1));
    const pos = banGeo.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const u = pos.getX(i) / (FINISH_HALF * 2 - 0.9) + 0.5;
      pos.setY(i, pos.getY(i) - Math.sin(Math.PI * u) * 0.55);
    }
    const banner = new THREE.Mesh(banGeo, fade(new THREE.MeshBasicMaterial({ map: keep(checkerTexture()), opacity: 1, side: THREE.DoubleSide, depthWrite: false })));
    banner.position.y = 6.6;
    group.add(banner);
    const { pts, seed } = sparkles(90, 0xffe08a, 0.24);
    keep(pts.geometry); fade(pts.material as THREE.PointsMaterial);
    group.add(pts);
    return { key: info.key, kind: 'finish', color: 0xffc83d, group, z: 0, fade: 0, passed: false, fades, floats, sparkles: pts, sparkleSeed: seed, pennants, dispose: () => disposables.forEach((d) => d.dispose()) };
  }

  /** Little lights drifting along the arch (target) or twinkling around the banner (finish). */
  private animateSparkles(g: Gate, time: number) {
    const arr = (g.sparkles.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
    const s = g.sparkleSeed;
    const n = arr.length / 3;
    for (let i = 0; i < n; i++) {
      if (g.kind === 'target') {
        const u = (s[i * 3] + time * (0.03 + s[i * 3 + 1] * 0.04)) % 1;
        const a = Math.PI * (1 - u);
        const r = ARCH_R + (s[i * 3 + 2] - 0.5) * 0.9;
        arr[i * 3] = Math.cos(a) * r;
        arr[i * 3 + 1] = 0.9 + Math.sin(a) * r + Math.sin(time * 2 + i) * 0.15;
        arr[i * 3 + 2] = (s[i * 3 + 1] - 0.5) * 0.8;
      } else {
        arr[i * 3] = (s[i * 3] - 0.5) * FINISH_HALF * 2.4;
        arr[i * 3 + 1] = 3 + s[i * 3 + 1] * 8 + Math.sin(time * 0.7 + i) * 0.4;
        arr[i * 3 + 2] = (s[i * 3 + 2] - 0.5) * 4;
      }
    }
    g.sparkles.geometry.attributes.position.needsUpdate = true;
    (g.sparkles.material as THREE.PointsMaterial).size = g.kind === 'finish' ? 0.3 + 0.12 * Math.sin(time * 6) : 0.36;
  }

  // ---------- confetti at the finish ----------

  private burst(z: number) {
    this.clearConfetti();
    const n = 260;
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), vel = new Float32Array(n * 3);
    const palette = [0xffc83d, 0xe53935, 0x2fd3c0, 0x4aa8ff, 0xff4fa3, 0xffffff].map((c) => new THREE.Color(c));
    for (let i = 0; i < n; i++) {
      pos[i * 3] = (Math.random() - 0.5) * FINISH_HALF * 2;
      pos[i * 3 + 1] = 6 + Math.random() * 3;
      pos[i * 3 + 2] = z + (Math.random() - 0.5) * 3;
      vel[i * 3] = (Math.random() - 0.5) * 6;
      vel[i * 3 + 1] = 3 + Math.random() * 6;
      vel[i * 3 + 2] = (Math.random() - 0.5) * 6;
      const c = palette[i % palette.length];
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.32, vertexColors: true, transparent: true, opacity: 1, depthWrite: false }));
    pts.frustumCulled = false;
    this.group.add(pts);
    this.confetti = { pts, vel, age: 0 };
  }

  private updateConfetti(dt: number) {
    const c = this.confetti;
    if (!c) return;
    c.age += dt;
    const arr = (c.pts.geometry.attributes.position as THREE.BufferAttribute).array as Float32Array;
    for (let i = 0; i < arr.length; i += 3) {
      c.vel[i + 1] -= 4.5 * dt;                        // gravity, slowed by air
      c.vel[i] *= 1 - dt * 0.6; c.vel[i + 2] *= 1 - dt * 0.6;
      if (c.vel[i + 1] < -2.2) c.vel[i + 1] = -2.2;   // flutter down
      arr[i] += (c.vel[i] + Math.sin(c.age * 3 + i) * 0.6) * dt;
      arr[i + 1] = Math.max(0.05, arr[i + 1] + c.vel[i + 1] * dt);
      arr[i + 2] += c.vel[i + 2] * dt;
    }
    c.pts.geometry.attributes.position.needsUpdate = true;
    (c.pts.material as THREE.PointsMaterial).opacity = Math.max(0, Math.min(1, (9 - c.age) / 2));
    if (c.age > 9) this.clearConfetti();
  }

  private clearConfetti() {
    if (!this.confetti) return;
    this.group.remove(this.confetti.pts);
    this.confetti.pts.geometry.dispose();
    (this.confetti.pts.material as THREE.Material).dispose();
    this.confetti = null;
  }

  dispose() {
    for (const g of this.gates) g.dispose();
    this.gates = [];
    this.clearConfetti();
  }
}
