// Renderer WebGL compartido para una galería de MUCHOS visores (adaptado de
// samp-models-viewer).
//
// Un navegador solo permite ~16 contextos WebGL simultáneos, así que no podemos
// crear un WebGLRenderer por tarjeta. En su lugar mantenemos UN solo renderer
// off-screen y, en cada frame, dibujamos las escenas visibles y copiamos el
// resultado al <canvas> 2D de cada tarjeta con drawImage.
//
// Cada tarjeta registra un Viewport (su canvas 2D destino + scene/camera) y se
// marca dirty cuando necesita redibujarse. El loop global solo procesa
// viewports visibles y dirty, y se detiene solo cuando no hay nada que pintar.

import * as THREE from "three";
import type { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export interface Viewport {
  /** Canvas 2D visible en la tarjeta. */
  canvas: HTMLCanvasElement;
  /** Tamaño CSS del canvas (lo mantiene un ResizeObserver; 0 = aún sin medir). */
  width: number;
  height: number;
  ctx: CanvasRenderingContext2D;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** Solo donde se puede rotar arrastrando (puntero fino o visor ampliado). */
  controls: OrbitControls | null;
  visible: boolean;
  dirty: boolean;
  /** Fuerza el redibujado hasta este timestamp (damping de OrbitControls). */
  animateUntil: number;
  /** Se invoca en cada frame mientras dure `animateUntil` (inercia del giro). */
  onFrame?: (now: number) => void;
}

class SharedRenderer {
  readonly renderer: THREE.WebGLRenderer;
  /** Capacidades de la GPU que condicionan cómo se suben las texturas. */
  readonly textureSupport: {
    hasS3tc: boolean;
    isWebGL2: boolean;
    maxAnisotropy: number;
  };
  private viewports = new Set<Viewport>();
  private running = false;
  private width = 0;
  private height = 0;

  constructor() {
    const canvas = document.createElement("canvas");
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true, // necesario para leer el buffer con drawImage
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputEncoding = THREE.sRGBEncoding;
    this.renderer.setClearColor(0x000000, 0);
    // Comprobar el log de cada shader obliga a esperar a la GPU (tirón al
    // compilar el primer material); los shaders son los de serie de three.
    this.renderer.debug.checkShaderErrors = false;
    // Las texturas van en sRGB: hace falta también la variante sRGB de S3TC.
    // Casi ningún móvil tiene ninguna de las dos; ahí el DXT se decodifica por CPU.
    const { extensions, capabilities } = this.renderer;
    this.textureSupport = {
      hasS3tc:
        extensions.has("WEBGL_compressed_texture_s3tc") &&
        extensions.has("WEBGL_compressed_texture_s3tc_srgb"),
      isWebGL2: capabilities.isWebGL2,
      maxAnisotropy: capabilities.getMaxAnisotropy(),
    };
  }

  register(vp: Viewport): void {
    this.viewports.add(vp);
    this.ensureRunning();
  }

  unregister(vp: Viewport): void {
    this.viewports.delete(vp);
  }

  markDirty(vp: Viewport): void {
    vp.dirty = true;
    this.ensureRunning();
  }

  private ensureRunning(): void {
    if (this.running) return;
    this.running = true;
    requestAnimationFrame(this.tick);
  }

  private tick = (): void => {
    const now = performance.now();
    let pending = false;

    for (const vp of this.viewports) {
      if (!vp.visible) continue;

      const animating = now < vp.animateUntil;
      if (animating) {
        vp.onFrame?.(now);
        vp.controls?.update();
      }
      if (!vp.dirty && !animating) continue;

      const w = vp.width;
      const h = vp.height;
      if (w === 0 || h === 0) continue;

      // three reasigna canvas.width/height en cada setSize aunque no cambien,
      // y eso realoja el buffer de dibujo: solo cuando el tamaño es otro.
      if (w !== this.width || h !== this.height) {
        this.renderer.setSize(w, h, false);
        this.width = w;
        this.height = h;
      }
      if (vp.camera.aspect !== w / h) {
        vp.camera.aspect = w / h;
        vp.camera.updateProjectionMatrix();
      }
      this.renderer.render(vp.scene, vp.camera);

      // Copia el framebuffer del renderer al canvas 2D de la tarjeta.
      const dpr = this.renderer.getPixelRatio();
      const pw = Math.floor(w * dpr);
      const ph = Math.floor(h * dpr);
      if (vp.canvas.width !== pw || vp.canvas.height !== ph) {
        vp.canvas.width = pw;
        vp.canvas.height = ph;
      }
      vp.ctx.clearRect(0, 0, pw, ph);
      vp.ctx.drawImage(this.renderer.domElement, 0, 0, pw, ph);

      vp.dirty = false;
      pending = true;
    }

    if (pending) requestAnimationFrame(this.tick);
    else this.running = false;
  };
}

let instance: SharedRenderer | null = null;

/** Lanza si el navegador no ofrece WebGL. */
export function getSharedRenderer(): SharedRenderer {
  if (!instance) instance = new SharedRenderer();
  return instance;
}
