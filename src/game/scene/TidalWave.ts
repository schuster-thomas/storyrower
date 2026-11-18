import * as THREE from 'three';
import { NO_REFLECTION } from './Water';

/**
 * The tidal wave that chases the boat in the finale – a stylised 3D breaker: a long back slope,
 * a crest that curls forward over a hollow, a concave face streaked with foam and a churning foam
 * band at its foot, with spray thrown ahead of the lip. The break peels along the wave (the curl
 * is a little further on in some places than in others) and the whole wall heaves.
 *
 * Built procedurally (no assets): a profile curve swept across the valley, shaded like the river
 * water (deep teal at the foot, light turquoise where the crest is thin, white foam).
 * Local axes: x across the valley, y up, −z towards the boat (the group sits behind the boat).
 */

const WIDTH = 110;           // reaches into both banks; the ends sink, so nothing ends in mid-air
// the profile (forward f towards the boat, height y – 10 m at full size), a plunging breaker
const PROFILE: [number, number][] = [
  [-46, -0.6], [-26, 2.2], [-13, 6.2], [-5.5, 9.1], [0, 10], [3.6, 9.6], [6.3, 8.2], [7.3, 6.2],
  [6.4, 4.6], [4.7, 4.2], [3.9, 3.0], [4.5, 1.5], [6.6, 0.3], [9.5, -0.6],
];

const vertex = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>
  uniform float uTime;
  attribute vec2 aProfile;     // (f, y) of the undisturbed profile
  varying vec2 vProfile;
  varying vec3 vNormalW;
  varying vec3 vWorld;
  varying float vX;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  void main() {
    vec3 p = position;
    float f = aProfile.x, y = aProfile.y;
    // the ends sink into the banks
    float ends = smoothstep(${(WIDTH / 2).toFixed(1)}, ${(WIDTH / 2 - 30).toFixed(1)}, abs(p.x));
    // the break peels along the wave: the curl is further on here than there, and it rolls
    float peel = sin(p.x * 0.11 - uTime * 0.9) * 0.5 + sin(p.x * 0.27 + uTime * 0.6) * 0.25;
    float lip = smoothstep(4.0, 9.0, y) * smoothstep(1.0, 4.0, f);
    p.z -= lip * (1.0 + peel) * 1.4;
    p.y += lip * peel * 0.6;
    // the wall heaves and the surface churns
    float heave = sin(uTime * 1.3 + p.x * 0.05) * 0.35;
    p.y += heave * smoothstep(0.0, 10.0, y);
    p.y += (noise(vec2(p.x * 0.35, y * 0.6 - uTime * 1.5)) - 0.5) * 0.5 * smoothstep(0.0, 3.0, y);
    p.y *= mix(0.15, 1.0, ends);
    p.z *= mix(0.6, 1.0, ends);
    vProfile = vec2(f, y);
    vX = p.x;
    vec4 world = modelMatrix * vec4(p, 1.0);
    vWorld = world.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const fragment = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>
  uniform float uTime;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform vec3 uGlow;
  uniform vec3 uSunDir;
  uniform float uLight;
  uniform vec3 uTint;
  varying vec2 vProfile;
  varying vec3 vNormalW;
  varying vec3 vWorld;
  varying float vX;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  void main() {
    float f = vProfile.x, y = vProfile.y;
    vec3 n = normalize(vNormalW);
    if (!gl_FrontFacing) n = -n;
    vec3 v = normalize(cameraPosition - vWorld);
    // deep at the foot, lighter up the wall, glowing turquoise where the crest is thin (light shines through)
    vec3 col = mix(uDeep, uShallow, smoothstep(0.0, 8.0, y));
    float thin = smoothstep(5.0, 8.5, y) * smoothstep(1.0, 5.0, f);
    col = mix(col, uGlow, thin * 0.75);
    // soft light and a bright rim towards the sky
    col *= 0.72 + 0.38 * max(dot(n, uSunDir), 0.0);
    col += uShallow * pow(1.0 - max(dot(n, v), 0.0), 3.0) * 0.35;
    // foam: on the crest and the lip, streaks pulled down the face, and a churning band at the foot
    float t = uTime;
    // a continuous band of white water along the crest and the curling lip, finely rippled
    float crest = smoothstep(8.3, 9.5, y) * (0.7 + 0.3 * noise(vec2(vX * 1.5, f * 2.0 - t * 2.0)));
    float lipFoam = smoothstep(6.2, 7.3, f) * smoothstep(4.0, 6.0, y) * (0.6 + 0.4 * noise(vec2(vX * 2.0, y * 3.0 + t * 3.0)));
    // thin streaks pulled down the glassy face (fine across, long along the fall)
    float streaks = smoothstep(2.0, 5.0, f) * (1.0 - smoothstep(4.5, 7.0, y)) * smoothstep(0.74, 0.9, noise(vec2(vX * 3.2, y * 0.35 + t * 1.6)));
    float foot = (1.0 - smoothstep(0.4, 2.2, y)) * smoothstep(0.3, 0.75, noise(vec2(vX * 0.5 + t * 0.4, f * 0.9 - t * 2.0)) + 0.25);
    float foam = clamp(crest + lipFoam + streaks * 0.55 + foot, 0.0, 1.0);
    col = mix(col, vec3(0.95, 0.98, 1.0), foam);
    gl_FragColor = vec4(col * uTint * uLight, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

const sprayVertex = /* glsl */ `
  attribute vec4 seed;
  uniform float uTime;
  uniform float uPx;
  uniform float uAmount;
  varying float vT;
  varying float vOn;
  void main() {
    float life = 1.3 + seed.x * 1.1;
    float t = mod(uTime + seed.y * 17.0, life);
    float x = (seed.z - 0.5) * ${(WIDTH * 0.62).toFixed(1)};
    // thrown forward and up from the curling lip, then falling
    vec3 p = vec3(x, 8.6 + seed.w * 1.2, -(5.5 + seed.y * 2.0));
    vec3 vel = vec3((seed.w - 0.5) * 2.0, 2.5 + seed.x * 4.0, -(4.0 + seed.w * 6.0));
    p += vel * t + vec3(0.0, -4.9 * t * t, 0.0);
    vT = t / life;
    vOn = step(seed.x, uAmount) * step(-1.0, p.y);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = (0.12 + 0.3 * seed.z) * (0.6 + vT) * uPx / -mv.z;
  }
`;
const sprayFragment = /* glsl */ `
  uniform float uLight;
  varying float vT;
  varying float vOn;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c) * 2.0;
    if (r > 1.0 || vOn < 0.5) discard;
    gl_FragColor = vec4(vec3(0.94, 0.98, 1.0) * uLight, (1.0 - r * r) * 0.5 * (1.0 - smoothstep(0.5, 1.0, vT)));
    #include <colorspace_fragment>
  }
`;

function buildGeometry() {
  const curve = new THREE.CatmullRomCurve3(PROFILE.map(([f, y]) => new THREE.Vector3(f, y, 0)), false, 'centripetal');
  const pts = curve.getSpacedPoints(90);
  const NX = 70;
  const pos: number[] = [], prof: number[] = [], idx: number[] = [];
  for (let j = 0; j <= NX; j++) {
    const x = -WIDTH / 2 + (j / NX) * WIDTH;
    for (const p of pts) { pos.push(x, p.y, -p.x); prof.push(p.x, p.y); }
  }
  const row = pts.length;
  for (let j = 0; j < NX; j++) for (let i = 0; i < row - 1; i++) {
    const a = j * row + i, b = a + 1, c = a + row, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aProfile', new THREE.Float32BufferAttribute(prof, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export interface TidalWaveFrame {
  time: number;
  boatZ: number;
  /** 0–1 how present the wave is (story environment) */
  wave: number;
  /** 0 = right at the stern, 1 = far behind */
  threat: number;
  light: number;
  tint: THREE.Color;
  sunDir: THREE.Vector3;
  pixelHeight: number;
  camera: THREE.PerspectiveCamera;
}

export class TidalWave {
  readonly group = new THREE.Group();
  private mat: THREE.ShaderMaterial;
  private sprayMat: THREE.ShaderMaterial;

  constructor(particles: number) {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: vertex, fragmentShader: fragment, side: THREE.DoubleSide, fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uTime: { value: 0 }, uDeep: { value: new THREE.Color(0x0d4a62) }, uShallow: { value: new THREE.Color(0x2c9fb3) },
        uGlow: { value: new THREE.Color(0x7fe6dc) }, uSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.5).normalize() },
        uLight: { value: 1 }, uTint: { value: new THREE.Color(1, 1, 1) },
      }]),
    });
    const wall = new THREE.Mesh(buildGeometry(), this.mat);
    wall.frustumCulled = false;
    this.group.add(wall);

    const n = Math.round(1400 * Math.max(0.3, particles));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('seed', new THREE.BufferAttribute(Float32Array.from({ length: n * 4 }, Math.random), 4));
    this.sprayMat = new THREE.ShaderMaterial({
      vertexShader: sprayVertex, fragmentShader: sprayFragment, transparent: true, depthWrite: false,
      uniforms: { uTime: { value: 0 }, uPx: { value: 800 }, uAmount: { value: 1 }, uLight: { value: 1 } },
    });
    const spray = new THREE.Points(g, this.sprayMat);
    spray.frustumCulled = false;
    spray.layers.set(NO_REFLECTION);
    this.group.add(spray);
    this.group.visible = false;
  }

  update(p: TidalWaveFrame) {
    const show = p.wave;
    this.group.visible = show > 0.02;
    if (!this.group.visible) return;
    // threat 1 → far behind, threat 0 → right at the stern; it grows as the finale comes
    const dist = 14 + p.threat * 55 + (1 - show) * 120;
    // a wall that towers over the valley: up to ~28 m in the finale
    const s = 1.0 + show * 1.8;
    this.group.position.set(0, -0.6, p.boatZ + dist);
    this.group.scale.set(1, s, s);
    const u = this.mat.uniforms;
    u.uTime.value = p.time;
    u.uLight.value = Math.min(1.15, 0.55 + p.light * 0.55);
    (u.uTint.value as THREE.Color).copy(p.tint);
    (u.uSunDir.value as THREE.Vector3).copy(p.sunDir);
    const su = this.sprayMat.uniforms;
    su.uTime.value = p.time;
    su.uLight.value = Math.min(1.1, 0.6 + p.light * 0.5);
    su.uAmount.value = show;
    su.uPx.value = p.pixelHeight / (2 * Math.tan(THREE.MathUtils.degToRad(p.camera.fov) / 2));
  }

  dispose() {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      (m.material as THREE.Material | undefined)?.dispose?.();
    });
  }
}
