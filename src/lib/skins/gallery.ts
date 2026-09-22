// Galería de skins (/skins): catálogo en vivo desde Backblaze, buscador con
// filtros de etiqueta, grid virtualizado con vista previa 3D y descarga de la
// pareja .dff + .txd en un ZIP. El marcado vive en src/pages/skins.astro; aquí
// solo se clona la plantilla de tarjeta y se rellenan los huecos `data-*`.

import {
  SKIN_SOURCES,
  skinFileUrl,
  skinSourceUrl,
  skinTag,
} from "../../data/skins";
import {
  GENDER_LABELS,
  RACE_LABELS,
  skinGender,
  skinLabel,
  skinName,
  skinRace,
  type SkinGender,
  type SkinRace,
} from "../../data/skin-names";
import { mergeSkins, parseSkins, type Skin, type SkinEntry } from "./artconfig";
import { buildZip } from "./zip";
import type { SkinPreview } from "./viewer";

type Sort = "asc" | "desc" | "orig";

// Empate entre skins con el mismo ID base: primero los de la etiqueta más
// "de casa". Las fuentes que no estén aquí van después, por orden alfabético.
const TAG_PRIORITY = ["SARP", "LSRP", "SOLS"];
const tagRank = (skin: Skin): number => {
  let best = TAG_PRIORITY.length;
  for (const tag of skin.tags) {
    const i = TAG_PRIORITY.indexOf(tag);
    if (i !== -1 && i < best) best = i;
  }
  return best;
};
type ViewState = "loading" | "empty" | "noresults" | "error" | "ready";

const OVERSCAN_ROWS = 1;
const INFO_H = 104; // bloque de nombre + archivo + botón de la tarjeta
const MAX_PARALLEL_LOADS = 4;
const LOAD_DELAY_MS = 140; // evita cargar tarjetas que solo pasan de largo

const track = (name: string, params: Record<string, unknown>) => {
  const g = (window as unknown as { gtag?: (...a: unknown[]) => void }).gtag;
  if (typeof g === "function") g("event", name, params);
};

// ---------------------------------------------------------------------------
// Los .dff/.txd de las vistas previas los descarga y parsea un Web Worker
// (viewer.ts -> modelWorker.ts). Aquí solo se bajan para la descarga en ZIP.
// ---------------------------------------------------------------------------

class MissingFileError extends Error {}

async function getFile(name: string): Promise<ArrayBuffer> {
  const res = await fetch(skinFileUrl(name));
  if (res.status === 404 || res.status === 403) throw new MissingFileError(name);
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
  return res.arrayBuffer();
}

let viewerModule: Promise<typeof import("./viewer")> | null = null;
const loadViewer = () => (viewerModule ??= import("./viewer"));

// Crear las mallas y subir texturas a la GPU sí exige el hilo principal: como
// mucho un modelo por frame, para que varias cargas que terminan a la vez no
// se coman un frame entero en mitad del scroll.
// Y nunca en pleno desplazamiento rápido, que es cuando un frame perdido se nota:
// se espera a que el scroll afloje (con tope, por si no para).
const FAST_SCROLL = 1.4; // px/ms
const MAX_BUILD_WAIT_MS = 1200;
let scrollSpeed = 0;
let lastScrollY = 0;
let lastScrollT = 0;

function trackScrollSpeed(): void {
  const now = performance.now();
  const dt = now - lastScrollT;
  if (dt > 0 && dt < 250)
    scrollSpeed = scrollSpeed * 0.6 + (Math.abs(scrollY - lastScrollY) / dt) * 0.4;
  else scrollSpeed = 0;
  lastScrollY = scrollY;
  lastScrollT = now;
}

const scrollingFast = () =>
  scrollSpeed > FAST_SCROLL && performance.now() - lastScrollT < 120;

let buildTurn: Promise<void> = Promise.resolve();
const nextBuildTurn = () =>
  (buildTurn = buildTurn.then(
    () =>
      new Promise<void>((resolve) => {
        const started = performance.now();
        const wait = () =>
          scrollingFast() && performance.now() - started < MAX_BUILD_WAIT_MS
            ? requestAnimationFrame(wait)
            : resolve();
        requestAnimationFrame(wait);
      }),
  ));

// D. Liberar geometrías y texturas de la GPU tampoco corre prisa: en ratos libres.
const disposals: SkinPreview[] = [];
let disposing = false;

function disposeLater(preview: SkinPreview): void {
  disposals.push(preview);
  if (disposing) return;
  disposing = true;
  const idle: (cb: () => void) => void =
    "requestIdleCallback" in window
      ? (cb) => requestIdleCallback(cb, { timeout: 2000 })
      : (cb) => setTimeout(cb, 200);
  const run = () => {
    const batch = scrollingFast() ? 0 : 3;
    for (let i = 0; i < batch && disposals.length; i++) disposals.shift()!.dispose();
    if (disposals.length) idle(run);
    else disposing = false;
  };
  idle(run);
}

// (El MissingFileError de la vista previa es el de viewer.ts, otro módulo.)
const errorLabel = (err: unknown) =>
  err instanceof Error && err.constructor.name === "MissingFileError"
    ? "Archivo no disponible"
    : "No se pudo cargar la vista 3D";

// ---------------------------------------------------------------------------
// Cola de carga: pocas descargas a la vez y primero lo último que entró en
// pantalla (LIFO), que es lo que el usuario está mirando.
// ---------------------------------------------------------------------------

const loadQueue: Card[] = [];
let activeLoads = 0;

function pumpQueue(): void {
  while (activeLoads < MAX_PARALLEL_LOADS && loadQueue.length) {
    const card = loadQueue.pop()!;
    activeLoads++;
    card.load().finally(() => {
      activeLoads--;
      pumpQueue();
    });
  }
}

class Card {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private overlay: HTMLElement;
  private preview: SkinPreview | null = null;
  private timer = 0;
  private dead = false;

  constructor(
    readonly skin: Skin,
    template: HTMLTemplateElement,
  ) {
    const el = (template.content.firstElementChild as HTMLElement).cloneNode(
      true,
    ) as HTMLElement;
    el.dataset.key = skin.key;
    const label = skin.name;
    const name = el.querySelector<HTMLElement>("[data-name]")!;
    name.textContent = label;
    name.title = `${skin.dff} + ${skin.txd}`;
    el.querySelector("[data-file]")!.textContent = skinLabel(skin.baseId);
    el.querySelector("[data-tags]")!.append(...skin.tags.map(tagBadge));
    el.querySelector("[data-expand]")!.setAttribute(
      "aria-label",
      `Ampliar el skin ${label} (${skin.tags.join(", ")})`,
    );
    el.querySelector("[data-download]")!.setAttribute(
      "aria-label",
      `Descargar el skin ${label} (${skin.dff} y ${skin.txd})`,
    );

    this.el = el;
    this.canvas = el.querySelector("canvas")!;
    this.overlay = el.querySelector("[data-overlay]")!;
    this.timer = window.setTimeout(() => {
      loadQueue.push(this);
      pumpQueue();
    }, LOAD_DELAY_MS);
  }

  async load(): Promise<void> {
    if (this.dead) return;
    try {
      const viewer = await loadViewer();
      if (this.dead) return;
      const model = await viewer.prepareSkin(
        skinFileUrl(this.skin.dff),
        skinFileUrl(this.skin.txd),
        "card",
      );
      await nextBuildTurn();
      if (this.dead) return;
      this.preview = new viewer.SkinPreview(this.canvas, "card");
      this.preview.setVisible(true);
      this.preview.show(model);
      this.overlay.hidden = true;
    } catch (err) {
      if (this.dead) return;
      console.error(`[skins] ${this.skin.dff}`, err);
      this.overlay.textContent = errorLabel(err);
    }
  }

  destroy(): void {
    this.dead = true;
    clearTimeout(this.timer);
    const queued = loadQueue.indexOf(this);
    if (queued !== -1) loadQueue.splice(queued, 1);
    // Fuera del grid ya; el canvas deja de pintarse y la GPU se libera luego.
    this.preview?.setVisible(false);
    if (this.preview) disposeLater(this.preview);
    this.preview = null;
    this.el.remove();
  }
}

function tagBadge(tag: string): HTMLElement {
  const li = document.createElement("li");
  li.className =
    "rounded bg-black/70 px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-primary ring-1 ring-primary/40";
  li.textContent = tag;
  return li;
}

// ---------------------------------------------------------------------------
// Búsqueda: cada término debe coincidir (Y lógico). Un número busca por ID de
// skin (el exacto sale primero), "280-290" es un rango y el texto busca en el
// nombre de los archivos y en las etiquetas.
// ---------------------------------------------------------------------------

type Scorer = (skin: Skin, haystack: string) => number;

function tokenScorer(token: string): Scorer {
  const range = /^(\d+)-(\d+)$/.exec(token);
  if (range) {
    const lo = Math.min(+range[1], +range[2]);
    const hi = Math.max(+range[1], +range[2]);
    return (s) => (s.baseId >= lo && s.baseId <= hi ? 2 : 0);
  }
  if (/^\d+$/.test(token))
    return (s, hay) => {
      const id = String(s.baseId);
      if (id === token) return 4;
      if (id.startsWith(token)) return 3;
      if (id.includes(token)) return 2;
      return String(s.newId ?? "").includes(token) || hay.includes(token)
        ? 1
        : 0;
    };
  return (_s, hay) => (hay.includes(token) ? 1 : 0);
}

// ---------------------------------------------------------------------------

function init(root: HTMLElement): void {
  const $ = <T extends HTMLElement = HTMLElement>(sel: string) =>
    root.querySelector<T>(sel)!;

  const input = $<HTMLInputElement>("[data-search]");
  const clearBtn = $("[data-search-clear]");
  const sortSelect = $<HTMLSelectElement>("[data-sort]");
  const toolbar = $("[data-toolbar]");
  const filtersToggle = root.querySelector<HTMLElement>("[data-filters-toggle]");
  const filtersPanel = root.querySelector<HTMLElement>("#skins-filtros");
  // Dos huecos para el recuento: el de la fila de chips (sm+) y el compacto
  // junto al buscador (móvil). El `role="status"` vive solo en el primero.
  const counters = [...root.querySelectorAll("[data-count], [data-count-mobile]")];
  const host = $("[data-grid]");
  const inner = $("[data-grid-inner]");
  const template = $<HTMLTemplateElement>("[data-card-tpl]");
  const chips = [...root.querySelectorAll<HTMLButtonElement>("[data-tag]")];
  const genderChips = [
    ...root.querySelectorAll<HTMLButtonElement>("[data-gender]"),
  ];
  const raceChips = [...root.querySelectorAll<HTMLButtonElement>("[data-race]")];
  const states = [...root.querySelectorAll<HTMLElement>("[data-state]")];

  let catalog: Skin[] = [];
  let haystacks = new Map<string, string>();
  let order = new Map<string, number>();
  let filtered: Skin[] = [];
  let query = "";
  let sort: Sort = "asc";
  const activeTags = new Set<string>();
  // Género y raza del skin ORIGINAL del que parte cada modelo (skintags.inc):
  // un skin personalizado hereda el cuerpo del ped que reemplaza.
  const activeGenders = new Set<SkinGender>();
  const activeRaces = new Set<SkinRace>();

  // --- Estado en la URL (enlaces compartibles) -----------------------------
  const params = new URLSearchParams(location.search);
  query = params.get("q") ?? "";
  const sortParam = params.get("orden");
  if (sortParam === "desc" || sortParam === "orig") sort = sortParam;
  for (const t of (params.get("tag") ?? "").split(","))
    if (t) activeTags.add(t.toUpperCase());
  for (const g of (params.get("genero") ?? "").split(","))
    if (g === "m" || g === "f") activeGenders.add(g);
  for (const r of (params.get("raza") ?? "").split(","))
    if (r in RACE_LABELS) activeRaces.add(r as SkinRace);
  let pendingSkin = params.get("skin");
  input.value = query;
  sortSelect.value = sort;

  function syncUrl(openKey?: string | null): void {
    const p = new URLSearchParams();
    if (query.trim()) p.set("q", query.trim());
    if (activeTags.size) p.set("tag", [...activeTags].join(",").toLowerCase());
    if (activeGenders.size) p.set("genero", [...activeGenders].join(","));
    if (activeRaces.size) p.set("raza", [...activeRaces].join(","));
    if (sort !== "asc") p.set("orden", sort);
    if (openKey) p.set("skin", openKey);
    const qs = p.toString();
    history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
  }

  function setState(state: ViewState): void {
    for (const el of states) el.hidden = el.dataset.state !== state;
    host.hidden = state !== "ready";
  }

  // --- Grid virtualizado sobre el scroll de la página -----------------------
  const mounted = new Map<string, Card>();
  let cols = 2;
  let gap = 16;
  let rowH = 1;
  let cardW = 1;
  let cardH = 1;
  let lastRange = "";
  // Distancia del grid al inicio del documento. Se mide al cambiar el layout,
  // no en cada frame de scroll (getBoundingClientRect fuerza un layout).
  let hostTop = 0;

  function measure(): void {
    const width = host.clientWidth;
    const compact = width < 520;
    gap = compact ? 10 : 16;
    const minCard = compact ? 136 : 184;
    cols = Math.max(2, Math.floor((width + gap) / (minCard + gap)));
    cardW = Math.floor((width - gap * (cols - 1)) / cols);
    cardH = Math.round(cardW * 1.35) + INFO_H;
    rowH = cardH + gap;
    hostTop = host.getBoundingClientRect().top + scrollY;
  }

  function renderGrid(force = false): void {
    if (host.hidden) return;
    const rows = Math.ceil(filtered.length / cols);
    const height = `${Math.max(0, rows * rowH - gap)}px`;
    if (host.style.height !== height) host.style.height = height;

    const top = hostTop - scrollY;
    const first = Math.min(
      rows,
      Math.max(0, Math.floor(-top / rowH) - OVERSCAN_ROWS),
    );
    const last = Math.max(
      first,
      Math.min(rows, Math.ceil((innerHeight - top) / rowH) + OVERSCAN_ROWS),
    );
    const range = `${first}:${last}:${cols}`;
    if (!force && range === lastRange) return;
    lastRange = range;

    const start = first * cols;
    const wanted = filtered.slice(start, last * cols);
    const keep = new Set(wanted.map((s) => s.key));
    for (const [key, card] of mounted)
      if (!keep.has(key)) {
        card.destroy();
        mounted.delete(key);
      }

    // Cada tarjeta va en posición absoluta con su propio transform: las que
    // entran o salen no provocan el relayout de las demás.
    wanted.forEach((skin, i) => {
      let card = mounted.get(skin.key);
      if (!card) {
        card = new Card(skin, template);
        mounted.set(skin.key, card);
        inner.append(card.el);
      }
      const index = start + i;
      const x = (index % cols) * (cardW + gap);
      const y = Math.floor(index / cols) * rowH;
      const place = `${x},${y},${cardW},${cardH}`;
      if (card.el.dataset.place === place) return;
      card.el.dataset.place = place;
      card.el.style.width = `${cardW}px`;
      card.el.style.height = `${cardH}px`;
      card.el.style.transform = `translate(${x}px, ${y}px)`;
    });
  }

  let scrollFrame = 0;
  const onScroll = () => {
    trackScrollSpeed();
    if (scrollFrame) return;
    scrollFrame = requestAnimationFrame(() => {
      scrollFrame = 0;
      renderGrid();
    });
  };
  addEventListener("scroll", onScroll, { passive: true });
  // El grid cambia de ancho, o algo por encima cambia de alto (un anuncio
  // que se rellena, la cabecera al girar el móvil): se vuelve a medir.
  const layoutObserver = new ResizeObserver(() => {
    measure();
    renderGrid(true);
  });
  layoutObserver.observe(host);
  layoutObserver.observe(document.body);

  // --- Filtro ---------------------------------------------------------------
  function applyFilter(): void {
    const tokens = query.toLowerCase().split(/[\s,;]+/).filter(Boolean);
    const scorers = tokens.map(tokenScorer);
    const scores = new Map<string, number>();

    filtered = catalog.filter((skin) => {
      if (activeTags.size && !skin.tags.some((t) => activeTags.has(t)))
        return false;
      if (activeGenders.size) {
        const gender = skinGender(skin.baseId);
        if (!gender || !activeGenders.has(gender)) return false;
      }
      if (activeRaces.size) {
        const race = skinRace(skin.baseId);
        if (!race || !activeRaces.has(race)) return false;
      }
      let total = 0;
      const hay = haystacks.get(skin.key)!;
      for (const scorer of scorers) {
        const score = scorer(skin, hay);
        if (!score) return false;
        total += score;
      }
      scores.set(skin.key, total);
      return true;
    });

    const bySort = (a: Skin, b: Skin) => {
      const original = order.get(a.key)! - order.get(b.key)!;
      if (sort === "orig") return original;
      const byId = sort === "asc" ? a.baseId - b.baseId : b.baseId - a.baseId;
      return byId || tagRank(a) - tagRank(b) || original;
    };
    filtered.sort(
      (a, b) => scores.get(b.key)! - scores.get(a.key)! || bySort(a, b),
    );

    const total = catalog.length.toLocaleString("es-ES");
    const shown = filtered.length.toLocaleString("es-ES");
    const full = filtered.length === catalog.length;
    for (const el of counters)
      el.textContent =
        el.hasAttribute("data-count-mobile")
          ? full
            ? `${total} skins`
            : `${shown}/${total}`
          : full
            ? `${total} skins`
            : `${shown} de ${total} skins`;
    clearBtn.hidden = query === "";
    for (const chip of chips) {
      const tag = chip.dataset.tag!;
      const on = tag === "" ? activeTags.size === 0 : activeTags.has(tag);
      chip.setAttribute("aria-pressed", String(on));
    }
    for (const chip of genderChips)
      chip.setAttribute(
        "aria-pressed",
        String(activeGenders.has(chip.dataset.gender as SkinGender)),
      );
    for (const chip of raceChips)
      chip.setAttribute(
        "aria-pressed",
        String(activeRaces.has(chip.dataset.race as SkinRace)),
      );
    filtersToggle?.classList.toggle(
      "has-active",
      activeGenders.size + activeRaces.size > 0,
    );

    if (!catalog.length) return;
    setState(filtered.length ? "ready" : "noresults");
    measure(); // el grid acaba de hacerse visible: su ancho ya es real
    renderGrid(true);
  }

  /** Tras filtrar, si el usuario estaba a mitad del grid, vuelve al inicio. */
  function scrollToResults(): void {
    const limit = toolbar.getBoundingClientRect().bottom + 16;
    const top = host.getBoundingClientRect().top;
    if (top < limit)
      window.scrollBy({ top: top - limit, behavior: "instant" });
  }

  function update(): void {
    applyFilter();
    syncUrl();
    scrollToResults();
  }

  let typing = 0;
  input.addEventListener("input", () => {
    clearTimeout(typing);
    typing = window.setTimeout(() => {
      query = input.value;
      update();
    }, 120);
  });
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && input.value) {
      ev.preventDefault();
      input.value = query = "";
      update();
    }
  });
  clearBtn.addEventListener("click", () => {
    input.value = query = "";
    update();
    input.focus();
  });
  sortSelect.addEventListener("change", () => {
    sort = sortSelect.value as Sort;
    update();
  });
  for (const chip of chips)
    chip.addEventListener("click", () => {
      const tag = chip.dataset.tag!;
      if (tag === "") activeTags.clear();
      else if (!activeTags.delete(tag)) activeTags.add(tag);
      track("skin_filter", { tag: tag || "todas" });
      update();
    });
  // Panel de filtros avanzados: plegado por defecto, se abre si ya hay alguno
  // activo (p. ej. al llegar por un enlace con ?genero=).
  function setFiltersOpen(open: boolean): void {
    if (!filtersPanel || !filtersToggle) return;
    filtersPanel.hidden = !open;
    filtersToggle.setAttribute("aria-expanded", String(open));
  }
  setFiltersOpen(activeGenders.size + activeRaces.size > 0);
  filtersToggle?.addEventListener("click", () =>
    setFiltersOpen(filtersToggle.getAttribute("aria-expanded") !== "true"),
  );

  for (const chip of genderChips)
    chip.addEventListener("click", () => {
      const gender = chip.dataset.gender as SkinGender;
      if (!activeGenders.delete(gender)) activeGenders.add(gender);
      track("skin_filter", { gender });
      update();
    });
  for (const chip of raceChips)
    chip.addEventListener("click", () => {
      const race = chip.dataset.race as SkinRace;
      if (!activeRaces.delete(race)) activeRaces.add(race);
      track("skin_filter", { race });
      update();
    });
  root.querySelector("[data-reset]")?.addEventListener("click", () => {
    input.value = query = "";
    activeTags.clear();
    activeGenders.clear();
    activeRaces.clear();
    setFiltersOpen(false);
    update();
    input.focus();
  });
  // "/" enfoca el buscador desde cualquier parte de la página.
  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "/" || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    const target = ev.target as HTMLElement | null;
    if (target?.closest("input, textarea, select, [contenteditable], dialog"))
      return;
    ev.preventDefault();
    input.focus();
    input.select();
  });

  // --- Descarga: la pareja en un ZIP, un solo clic ---------------------------
  async function download(skin: Skin, button: HTMLButtonElement): Promise<void> {
    if (button.disabled) return;
    const label = button.querySelector<HTMLElement>("[data-label]")!;
    const idle = label.dataset.idle ?? (label.dataset.idle = label.textContent!);
    button.disabled = true;
    label.textContent = "Preparando…";
    try {
      const [dff, txd] = await Promise.all([
        getFile(skin.dff),
        getFile(skin.txd),
      ]);
      const zip = buildZip([
        { name: skin.dff, data: dff },
        { name: skin.txd, data: txd },
      ]);
      const stem = skin.name.replace(/[^\w.-]+/g, "_");
      const a = document.createElement("a");
      a.href = URL.createObjectURL(zip);
      a.download = `skin-${stem}.zip`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
      label.textContent = "¡Descargado!";
      track("skin_download", {
        skin_name: skin.name,
        skin_file: skin.dff,
        skin_tags: skin.tags.join(","),
      });
    } catch (err) {
      console.error(`[skins] descarga de ${skin.dff}`, err);
      label.textContent =
        err instanceof MissingFileError ? "No disponible" : "Error, reintenta";
    } finally {
      button.disabled = false;
      setTimeout(() => (label.textContent = idle), 2200);
    }
  }

  // --- Visor ampliado ---------------------------------------------------------
  const dialog = $<HTMLDialogElement>("[data-viewer]");
  const v = <T extends HTMLElement = HTMLElement>(name: string) =>
    dialog.querySelector<T>(`[data-v-${name}]`)!;
  const vOverlay = v("overlay");
  let viewerPreview: SkinPreview | null = null;
  let viewerSkin: Skin | null = null;

  async function openViewer(skin: Skin): Promise<void> {
    viewerSkin = skin;
    v("title").textContent = skin.name;
    v("tags").replaceChildren(...skin.tags.map(tagBadge));
    v("base").textContent = skinLabel(skin.baseId);
    const gender = skinGender(skin.baseId);
    const race = skinRace(skin.baseId);
    v("body").textContent =
      gender && race ? `${GENDER_LABELS[gender]} · ${RACE_LABELS[race]}` : "—";
    v("newid").textContent = skin.newId == null ? "—" : String(skin.newId);
    v("dff").textContent = skin.dff;
    v("txd").textContent = skin.txd;
    const index = filtered.indexOf(skin);
    v("pos").textContent =
      index === -1 ? "" : `${index + 1} / ${filtered.length}`;
    v<HTMLButtonElement>("prev").disabled = index <= 0;
    v<HTMLButtonElement>("next").disabled =
      index === -1 || index >= filtered.length - 1;
    vOverlay.hidden = false;
    vOverlay.textContent = "Cargando…";
    if (!dialog.open) {
      dialog.showModal();
      track("skin_view", { skin_name: skin.name, skin_file: skin.dff });
    }
    syncUrl(skin.dff.replace(/\.dff$/i, ""));

    try {
      const viewer = await loadViewer();
      const model = await viewer.prepareSkin(
        skinFileUrl(skin.dff),
        skinFileUrl(skin.txd),
        "full",
      );
      if (viewerSkin !== skin || !dialog.open) return;
      viewerPreview ??= new viewer.SkinPreview(v("canvas"), "full");
      viewerPreview.show(model);
      vOverlay.hidden = true;
    } catch (err) {
      if (viewerSkin !== skin) return;
      console.error(`[skins] ${skin.dff}`, err);
      vOverlay.textContent = errorLabel(err);
    }
  }

  function step(delta: number): void {
    if (!viewerSkin) return;
    const next = filtered[filtered.indexOf(viewerSkin) + delta];
    if (next) openViewer(next);
  }

  dialog.addEventListener("close", () => {
    viewerPreview?.dispose();
    viewerPreview = null;
    viewerSkin = null;
    syncUrl();
  });
  dialog.addEventListener("click", (ev) => {
    if (ev.target === dialog) dialog.close(); // clic en el fondo
  });
  dialog.addEventListener("keydown", (ev) => {
    if (ev.key === "ArrowLeft") step(-1);
    else if (ev.key === "ArrowRight") step(1);
  });
  v("close").addEventListener("click", () => dialog.close());
  v("prev").addEventListener("click", () => step(-1));
  v("next").addEventListener("click", () => step(1));
  v("reset").addEventListener("click", () => viewerPreview?.reset());
  v("download").addEventListener("click", (ev) => {
    if (viewerSkin)
      download(viewerSkin, ev.currentTarget as HTMLButtonElement);
  });

  // --- Clics en las tarjetas (delegados) --------------------------------------
  let downAt: [number, number] = [0, 0];
  inner.addEventListener("pointerdown", (ev) => {
    downAt = [ev.clientX, ev.clientY];
  });
  inner.addEventListener("click", (ev) => {
    const target = ev.target as HTMLElement;
    const key = target.closest<HTMLElement>("[data-key]")?.dataset.key;
    const skin = key && mounted.get(key)?.skin;
    if (!skin) return;
    const button = target.closest<HTMLButtonElement>("[data-download]");
    if (button) return void download(skin, button);
    if (target.closest("[data-expand]")) return void openViewer(skin);
    // Clic sobre el modelo (no un arrastre para girarlo) → visor ampliado.
    const moved = Math.hypot(ev.clientX - downAt[0], ev.clientY - downAt[1]);
    if (target.closest("canvas") && moved < 6) openViewer(skin);
  });

  // --- Catálogo ---------------------------------------------------------------
  async function fetchSource(source: string): Promise<SkinEntry[]> {
    const res = await fetch(skinSourceUrl(source), { cache: "no-cache" });
    // Fuente declarada pero aún sin subir: cuenta como vacía, no como error.
    if (res.status === 404 || res.status === 403) return [];
    if (!res.ok) throw new Error(`${source}.txt: HTTP ${res.status}`);
    return parseSkins(await res.text());
  }

  async function loadCatalog(): Promise<void> {
    setState("loading");
    const results = await Promise.allSettled(SKIN_SOURCES.map(fetchSource));
    const sources: { tag: string; entries: SkinEntry[] }[] = [];
    results.forEach((result, i) => {
      if (result.status === "fulfilled")
        sources.push({ tag: skinTag(SKIN_SOURCES[i]), entries: result.value });
      else console.error("[skins]", result.reason);
    });
    if (!sources.length) return setState("error");

    catalog = mergeSkins(sources);
    order = new Map(catalog.map((s, i) => [s.key, i]));
    haystacks = new Map(
      catalog.map((s) => [
        s.key,
        // Nombre y género/raza del skin base entran en la búsqueda: buscar
        // "prostitute", "truth" o "mujer" encuentra los modelos que parten de ahí.
        [
          s.dff,
          s.txd,
          s.tags.join(" "),
          skinName(s.baseId) ?? "",
          GENDER_LABELS[skinGender(s.baseId) ?? "m"],
          RACE_LABELS[skinRace(s.baseId) ?? "white"],
        ]
          .join(" ")
          .toLowerCase(),
      ]),
    );

    for (const chip of chips) {
      const tag = chip.dataset.tag!;
      const n = tag
        ? catalog.filter((s) => s.tags.includes(tag)).length
        : catalog.length;
      chip.querySelector("[data-tag-count]")!.textContent =
        n.toLocaleString("es-ES");
      if (tag) chip.hidden = n === 0;
    }
    for (const tag of activeTags)
      if (!chips.some((c) => c.dataset.tag === tag && !c.hidden))
        activeTags.delete(tag);

    if (!catalog.length) return setState("empty");
    applyFilter();

    if (pendingSkin) {
      const wanted = pendingSkin.toLowerCase();
      pendingSkin = null;
      const skin = catalog.find(
        (s) => s.dff.replace(/\.dff$/i, "").toLowerCase() === wanted,
      );
      if (skin) openViewer(skin);
    }
  }

  root.querySelector("[data-retry]")?.addEventListener("click", loadCatalog);
  loadCatalog();
}

const root = document.querySelector<HTMLElement>("[data-skins]");
if (root) init(root);
