import * as THREE from 'three';

/** One painted cut-out standing in the world. */
export interface Card {
  x: number; y: number; z: number;
  /** atlas tile (0–3), or 0 for a single picture */
  tile: number;
  /** height in metres (the width follows from the picture's aspect ratio) */
  height: number;
  /** mirror the picture */
  flip?: boolean;
  /** 0–1 how much the top sways in the wind (trees) */
  sway?: number;
  seed?: number;
}

const vertex = /* glsl */ `
  #include <common>
  #include <fog_pars_vertex>
  attribute vec4 aUv;      // u0, v0, u1, v1 of the picture in the atlas
  attribute vec3 aOffset;  // foot of the card in the world
  attribute vec3 aSize;    // width (negative = mirrored), height, sway
  attribute float aSeed;
  uniform float uTime;
  uniform float uShake;
  varying vec2 vUv;
  varying float vShade;
  void main() {
    // turn about the vertical axis towards the camera, so the cut-outs always face the viewer
    vec3 toCam = cameraPosition - aOffset;
    toCam.y = 0.0;
    vec3 fwd = normalize(toCam + vec3(0.0001, 0.0, 0.0));
    vec3 right = vec3(fwd.z, 0.0, -fwd.x);
    float h = position.y;   // 0 at the foot, 1 at the top
    float wind = (sin(uTime * 1.1 + aSeed * 6.283) * 0.6 + sin(uTime * 2.3 + aSeed * 3.1) * 0.4) * aSize.z * h * h * 0.06 * aSize.y;
    float quake = uShake * sin(uTime * 19.0 + aSeed * 10.0) * h * 0.05 * aSize.y;
    vec3 world = aOffset + right * (position.x * aSize.x + wind + quake) + vec3(0.0, h * aSize.y, 0.0);
    vUv = vec2(mix(aUv.x, aUv.z, position.x + 0.5), mix(aUv.y, aUv.w, h));
    vShade = 0.82 + 0.18 * h;   // a touch darker at the foot
    vec4 mvPosition = viewMatrix * vec4(world, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;
const fragment = /* glsl */ `
  #include <common>
  #include <fog_pars_fragment>
  uniform sampler2D uMap;
  uniform vec3 uTint;
  varying vec2 vUv;
  varying float vShade;
  void main() {
    vec4 c = texture2D(uMap, vUv);
    if (c.a < 0.5) discard;
    gl_FragColor = vec4(c.rgb * uTint * vShade, 1.0);
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

/**
 * Painted cut-outs (trees, pagodas, lanterns …) as one instanced draw: every card turns about its
 * vertical axis towards the camera, trees sway in the wind and everything shivers in the quake.
 * Alpha-tested (no sorting needed), fogged like the rest of the world.
 */
export class CardField {
  readonly mesh: THREE.Mesh<THREE.InstancedBufferGeometry, THREE.ShaderMaterial>;
  private uv: THREE.InstancedBufferAttribute;
  private offset: THREE.InstancedBufferAttribute;
  private size: THREE.InstancedBufferAttribute;
  private seed: THREE.InstancedBufferAttribute;

  /**
   * @param map the picture or a 4 × 1 atlas
   * @param aspects width / height of each picture in it (one value for a single picture)
   */
  constructor(map: THREE.Texture, private aspects: number[], private capacity: number) {
    const base = new THREE.PlaneGeometry(1, 1);
    base.translate(0, 0.5, 0);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = base.index;
    geo.setAttribute('position', base.attributes.position);
    this.uv = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4);
    this.offset = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.size = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.seed = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    for (const a of [this.uv, this.offset, this.size, this.seed]) a.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aUv', this.uv);
    geo.setAttribute('aOffset', this.offset);
    geo.setAttribute('aSize', this.size);
    geo.setAttribute('aSeed', this.seed);
    geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      vertexShader: vertex, fragmentShader: fragment, fog: true, side: THREE.DoubleSide,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTime: { value: 0 }, uShake: { value: 0 }, uTint: { value: new THREE.Color(1, 1, 1) } }]),
    });
    mat.uniforms.uMap = { value: map };
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
  }

  /** Replace every card (called when the set of chunks changes). */
  set(cards: Card[]) {
    const n = Math.min(cards.length, this.capacity);
    const tiles = this.aspects.length > 1 ? 4 : 1;
    for (let i = 0; i < n; i++) {
      const c = cards[i];
      const aspect = this.aspects[c.tile] ?? this.aspects[0];
      // pictures in an atlas tile are fitted to the square tile, bottom-aligned and centred
      const u0 = c.tile / tiles, du = 1 / tiles;
      const w = tiles > 1 ? Math.min(1, aspect) : 1, hh = tiles > 1 ? Math.min(1, 1 / aspect) : 1;
      this.uv.setXYZW(i, u0 + du * (0.5 - w / 2), 0, u0 + du * (0.5 + w / 2), hh);
      this.offset.setXYZ(i, c.x, c.y, c.z);
      this.size.setXYZ(i, c.height * aspect * (c.flip ? -1 : 1), c.height, c.sway ?? 0);
      this.seed.setX(i, c.seed ?? (i * 0.618) % 1);
    }
    for (const a of [this.uv, this.offset, this.size, this.seed]) a.needsUpdate = true;
    this.mesh.geometry.instanceCount = n;
  }

  update(time: number, shake: number, tint: THREE.Color) {
    const u = this.mesh.material.uniforms;
    u.uTime.value = time;
    u.uShake.value = shake;
    (u.uTint.value as THREE.Color).copy(tint);
  }

  dispose() { this.mesh.geometry.dispose(); this.mesh.material.dispose(); }
}
