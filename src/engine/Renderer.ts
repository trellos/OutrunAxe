import * as THREE from "three";
import { Composer } from "../render/Composer";

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly worldScene: THREE.Scene;
  readonly worldCamera: THREE.PerspectiveCamera;
  readonly canvas: HTMLCanvasElement;
  composer: Composer;

  constructor(parent: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      preserveDrawingBuffer: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x0a0612, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    this.canvas = this.renderer.domElement;
    this.canvas.style.display = "block";
    parent.appendChild(this.canvas);

    this.worldScene = new THREE.Scene();
    this.worldScene.fog = new THREE.Fog(0x0a0612, 40, 220);

    this.worldCamera = new THREE.PerspectiveCamera(
      70,
      window.innerWidth / window.innerHeight,
      0.1,
      500,
    );

    this.composer = new Composer(this.renderer, this.worldScene, this.worldCamera);

    let resizeTimer: number | null = null;
    window.addEventListener("resize", () => {
      if (resizeTimer !== null) clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => { resizeTimer = null; this.resize(); }, 150);
    });
    this.resize();
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.worldCamera.aspect = w / h;
    this.worldCamera.updateProjectionMatrix();
    this.composer.setSize(w, h);
  }

  render(dt: number) {
    this.composer.render(dt);
  }
}
