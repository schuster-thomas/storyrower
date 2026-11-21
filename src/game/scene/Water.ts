import * as THREE from 'three';
import { FJORD_GLSL } from './Fjord';

const WIDTH = 520; // from beyond the left shore to beyond the glacier front
const X0 = -160;    // left edge of the water grid
const FAR_WIDTH = 1000; // the open sea beyond it (levels without a left bank)

/**
 * Height of the water surface at a world position – exactly the waves of the vertex shader below
 * (keep the two in sync), so the boat can ride them instead of sinking into a wave crest.
 */
export function waterHeight(x: number, z: number, t: number, swell: number) {
  let h = Math.sin(x * 0.45 + t * 1.3) * Math.cos(z * 0.18 + t * 0.9);
  h += Math.sin(z * 0.07 - t * 0.6) * 0.6;
  h += Math.sin((x + z) * 0.9 + t * 2.1) * 0.18;
  return h * (0.06 + swell * 0.45);
}

const vertex = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>
  uniform float uTime;
  uniform float uSwell;
  uniform float uOpenLeft;
  uniform mat4 uTextureMatrix;
  varying vec4 vReflect;
  varying vec3 vWorld;
  varying float vHeight;
  varying vec3 vNormal;

  // same waves as waterHeight() in TypeScript
  float waves(vec2 p, float t) {
    float h = sin(p.x * 0.45 + t * 1.3) * cos(p.y * 0.18 + t * 0.9);
    h += sin(p.y * 0.07 - t * 0.6) * 0.6;
    h += sin((p.x + p.y) * 0.9 + t * 2.1) * 0.18;
    return h;
  }

  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vReflect = uTextureMatrix * vec4(world.x, 0.0, world.z, 1.0);   // where the flat mirror sees this point
    float amp = 0.06 + uSwell * 0.45;
    // open sea: the far grid is coarse, keep its waves low (they would only alias into blotches)
    if (uOpenLeft > 0.5) amp *= 1.0 - 0.85 * smoothstep(110.0, 220.0, -world.x);
    float h = waves(world.xz, uTime) * amp;
    // smooth normal from the wave slope (finite differences)
    float e = 0.5;
    float hx = waves(world.xz + vec2(e, 0.0), uTime) * amp;
    float hz = waves(world.xz + vec2(0.0, e), uTime) * amp;
    vNormal = normalize(vec3(h - hx, e, h - hz));
    world.y += h;
    vHeight = h / max(amp, 0.001);
    vWorld = world.xyz;
    vec4 mvPosition = viewMatrix * world;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const fragment = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>
  uniform float uTime;
  uniform vec3 uMilk;
  uniform float uMilkAmount;
  uniform float uMilkReach;
  uniform float uOpenLeft;
  uniform float uRightOffset;
  uniform float uReef;
  uniform float uCaustics;
  uniform float uRain;
  uniform float uBoatZ;
  uniform float uSpeed;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform vec3 uSky;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uLight;
  uniform sampler2D tReflect;
  uniform float uReflect;
  varying vec4 vReflect;
  varying vec3 vWorld;
  varying float vHeight;
  varying vec3 vNormal;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  ${FJORD_GLSL}

  void main() {
    // Smooth wave normal, slightly roughened with noise for sparkle
    vec3 n = normalize(vNormal + vec3(noise(vWorld.xz * 1.7 + uTime * 0.8) - 0.5, 0.0, noise(vWorld.zx * 1.7 - uTime * 0.7) - 0.5) * 0.25);
    vec3 viewDir = normalize(cameraPosition - vWorld);

    // Distance to the shores: lighter shallows under the cliffs, milky turquoise meltwater before the glacier
    float toLeft = uOpenLeft > 0.5 ? 1000.0 : vWorld.x + leftShore(vWorld.z);   // 0 at the left shore, > 0 on the water
    float toIce = glacierFront(vWorld.z) + uRightOffset - vWorld.x;              // 0 at the glacier front (or the beach)
    float shore = min(toLeft, toIce);
    vec3 col = mix(uShallow, uDeep, smoothstep(0.5, 6.0, toLeft));
    col = mix(col, uMilk, (1.0 - smoothstep(0.0, uMilkReach, toIce)) * uMilkAmount);
    // open sea beyond a reef: a darker ocean blue out there, the lagoon inside, surf breaking on the reef
    float reefFoam = 0.0;
    if (uReef > 0.0) {
      float reefX = -95.0 + 8.0 * sin(vWorld.z * 0.013) + 4.0 * sin(vWorld.z * 0.041 + 1.3);
      float outside = smoothstep(reefX + 25.0, reefX - 8.0, vWorld.x);
      col = mix(col, uDeep * vec3(0.62, 0.78, 1.0), outside * 0.8 * uReef);
      float d = abs(vWorld.x - reefX + (noise(vWorld.zx * vec2(0.08, 0.3) + uTime * 0.2) - 0.5) * 5.0);
      float breaking = smoothstep(0.35, 0.75, noise(vec2(vWorld.z * 0.045 - uTime * 0.35, uTime * 0.15)));
      reefFoam = (1.0 - smoothstep(0.0, 2.5 + 3.0 * breaking, d)) * (0.45 + 0.55 * breaking) * uReef;
    }
    // sunlight dancing on the sandy bottom of the lagoon (fades out with distance, where it would shimmer)
    if (uCaustics > 0.0) {
      float dist = length(cameraPosition.xz - vWorld.xz);
      vec2 cp = vWorld.xz * 0.42;
      float c1 = noise(cp + vec2(uTime * 0.31, uTime * 0.17));
      float c2 = noise(cp * 1.37 + vec2(-uTime * 0.21, uTime * 0.27) + 7.3);
      float web = 1.0 - smoothstep(0.0, 0.09, abs(c1 - c2));
      float lagoon = (1.0 - smoothstep(0.0, uMilkReach * 1.2, toIce)) * 0.6 + 0.4;
      col += vec3(0.55, 0.95, 0.85) * web * 0.22 * uCaustics * lagoon * (1.0 - smoothstep(18.0, 80.0, dist));
      // pale sand shining through right at the beach
      col = mix(col, vec3(0.62, 0.86, 0.8), (1.0 - smoothstep(0.0, 5.0, toIce)) * 0.45 * uCaustics);
    }

    // Sky reflection at grazing angles
    float fresnel = pow(1.0 - max(dot(n, viewDir), 0.0), 5.0);
    col = mix(col, uSky * 0.9, clamp(fresnel * 0.35, 0.0, 0.35));

    // follow the scene lighting (darker under the ash cloud)
    col *= uLight;

    // Mirror image of the banks, the glacier and the sky, rippled by the waves (already lit)
    if (uReflect > 0.0) {
      vec2 ruv = vReflect.xy / vReflect.w + n.xz * 0.035;
      vec3 refl = texture2D(tReflect, ruv).rgb;
      float k = uReflect * (0.38 + 0.5 * pow(1.0 - max(dot(n, viewDir), 0.0), 3.0));
      col = mix(col, refl, clamp(k, 0.0, 0.85));
    }

    // Sun glint
    vec3 r = reflect(-uSunDir, n);
    float glint = pow(max(dot(r, viewDir), 0.0), 120.0);
    col += uSunColor * glint * 0.6;

    // Foam: along the banks, on wave crests, and in the boat's wake
    float t = uTime;
    float bankFoam = 1.0 - smoothstep(0.0, 1.6 + noise(vWorld.xz * 0.4 + t * 0.3) * 1.4, shore);
    float crest = smoothstep(1.15, 1.5, vHeight + noise(vWorld.xz * 1.3 - t * 0.5) * 0.3);
    float behind = vWorld.z - (uBoatZ + 4.0);           // > 0 behind the stern
    float wakeWidth = 0.35 + behind * 0.16;
    float wakeLine = 1.0 - smoothstep(0.0, 0.45, abs(abs(vWorld.x) - wakeWidth));
    float wake = behind > 0.0 ? wakeLine * (1.0 - smoothstep(2.0, 30.0, behind)) * clamp(uSpeed / 6.0, 0.0, 1.0) : 0.0;
    wake *= 0.6 + 0.4 * noise(vWorld.xz * 2.0 + t);
    // rain: little splashes flicking up all over the surface (near the camera)
    float rainDots = 0.0;
    if (uRain > 0.0) {
      vec2 cell = floor(vWorld.xz * 2.5);
      float flick = step(1.0 - 0.06 * uRain, hash(cell + floor(t * 7.0 + hash(cell) * 7.0)));
      vec2 inCell = fract(vWorld.xz * 2.5) - 0.5;
      rainDots = flick * (1.0 - smoothstep(0.1, 0.35, length(inCell))) * (1.0 - smoothstep(10.0, 45.0, length(cameraPosition.xz - vWorld.xz)));
    }
    float foam = clamp(max(max(max(bankFoam, crest * 0.7), wake), max(reefFoam, rainDots * 0.6)), 0.0, 1.0);
    col = mix(col, vec3(0.95, 0.98, 1.0) * uLight, foam * 0.8);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

/**
 * Stylised river water: GPU waves (no per-frame vertex work on the CPU), faceted shading,
 * deep/shallow colours, a mirror image of the banks (medium/high), sun glint and foam on banks,
 * crests and the wake.
 */
/** Objects on this layer are seen by the camera but left out of the water's reflection. */
export const NO_REFLECTION = 1;

export class Water {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private uniforms: Record<string, THREE.IUniform>;
  private segWidth = 1;
  private segLen = 1;
  private segs: [number, number];
  /** the open sea left of the grid, out to the horizon (see openSea) */
  private far: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial> | null = null;
  // planar reflection (see renderReflection)
  private target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  private mirror = new THREE.PerspectiveCamera();
  private clip = new THREE.Vector4();
  private plane = new THREE.Plane();
  private tmp = new THREE.Vector3();
  private target3 = new THREE.Vector3();
  reflections = false;

  constructor(segments: [number, number]) {
    this.uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uSwell: { value: 0.1 }, uMilk: { value: new THREE.Color(0x5cc3c8) }, uMilkAmount: { value: 0.55 }, uMilkReach: { value: 16 }, uBoatZ: { value: 0 }, uSpeed: { value: 0 },
      uOpenLeft: { value: 0 }, uRightOffset: { value: 0 }, uReef: { value: 0 }, uCaustics: { value: 0 }, uRain: { value: 0 },
      uDeep: { value: new THREE.Color(0x1f6390) }, uShallow: { value: new THREE.Color(0x4fa3c0) }, uSky: { value: new THREE.Color(0xbfe2f2) },
      uSunDir: { value: new THREE.Vector3(-0.4, 0.5, -0.75).normalize() }, uSunColor: { value: new THREE.Color(0xfff3d6) }, uLight: { value: 1 },
      tReflect: { value: null }, uReflect: { value: 0 }, uTextureMatrix: { value: new THREE.Matrix4() },
    }]);
    this.uniforms.tReflect.value = this.target.texture;
    const mat = new THREE.ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment, uniforms: this.uniforms, fog: true });
    this.segs = segments;
    this.mesh = new THREE.Mesh(this.geometry(segments), mat);
    this.mesh.frustumCulled = false;
  }

  /**
   * A level without a left bank (Mauritius): the water runs on to the horizon on the left. A second,
   * coarse grid with the same material joins the river grid along its left edge (same rows, so
   * the seam has no cracks); its waves calm down with distance.
   */
  openSea(on: boolean) {
    this.uniforms.uOpenLeft.value = on ? 1 : 0;
    if (on && !this.far) {
      this.far = new THREE.Mesh(this.farGeometry(), this.mesh.material);
      this.far.position.x = -FAR_WIDTH / 2 - WIDTH / 2;
      this.far.frustumCulled = false;
      this.mesh.add(this.far);
    } else if (!on && this.far) {
      this.mesh.remove(this.far);
      this.far.geometry.dispose();
      this.far = null;
    }
  }

  private farGeometry() {
    const g = new THREE.PlaneGeometry(FAR_WIDTH, 1000, 16, this.segs[1]);
    g.rotateX(-Math.PI / 2);
    return g;
  }

  /**
   * Water details of a level: how far out the beach (or glacier front) sits beyond the shared bank
   * line, how far the milky (or turquoise lagoon) water before it reaches, surf on a reef out on
   * the open sea, sunlight on the sandy bottom and rain on the surface (0–1 each).
   */
  setLook(o: { rightOffset?: number; milkReach?: number; reef?: number; caustics?: number; rain?: number }) {
    const u = this.uniforms;
    if (o.rightOffset != null) u.uRightOffset.value = o.rightOffset;
    if (o.milkReach != null) u.uMilkReach.value = o.milkReach;
    if (o.reef != null) u.uReef.value = o.reef;
    if (o.caustics != null) u.uCaustics.value = o.caustics;
    if (o.rain != null) u.uRain.value = o.rain;
  }

  private geometry([sx, sz]: [number, number]) {
    // the whole fjord out to the horizon; the shores cover the edges
    const length = 1000;
    this.segLen = length / sz;
    this.segWidth = WIDTH / sx;
    const g = new THREE.PlaneGeometry(WIDTH, length, sx, sz);
    g.rotateX(-Math.PI / 2);
    return g;
  }

  /**
   * The water surface as it is drawn: the shader moves only the grid points (~5 m apart) and the
   * GPU draws straight between them, so small ripples are flattened – interpolate the same way.
   */
  surfaceAt(x: number, z: number, t: number, swell: number) {
    const x0 = X0 + Math.floor((x - X0) / this.segWidth) * this.segWidth;
    const z0 = Math.floor(z / this.segLen) * this.segLen;   // the grid snaps to multiples of segLen
    const fx = (x - x0) / this.segWidth, fz = (z - z0) / this.segLen;
    const h = (dx: number, dz: number) => waterHeight(x0 + dx * this.segWidth, z0 + dz * this.segLen, t, swell);
    return (h(0, 0) * (1 - fx) + h(1, 0) * fx) * (1 - fz) + (h(0, 1) * (1 - fx) + h(1, 1) * fx) * fz;
  }

  /** How milky the water gets towards the right bank (glacier meltwater in Iceland; 0 = none). */
  set milk(amount: number) { this.uniforms.uMilkAmount.value = amount; }

  setSegments(segments: [number, number]) {
    this.segs = segments;
    this.mesh.geometry.dispose();
    this.mesh.geometry = this.geometry(segments);
    if (this.far) { this.far.geometry.dispose(); this.far.geometry = this.farGeometry(); }
  }

  update(p: { time: number; boatZ: number; speed: number; swell: number; water: THREE.Color; sky: THREE.Color; sunColor: THREE.Color; sunDir: THREE.Vector3; light: number }) {
    // Snap to the grid spacing so waves don't shimmer while the mesh follows the boat
    this.mesh.position.set(X0 + WIDTH / 2, 0, Math.round((p.boatZ - 430) / this.segLen) * this.segLen);
    const u = this.uniforms;
    u.uTime.value = p.time;
    u.uSwell.value = p.swell;
    u.uBoatZ.value = p.boatZ;
    u.uSpeed.value = p.speed;
    u.uLight.value = p.light;
    (u.uDeep.value as THREE.Color).copy(p.water).multiplyScalar(0.75);
    (u.uShallow.value as THREE.Color).copy(p.water).lerp(new THREE.Color(0x4fae9c), 0.4);
    (u.uMilk.value as THREE.Color).copy(p.water).lerp(new THREE.Color(0x7fd6d2), 0.55);
    (u.uSky.value as THREE.Color).copy(p.sky);
    (u.uSunColor.value as THREE.Color).copy(p.sunColor);
    (u.uSunDir.value as THREE.Vector3).copy(p.sunDir);
  }

  /** Reflection texture at a fraction of the screen resolution. */
  setReflectionSize(width: number, height: number) {
    this.target.setSize(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
  }

  /**
   * Render the scene seen in the water surface (y = 0) into the reflection texture: the camera is
   * mirrored at the surface and everything below it is clipped with an oblique near plane
   * (technique of three.js' Reflector). Call before the main render.
   */
  renderReflection(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
    this.uniforms.uReflect.value = this.reflections ? 0.6 : 0;
    if (!this.reflections) return;
    const m = this.mirror;
    camera.updateMatrixWorld();
    m.copy(camera, false);
    // big see-through effects high in the sky (the volcano's plume) would cost a lot of fill rate
    // in the reflection for little gain
    m.layers.disable(NO_REFLECTION);
    m.position.set(camera.position.x, -camera.position.y, camera.position.z);
    this.tmp.set(0, 0, -1).applyQuaternion(camera.quaternion).add(camera.position);
    this.target3.set(this.tmp.x, -this.tmp.y, this.tmp.z);
    m.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    m.up.y = -m.up.y;
    m.lookAt(this.target3);
    m.updateMatrixWorld();
    m.projectionMatrix.copy(camera.projectionMatrix);
    // texture matrix: world → reflection texture coordinates (before the oblique clip)
    (this.uniforms.uTextureMatrix.value as THREE.Matrix4).set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1)
      .multiply(m.projectionMatrix).multiply(m.matrixWorldInverse);
    // oblique near plane = the water surface
    this.plane.set(new THREE.Vector3(0, 1, 0), 0).applyMatrix4(m.matrixWorldInverse);
    this.clip.set(this.plane.normal.x, this.plane.normal.y, this.plane.normal.z, this.plane.constant);
    const e = m.projectionMatrix.elements;
    const q = new THREE.Vector4((Math.sign(this.clip.x) + e[8]) / e[0], (Math.sign(this.clip.y) + e[9]) / e[5], -1, (1 + e[10]) / e[14]);
    this.clip.multiplyScalar(2 / this.clip.dot(q));
    e[2] = this.clip.x; e[6] = this.clip.y; e[10] = this.clip.z + 1 - 0.003; e[14] = this.clip.w;
    m.projectionMatrixInverse.copy(m.projectionMatrix).invert();

    const prevTarget = renderer.getRenderTarget();
    this.mesh.visible = false;
    renderer.setRenderTarget(this.target);
    renderer.clear();
    renderer.render(scene, m);
    renderer.setRenderTarget(prevTarget);
    this.mesh.visible = true;
  }

  dispose() { this.far?.geometry.dispose(); this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.target.dispose(); }
}
