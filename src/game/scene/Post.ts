import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { QualityLevel } from './quality';

/**
 * Colour grade that ties the 3D models, the painted backdrops and the water together:
 * a gentle S-curve for contrast, a bit more saturation, a per-phase tint (warm at sunset,
 * orange under the eruption) and a soft vignette.
 */
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTint: { value: new THREE.Color(1, 1, 1) },
    uSaturation: { value: 1.12 },
    uContrast: { value: 1.06 },
    uVignette: { value: 0.28 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec3 uTint;
    uniform float uSaturation;
    uniform float uContrast;
    uniform float uVignette;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb * uTint;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSaturation);
      col = (col - 0.5) * uContrast + 0.5;
      vec2 d = vUv - 0.5;
      col *= 1.0 - uVignette * smoothstep(0.35, 0.85, length(d * vec2(1.2, 1.0)));
      gl_FragColor = vec4(max(col, 0.0), c.a);
    }
  `,
};

/** Post-processing chain; on "low" the scene is rendered directly without it. */
export class Post {
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private grade: ShaderPass;
  private enabled = true;

  constructor(private renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    // Bloom only picks up really bright things: lava, the sun, sparks, glints
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.3, 0.4, 0.96);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
  }

  setQuality(level: QualityLevel) {
    this.enabled = level !== 'low';
    this.bloom.enabled = level === 'high';
  }

  setSize(w: number, h: number) {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    // bloom at half resolution is plenty and much cheaper
    this.bloom.resolution.set(Math.max(1, w / 2), Math.max(1, h / 2));
  }

  /** @param tint per-phase colour multiplier, @param glow extra bloom strength (eruption) */
  render(scene: THREE.Scene, camera: THREE.Camera, tint: THREE.Color, glow: number) {
    if (!this.enabled) { this.renderer.render(scene, camera); return; }
    (this.grade.uniforms.uTint.value as THREE.Color).copy(tint);
    this.bloom.strength = 0.18 + glow * 0.55;
    this.composer.render();
  }

  dispose() { this.composer.dispose(); }
}
