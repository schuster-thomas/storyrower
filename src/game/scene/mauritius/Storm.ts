import * as THREE from 'three';
import { NO_REFLECTION } from '../Water';
import type { WorldHost } from '../World';

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

// ---------- the cloud deck ----------
const deckVertex = /* glsl */ `
  varying vec2 vXZ;
  varying vec2 vLocal;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vXZ = w.xz;
    vLocal = position.xz;   // (per pixel below: the disc has only four corners)
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;
const deckFragment = /* glsl */ `
  uniform float uTime;
  uniform float uAmount;
  uniform float uFlash;
  uniform vec3 uDark;
  uniform vec3 uLight;
  varying vec2 vXZ;
  varying vec2 vLocal;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * noise(p); p = p * 2.03 + 11.7; a *= 0.5; } return s; }
  void main() {
    vec2 p = vXZ * 0.0035 + vec2(uTime * 0.012, uTime * 0.02);
    float d = fbm(p);
    float billow = fbm(p * 2.6 - uTime * 0.01);
    // the deck closes as the storm grows: thin streaks first, a solid dark ceiling at the height of it
    float cover = smoothstep(0.6 - uAmount * 0.5, 0.75 - uAmount * 0.45, d);
    float edge = 1.0 - smoothstep(1100.0, 1580.0, length(vLocal));
    float a = cover * edge * clamp(uAmount * 1.8, 0.0, 1.0);
    // dark bellies with lighter, billowing rims
    vec3 col = mix(uDark, uLight, smoothstep(0.35, 0.8, billow) * 0.7);
    col += vec3(0.55, 0.62, 0.85) * uFlash * (0.4 + billow);
    gl_FragColor = vec4(col, a);
    #include <colorspace_fragment>
  }
`;

// ---------- rain streaks ----------
const rainVertex = /* glsl */ `
  attribute vec4 aSeed;
  uniform float uTime;
  uniform float uAmount;
  uniform vec3 uCenter;
  uniform vec3 uWind;
  varying float vAlong;
  varying float vNear;
  const float SIZE = 46.0;
  const float HEIGHT = 26.0;
  void main() {
    if (aSeed.w > uAmount) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
    // each drop falls in its own column; the columns wrap round the camera so the rain stays put in the world
    vec2 cell = aSeed.xy * SIZE;
    vec2 xz = uCenter.xz + mod(cell - uCenter.xz, SIZE) - SIZE * 0.5;
    float fall = 22.0 + aSeed.z * 8.0;
    float y = mod(aSeed.z * HEIGHT - uTime * fall, HEIGHT) - 1.0;
    vec3 dir = normalize(vec3(uWind.x, -1.0, uWind.z));
    vec3 base = vec3(xz.x, y, xz.y);
    vec3 toCam = normalize(cameraPosition - base);
    vec3 side = normalize(cross(dir, toCam));
    float len = 1.3;
    vec3 world = base + dir * (position.y * len) + side * (position.x * 0.04);
    vAlong = position.y;
    vNear = smoothstep(2.0, 6.0, distance(cameraPosition, base));
    gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  }
`;
const rainFragment = /* glsl */ `
  uniform vec3 uColor;
  varying float vAlong;
  varying float vNear;
  void main() {
    gl_FragColor = vec4(uColor, 0.42 * (1.0 - vAlong * 0.7) * vNear);
    #include <colorspace_fragment>
  }
`;

interface Bolt { group: THREE.Group; core: THREE.Mesh; glow: THREE.Mesh; age: number; life: number; flicker: number[] }

/**
 * The thunderstorm over the lagoon: a ceiling of dark clouds that closes in, rain streaks round the
 * camera and lightning bolts – branching ribbons over the open sea (and now and then over the
 * mountain), each with a flash of light and thunder that rolls in after the distance.
 */
export class Storm {
  readonly group = new THREE.Group();
  private deck: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private rain: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private bolts: Bolt[] = [];
  private coreMat = new THREE.MeshBasicMaterial({ color: 0xf2f6ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide });
  private glowMat = new THREE.MeshBasicMaterial({ color: 0x6f8dff, transparent: true, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide });
  private flash = 0;
  private timer = 6;
  private tmp = new THREE.Vector3();

  constructor(private host: WorldHost) {
    // the deck: a huge disc at cloud height, seen from below
    const deckGeo = new THREE.PlaneGeometry(3200, 3200, 1, 1);
    deckGeo.rotateX(Math.PI / 2);
    this.deck = new THREE.Mesh(deckGeo, new THREE.ShaderMaterial({
      vertexShader: deckVertex, fragmentShader: deckFragment, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      uniforms: { uTime: { value: 0 }, uAmount: { value: 0 }, uFlash: { value: 0 }, uDark: { value: new THREE.Color(0x1a2131) }, uLight: { value: new THREE.Color(0x56627c) } },
    }));
    this.deck.position.y = 150;
    // drawn before the painted coast: the mountain stands dark against the clouds instead of vanishing in them
    this.deck.renderOrder = -8;
    this.deck.frustumCulled = false;
    this.deck.layers.set(NO_REFLECTION);

    // rain: one quad per drop, the GPU moves them
    const N = 3200;
    const quad = new THREE.PlaneGeometry(1, 1);
    quad.translate(0, 0.5, 0);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.attributes.position);
    const seeds = new Float32Array(N * 4);
    for (let i = 0; i < N * 4; i++) seeds[i] = Math.random();
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    geo.instanceCount = N;
    this.rain = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      vertexShader: rainVertex, fragmentShader: rainFragment, transparent: true, depthWrite: false,
      uniforms: { uTime: { value: 0 }, uAmount: { value: 0 }, uCenter: { value: new THREE.Vector3() }, uWind: { value: new THREE.Vector3(-0.35, 0, 0.1) }, uColor: { value: new THREE.Color(0xc8d2e0) } },
    }));
    this.rain.frustumCulled = false;
    this.rain.layers.set(NO_REFLECTION);
    this.rain.visible = false;

    for (let i = 0; i < 3; i++) {
      const g = new THREE.Group();
      const core = new THREE.Mesh(new THREE.BufferGeometry(), this.coreMat);
      const glow = new THREE.Mesh(new THREE.BufferGeometry(), this.glowMat);
      core.frustumCulled = glow.frustumCulled = false;
      g.add(glow, core);
      g.visible = false;
      this.bolts.push({ group: g, core, glow, age: 99, life: 0, flicker: [] });
      this.group.add(g);
    }
    this.group.add(this.deck, this.rain);
  }

  /**
   * A lightning bolt. `near` brings it close (the first crack of the thunderstorm); most strike out
   * over the open sea on the left, a few behind the beach on the right.
   */
  strike(boatZ: number, camera: THREE.Camera, near = false) {
    const b = this.bolts.find((x) => x.age > x.life) ?? this.bolts[0];
    const dist = near ? rnd(170, 230) : rnd(240, 520);
    const angle = Math.random() < 0.8 ? rnd(-0.85, -0.1) : rnd(0.15, 0.6);   // radians right of straight ahead
    const x = Math.sin(angle) * dist, z = boatZ - Math.cos(angle) * dist;
    const top = 150;
    this.buildBolt(b, top, near ? 1.6 : 1.1);
    b.group.position.set(x, 0, z);
    // the bolt is drawn in its own plane: turn that plane to the camera
    this.tmp.set(camera.position.x, 0, camera.position.z);
    b.group.lookAt(this.tmp);
    b.group.visible = true;
    b.age = 0;
    b.life = near ? 0.55 : rnd(0.3, 0.45);
    b.flicker = [0, 0.05, 0.09, 0.16, 0.22];
    this.flash = near ? 1.4 : 1;
    this.host.flash(0xcfd8ff, near ? 0.85 : 0.5);
    this.host.sound('thunder', dist);
  }

  /** Branching ribbons from the cloud base down to the sea, in the group's xy plane. */
  private buildBolt(b: Bolt, top: number, width: number) {
    const core: number[] = [], glow: number[] = [];
    const ribbon = (pts: THREE.Vector2[], w: number) => {
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], c = pts[i + 1];
        const dx = c.x - a.x, dy = c.y - a.y, l = Math.hypot(dx, dy) || 1;
        const nx = (-dy / l), ny = dx / l;
        const wa = w * (1 - (i / pts.length) * 0.5), wc = w * (1 - ((i + 1) / pts.length) * 0.5);
        for (const [out, k] of [[core, 1], [glow, 5]] as const) {
          const A = [a.x + nx * wa * k, a.y + ny * wa * k], B = [a.x - nx * wa * k, a.y - ny * wa * k];
          const C = [c.x + nx * wc * k, c.y + ny * wc * k], D = [c.x - nx * wc * k, c.y - ny * wc * k];
          out.push(A[0], A[1], 0, B[0], B[1], 0, C[0], C[1], 0, B[0], B[1], 0, D[0], D[1], 0, C[0], C[1], 0);
        }
      }
    };
    const path = (from: THREE.Vector2, steps: number, stepLen: number, drift: number, bottom: number) => {
      const pts = [from.clone()];
      let p = from.clone(), dir = drift;
      for (let i = 0; i < steps && p.y > bottom; i++) {
        dir = dir * 0.6 + rnd(-0.9, 0.9);
        p = p.clone().add(new THREE.Vector2(dir * stepLen * 0.6, -stepLen * rnd(0.7, 1.1)));
        pts.push(p);
      }
      return pts;
    };
    const main = path(new THREE.Vector2(0, top), 30, top / 16, 0, 0);
    main[main.length - 1].y = Math.min(main[main.length - 1].y, 0);
    ribbon(main, width);
    for (let k = 0, n = 3 + Math.floor(Math.random() * 4); k < n; k++) {
      const from = main[1 + Math.floor(Math.random() * (main.length * 0.6))];
      const side = Math.random() < 0.5 ? -1 : 1;
      ribbon(path(from, 5 + Math.floor(Math.random() * 6), top / 22, side * 1.4, from.y - top * 0.45), width * 0.45);
    }
    for (const [mesh, arr] of [[b.core, core], [b.glow, glow]] as const) {
      mesh.geometry.dispose();
      mesh.geometry = new THREE.BufferGeometry();
      mesh.geometry.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    }
  }

  /**
   * @param storm 0–1 (clouds from 0.4, rain and lightning above)
   * @param effort 0–1 how hard the current section is (more lightning)
   */
  update(f: { dt: number; time: number; boatZ: number; camera: THREE.PerspectiveCamera; storm: number; effort: number; light: number; share: number }) {
    const u = this.deck.material.uniforms;
    u.uTime.value = f.time;
    u.uAmount.value = f.storm;
    this.flash *= Math.exp(-f.dt * 6);
    u.uFlash.value = this.flash;
    (u.uDark.value as THREE.Color).setHex(0x1a2131).multiplyScalar(0.8 + 0.4 * f.light);
    (u.uLight.value as THREE.Color).setHex(0x56627c).multiplyScalar(0.8 + 0.4 * f.light);
    this.deck.visible = f.storm > 0.01;
    this.deck.position.set(0, 150, f.boatZ);

    const rain = Math.max(0, (f.storm - 0.55) / 0.45);
    const ru = this.rain.material.uniforms;
    this.rain.visible = rain > 0.01;
    ru.uTime.value = f.time;
    ru.uAmount.value = rain * f.share;
    (ru.uCenter.value as THREE.Vector3).set(f.camera.position.x, 0, f.camera.position.z - 20);
    (ru.uColor.value as THREE.Color).setHex(0xc8d2e0).multiplyScalar(0.6 + 0.4 * f.light + this.flash * 0.3);

    // lightning in the thunderstorm: more often in hard sections
    if (f.storm > 0.6) {
      this.timer -= f.dt * (0.5 + f.effort);
      if (this.timer <= 0) { this.timer = rnd(5, 11); this.strike(f.boatZ, f.camera); }
    }
    for (const b of this.bolts) {
      if (b.age > b.life) { b.group.visible = false; continue; }
      b.age += f.dt;
      // a few quick flickers, then it fades
      const on = b.flicker.some((t) => b.age >= t && b.age < t + 0.035) || b.age < 0.03;
      const fade = 1 - b.age / b.life;
      this.coreMat.opacity = on ? 1 : fade * 0.7;
      this.glowMat.opacity = (on ? 0.55 : 0.25) * fade;
      b.group.visible = true;
    }
  }

  dispose() {
    this.deck.geometry.dispose(); this.deck.material.dispose();
    this.rain.geometry.dispose(); this.rain.material.dispose();
    for (const b of this.bolts) { b.core.geometry.dispose(); b.glow.geometry.dispose(); }
    this.coreMat.dispose(); this.glowMat.dispose();
  }
}
