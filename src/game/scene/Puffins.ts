import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import standingUrl from '../../assets/models/puffin-standing.glb?url';
import flyingUrl from '../../assets/models/puffin-flying.glb?url';
import { bakeGeometry } from './PaintedProps';
import type { Perch } from './Fjord';

/**
 * Atlantic puffins (Tripo3D models, scripts/blender/puffin.py): they sit on the rocks in the river,
 * turn their heads in little jerks and take off when the boat comes close – or all at once when the
 * earth trembles. In the calm morning a few circle above the river. Two instanced draw calls: one
 * for the sitting birds, one for the flying ones; the wing beat and the head turns are done in the
 * vertex shader (the flying model has its wings spread straight out, so they can be bent there).
 */

const MAX_SITTING = 48;
const MAX_FLYING = 48;
/** half the body width of the flying model (1.5 m span): inside it nothing flaps */
const BODY_HALF = 0.13;
/** how close the boat comes before the birds on a rock take off (m) */
const SHY = 32;
/** the models are about twice a real puffin; a bit more still reads better from the boat */
const SIZE = 1.4;

interface Flyer {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  age: number;
  life: number;
  phase: number;
  rate: number;
  /** where it sat and which way it looked: until it takes off (age < 0) it is drawn sitting there */
  spot: THREE.Vector3 | null;
  yaw: number;
  /** the bank it turns back to: −1 left, 1 glacier side */
  side: number;
  /** circling above the river (idyll) or fleeing; age < 0: waiting to take off */
  circle: { cx: number; cz: number; r: number; speed: number; a: number; y: number } | null;
}

const flapChunk = /* glsl */ `
  #include <begin_vertex>
  {
    float ph = uTime * aFlap.y + aFlap.x;
    // fast down-stroke, slower up-stroke; the outer wing lags a little behind
    float beat = sin(ph) + 0.25 * sin(2.0 * ph);
    float side = sign(transformed.x);
    float d = abs(transformed.x) - ${BODY_HALF.toFixed(3)};
    if (d > 0.0) {
      float w = smoothstep(0.0, 0.12, d);
      float a = beat * 0.75 * w + 0.25 * sin(ph - 0.6) * smoothstep(0.25, 0.6, d);
      float c = cos(a), s = sin(a);
      transformed.x = side * (${BODY_HALF.toFixed(3)} + d * c);
      transformed.y += d * s;
    }
    // the body rises and sinks a little with every beat
    transformed.y -= beat * 0.02;
  }
`;

const idleChunk = /* glsl */ `
  #include <begin_vertex>
  {
    // jerky head turns: hold, snap to a new direction, hold …
    float t = uTime * 0.45 + aFlap.x;
    float k = floor(t);
    float f = smoothstep(0.0, 0.12, fract(t));
    float from = fract(sin(k * 12.9898 + aFlap.x) * 43758.5) - 0.5;
    float to = fract(sin((k + 1.0) * 12.9898 + aFlap.x) * 43758.5) - 0.5;
    float yaw = mix(from, to, f) * 1.9;
    float head = smoothstep(0.43, 0.5, transformed.y);
    float c = cos(yaw * head), s = sin(yaw * head);
    vec2 xz = transformed.xz;
    transformed.x = xz.x * c - xz.y * s;
    transformed.z = xz.x * s + xz.y * c;
    // a little bob now and then
    transformed.y += max(0.0, sin(uTime * 1.3 + aFlap.x * 3.0) - 0.9) * 0.25;
  }
`;

export class Puffins {
  readonly group = new THREE.Group();
  ready = false;
  readonly loaded: Promise<void>;

  private sitting: THREE.InstancedMesh | null = null;
  private flying: THREE.InstancedMesh | null = null;
  private time = { value: 0 };
  private flyers: Flyer[] = [];
  /** per bank section: the birds on its rock have flown */
  private gone = new Set<number>();
  private circling = false;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private look = new THREE.Matrix4();
  private up = new THREE.Vector3(0, 1, 0);
  private tmp = new THREE.Vector3();

  private static loading: Promise<THREE.Object3D[]> | null = null;
  static preload(): Promise<THREE.Object3D[]> {
    if (!this.loading) {
      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);
      this.loading = Promise.all([standingUrl, flyingUrl].map((u) => loader.loadAsync(u).then((g) => g.scene)));
      this.loading.catch(() => { this.loading = null; });
    }
    return this.loading;
  }

  constructor() {
    this.loaded = Puffins.preload().then(([standing, flying]) => {
      this.sitting = this.instanced(standing, idleChunk, MAX_SITTING);
      this.flying = this.instanced(flying, flapChunk, MAX_FLYING);
      this.group.add(this.sitting, this.flying);
      this.ready = true;
    }).catch((e) => console.warn('Puffins could not be loaded', e));
  }

  private instanced(root: THREE.Object3D, chunk: string, max: number) {
    root.updateMatrixWorld(true);
    let mesh: THREE.Mesh | null = null;
    root.traverse((o) => { if (!mesh && (o as THREE.Mesh).isMesh) mesh = o as THREE.Mesh; });
    const src = mesh! as THREE.Mesh;
    const geometry = bakeGeometry(src);
    const map = (src.material as THREE.MeshStandardMaterial).map;
    const material = new THREE.MeshStandardMaterial({ map, roughness: 0.75, metalness: 0 });
    const time = this.time;
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = time;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nattribute vec2 aFlap;')
        .replace('#include <begin_vertex>', chunk);
    };
    // per bird: phase offset and wing-beat rate
    geometry.setAttribute('aFlap', new THREE.InstancedBufferAttribute(Float32Array.from({ length: max * 2 }, (_, i) => (i % 2 ? 0 : Math.random() * 40)), 2));
    const inst = new THREE.InstancedMesh(geometry, material, max);
    inst.count = 0;
    inst.frustumCulled = false;
    inst.castShadow = false;
    return inst;
  }

  /** which way the bird on spot i looks: most of them towards the middle of the river */
  private static yaw(key: number, i: number, side: number) { return side * -Math.PI * 0.5 + Math.sin(key * 7.1 + i * 2.3) * 1.1; }

  /**
   * A bird leaves its spot: it keeps sitting until its turn (one after the other), then pushes off
   * the way it was looking, climbs and turns ahead along the river and back over the bank.
   */
  private takeOff(at: THREE.Vector3, yaw: number, side: number, delay: number) {
    if (this.flyers.length >= MAX_FLYING) return;
    const fwd = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
    this.flyers.push({
      pos: at.clone().add(new THREE.Vector3(0, 0.3 * SIZE, 0)),
      vel: fwd.multiplyScalar(2.5 + Math.random()).add(new THREE.Vector3(0, 2.6 + Math.random(), -(2 + Math.random() * 2))),
      age: -delay, life: 8 + Math.random() * 3, phase: Math.random() * 40, rate: 17 + Math.random() * 4,
      spot: at.clone(), yaw, side, circle: null,
    });
  }

  update(p: { dt: number; time: number; boatZ: number; birds: number; light: number; perches: Perch[] }) {
    if (!this.ready || !this.sitting || !this.flying) return;
    this.time.value = p.time;

    // sitting birds: on the rocks of the sections around the boat, until they fly
    let n = 0;
    const scared = p.birds <= 0;   // the earth trembled: every bird is up
    for (const { key, spots, side } of p.perches) {
      if (this.gone.has(key)) continue;
      const ahead = p.boatZ - spots[0].z;
      if (scared || (ahead > -4 && ahead < SHY)) {
        this.gone.add(key);
        // one after the other, not all in the same instant
        spots.forEach((sp, i) => this.takeOff(sp, Puffins.yaw(key, i, side), side, i * 0.18 + Math.random() * 0.25));
        continue;
      }
      for (const [i, sp] of spots.entries()) {
        if (n >= MAX_SITTING) break;
        this.q.setFromAxisAngle(this.up, Puffins.yaw(key, i, side));
        this.sitting.setMatrixAt(n++, this.m.compose(sp, this.q, this.s.setScalar(SIZE)));
      }
    }
    // birds about to take off still sit where they were
    for (const f of this.flyers) {
      if (f.age + p.dt >= 0 || !f.spot || n >= MAX_SITTING) continue;
      this.q.setFromAxisAngle(this.up, f.yaw);
      this.sitting.setMatrixAt(n++, this.m.compose(f.spot, this.q, this.s.setScalar(SIZE)));
    }
    // forget sections far behind (they are rebuilt with fresh birds when they come round again)
    for (const k of this.gone) if (!p.perches.some((x) => x.key === k)) this.gone.delete(k);
    this.sitting.count = n;
    this.sitting.instanceMatrix.needsUpdate = true;

    // a few circle above the river in the calm morning, then flee with the first tremor
    if (p.birds > 0 && !this.circling) {
      this.circling = true;
      for (let i = 0; i < 6; i++) {
        this.flyers.push({
          pos: new THREE.Vector3(), vel: new THREE.Vector3(), age: 0, life: Infinity, phase: Math.random() * 40, rate: 15 + Math.random() * 3, spot: null, yaw: 0, side: -1,
          circle: { cx: i % 2 ? 7 : -7, cz: -45 - (i % 3) * 10, r: 12 + (i % 3) * 4, speed: 0.32 + (i % 2) * 0.06, a: (i / 6) * Math.PI * 2, y: 10 + (i % 3) * 1.5 },
        });
      }
    }
    if (p.birds <= 0 && this.circling) {
      this.circling = false;
      for (const f of this.flyers) {
        if (!f.circle) continue;
        f.vel.set(f.circle.cx > 0 ? 4 : -4, 2.5, -8);
        f.circle = null; f.age = 0; f.life = 6;
      }
    }

    // flying birds
    let m = 0;
    const flap = this.flying.geometry.attributes.aFlap as THREE.InstancedBufferAttribute;
    this.flyers = this.flyers.filter((f) => f.age < f.life);
    for (const f of this.flyers) {
      f.age += p.dt;
      if (f.age < 0) continue;     // still about to take off
      const prev = f.pos.clone();
      if (f.circle) {
        const c = f.circle;
        c.a += p.dt * c.speed;
        f.pos.set(c.cx + Math.cos(c.a) * c.r, c.y + Math.sin(p.time * 0.9 + c.r) * 1.2, p.boatZ + c.cz + Math.sin(c.a) * c.r * 0.6);
        this.look.lookAt(prev, f.pos, this.up);
      } else {
        // climb away ahead of the boat, then curve back over the bank they came from
        f.vel.y = Math.max(0.3, f.vel.y - p.dt * 0.4);
        f.vel.x += f.side * p.dt * 1.1;
        f.vel.z -= p.dt * 1.5;
        f.pos.addScaledVector(f.vel, p.dt);
        this.look.lookAt(f.pos, this.tmp.copy(f.pos).add(f.vel), this.up);
      }
      // model forward is −z: look along the flight path
      this.q.setFromRotationMatrix(this.look);
      // full size from the first wing beat; only far away at the end do they shrink out of sight
      const fade = Math.min(1, (f.life - f.age) / 1.2);
      if (m >= MAX_FLYING) break;
      this.flying.setMatrixAt(m, this.m.compose(f.pos, this.q, this.s.setScalar(SIZE * Math.max(0.001, fade))));
      flap.setXY(m, f.phase, f.rate);
      m++;
    }
    this.flying.count = m;
    this.flying.instanceMatrix.needsUpdate = true;
    flap.needsUpdate = true;
  }

  dispose() {
    for (const inst of [this.sitting, this.flying]) {
      if (!inst) continue;
      inst.geometry.dispose();
      (inst.material as THREE.Material).dispose();
      inst.dispose();
    }
  }
}
