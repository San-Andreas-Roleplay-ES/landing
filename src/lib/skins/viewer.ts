// Vista previa 3D de un skin sobre un <canvas> 2D (adaptado de ModelViewer.vue
// de samp-models-viewer). Este módulo arrastra three.js, así que la galería lo
// carga con import() dinámico solo cuando hay skins que mostrar.
//
//   "card"  tarjeta de la galería: giro tipo tornamesa arrastrando en
//           horizontal. SIN OrbitControls: este registra un listener de rueda
//           no pasivo por canvas y el navegador tendría que esperar al hilo
//           principal para desplazar la página con el cursor sobre un skin.
//   "full"  visor ampliado: órbita libre, zoom y giro automático hasta que el
//           usuario toca el modelo.
//
// La descarga y el parseo de .dff/.txd corren en Web Workers (`prepareSkin`);
// aquí solo se ensambla y se pinta.

import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

import { buildModel, disposeModel } from "./modelBuilder";
import type { PreparedModel } from "./modelData";
import { handle, type PrepareRequest, type PrepareResponse } from "./modelWorker";
import { getSharedRenderer, type Viewport } from "./sharedRenderer";

export type PreviewMode = "card" | "full";
export type { PreparedModel };

// Las tarjetas miden ~200 px de ancho: con 512 px de textura sobra y se ahorra
// memoria de GPU (y tiempo de decodificación DXT en móvil).
const CARD_TEXTURE_SIZE = 512;

const reducedMotion = () =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ---------------------------------------------------------------------------
// Workers de preparación
// ---------------------------------------------------------------------------

/** El .dff o el .txd no están en el bucket. */
export class MissingFileError extends Error {}

interface Pending {
  resolve: (model: PreparedModel) => void;
  reject: (err: Error) => void;
}

const pending = new Map<number, Pending>();
let workers: Worker[] | null = null;
let nextId = 0;

function settle(response: PrepareResponse): void {
  const job = pending.get(response.id);
  if (!job) return;
  pending.delete(response.id);
  if ("model" in response) job.resolve(response.model);
  else
    job.reject(
      response.missing
        ? new MissingFileError(response.error)
        : new Error(response.error),
    );
}

function getWorkers(): Worker[] {
  if (workers) return workers;
  workers = [];
  try {
    const count = (navigator.hardwareConcurrency || 2) >= 4 ? 2 : 1;
    for (let i = 0; i < count; i++) {
      const worker = new Worker(new URL("./modelWorker.ts", import.meta.url), {
        type: "module",
      });
      worker.onmessage = ({ data }: MessageEvent<PrepareResponse>) => settle(data);
      workers.push(worker);
    }
  } catch {
    workers = []; // sin workers: todo en el hilo principal
  }
  return workers;
}

/**
 * Descarga, parsea y prepara un skin fuera del hilo principal. Rechaza con
 * MissingFileError si falta un archivo; lanza si no hay WebGL.
 */
export function prepareSkin(
  dffUrl: string,
  txdUrl: string,
  mode: PreviewMode,
): Promise<PreparedModel> {
  const request: PrepareRequest = {
    id: nextId++,
    dffUrl,
    txdUrl,
    opts: {
      hasS3tc: getSharedRenderer().textureSupport.hasS3tc,
      maxTextureSize: mode === "card" ? CARD_TEXTURE_SIZE : undefined,
    },
  };
  return new Promise((resolve, reject) => {
    pending.set(request.id, { resolve, reject });
    const pool = getWorkers();
    if (!pool.length) return void handle(request).then(settle);
    // Siempre el mismo worker para el mismo skin: su caché de archivos hace
    // que abrir el visor ampliado de una tarjeta ya vista no descargue nada.
    let hash = 0;
    for (let i = 0; i < dffUrl.length; i++)
      hash = (hash * 31 + dffUrl.charCodeAt(i)) | 0;
    pool[Math.abs(hash) % pool.length].postMessage(request);
  });
}

// ---------------------------------------------------------------------------

export class SkinPreview {
  private shared = getSharedRenderer(); // lanza si no hay WebGL
  private viewport: Viewport;
  private controls: OrbitControls | null = null;
  private group: THREE.Group | null = null;
  private bounds: PreparedModel["bounds"] | null = null;
  private resizeObserver: ResizeObserver;
  private abort = new AbortController();
  private disposed = false;
  private interacted = false;
  private spin = 0; // inercia del giro de la tarjeta (rad/ms)

  constructor(
    canvas: HTMLCanvasElement,
    private mode: PreviewMode,
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D no disponible");

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(mode === "card" ? 35 : 40, 1, 0.1, 1000);

    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.0));
    const key = new THREE.DirectionalLight(0xffffff, 1.2);
    key.position.set(3, 5, 4);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.4);
    fill.position.set(-3, 2, -2);
    scene.add(fill);

    this.viewport = {
      canvas,
      ctx,
      scene,
      camera,
      controls: null,
      width: 0,
      height: 0,
      visible: mode === "full",
      dirty: false,
      animateUntil: 0,
    };

    if (mode === "full") this.initOrbit(canvas, camera);
    else this.initTurntable(canvas);

    this.shared.register(this.viewport);

    // El encuadre depende de la proporción del canvas: se rehace al cambiar de
    // tamaño mientras el usuario no haya movido la cámara.
    // El tamaño llega por el observer: leer clientWidth al pintar forzaría un
    // layout síncrono en mitad del scroll.
    this.resizeObserver = new ResizeObserver(([entry]) => {
      this.viewport.width = Math.round(entry.contentRect.width);
      this.viewport.height = Math.round(entry.contentRect.height);
      if (this.group && !this.interacted) this.frame();
      this.shared.markDirty(this.viewport);
    });
    this.resizeObserver.observe(canvas);
  }

  private initOrbit(canvas: HTMLCanvasElement, camera: THREE.PerspectiveCamera): void {
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.enablePan = false;
    controls.addEventListener("change", () =>
      this.shared.markDirty(this.viewport),
    );
    controls.addEventListener("start", () => {
      this.interacted = true;
      controls.autoRotate = false;
      this.keepAnimating(Infinity); // mientras arrastra
    });
    controls.addEventListener("end", () => this.keepAnimating(600)); // damping
    this.controls = this.viewport.controls = controls;
  }

  /**
   * Giro horizontal con listeners pasivos. El canvas lleva `touch-action:
   * pan-y`: el gesto vertical sigue desplazando la página y solo el horizontal
   * llega aquí.
   */
  private initTurntable(canvas: HTMLCanvasElement): void {
    const { signal } = this.abort;
    let pointer = -1;
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let lastX = 0;
    let lastT = 0;

    const end = (ev: PointerEvent) => {
      if (ev.pointerId !== pointer) return;
      pointer = -1;
      if (!dragging) return;
      dragging = false;
      if (Math.abs(this.spin) > 0.0004 && !reducedMotion())
        this.keepAnimating(Infinity); // inercia: la apaga onFrame
      else this.spin = 0;
    };

    canvas.addEventListener(
      "pointerdown",
      (ev) => {
        if (!this.group || (ev.pointerType === "mouse" && ev.button !== 0)) return;
        pointer = ev.pointerId;
        dragging = false;
        this.spin = 0;
        startX = lastX = ev.clientX;
        startY = ev.clientY;
        lastT = ev.timeStamp;
      },
      { signal, passive: true },
    );
    canvas.addEventListener(
      "pointermove",
      (ev) => {
        if (ev.pointerId !== pointer || !this.group) return;
        if (!dragging) {
          const dx = Math.abs(ev.clientX - startX);
          if (dx < 5 || dx < Math.abs(ev.clientY - startY)) return;
          dragging = true;
          this.interacted = true;
          canvas.setPointerCapture(pointer);
        }
        const delta = (ev.clientX - lastX) * 0.012;
        const dt = Math.max(1, ev.timeStamp - lastT);
        this.group.rotation.y += delta;
        this.spin = this.spin * 0.5 + (delta / dt) * 0.5;
        lastX = ev.clientX;
        lastT = ev.timeStamp;
        this.shared.markDirty(this.viewport);
      },
      { signal, passive: true },
    );
    canvas.addEventListener("pointerup", end, { signal, passive: true });
    canvas.addEventListener("pointercancel", end, { signal, passive: true });

    let lastFrame = 0;
    this.viewport.onFrame = (now) => {
      const dt = lastFrame ? Math.min(50, now - lastFrame) : 16;
      lastFrame = now;
      if (!this.group || dragging) return;
      this.group.rotation.y += this.spin * dt;
      this.spin *= Math.pow(0.94, dt / 16);
      if (Math.abs(this.spin) < 0.0002) {
        this.spin = 0;
        lastFrame = 0;
        this.viewport.animateUntil = 0;
      }
    };
  }

  /** La galería avisa cuando la tarjeta entra o sale de pantalla. */
  setVisible(visible: boolean): void {
    this.viewport.visible = visible;
    if (visible) this.shared.markDirty(this.viewport);
  }

  show(model: PreparedModel): void {
    if (this.disposed) return;
    this.clearModel();
    this.group = buildModel(model, this.shared.textureSupport);
    this.bounds = model.bounds;
    this.viewport.scene.add(this.group);
    this.reset();
  }

  reset(): void {
    if (!this.group) return;
    this.group.rotation.set(0, 0, 0);
    this.interacted = false;
    this.spin = 0;
    this.frame();
    if (this.controls && !reducedMotion()) {
      this.controls.autoRotate = true;
      this.controls.autoRotateSpeed = 1.5;
      this.keepAnimating(Infinity);
    } else {
      this.keepAnimating(0);
    }
  }

  dispose(): void {
    this.disposed = true;
    this.abort.abort();
    this.resizeObserver.disconnect();
    this.shared.unregister(this.viewport);
    this.controls?.dispose();
    this.clearModel();
  }

  private clearModel(): void {
    if (!this.group) return;
    this.viewport.scene.remove(this.group);
    disposeModel(this.group);
    this.group = null;
  }

  private keepAnimating(ms: number): void {
    this.viewport.animateUntil = performance.now() + ms;
    this.shared.markDirty(this.viewport);
  }

  /** Centra el modelo y aleja la cámara lo justo para que quepa entero. */
  private frame(): void {
    const { camera } = this.viewport;
    const { min, max } = this.bounds!;
    const size = new THREE.Vector3(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
    // El grupo gira sobre su origen: los vértices se centran con un hijo
    // desplazado, así el giro de la tarjeta es sobre el eje del cuerpo.
    this.group!.children.forEach((child) =>
      child.position.set(-(min[0] + max[0]) / 2, -(min[1] + max[1]) / 2, -(min[2] + max[2]) / 2),
    );

    // Distancia a la que caben a la vez el alto y el ancho (brazos en cruz
    // incluidos) según la proporción real del canvas.
    const { width, height } = this.viewport;
    const aspect = width && height ? width / height : 0.75;
    const tan = Math.tan((camera.fov * Math.PI) / 360);
    const fitHeight = (size.y || 1) / 2 / tan;
    const fitWidth = Math.max(size.x, size.z * 0.6) / 2 / (tan * aspect);
    const distance = Math.max(fitHeight, fitWidth) * 1.1 + size.z / 2;
    const dir = new THREE.Vector3(0.35, 0.15, 1).normalize();
    camera.position.copy(dir.multiplyScalar(distance));
    camera.near = Math.max(0.01, distance / 100);
    camera.far = distance * 100;
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();

    if (this.controls) {
      this.controls.target.set(0, 0, 0);
      this.controls.update();
    }
  }
}
