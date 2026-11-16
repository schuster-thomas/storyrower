import * as THREE from 'three';
import type { Environment } from '../levels/iceland';

const CHUNK = 40;          // length of one world chunk (m)
const CHUNKS_AHEAD = 10;
const CHUNKS_BEHIND = 2;
const RIVER_HALF = 9;      // half river width
/** World units per real metre. >1 makes the boat feel faster than the real split. */
export const SPEED_SCALE = 2;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpColor = (c: THREE.Color, hex: number, t: number) => c.lerp(new THREE.Color(hex), t);

/** Seeded random so the world looks the same for the same chunk index. */
function rand(seed: number) {
  let s = seed * 9301 + 49297;
  return () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
}

interface Chunk { index: number; group: THREE.Group }

/**
 * Greybox river world: endless river made of chunks, a rowing boat whose oars follow the
 * real strokes, a volcano in the distance and a tidal wave that chases the boat.
 */
export class RiverScene {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(60, 1, 0.1, 1200);
  private hemi = new THREE.HemisphereLight(0xffffff, 0x445533, 1.2);
  private sun = new THREE.DirectionalLight(0xffffff, 2);

  private env: Environment;
  private envTarget: Environment;
  private skyColor = new THREE.Color();
  private groundMat = new THREE.MeshStandardMaterial({ color: 0x5f9e4f, roughness: 1, flatShading: true });
  private cliffMat = new THREE.MeshStandardMaterial({ color: 0x6f6a64, roughness: 1, flatShading: true });
  private treeMat = new THREE.MeshStandardMaterial({ color: 0x2f6b3a, roughness: 1, flatShading: true });
  private trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 1 });
  private rockMat = new THREE.MeshStandardMaterial({ color: 0x8a8580, roughness: 1, flatShading: true });
  private fallMat = new THREE.MeshBasicMaterial({ color: 0xeaf6ff, transparent: true, opacity: 0.85 });
  private waterMat = new THREE.MeshStandardMaterial({ color: 0x2a7fb8, roughness: 0.25, metalness: 0.1, flatShading: true });
  private water: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  private waterBase: Float32Array;

  private chunks: Chunk[] = [];
  private treeGeo = new THREE.ConeGeometry(1.4, 4.5, 6);
  private trunkGeo = new THREE.CylinderGeometry(0.25, 0.3, 1.2, 5);
  private rockGeo = new THREE.DodecahedronGeometry(1, 0);

  private boat = new THREE.Group();
  private torso!: THREE.Group;
  private oars: { pivot: THREE.Group; side: 1 | -1 }[] = [];
  private volcano = new THREE.Group();
  private lavaMat = new THREE.MeshStandardMaterial({ color: 0x3a2a24, emissive: 0xff4a10, emissiveIntensity: 0, roughness: 1, flatShading: true, fog: false });
  private smoke: THREE.Mesh[] = [];
  private wave: THREE.Mesh;
  private waveMat = new THREE.MeshStandardMaterial({ color: 0x6fb4d8, roughness: 0.3, transparent: true, opacity: 0.92, flatShading: true });

  private z = 0;              // boat position (moves towards -z)
  private speed = 0;          // current world speed (units/s)
  private time = 0;
  private strokePhase = 1;    // 0 = catch, 0.35 = finish, 1 = ready for next catch
  private strokeCycle = 2.5;  // s
  private shake = 0;

  constructor(canvas: HTMLCanvasElement, env: Environment) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.env = { ...env };
    this.envTarget = { ...env };
    this.scene.fog = new THREE.Fog(env.fog, env.fogNear, env.fogFar);

    this.sun.position.set(-40, 80, 30);
    this.scene.add(this.hemi, this.sun, this.sun.target);

    // Water: a low-res plane that travels with the boat; vertices bob with the swell
    const wg = new THREE.PlaneGeometry(RIVER_HALF * 2 + 6, 360, 16, 90);
    wg.rotateX(-Math.PI / 2);
    this.water = new THREE.Mesh(wg, this.waterMat);
    this.waterBase = Float32Array.from(wg.attributes.position.array as Float32Array);
    this.scene.add(this.water);

    this.buildBoat();
    this.buildVolcano();
    this.wave = this.buildWave();
    this.applyEnvironment(1);
  }

  // ---------- public API ----------

  /** Blend the world towards another phase look (smoothly over a few seconds). */
  setEnvironment(env: Environment, immediate = false) {
    this.envTarget = { ...env };
    if (immediate) this.applyEnvironment(1);
  }

  /** A real stroke happened. `intervalMs` = time since the previous one. */
  stroke(intervalMs: number | null) {
    if (intervalMs && intervalMs > 800 && intervalMs < 6000) this.strokeCycle = lerp(this.strokeCycle, intervalMs / 1000, 0.5);
    this.strokePhase = 0;
  }

  /**
   * @param dt seconds since last frame
   * @param metersPerSecond boat speed from the (smoothed) split, 0 when paused
   * @param threat 0 = wave on top of you, 1 = far away
   * @param intensity 0–1 from the workout segment (camera shake, swell)
   */
  update(dt: number, metersPerSecond: number, threat: number, intensity: number) {
    dt = Math.min(dt, 0.1);
    this.time += dt;
    // Speed eases towards the target; the drive adds a little surge
    const surge = this.strokePhase < 0.35 ? 1.15 : 0.95;
    const target = metersPerSecond * SPEED_SCALE * (metersPerSecond > 0 ? surge : 1);
    this.speed = lerp(this.speed, target, 1 - Math.exp(-dt * 1.5));
    this.z -= this.speed * dt;

    this.applyEnvironment(1 - Math.exp(-dt * 0.4));
    this.updateChunks();
    this.updateWater();
    this.updateBoat(dt);
    this.updateVolcano(dt);
    this.updateWave(dt, threat);
    this.updateCamera(dt, threat, intensity);
    this.renderer.render(this.scene, this.camera);
  }

  resize(width: number, height: number) {
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / Math.max(1, height);
    this.camera.updateProjectionMatrix();
  }

  dispose() {
    this.renderer.dispose();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
    });
  }

  // ---------- environment ----------

  private applyEnvironment(t: number) {
    const e = this.env, g = this.envTarget;
    for (const k of ['fogNear', 'fogFar', 'sunIntensity', 'lava', 'smoke', 'wave', 'swell'] as const) e[k] = lerp(e[k], g[k], t);
    for (const k of ['sky', 'fog', 'sun', 'ground', 'water'] as const) e[k] = new THREE.Color(e[k]).lerp(new THREE.Color(g[k]), t).getHex();

    this.skyColor.set(e.sky);
    this.scene.background = this.skyColor;
    const fog = this.scene.fog as THREE.Fog;
    fog.color.set(e.fog); fog.near = e.fogNear; fog.far = e.fogFar;
    this.sun.color.set(e.sun); this.sun.intensity = e.sunIntensity;
    this.hemi.color.set(e.sky);
    this.groundMat.color.set(e.ground);
    lerpColor(this.treeMat.color.set(0x2f6b3a), 0x3a3d33, e.smoke * 0.6);
    this.waterMat.color.set(e.water);
    this.lavaMat.emissiveIntensity = e.lava * 2.5;
  }

  // ---------- chunks ----------

  private updateChunks() {
    const current = Math.floor(-this.z / CHUNK);
    const min = current - CHUNKS_BEHIND, max = current + CHUNKS_AHEAD;
    this.chunks = this.chunks.filter((c) => {
      if (c.index >= min && c.index <= max) return true;
      this.scene.remove(c.group);
      const shared = new Set<THREE.BufferGeometry>([this.treeGeo, this.trunkGeo, this.rockGeo]);
      c.group.traverse((o) => {
        if ((o as THREE.InstancedMesh).isInstancedMesh) (o as THREE.InstancedMesh).dispose();
        const g = (o as THREE.Mesh).geometry;
        if (g && !shared.has(g)) g.dispose();
      });
      return false;
    });
    for (let i = min; i <= max; i++) if (!this.chunks.some((c) => c.index === i)) this.chunks.push(this.buildChunk(i));
  }

  private buildChunk(index: number): Chunk {
    const r = rand(index + 1000);
    const group = new THREE.Group();
    group.position.z = -index * CHUNK - CHUNK / 2;

    // Banks
    const bankGeo = new THREE.BoxGeometry(60, 1.2, CHUNK + 0.1);
    for (const side of [-1, 1]) {
      const bank = new THREE.Mesh(bankGeo, this.groundMat);
      bank.position.set(side * (RIVER_HALF + 30), 0.2, 0);
      group.add(bank);
    }

    // Trees and rocks as instanced meshes
    const trees = 14, rocks = 6;
    const treeMesh = new THREE.InstancedMesh(this.treeGeo, this.treeMat, trees);
    const trunkMesh = new THREE.InstancedMesh(this.trunkGeo, this.trunkMat, trees);
    const rockMesh = new THREE.InstancedMesh(this.rockGeo, this.rockMat, rocks);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    for (let i = 0; i < trees; i++) {
      const side = r() < 0.5 ? -1 : 1;
      const x = side * (RIVER_HALF + 2 + r() * 22);
      const z = (r() - 0.5) * CHUNK;
      const h = 0.7 + r() * 0.8;
      treeMesh.setMatrixAt(i, m.compose(p.set(x, 0.8 + 3.2 * h, z), q.identity(), s.set(h, h, h)));
      trunkMesh.setMatrixAt(i, m.compose(p.set(x, 0.8 + 0.6 * h, z), q.identity(), s.set(h, h, h)));
    }
    for (let i = 0; i < rocks; i++) {
      const side = r() < 0.5 ? -1 : 1;
      const k = 0.6 + r() * 1.4;
      rockMesh.setMatrixAt(i, m.compose(p.set(side * (RIVER_HALF + 0.5 + r() * 3), 0.4, (r() - 0.5) * CHUNK), q.setFromEuler(new THREE.Euler(r(), r(), r())), s.set(k, k * 0.7, k)));
    }
    group.add(treeMesh, trunkMesh, rockMesh);

    // Cliffs further out, sometimes with a waterfall
    for (const side of [-1, 1]) {
      if (r() < 0.55) {
        const h = 12 + r() * 22;
        const cliff = new THREE.Mesh(new THREE.BoxGeometry(14 + r() * 10, h, CHUNK * (0.6 + r() * 0.5)), this.cliffMat);
        cliff.position.set(side * (RIVER_HALF + 34 + r() * 10), h / 2, (r() - 0.5) * 10);
        group.add(cliff);
        if (r() < 0.45) {
          const fall = new THREE.Mesh(new THREE.PlaneGeometry(3 + r() * 3, h), this.fallMat);
          fall.position.set(cliff.position.x - side * ((cliff.geometry as THREE.BoxGeometry).parameters.width / 2 + 0.05), h / 2, cliff.position.z);
          fall.rotation.y = side * Math.PI / 2;
          group.add(fall);
        }
      }
    }
    this.scene.add(group);
    return { index, group };
  }

  private updateWater() {
    this.water.position.z = this.z - 140;
    const pos = this.water.geometry.attributes.position;
    const arr = pos.array as Float32Array;
    const amp = 0.06 + this.env.swell * 0.45;
    const t = this.time;
    for (let i = 0; i < arr.length; i += 3) {
      const x = this.waterBase[i], z = this.waterBase[i + 2] + this.water.position.z;
      arr[i + 1] = Math.sin(x * 0.45 + t * 1.3) * Math.cos(z * 0.18 + t * 0.9) * amp + Math.sin(z * 0.07 - t * 0.6) * amp * 0.6;
    }
    pos.needsUpdate = true;
    this.water.geometry.computeVertexNormals();
  }

  // ---------- boat ----------

  private buildBoat() {
    const hullMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.4 });
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0xd8333b, roughness: 0.5 });
    const oarMat = new THREE.MeshStandardMaterial({ color: 0x222831, roughness: 0.6 });
    const bladeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 });
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xe0b48f, roughness: 0.8 });
    const shirtMat = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.7 });

    const hull = new THREE.Mesh(new THREE.CapsuleGeometry(0.45, 6.5, 4, 10), hullMat);
    hull.rotation.x = Math.PI / 2;
    hull.scale.set(1, 1, 0.45);
    hull.position.y = 0.15;
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.02, 5.5), stripeMat);
    stripe.position.set(0, 0.36, 0);
    this.boat.add(hull, stripe);

    // Rower: torso pivots at the hips to lean with the stroke
    this.torso = new THREE.Group();
    this.torso.position.set(0, 0.55, 0.4);
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.6, 4, 8), shirtMat);
    body.position.y = 0.45;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 10), skinMat);
    head.position.y = 1.05;
    this.torso.add(body, head);
    this.boat.add(this.torso);

    // Oars on riggers
    for (const side of [-1, 1] as const) {
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.75, 0.75, 0.1);
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 3.6, 6), oarMat);
      shaft.rotation.z = Math.PI / 2;
      shaft.position.x = side * 1.2;
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.22, 0.03), bladeMat);
      blade.position.x = side * 2.95;
      pivot.add(shaft, blade);
      this.boat.add(pivot);
      this.oars.push({ pivot, side });
    }
    this.scene.add(this.boat);
  }

  private updateBoat(dt: number) {
    // Advance the stroke cycle; hold at the catch until the next real stroke arrives
    if (this.strokePhase < 1) this.strokePhase = Math.min(1, this.strokePhase + dt / this.strokeCycle);
    const p = this.strokePhase;
    const drive = p < 0.35;
    const k = drive ? p / 0.35 : (p - 0.35) / 0.65;           // progress within drive/recovery
    const sweep = drive ? lerp(0.75, -0.55, easeInOut(k)) : lerp(-0.55, 0.75, easeInOut(k)); // + = towards the bow
    const lift = drive ? -0.12 : 0.18 * Math.sin(Math.PI * k);
    for (const o of this.oars) {
      o.pivot.rotation.y = -o.side * sweep * 0.9;
      o.pivot.rotation.z = o.side * (lift - 0.08);
    }
    this.torso.rotation.x = drive ? lerp(0.45, -0.35, easeInOut(k)) : lerp(-0.35, 0.45, easeInOut(k));
    this.torso.position.z = drive ? lerp(0.0, 0.5, k) : lerp(0.5, 0.0, k);

    this.boat.position.set(0, Math.sin(this.time * 1.7) * 0.04 * (1 + this.env.swell * 3), this.z);
    this.boat.rotation.z = Math.sin(this.time * 1.1) * 0.015 * (1 + this.env.swell * 4);
    this.boat.rotation.x = Math.sin(this.time * 0.9) * 0.01 * (1 + this.env.swell * 3);
  }

  // ---------- volcano & smoke ----------

  private buildVolcano() {
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x6a6670, roughness: 1, flatShading: true, fog: false });
    const cone = new THREE.Mesh(new THREE.ConeGeometry(160, 150, 9, 1, true), rockMat);
    cone.position.y = 70;
    const crater = new THREE.Mesh(new THREE.CylinderGeometry(28, 40, 12, 9), this.lavaMat);
    crater.position.y = 140;
    this.volcano.add(cone, crater);
    const smokeMat = new THREE.MeshStandardMaterial({ color: 0x3d3a3a, roughness: 1, transparent: true, opacity: 0.85, flatShading: true, fog: false });
    for (let i = 0; i < 9; i++) {
      const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 0), smokeMat);
      this.smoke.push(puff);
      this.volcano.add(puff);
    }
    this.volcano.position.set(110, 0, -700);
    this.scene.add(this.volcano);
  }

  private updateVolcano(_dt: number) {
    // Stays on the horizon, slowly drifting closer as the story escalates
    this.volcano.position.z = this.z - 700 + this.env.lava * 180;
    const s = this.env.smoke;
    this.smoke.forEach((puff, i) => {
      const life = (this.time * 0.05 + i / this.smoke.length) % 1;
      const size = (8 + life * 55) * s;
      puff.scale.setScalar(Math.max(0.001, size));
      puff.position.set(Math.sin(i * 2.1) * 20 * life, 150 + life * 160 * Math.max(0.3, s), Math.cos(i * 1.7) * 15 * life);
      puff.visible = s > 0.02;
    });
  }

  // ---------- tidal wave ----------

  private buildWave(): THREE.Mesh {
    const g = new THREE.CylinderGeometry(9, 9, 60, 20, 1, true, 0, Math.PI);
    g.rotateZ(Math.PI / 2);
    const wave = new THREE.Mesh(g, this.waveMat);
    wave.material.side = THREE.DoubleSide;
    this.scene.add(wave);
    return wave;
  }

  private updateWave(_dt: number, threat: number) {
    const show = this.env.wave;
    this.wave.visible = show > 0.02;
    if (!this.wave.visible) return;
    // threat 1 → far behind, threat 0 → right at the stern
    const dist = 12 + threat * 70 + (1 - show) * 120;
    const h = 0.6 + show * 1.2;
    this.wave.position.set(0, -2, this.z + dist);
    this.wave.scale.set(1, h, 1);
    this.wave.rotation.x = Math.sin(this.time * 2) * 0.03;
  }

  // ---------- camera ----------

  private updateCamera(dt: number, threat: number, intensity: number) {
    const danger = this.env.wave * (1 - threat);
    this.shake = lerp(this.shake, 0.02 + intensity * 0.05 * this.env.swell + danger * 0.25, 1 - Math.exp(-dt * 2));
    const sx = (Math.sin(this.time * 23) + Math.sin(this.time * 17)) * 0.5 * this.shake;
    const sy = (Math.sin(this.time * 19) + Math.sin(this.time * 29)) * 0.5 * this.shake;
    // While the wave chases you, the camera swings around the boat: side view during the
    // eruption, a front view (the rower's own view – rowers face the stern) in the finale.
    const w = this.env.wave;
    const a = Math.PI * w * w * w; // eruption (0.6) ≈ 40° three-quarter view, finale (1) = 180°
    const f = a / Math.PI;
    const r = 8.5 + 3 * Math.sin(a) + 2.5 * f;
    this.camera.position.set(sx + Math.sin(a) * r + Math.sin(this.time * 0.3) * 0.3, 3.4 + 2.6 * f + sy, this.z + Math.cos(a) * r);
    this.camera.lookAt(-Math.sin(a) * 4, 1.2 - 0.7 * f, this.z - Math.cos(a) * (12 - 2 * f));
    this.sun.position.set(-40, 80, this.z + 30);
    this.sun.target.position.set(0, 0, this.z - 20);
  }
}

function easeInOut(t: number) { return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2; }
