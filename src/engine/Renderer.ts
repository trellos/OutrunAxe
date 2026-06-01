import * as THREE from "three";
import { Composer } from "../render/Composer";

export class Renderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly worldScene: THREE.Scene;
  readonly worldCamera: THREE.PerspectiveCamera;
  readonly canvas: HTMLCanvasElement;
  composer: Composer;

  // Perf-isolation toggles (read once from the URL):
  //   ?nofx  — bypass the bloom/grade post-processing (render the scene direct)
  //   ?dpr1  — clamp pixel ratio to 1 (huge win on high-DPI panels)
  //   ?noaa  — disable MSAA
  // These let the player's real machine pinpoint the framerate bottleneck.
  private readonly postFx: boolean;
  private readonly noRender: boolean;

  constructor(parent: HTMLElement) {
    const params = new URLSearchParams(location.search);
    this.postFx = !params.has("nofx");
    // ?norender — skip ALL drawing. If fps recovers, the cost is WebGL render +
    // canvas compositing; if it stays low, it's DOM/CSS compositing or GC.
    this.noRender = params.has("norender");
    const dprCap = params.has("dpr1") ? 1 : 2;

    this.renderer = new THREE.WebGLRenderer({
      antialias: !params.has("noaa"),
      alpha: false,
      // preserveDrawingBuffer forces the GPU to keep the framebuffer every frame
      // (a known perf cost); only enable it when a screenshot path needs it.
      preserveDrawingBuffer: params.has("grab"),
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, dprCap));
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
    if (this.noRender) return; // ?norender — isolate rendering cost entirely
    // ?nofx renders the scene straight to the screen, skipping the multi-pass
    // bloom/grade composer — the prime suspect for low framerate.
    if (this.postFx) this.composer.render(dt);
    else this.renderer.render(this.worldScene, this.worldCamera);
  }
}
