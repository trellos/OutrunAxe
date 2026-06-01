import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uStrength: { value: 0.8 },
  },
  vertexShader: [
    "varying vec2 vUv;",
    "void main() {",
    "  vUv = uv;",
    "  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
    "}",
  ].join("\n"),
  fragmentShader: [
    "uniform sampler2D tDiffuse;",
    "uniform float uStrength;",
    "varying vec2 vUv;",
    "",
    "void main() {",
    "  vec4 src = texture2D(tDiffuse, vUv);",
    "  vec3 c = src.rgb;",
    "  vec3 graded = c;",
    "",
    "  // Saturation boost (luma-preserving) ~1.2x",
    "  float luma = dot(graded, vec3(0.2126, 0.7152, 0.0722));",
    "  graded = mix(vec3(luma), graded, 1.20);",
    "",
    "  // Gentle S-curve contrast pivoted at mid-gray",
    "  graded = clamp(graded, 0.0, 8.0);",
    "  graded = mix(graded, graded * graded * (3.0 - 2.0 * graded), 0.30);",
    "",
    "  // Subtle split-tone: warm highlights, cool shadows",
    "  vec3 shadowTint = vec3(0.96, 0.99, 1.05);",
    "  vec3 highlightTint = vec3(1.05, 1.00, 0.95);",
    "  vec3 tint = mix(shadowTint, highlightTint, smoothstep(0.0, 1.0, luma));",
    "  graded *= mix(vec3(1.0), tint, 0.5);",
    "",
    "  // Slight vignette",
    "  vec2 d = vUv - 0.5;",
    "  float vig = 1.0 - dot(d, d) * 0.55;",
    "  graded *= mix(1.0, vig, 0.6);",
    "",
    "  vec3 outRgb = mix(c, graded, uStrength);",
    "  gl_FragColor = vec4(outRgb, src.a);",
    "}",
  ].join("\n"),
};

export class Composer {
  readonly composer: EffectComposer;
  private bloomPass: UnrealBloomPass;
  private gradePass: ShaderPass;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
  ) {
    const w = Math.max(1, window.innerWidth);
    const h = Math.max(1, window.innerHeight);

    this.composer = new EffectComposer(renderer);
    this.composer.setSize(w, h);
    this.composer.addPass(new RenderPass(scene, camera));

    // High threshold so only genuinely emissive neon/signage blooms — lit
    // white geometry (subway tiles, the avatar's legs, road dashes) stays
    // crisp instead of blowing out in brighter levels.
    // Bloom is low-frequency (a blur), so render it at HALF resolution: the
    // iterative blur passes are the dominant per-frame GPU cost and this roughly
    // quarters that work with no visible difference — big FPS win on weaker GPUs.
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(Math.max(1, w >> 1), Math.max(1, h >> 1)),
      0.55,
      0.45,
      0.9,
    );
    this.composer.addPass(this.bloomPass);

    this.gradePass = new ShaderPass(GradeShader);
    this.composer.addPass(this.gradePass);

    this.composer.addPass(new OutputPass());
  }

  setGradeStrength(s: number) {
    this.gradePass.uniforms.uStrength.value = s;
  }

  setSize(w: number, h: number) {
    const cw = Math.max(1, w);
    const ch = Math.max(1, h);
    this.composer.setSize(cw, ch);
    this.bloomPass.resolution.set(Math.max(1, cw >> 1), Math.max(1, ch >> 1));
  }

  setBloomStrength(s: number) {
    this.bloomPass.strength = s;
  }

  render(_dt: number) {
    this.composer.render();
  }
}
