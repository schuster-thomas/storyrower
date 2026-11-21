import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import dragonUrl from '../../../assets/models/dragon.glb?url';
import type { WorldHost } from '../World';
import { puffTexture } from './textures';

const SPAN = 46;         // wingspan (m)
const AHEAD = 72;        // where it hovers in front of the boat
const HEIGHT = 17;
/** The Tripo model lies with its wings along z and faces +x: turn it to wings along x, facing +z. */
const TURN = new THREE.Matrix4().makeRotationY(-Math.PI / 2);
const rnd = (a: number, b: number) => a + Math.random() * (b - a);
const smooth = (x: number) => { const c = Math.max(0, Math.min(1, x)); return c * c * (3 - 2 * c); };

type Phase = 'idle' | 'charge' | 'fire';

/**
 * An original dark green, almost black dragon with huge bat wings (Tripo3D model from a painted concept, see
 * scripts/tokyo/assets.mjs 'dragon-concept'): it rises from behind the skyline, hovers above the
 * river ahead of the boat with slow, heavy wing beats and fires blue laser beams from its eyes
 * at the water left and right of the boat – closer when the rower falls behind the targets.
 * After the escape it soars away. The wings beat in the vertex shader (no rig needed).
 */
export class Dragon {
  readonly group = new THREE.Group();
  private model = new THREE.Group();
  private flap = { value: 0 };
  private glowUniform = { value: 0 };
  private eyes = new THREE.Vector3(0, 0.1, 0.3);     // model space, set from the mesh once loaded
  private pos = new THREE.Vector3();
  private look = new THREE.Vector3();
  private beams: { core: THREE.Mesh; glow: THREE.Mesh; from: THREE.Vector3; to: THREE.Vector3; end: THREE.Vector3 }[] = [];
  private eyeGlow: THREE.Sprite[] = [];
  private hits: { sprite: THREE.Sprite; age: number }[] = [];
  private phase: Phase = 'idle';
  private phaseT = 0;
  private timer = 2.5;
  private wingT = 0;
  private tmp = new THREE.Vector3();
  private tmp2 = new THREE.Vector3();
  private glowTex = puffTexture();
  private disposables: { dispose(): void }[] = [];
  readonly loaded: Promise<void>;

  private static loading: Promise<THREE.Object3D> | null = null;
  static preload() {
    if (!this.loading) {
      const loader = new GLTFLoader();
      loader.setMeshoptDecoder(MeshoptDecoder);
      this.loading = loader.loadAsync(dragonUrl).then((g) => g.scene);
      this.loading.catch(() => { this.loading = null; });
    }
    return this.loading;
  }

  constructor(private host: WorldHost) {
    const keep = <T extends { dispose(): void }>(x: T) => { this.disposables.push(x); return x; };
    this.group.add(this.model);
    this.loaded = Dragon.preload().then((scene) => this.build(scene)).catch((e) => console.warn('The dragon could not be loaded', e));

    // ---------- lasers ----------
    const beamGeo = keep(new THREE.CylinderGeometry(1, 1, 1, 10, 1, true));
    beamGeo.translate(0, 0.5, 0);
    beamGeo.rotateX(Math.PI / 2);       // along +z from the origin
    const coreMat = keep(new THREE.MeshBasicMaterial({ color: 0xe8f6ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    const glowMat = keep(new THREE.MeshBasicMaterial({ color: 0x2f8fff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    for (let i = 0; i < 2; i++) {
      const core = new THREE.Mesh(beamGeo, coreMat), glow = new THREE.Mesh(beamGeo, glowMat);
      core.visible = glow.visible = false;
      core.frustumCulled = glow.frustumCulled = false;
      this.beams.push({ core, glow, from: new THREE.Vector3(), to: new THREE.Vector3(), end: new THREE.Vector3() });
      this.group.add(core, glow);
      const eg = new THREE.Sprite(keep(new THREE.SpriteMaterial({ map: this.glowTex, color: 0x4fb4ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })));
      eg.visible = false;
      this.eyeGlow.push(eg);
      this.group.add(eg);
    }
    for (let i = 0; i < 4; i++) {
      const s = new THREE.Sprite(keep(new THREE.SpriteMaterial({ map: this.glowTex, color: 0x3fa0ff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })));
      s.visible = false;
      this.hits.push({ sprite: s, age: 99 });
      this.group.add(s);
    }
    this.group.visible = false;
  }

  /** Normalise the model (wings along x, facing +z, span 1, centred) and let the wings beat. */
  private build(src: THREE.Object3D) {
    const meshes: THREE.Mesh[] = [];
    src.updateMatrixWorld(true);
    src.traverse((o) => { if ((o as THREE.Mesh).isMesh) meshes.push(o as THREE.Mesh); });
    const box = new THREE.Box3();
    const geos = meshes.map((m) => {
      const g = m.geometry.clone();
      g.applyMatrix4(m.matrixWorld).applyMatrix4(TURN);
      g.computeBoundingBox();
      box.union(g.boundingBox!);
      return g;
    });
    const size = box.getSize(new THREE.Vector3()), centre = box.getCenter(new THREE.Vector3());
    const s = 1 / size.x;
    meshes.forEach((m, i) => {
      const g = geos[i];
      // (keep the model's own normals: recomputing them left zero normals on its seams → NaN pixels)
      g.translate(-centre.x, -centre.y, -centre.z).scale(s, s, s);
      this.disposables.push(g);
      const mat = (m.material as THREE.MeshStandardMaterial).clone();
      mat.emissive = new THREE.Color(0x06200f);
      mat.roughness = Math.min(mat.roughness, 0.6);
      const flap = this.flap, glow = this.glowUniform;
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.uFlap = flap;
        sh.uniforms.uGlow = glow;
        // the wings: everything outside the shoulders rotates about the shoulder line, more towards
        // the tips; the body and the tail hanging below stay put
        // the model was painted red: recolour it dark green to black, keeping the shading of the
        // scales; light, unsaturated parts (horns, claws, teeth) stay bone-coloured
        sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
          {
            vec3 c = diffuseColor.rgb;
            float lum = dot(c, vec3(0.3, 0.59, 0.11));
            float sat = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
            vec3 scales = mix(vec3(0.02, 0.05, 0.03), vec3(0.2, 0.46, 0.26), smoothstep(0.03, 0.5, lum));
            float belly = smoothstep(0.35, 0.65, c.g / max(c.r, 0.001));   // the golden belly: a dull olive-bronze
            scales = mix(scales, vec3(0.2, 0.22, 0.1) * (0.4 + lum), belly * 0.7);
            float bone = smoothstep(0.45, 0.7, lum) * (1.0 - smoothstep(0.12, 0.35, sat));
            diffuseColor.rgb = mix(scales, c * vec3(0.95, 0.92, 0.85), bone);
          }`);
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uFlap;')
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            float side = sign(transformed.x);
            float ow = abs(transformed.x) - 0.1;
            float w = smoothstep(0.0, 0.08, ow) * smoothstep(-0.18, 0.0, transformed.y);
            if (ow > 0.0 && w > 0.0) {
              float a = uFlap * w * (0.7 + 0.6 * ow);
              float ca = cos(a), sa = sin(a);
              transformed.x = side * (0.1 + ow * ca);
              transformed.y += ow * sa;
              transformed.z -= ow * abs(sa) * 0.25;
            }`);
      };
      this.disposables.push(mat);
      const mesh = new THREE.Mesh(g, mat);
      mesh.castShadow = false;
      mesh.frustumCulled = false;
      this.model.add(mesh);
    });
    // where the beams come from: the front of the head (the most forward point near the middle, up high)
    let best = -Infinity;
    for (const g of geos) {
      const p = g.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i += 3) {
        const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
        if (Math.abs(x) > 0.05 || y < 0.05) continue;
        if (z + y * 0.5 > best) { best = z + y * 0.5; this.eyes.set(0, y, z); }
      }
    }
    this.model.scale.setScalar(SPAN);
  }

  /**
   * @param presence 0–1 (1 = here; falling = it soars away after the escape)
   * @param age seconds since it appeared
   * @param attack 0–1 how often it fires
   * @param threat 0 = the rower is behind the targets (beams hit close), 1 = well on target
   */
  update(f: { dt: number; time: number; boatZ: number; presence: number; age: number; attack: number; threat: number; light: number }) {
    const vis = f.presence > 0.01 && f.age >= 0 && this.model.children.length > 0;
    this.group.visible = vis;
    if (!vis) { this.phase = 'idle'; this.hideBeams(); return; }
    const t = f.time;
    const arrive = smooth(f.age / 7);
    const leave = 1 - f.presence;
    const flying = Math.max(1 - arrive, leave);
    // heavy, slow beats while hovering, faster while flying in or away
    this.wingT += f.dt * (2.6 + flying * 2.4);
    this.flap.value = Math.sin(this.wingT) * (0.55 + flying * 0.15) + 0.05;
    // where it hovers: ahead of the boat, weaving slowly; rising and falling with the beats
    const hover = this.tmp.set(Math.sin(t * 0.21) * 10, HEIGHT + Math.sin(t * 0.6) * 2 - Math.sin(this.wingT) * 0.8, f.boatZ - AHEAD + Math.sin(t * 0.3) * 6);
    // arrival: rises from behind the skyline on the right
    const start = this.tmp2.set(130, 10, f.boatZ - 260);
    this.pos.lerpVectors(start, hover, arrive);
    this.pos.y += Math.sin(arrive * Math.PI) * 20;
    // leaving: soars up and away to the left
    this.pos.x -= leave * 120; this.pos.y += leave * 90; this.pos.z -= leave * 220;
    this.group.position.set(0, 0, 0);
    this.model.position.copy(this.pos);
    // it faces the boat; while it flies in or away it faces where it is going
    this.look.set(this.pos.x * 0.3, 0, f.boatZ);
    if (flying > 0) this.look.lerp(this.tmp2.set(this.pos.x - (leave > 0 ? 80 : -60), this.pos.y + (leave > 0 ? 60 : -10), this.pos.z + (leave > 0 ? -120 : 140)), Math.min(1, flying * 1.5));
    this.model.lookAt(this.look);
    this.model.rotateZ(Math.sin(t * 0.21 + 1) * 0.12);   // banking a little as it weaves
    this.model.updateMatrixWorld(true);
    // it only fires once it hovers in front of the boat
    this.updateAttack({ ...f, attack: arrive >= 0.99 ? f.attack : 0 });
  }

  private eyeWorld(i: number, out: THREE.Vector3) {
    return out.set(this.eyes.x + (i === 0 ? -0.012 : 0.012), this.eyes.y, this.eyes.z).applyMatrix4(this.model.matrixWorld);
  }

  private updateAttack(f: { dt: number; boatZ: number; attack: number; threat: number; presence: number }) {
    this.phaseT += f.dt;
    if (this.phase === 'idle') {
      this.hideBeams();
      if (f.attack > 0 && f.presence >= 1) this.timer -= f.dt * (0.4 + f.attack * 0.8);
      if (this.timer <= 0) {
        this.phase = 'charge'; this.phaseT = 0;
        // aim left and right of the boat: closer when the rower is behind the targets
        this.beams.forEach((b, i) => {
          const dist = 7 + f.threat * 22 + rnd(0, 8);
          b.end.set((i === 0 ? -1 : 1) * rnd(3.8, 7.5), 0, f.boatZ - dist);
        });
      }
    } else if (this.phase === 'charge') {
      this.eyeGlow.forEach((g, i) => {
        g.visible = true;
        this.eyeWorld(i, g.position);
        g.scale.setScalar(1.5 + this.phaseT * 6);
        (g.material as THREE.SpriteMaterial).opacity = Math.min(1, this.phaseT * 2);
      });
      if (this.phaseT > 0.75) {
        this.phase = 'fire'; this.phaseT = 0;
        this.host.sound('laser', AHEAD);
      }
    } else {
      // the beams sweep in from further ahead onto their targets
      const k = Math.min(1, this.phaseT / 0.35);
      this.beams.forEach((b, i) => {
        this.eyeWorld(i, b.from);
        b.to.copy(b.end).add(this.tmp.set(0, 0, -(1 - k) * 14));
        const wob = 1 + 0.15 * Math.sin(this.phaseT * 60);
        for (const [m, r] of [[b.core, 0.16], [b.glow, 0.55]] as const) {
          m.visible = true;
          m.position.copy(b.from);
          m.lookAt(b.to);
          m.scale.set(r * wob, r * wob, b.from.distanceTo(b.to));
        }
        this.eyeGlow[i].position.copy(b.from);
        this.eyeGlow[i].scale.setScalar(5);
      });
      if (this.phaseT > 0.55) {
        this.phase = 'idle'; this.phaseT = 0;
        this.timer = rnd(2.2, 3.6);
        for (const b of this.beams) {
          this.host.effects.impact(b.end, 14, 2.2);
          const h = this.hits.find((x) => x.age > 1.2) ?? this.hits[0];
          h.age = 0;
          h.sprite.position.set(b.end.x, 0.6, b.end.z);
          h.sprite.visible = true;
        }
        this.host.sound('laser-hit', Math.abs(this.beams[0].end.z - f.boatZ));
        this.host.flash(0x4fb4ff, 0.22);
        this.host.shake(0.5);
      }
    }
    for (const h of this.hits) {
      if (h.age > 1.2) { h.sprite.visible = false; continue; }
      h.age += f.dt;
      const k = h.age / 1.2;
      h.sprite.scale.setScalar(3 + k * 9);
      (h.sprite.material as THREE.SpriteMaterial).opacity = (1 - k) * 0.9;
    }
  }

  private hideBeams() {
    for (const b of this.beams) { b.core.visible = false; b.glow.visible = false; }
    for (const g of this.eyeGlow) g.visible = false;
  }

  dispose() {
    this.disposables.forEach((d) => d.dispose());
    this.glowTex.dispose();
  }
}
