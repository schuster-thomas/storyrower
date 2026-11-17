import * as THREE from 'three';

const vertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww; // always on the far plane
  }
`;
const fragment = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uSunColor;
  uniform vec3 uSunDir;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    float h = max(d.y, 0.0);
    vec3 col = mix(uHorizon, uTop, pow(h, 0.55));
    // below the horizon: stay at horizon colour (hidden by terrain and fog anyway)
    if (d.y < 0.0) col = uHorizon;
    float s = max(dot(d, uSunDir), 0.0);
    col += uSunColor * (pow(s, 900.0) * 1.6 + pow(s, 12.0) * 0.35);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

/** Soft puffy cloud drawn once into a canvas. */
function cloudTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d')!;
  const blobs = [[70, 80, 46], [120, 62, 58], [175, 78, 44], [100, 90, 40], [150, 92, 38], [205, 90, 30]];
  for (const [x, y, r] of blobs) {
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)');
    grad.addColorStop(0.6, 'rgba(255,255,255,0.75)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Cloud { sprite: THREE.Sprite; x: number; y: number; dz: number; speed: number }

/**
 * Gradient sky dome with a sun, drifting clouds and a ring of snow-capped mountains on the
 * horizon. Everything follows the boat, so it behaves like a backdrop.
 */
export class Sky {
  readonly group = new THREE.Group();
  readonly sunDir = new THREE.Vector3(-0.45, 0.35, -0.82).normalize();
  private dome: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  private clouds: Cloud[] = [];
  private cloudMat: THREE.SpriteMaterial;
  private mountains = new THREE.Group();
  private mountainMat = new THREE.MeshStandardMaterial({ color: 0x7a8088, flatShading: true, fog: false, roughness: 1 });
  private snowMat = new THREE.MeshStandardMaterial({ color: 0xf4f7fb, flatShading: true, fog: false, roughness: 1 });

  constructor(cloudCount: number) {
    this.dome = new THREE.Mesh(
      new THREE.SphereGeometry(950, 24, 12),
      new THREE.ShaderMaterial({
        vertexShader: vertex, fragmentShader: fragment, side: THREE.BackSide, depthWrite: false, fog: false,
        uniforms: {
          uTop: { value: new THREE.Color(0x5aa6e0) }, uHorizon: { value: new THREE.Color(0xcfe8f4) },
          uSunColor: { value: new THREE.Color(0xfff3d6) }, uSunDir: { value: this.sunDir },
        },
      }),
    );
    this.dome.renderOrder = -10;
    this.group.add(this.dome);

    this.cloudMat = new THREE.SpriteMaterial({ map: cloudTexture(), transparent: true, depthWrite: false, fog: false, opacity: 0.9 });
    this.setCloudCount(cloudCount);
    this.buildMountains();
    this.group.add(this.mountains);
  }

  /** Hide the 3D stand-in mountains once the painted panorama is loaded. */
  setMountainsVisible(on: boolean) { this.mountains.visible = on; }

  setCloudCount(n: number) {
    while (this.clouds.length > n) this.group.remove(this.clouds.pop()!.sprite);
    while (this.clouds.length < n) {
      const sprite = new THREE.Sprite(this.cloudMat);
      const s = 90 + Math.random() * 110;
      sprite.scale.set(s, s * 0.5, 1);
      const cloud = { sprite, x: (Math.random() - 0.5) * 900, y: 90 + Math.random() * 120, dz: -150 - Math.random() * 650, speed: 2 + Math.random() * 3 };
      this.clouds.push(cloud);
      this.group.add(sprite);
    }
  }

  private buildMountains() {
    let seed = 7;
    const r = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    for (let i = 0; i < 16; i++) {
      const side = i % 2 ? 1 : -1;
      const h = 70 + r() * 90;
      const rad = 70 + r() * 70;
      const m = new THREE.Mesh(new THREE.ConeGeometry(rad, h, 6 + Math.floor(r() * 3)), this.mountainMat);
      const x = side * (170 + r() * 260);
      const z = -250 - r() * 600;
      m.position.set(x, h / 2 - 8, z);
      m.rotation.y = r() * Math.PI;
      const capH = h * 0.32;
      const cap = new THREE.Mesh(new THREE.ConeGeometry(rad * 0.32 * 1.02, capH, m.geometry.parameters.radialSegments), this.snowMat);
      cap.position.set(x, h - 8 - capH / 2 + 0.5, z);
      cap.rotation.y = m.rotation.y;
      this.mountains.add(m, cap);
    }
  }

  update(p: { dt: number; time: number; camera: THREE.Camera; boatZ: number; top: THREE.Color; horizon: THREE.Color; sunColor: THREE.Color; smoke: number; sunHeight: number }) {
    this.group.position.set(0, 0, p.boatZ);
    this.dome.position.copy(p.camera.position).sub(this.group.position);
    this.sunDir.set(-0.45, p.sunHeight, -0.82).normalize();
    const u = this.dome.material.uniforms;
    (u.uTop.value as THREE.Color).copy(p.top);
    (u.uHorizon.value as THREE.Color).copy(p.horizon);
    (u.uSunColor.value as THREE.Color).copy(p.sunColor).multiplyScalar(1 - p.smoke * 0.6);

    // Distant mountains fade into the haze; ash darkens the clouds
    this.mountainMat.color.set(0x6f757e).lerp(p.horizon, 0.45);
    this.snowMat.color.set(0xf4f7fb).lerp(p.horizon, 0.3);
    this.cloudMat.color.set(0xffffff).lerp(new THREE.Color(0x5a5250), p.smoke * 0.7).lerp(p.horizon, 0.15);
    for (const c of this.clouds) {
      c.x += c.speed * p.dt;
      if (c.x > 480) c.x = -480;
      c.sprite.position.set(c.x, c.y, c.dz);
    }
  }

  dispose() {
    this.dome.geometry.dispose();
    this.dome.material.dispose();
    this.cloudMat.map?.dispose();
    this.cloudMat.dispose();
  }
}
