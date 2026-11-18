import * as THREE from 'three';
import { glacierFront } from './Fjord';
import type { PaintedProps } from './PaintedProps';

/**
 * The glacier calves (a story beat right after the first tremor): ahead of the boat an ice tower
 * leans out of the glacier front, topples ever faster into the river and crashes down in a big
 * fountain of spray with a ring of foam; a swell runs across the river and rocks the boat when it
 * arrives. The ice then drifts on as a bobbing iceberg until the boat has passed it.
 */

const AHEAD = 38;          // m in front of the boat
const SCALE = 2.6;         // the painted pinnacle berg (Ice_B), about 13 m tall
const FALL = 2.4;          // s from the first lean to the impact
const SWELL_SPEED = 9;     // m/s

const sprayVertex = /* glsl */ `
  attribute vec4 seed;
  uniform float uT;
  uniform float uPx;
  varying float vK;
  void main() {
    float life = 1.4 + seed.x * 1.4;
    float t = uT - seed.w * 0.25;
    vK = t / life;
    // a fountain thrown up and outwards from where the ice hits the water
    float a = seed.y * 6.2832;
    float spread = 2.0 + seed.z * 7.0;
    vec3 vel = vec3(cos(a) * spread, 7.0 + seed.x * 11.0, sin(a) * spread * 0.7);
    vec3 p = position + vel * t + vec3(0.0, -6.5 * t * t, 0.0);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = (t < 0.0 || vK >= 1.0 || p.y < -0.5) ? 0.0 : (0.35 + 0.9 * seed.z) * (0.7 + vK) * uPx / -mv.z;
  }
`;
const sprayFragment = /* glsl */ `
  uniform float uLight;
  varying float vK;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c) * 2.0;
    if (r > 1.0) discard;
    float fade = 1.0 - clamp(vK, 0.0, 1.0);
    gl_FragColor = vec4(vec3(0.95, 0.98, 1.0) * uLight, (1.0 - r * r) * fade * 0.8);
    #include <colorspace_fragment>
  }
`;

/** a soft ring (alpha rises and falls across its width), drawn once */
function ringTexture(width: number) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(Math.max(0, 1 - width * 2), 'rgba(255,255,255,0)');
  grad.addColorStop(1 - width, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.98, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Calving {
  readonly group = new THREE.Group();
  /** called when the swell reaches the boat */
  onSwell: (() => void) | null = null;

  private ice = new THREE.Group();
  private pivot = new THREE.Group();
  private spray: THREE.Points;
  private sprayMat: THREE.ShaderMaterial;
  private foam: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private swell: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private t = -1;            // seconds since the calving began (−1: nothing happening)
  private impact = new THREE.Vector3();
  private swellHit = false;
  private built = false;

  constructor(private props: PaintedProps) {
    this.group.add(this.pivot);
    this.pivot.add(this.ice);
    const n = 420;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('seed', new THREE.BufferAttribute(Float32Array.from({ length: n * 4 }, Math.random), 4));
    this.sprayMat = new THREE.ShaderMaterial({
      vertexShader: sprayVertex, fragmentShader: sprayFragment, transparent: true, depthWrite: false,
      uniforms: { uT: { value: -1 }, uPx: { value: 700 }, uLight: { value: 1 } },
    });
    this.spray = new THREE.Points(g, this.sprayMat);
    this.spray.frustumCulled = false;
    const ring = (width: number) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2),
        new THREE.MeshBasicMaterial({ map: ringTexture(width), color: 0xf4fbff, transparent: true, opacity: 0, depthWrite: false }));
      m.renderOrder = 3;
      return m;
    };
    this.foam = ring(0.45);    // a broad, soft band of foam
    this.swell = ring(0.08);   // a thin, soft swell line
    this.group.add(this.spray, this.foam, this.swell);
    this.group.visible = false;
  }

  /** Start the calving ahead of the boat. */
  start(boatZ: number) {
    if (!this.built) {
      const model = this.props.get('Ice_B');
      if (!model) return;
      for (const p of model.parts) this.ice.add(new THREE.Mesh(p.geometry, p.material));
      this.ice.scale.setScalar(SCALE);
      this.built = true;
    }
    const z = boatZ - AHEAD;
    const front = glacierFront(z);
    // the tower stands right at the ice front; it tips over its outer foot into the river
    this.pivot.position.set(front - 3, 0, z);
    this.pivot.rotation.set(0, 0, 0);
    this.ice.position.set(-1.0, 0, 0);
    this.ice.rotation.set(0, Math.random() * Math.PI, 0);
    this.group.visible = true;
    this.t = 0;
    this.swellHit = false;
    this.sprayMat.uniforms.uT.value = -1;
  }

  update(p: { dt: number; time: number; boatZ: number; light: number; pixelHeight: number; camera: THREE.PerspectiveCamera }) {
    if (this.t < 0) return;
    this.t += p.dt;
    const t = this.t;
    if (t < FALL) {
      // leans out slowly, then falls ever faster (towards −x: into the river)
      const k = t / FALL;
      this.pivot.rotation.z = (Math.PI * 0.5) * k * k * k + Math.sin(t * 30) * 0.01 * (1 - k);
      this.pivot.position.y = 0;
    } else {
      // it hit the water: rolls a little back and floats, half sunk, bobbing
      const s = t - FALL;
      this.pivot.rotation.z = Math.PI * 0.5 - 0.25 * (1 - Math.exp(-s * 1.5)) + Math.sin(s * 2.2) * 0.06 * Math.exp(-s * 0.4);
      this.pivot.position.y = -2.5 + Math.sin(s * 1.7) * 0.5 * Math.exp(-s * 0.5);
      if (this.sprayMat.uniforms.uT.value < 0) {
        // where the top of the tower comes down
        this.impact.set(this.pivot.position.x - 13 * 0.6, 0, this.pivot.position.z);
        this.spray.position.copy(this.impact);
        this.foam.position.set(this.impact.x, 0.1, this.impact.z);
        this.swell.position.set(this.impact.x, 0.12, this.impact.z);
      }
      this.sprayMat.uniforms.uT.value = s;
      // foam spreading where it fell, a swell ring running across the river
      const f = Math.min(1, s / 3);
      this.foam.scale.setScalar(3 + f * 14);
      this.foam.material.opacity = 0.75 * (1 - f);
      const r = 4 + s * SWELL_SPEED;
      this.swell.scale.setScalar(r);
      this.swell.material.opacity = Math.max(0, 0.45 - s * 0.06);
      const toBoat = Math.hypot(this.impact.x, this.impact.z - p.boatZ);
      if (!this.swellHit && r >= toBoat) { this.swellHit = true; this.onSwell?.(); }
    }
    this.sprayMat.uniforms.uLight.value = Math.min(1.1, 0.6 + p.light * 0.5);
    this.sprayMat.uniforms.uPx.value = p.pixelHeight / (2 * Math.tan(THREE.MathUtils.degToRad(p.camera.fov) / 2));
    // done once the boat has left the berg far behind
    if (t > FALL + 2 && this.pivot.position.z > p.boatZ + 120) { this.t = -1; this.group.visible = false; }
  }

  dispose() {
    this.spray.geometry.dispose();
    this.sprayMat.dispose();
    for (const m of [this.foam, this.swell]) { m.geometry.dispose(); m.material.map?.dispose(); m.material.dispose(); }
  }
}
