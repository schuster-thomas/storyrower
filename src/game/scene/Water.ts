import * as THREE from 'three';

const vertex = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>
  uniform float uTime;
  uniform float uSwell;
  varying vec3 vWorld;
  varying float vHeight;
  varying vec3 vNormal;

  float waves(vec2 p, float t) {
    float h = sin(p.x * 0.45 + t * 1.3) * cos(p.y * 0.18 + t * 0.9);
    h += sin(p.y * 0.07 - t * 0.6) * 0.6;
    h += sin((p.x + p.y) * 0.9 + t * 2.1) * 0.18;
    return h;
  }

  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    float amp = 0.06 + uSwell * 0.45;
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
  uniform float uRiverHalf;
  uniform float uBoatZ;
  uniform float uSpeed;
  uniform vec3 uDeep;
  uniform vec3 uShallow;
  uniform vec3 uSky;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uLight;
  varying vec3 vWorld;
  varying float vHeight;
  varying vec3 vNormal;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }

  void main() {
    // Smooth wave normal, slightly roughened with noise for sparkle
    vec3 n = normalize(vNormal + vec3(noise(vWorld.xz * 1.7 + uTime * 0.8) - 0.5, 0.0, noise(vWorld.zx * 1.7 - uTime * 0.7) - 0.5) * 0.25);
    vec3 viewDir = normalize(cameraPosition - vWorld);

    // Deep in the middle, lighter towards the banks
    float edge = abs(vWorld.x) / uRiverHalf;
    vec3 col = mix(uDeep, uShallow, smoothstep(0.55, 1.0, edge));

    // Sky reflection at grazing angles
    float fresnel = pow(1.0 - max(dot(n, viewDir), 0.0), 5.0);
    col = mix(col, uSky * 0.9, clamp(fresnel * 0.35, 0.0, 0.35));

    // Sun glint
    vec3 r = reflect(-uSunDir, n);
    float glint = pow(max(dot(r, viewDir), 0.0), 120.0);
    col += uSunColor * glint * 0.6;

    // Foam: along the banks, on wave crests, and in the boat's wake
    float t = uTime;
    float bankFoam = smoothstep(0.9, 0.99, edge + (noise(vWorld.xz * 0.6 + t * 0.3) - 0.5) * 0.08) * (1.0 - smoothstep(1.02, 1.1, edge));
    float crest = smoothstep(1.15, 1.5, vHeight + noise(vWorld.xz * 1.3 - t * 0.5) * 0.3);
    float behind = vWorld.z - (uBoatZ + 3.0);           // > 0 behind the stern
    float wakeWidth = 0.35 + behind * 0.16;
    float wakeLine = 1.0 - smoothstep(0.0, 0.45, abs(abs(vWorld.x) - wakeWidth));
    float wake = behind > 0.0 ? wakeLine * smoothstep(30.0, 2.0, behind) * clamp(uSpeed / 6.0, 0.0, 1.0) : 0.0;
    wake *= 0.6 + 0.4 * noise(vWorld.xz * 2.0 + t);
    float foam = clamp(max(max(bankFoam, crest * 0.7), wake), 0.0, 1.0);
    col = mix(col, vec3(0.95, 0.98, 1.0), foam * 0.8);

    // follow the scene lighting (darker under the ash cloud)
    col *= uLight;
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

/**
 * Stylised river water: GPU waves (no per-frame vertex work on the CPU), faceted shading,
 * deep/shallow colours, sky reflection, sun glint and foam on banks, crests and the wake.
 */
export class Water {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  private uniforms: Record<string, THREE.IUniform>;
  private segLen = 1;

  constructor(private riverHalf: number, segments: [number, number]) {
    this.uniforms = THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 }, uSwell: { value: 0.1 }, uRiverHalf: { value: riverHalf }, uBoatZ: { value: 0 }, uSpeed: { value: 0 },
      uDeep: { value: new THREE.Color(0x1f6390) }, uShallow: { value: new THREE.Color(0x4fa3c0) }, uSky: { value: new THREE.Color(0xbfe2f2) },
      uSunDir: { value: new THREE.Vector3(-0.4, 0.5, -0.75).normalize() }, uSunColor: { value: new THREE.Color(0xfff3d6) }, uLight: { value: 1 },
    }]);
    const mat = new THREE.ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment, uniforms: this.uniforms, fog: true });
    this.mesh = new THREE.Mesh(this.geometry(segments), mat);
    this.mesh.frustumCulled = false;
  }

  private geometry([sx, sz]: [number, number]) {
    const length = 380;
    this.segLen = length / sz;
    const g = new THREE.PlaneGeometry(this.riverHalf * 2 + 4, length, sx, sz);
    g.rotateX(-Math.PI / 2);
    return g;
  }

  setSegments(segments: [number, number]) {
    this.mesh.geometry.dispose();
    this.mesh.geometry = this.geometry(segments);
  }

  update(p: { time: number; boatZ: number; speed: number; swell: number; water: THREE.Color; sky: THREE.Color; sunColor: THREE.Color; sunDir: THREE.Vector3; light: number }) {
    // Snap to the grid spacing so waves don't shimmer while the mesh follows the boat
    this.mesh.position.z = Math.round((p.boatZ - 150) / this.segLen) * this.segLen;
    const u = this.uniforms;
    u.uTime.value = p.time;
    u.uSwell.value = p.swell;
    u.uBoatZ.value = p.boatZ;
    u.uSpeed.value = p.speed;
    u.uLight.value = p.light;
    (u.uDeep.value as THREE.Color).copy(p.water).multiplyScalar(0.75);
    (u.uShallow.value as THREE.Color).copy(p.water).lerp(new THREE.Color(0x5fb8c0), 0.35);
    (u.uSky.value as THREE.Color).copy(p.sky);
    (u.uSunColor.value as THREE.Color).copy(p.sunColor);
    (u.uSunDir.value as THREE.Vector3).copy(p.sunDir);
  }

  dispose() { this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}
