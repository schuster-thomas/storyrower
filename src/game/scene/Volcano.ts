import * as THREE from 'three';
import paintUrl from '../../assets/painted/volcano.webp';
import maskUrl from '../../assets/painted/volcano-mask.webp';
import puffsUrl from '../../assets/painted/ash-puffs.webp';
import meta from '../../assets/painted/volcano.json';

/**
 * The volcano at the end of the valley – the set piece the story revolves around.
 *
 * A painted plane (scripts/blender/volcano.py → scripts/painted/paint.mjs volcano) with a lava
 * mask rendered from the same blockout: the shader lets fresh lava run down the old grooves as
 * the eruption goes on, glowing at its front, with crust plates drifting down and cooling black
 * after the escape. On top, as real moving things: a steam/ash plume of painted puffs, a lava
 * fountain from the crater, the crater glow and volcanic lightning in the plume.
 *
 * The volcano is 700–780 m away, so a plane is enough – the camera never moves far enough
 * sideways for parallax to show.
 */

/** Width of the painted frame in metres at the volcano's distance (tuned to sit between the banks). */
const WIDTH = 560;
const HEIGHT = WIDTH * (meta.size[1] / meta.size[0]);
/** the painting's horizon (eye level of the blockout camera) sits at this height in the game */
const EYE_Y = 3;
const BOTTOM = EYE_Y - meta.horizon * HEIGHT;
/** where the crater sits in the group (x, y) */
const CRATER = new THREE.Vector3((meta.crater[0] - 0.5) * WIDTH, BOTTOM + meta.crater[1] * HEIGHT, 1);
const CRATER_HALF = ((meta.craterRight[0] - meta.craterLeft[0]) / 2) * WIDTH;

export interface VolcanoFrame {
  dt: number;
  time: number;
  boatZ: number;
  /** 0–1 overall light (darker under the ash cloud) */
  light: number;
  /** haze colour at the horizon */
  horizon: THREE.Color;
  /** environment levels of the story phase (0–1) */
  lava: number;
  smoke: number;
  /** from the story state */
  unrest: number;
  eruptionAge: number;
  cooling: number;
  /** drawing-buffer height in pixels (for the size of the lava drops) */
  pixelHeight: number;
  camera: THREE.PerspectiveCamera;
}

const coneVertex = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;
const coneFragment = /* glsl */ `
  uniform sampler2D tPaint;
  uniform sampler2D tMask;
  uniform float uTime;
  uniform float uFlow;     // how far down the channels the fresh lava has run (0–1)
  uniform float uHeat;     // 1 = glowing, 0 = cooled to black crust
  uniform float uGlow;     // crater glow on the upper slopes
  uniform vec3 uTint;
  uniform vec2 uCrater;
  varying vec2 vUv;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  void main() {
    vec4 paint = texture2D(tPaint, vUv);
    if (paint.a < 0.01) discard;
    vec3 m = texture2D(tMask, vUv).rgb;
    float ch = m.r, along = m.g;
    vec3 col = paint.rgb * uTint;

    // the fresh lava fills the middle of the grooves down to the flow front
    float core = smoothstep(0.42, 0.82, ch);
    float reach = uFlow > 0.001 ? smoothstep(uFlow + 0.004, uFlow - 0.03, along) : 0.0;
    float lava = core * reach;
    // crust plates drifting down the channel, more of them as it cools
    float plates = noise(vec2(vUv.x * 260.0, along * 70.0 - uTime * 0.55));
    float crust = smoothstep(0.5 - 0.4 * (1.0 - uHeat), 0.78, plates + (1.0 - core) * 0.55);
    float pulse = noise(vec2(vUv.x * 90.0, along * 22.0 - uTime * 0.9));
    vec3 hot = mix(vec3(0.95, 0.17, 0.03), vec3(1.0, 0.62, 0.15), smoothstep(0.78, 1.0, ch) * (0.35 + 0.65 * pulse));
    // the front of the flow is the hottest, brightest part
    float front = exp(-pow((along - uFlow + 0.012) / 0.018, 2.0)) * core * step(0.001, uFlow);
    hot *= 1.05 + 1.0 * front;
    vec3 cooled = vec3(0.10, 0.06, 0.05) + vec3(0.25, 0.05, 0.0) * uHeat * 0.4;
    vec3 lavaCol = mix(hot * uHeat + cooled * (1.0 - uHeat), cooled, crust * 0.85);
    col = mix(col, lavaCol, lava);
    // red glow on the rock beside the flows
    col += vec3(1.0, 0.28, 0.05) * ch * (1.0 - core) * reach * 0.35 * uHeat;
    // the crater lights the upper slopes from inside
    float nearCrater = exp(-length((vUv - uCrater) * vec2(3.0, 1.0)) * 9.0);
    col += vec3(1.0, 0.42, 0.1) * nearCrater * uGlow * (0.85 + 0.15 * sin(uTime * 7.0));
    gl_FragColor = vec4(col, paint.a);
    #include <colorspace_fragment>
  }
`;

const puffVertex = /* glsl */ `
  attribute vec4 seed;
  uniform float uPhase;
  uniform float uHeight;
  uniform float uSize;
  uniform float uSpread;
  uniform float uDrift;
  uniform float uAmount;
  uniform vec3 uOrigin;
  varying vec2 vUv;
  varying float vAge;
  varying float vAlpha;
  varying float vTile;
  void main() {
    float on = step(seed.z, uAmount);
    float a = fract(uPhase * (0.75 + 0.5 * seed.y) + seed.x);
    float rise = pow(a, 0.75);
    // the column rises, leans with the wind and spreads out at the top
    vec3 c = uOrigin + vec3((seed.y - 0.5) * uSpread * (0.25 + 1.2 * a * a) + uDrift * a * a, rise * uHeight, (seed.w - 0.5) * 30.0);
    float size = uSize * mix(0.45, 1.0, sqrt(a)) * (0.75 + 0.5 * seed.w);
    vec4 mv = modelViewMatrix * vec4(c, 1.0);
    float ang = (seed.z - 0.5) * 0.7 + a * 0.4 * (seed.y - 0.5);
    vec2 corner = mat2(cos(ang), sin(ang), -sin(ang), cos(ang)) * position.xy;
    mv.xy += corner * size;
    gl_Position = projectionMatrix * mv;
    vUv = uv;
    vAge = a;
    vAlpha = on * smoothstep(0.0, 0.07, a) * (1.0 - smoothstep(0.65, 1.0, a));
    vTile = floor(seed.w * 3.999);
  }
`;
const puffFragment = /* glsl */ `
  uniform sampler2D tPuffs;
  uniform vec3 uSteam;
  uniform vec3 uAsh;
  uniform float uDark;
  uniform float uGlow;
  uniform float uFlash;
  uniform float uOpacity;
  uniform vec3 uTint;
  varying vec2 vUv;
  varying float vAge;
  varying float vAlpha;
  varying float vTile;
  void main() {
    vec4 t = texture2D(tPuffs, vec2((vTile + vUv.x) / 4.0, vUv.y));
    float lum = t.r;
    vec3 col = mix(uSteam, uAsh, uDark) * (0.4 + 0.75 * lum) * uTint;
    // lit from below by the lava: only the underside of the low puffs
    col += vec3(1.0, 0.36, 0.08) * pow(1.0 - vUv.y, 1.5) * pow(1.0 - vAge, 4.0) * uGlow;
    col += vec3(0.78, 0.72, 1.0) * uFlash * (0.3 + 0.7 * lum) * (1.0 - vAge * 0.6);
    gl_FragColor = vec4(col, t.a * vAlpha * uOpacity * smoothstep(0.0, 0.2, vUv.y));
    #include <colorspace_fragment>
  }
`;

const dropVertex = /* glsl */ `
  attribute vec4 seed;
  uniform float uTime;
  uniform float uPower;
  uniform float uRate;
  uniform float uPx;
  uniform vec3 uOrigin;
  uniform float uVent;
  varying float vT;
  varying float vOn;
  void main() {
    float life = 1.8 + seed.x * 1.6;
    float t = mod(uTime + seed.y * 13.0, life);
    vec3 v = vec3((seed.z - 0.5) * 34.0, 38.0 + seed.w * 52.0, (seed.x - 0.5) * 12.0) * uPower;
    vec3 p = uOrigin + vec3((seed.y - 0.5) * uVent, 0.0, 0.0) + v * t + vec3(0.0, -21.0 * t * t, 0.0);
    vOn = step(fract(seed.x * 7.13 + seed.z * 3.71), uRate) * step(uOrigin.y - 45.0, p.y);
    vT = t / life;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = (2.4 + 3.6 * seed.z) * (1.0 - 0.45 * vT) * uPx / -mv.z;
  }
`;
const dropFragment = /* glsl */ `
  varying float vT;
  varying float vOn;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c) * 2.0;
    if (r > 1.0 || vOn < 0.5) discard;
    vec3 col = mix(vec3(1.0, 0.86, 0.4), vec3(1.0, 0.28, 0.05), smoothstep(0.05, 0.6, vT));
    col = mix(col, vec3(0.2, 0.06, 0.03), smoothstep(0.7, 1.0, vT));
    gl_FragColor = vec4(col * 1.5, (1.0 - r * r) * (1.0 - smoothstep(0.88, 1.0, vT)));
    #include <colorspace_fragment>
  }
`;

interface Textures { paint: THREE.Texture; mask: THREE.Texture; puffs: THREE.Texture }

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

export class Volcano {
  readonly group = new THREE.Group();
  ready = false;
  readonly loaded: Promise<void>;

  private cone: THREE.ShaderMaterial | null = null;
  private puffs: THREE.ShaderMaterial | null = null;
  private drops: THREE.ShaderMaterial | null = null;
  private glow: THREE.Sprite | null = null;
  private bolt: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> | null = null;
  private phase = 0;          // plume animation phase (accumulated, so speed changes don't jump)
  private boltTimer = 4;
  private boltLife = 0;
  private flash = 0;
  private distance = 780;
  private s = { amount: 0.3, height: 70, size: 34, spread: 30, dark: 0, glow: 0, speed: 0.05, opacity: 0.9, power: 0, rate: 0, heat: 1, flow: 0, craterGlow: 0 };

  private static loading: Promise<Textures> | null = null;
  static preload(): Promise<Textures> {
    if (!this.loading) {
      const loader = new THREE.TextureLoader();
      const load = (url: string, srgb: boolean) => loader.loadAsync(url).then((t) => {
        if (srgb) t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 4;
        return t;
      });
      this.loading = Promise.all([load(paintUrl, true), load(maskUrl, false), load(puffsUrl, true)])
        .then(([paint, mask, puffs]) => ({ paint, mask, puffs }));
      this.loading.catch(() => { this.loading = null; });
    }
    return this.loading;
  }

  constructor() {
    this.loaded = Volcano.preload().then((t) => { this.build(t); this.ready = true; })
      .catch((e) => console.warn('The painted volcano could not be loaded, keeping the stand-in', e));
  }

  private build(t: Textures) {
    // the painted cone with its lava
    this.cone = new THREE.ShaderMaterial({
      vertexShader: coneVertex, fragmentShader: coneFragment, transparent: true, depthWrite: false,
      uniforms: {
        tPaint: { value: t.paint }, tMask: { value: t.mask }, uTime: { value: 0 }, uFlow: { value: 0 }, uHeat: { value: 1 },
        uGlow: { value: 0 }, uTint: { value: new THREE.Color(1, 1, 1) }, uCrater: { value: new THREE.Vector2(meta.crater[0], meta.crater[1]) },
      },
    });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(WIDTH, HEIGHT).translate(0, BOTTOM + HEIGHT / 2, 0), this.cone);
    plane.renderOrder = -4;
    plane.frustumCulled = false;
    this.group.add(plane);

    // glow above the crater
    const glowTex = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const g = c.getContext('2d')!;
      const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      grad.addColorStop(0, 'rgba(255,220,150,1)'); grad.addColorStop(0.35, 'rgba(255,120,40,0.55)'); grad.addColorStop(1, 'rgba(255,60,10,0)');
      g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c);
    })();
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, fog: false, opacity: 0 }));
    this.glow.position.copy(CRATER).add(new THREE.Vector3(0, 6, 0));
    this.glow.scale.set(CRATER_HALF * 3.4, CRATER_HALF * 2.2, 1);
    this.glow.renderOrder = -3;
    this.group.add(this.glow);

    // lava fountain: stateless particles (positions come from time and a seed in the shader)
    const N_DROPS = 600;
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N_DROPS * 3), 3));
    dg.setAttribute('seed', new THREE.BufferAttribute(Float32Array.from({ length: N_DROPS * 4 }, Math.random), 4));
    this.drops = new THREE.ShaderMaterial({
      vertexShader: dropVertex, fragmentShader: dropFragment, transparent: true, depthWrite: false,
      uniforms: { uTime: { value: 0 }, uPower: { value: 0 }, uRate: { value: 0 }, uPx: { value: 800 }, uOrigin: { value: CRATER.clone() }, uVent: { value: CRATER_HALF * 0.9 } },
    });
    const drops = new THREE.Points(dg, this.drops);
    drops.frustumCulled = false;
    drops.renderOrder = -2;
    this.group.add(drops);

    // plume: painted puffs as camera-facing quads, one draw call
    const N_PUFFS = 60;
    const pg = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(1, 1) as unknown as THREE.InstancedBufferGeometry);
    pg.instanceCount = N_PUFFS;
    pg.setAttribute('seed', new THREE.InstancedBufferAttribute(Float32Array.from({ length: N_PUFFS * 4 }, Math.random), 4));
    this.puffs = new THREE.ShaderMaterial({
      vertexShader: puffVertex, fragmentShader: puffFragment, transparent: true, depthWrite: false,
      uniforms: {
        tPuffs: { value: t.puffs }, uPhase: { value: 0 }, uHeight: { value: 70 }, uSize: { value: 34 }, uSpread: { value: 30 }, uDrift: { value: 60 },
        uAmount: { value: 0.3 }, uOrigin: { value: CRATER.clone().add(new THREE.Vector3(0, 4, -2)) }, uSteam: { value: new THREE.Color(0.97, 0.97, 0.98) },
        uAsh: { value: new THREE.Color(0.2, 0.18, 0.18) }, uDark: { value: 0 }, uGlow: { value: 0 }, uFlash: { value: 0 }, uOpacity: { value: 0.9 },
        uTint: { value: new THREE.Color(1, 1, 1) },
      },
    });
    const plume = new THREE.Mesh(pg, this.puffs);
    plume.frustumCulled = false;
    plume.renderOrder = -1;
    this.group.add(plume);

    // volcanic lightning: a jagged ribbon in the plume, rebuilt for every strike
    const bg = new THREE.BufferGeometry();
    bg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(64 * 2 * 3), 3));
    bg.setIndex(Array.from({ length: 63 }, (_, i) => [i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2]).flat());
    this.bolt = new THREE.Mesh(bg, new THREE.MeshBasicMaterial({ color: 0xece4ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide }));
    this.bolt.frustumCulled = false;
    this.bolt.visible = false;
    this.bolt.renderOrder = 0;
    this.group.add(this.bolt);
  }

  /** a branching zig-zag from the plume down towards the crater */
  private strike(height: number) {
    if (!this.bolt) return;
    const pos = this.bolt.geometry.attributes.position as THREE.BufferAttribute;
    const pts: THREE.Vector3[] = [];
    let p = new THREE.Vector3(CRATER.x + (Math.random() - 0.5) * 120, CRATER.y + height * (0.45 + Math.random() * 0.4), CRATER.z + 3);
    const end = CRATER.y + 15 + Math.random() * 25;
    const steps = 22;
    for (let i = 0; i < steps; i++) {
      pts.push(p.clone());
      p = p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 22, -(p.y - end) / (steps - i) * (0.7 + Math.random() * 0.6), 0));
    }
    // a short branch
    const from = pts[Math.floor(steps * 0.4)].clone();
    const branch: THREE.Vector3[] = [from];
    for (let i = 0; i < 8; i++) branch.push(branch[i].clone().add(new THREE.Vector3(8 + Math.random() * 10, -8 - Math.random() * 10, 0)));
    const line = [...pts, ...branch];
    const w = 1.6;
    for (let i = 0; i < 64; i++) {
      const q = line[Math.min(i, line.length - 1)];
      const thin = i >= pts.length ? 0.5 : 1;
      pos.setXYZ(i * 2, q.x - w * thin, q.y, q.z);
      pos.setXYZ(i * 2 + 1, q.x + w * thin, q.y, q.z);
    }
    // break the ribbon between trunk and branch (degenerate quad)
    const k = pts.length - 1;
    pos.setXYZ(k * 2 + 2, pts[k].x, pts[k].y, pts[k].z); pos.setXYZ(k * 2 + 3, pts[k].x, pts[k].y, pts[k].z);
    pos.needsUpdate = true;
    this.bolt.geometry.computeBoundingSphere();
    this.boltLife = 0.12 + Math.random() * 0.14;
    this.flash = 1;
  }

  update(f: VolcanoFrame) {
    if (!this.ready || !this.cone || !this.puffs || !this.drops || !this.glow || !this.bolt) return;
    // the volcano looms closer as the story escalates
    const target = 780 - clamp01(f.lava) * 80;
    this.distance = lerp(this.distance, target, 1 - Math.exp(-f.dt * 0.3));
    this.group.position.set(0, 0, f.boatZ - this.distance);

    // what the volcano is doing: calm steam → unrest → eruption (with a blast at its start) → cooling
    const erupting = f.eruptionAge >= 0 ? 1 : clamp01((f.lava - 0.65) / 0.2);
    const age = f.eruptionAge >= 0 ? f.eruptionAge : erupting * 60;
    const blast = f.eruptionAge >= 0 ? Math.exp(-age / 9) : 0;
    const live = erupting * (1 - f.cooling);
    const k = 1 - Math.exp(-f.dt * 0.8);
    const s = this.s;
    s.amount = lerp(s.amount, 0.3 + 0.25 * f.unrest + 0.45 * live, k);
    s.height = lerp(s.height, 70 + 50 * f.unrest + 140 * live + 60 * blast, k);
    s.size = lerp(s.size, 34 + 14 * f.unrest + 80 * live + 30 * blast, k);
    s.spread = lerp(s.spread, 30 + 240 * live, k);
    s.dark = lerp(s.dark, Math.min(1, 0.45 * f.unrest + live * 0.95 + f.cooling * erupting * 0.4), k);
    s.speed = lerp(s.speed, 0.045 + 0.02 * f.unrest + 0.05 * live + 0.12 * blast, k);
    s.glow = lerp(s.glow, live * (0.55 + 0.45 * clamp01(f.lava)) + 0.15 * f.unrest, k);
    s.power = lerp(s.power, live * (0.8 + 0.25 * clamp01(f.lava)) + blast * 0.7, 1 - Math.exp(-f.dt * 2));
    s.rate = lerp(s.rate, live * 0.75 + blast * 0.25, 1 - Math.exp(-f.dt * 2));
    s.craterGlow = lerp(s.craterGlow, 0.25 * f.unrest + 0.75 * live + 0.5 * blast, k);
    // the flows reach the foot after about two and a half minutes; after the escape they cool
    s.flow = Math.max(s.flow, erupting * Math.pow(clamp01(age / 150), 0.75) * 1.02);
    s.heat = lerp(s.heat, 1 - f.cooling * 0.92, k);

    // light and haze: the painting darkens under the ash cloud and fades into the horizon
    const light = Math.max(0.35, f.light);
    // …and the cone itself darkens while it erupts, so the lava stands out
    const dim = 1 - 0.3 * live;
    const tint = new THREE.Color(light * dim, light * dim, light * dim).lerp(f.horizon, 0.18 + f.smoke * 0.22);
    this.cone.uniforms.uTint.value.copy(tint);
    this.cone.uniforms.uTime.value = f.time;
    this.cone.uniforms.uFlow.value = s.flow;
    this.cone.uniforms.uHeat.value = s.heat;
    this.cone.uniforms.uGlow.value = s.craterGlow * 0.6;
    this.glow.material.opacity = Math.min(0.7, s.craterGlow * 0.55 * (0.85 + 0.15 * Math.sin(f.time * 9)));

    this.phase += f.dt * s.speed;
    const pu = this.puffs.uniforms;
    pu.uPhase.value = this.phase;
    pu.uHeight.value = s.height; pu.uSize.value = s.size; pu.uSpread.value = s.spread; pu.uAmount.value = s.amount;
    pu.uDark.value = s.dark; pu.uGlow.value = s.glow; pu.uDrift.value = 50 + 110 * live;
    pu.uTint.value.setRGB(light, light, light);
    pu.uOpacity.value = 0.75 + 0.2 * Math.max(f.unrest, live);

    const du = this.drops.uniforms;
    du.uTime.value = f.time; du.uPower.value = s.power; du.uRate.value = s.rate;
    du.uPx.value = f.pixelHeight / (2 * Math.tan(THREE.MathUtils.degToRad(f.camera.fov) / 2));

    // lightning in the ash cloud while it erupts
    this.flash = Math.max(0, this.flash - f.dt * 5);
    if (live > 0.5) {
      this.boltTimer -= f.dt;
      if (this.boltTimer <= 0) { this.strike(s.height); this.boltTimer = 2 + Math.random() * 5; }
    }
    this.boltLife -= f.dt;
    this.bolt.visible = this.boltLife > 0;
    this.bolt.material.opacity = this.boltLife > 0 ? 0.7 + 0.3 * Math.sin(f.time * 90) : 0;
    pu.uFlash.value = this.flash * 0.8;
  }

  dispose() {
    // the textures are shared by every game (see preload) and stay loaded
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      (m.material as THREE.Material | undefined)?.dispose?.();
    });
  }
}
