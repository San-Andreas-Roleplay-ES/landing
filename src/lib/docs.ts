import { getCollection, type CollectionEntry } from "astro:content";
import { rewriteImageUrl } from "./docs-urls.mjs";

// Este módulo se empaqueta con Vite: nada de rutas relativas a
// import.meta.url. Los archivos generados por scripts/mirror-docs.mjs se
// resuelven con import.meta.glob (vacío si aún no existen).
const datesModules = import.meta.glob<{
  default: { files?: Record<string, DocDates> };
}>("../data/docs-dates.json", { eager: true });
const attachmentFiles = Object.keys(
  import.meta.glob("/public/images/docs/attachments/*"),
);
/** id -> "/images/docs/attachments/<id>.<ext>" (adjuntos espejados). */
function knownAttachments(): Map<string, string> {
  return new Map(
    attachmentFiles.map((p) => {
      const file = p.slice(p.lastIndexOf("/") + 1);
      return [file.replace(/\.[^.]+$/, ""), `/images/docs/attachments/${file}`];
    }),
  );
}

export type DocEntry = CollectionEntry<"docs">;

export const DOCS_REPO = "https://github.com/San-Andreas-Roleplay-ES/samp-docs";

/** Título = primer `# ` del Markdown (los docs no llevan frontmatter). */
export function docTitle(entry: DocEntry): string {
  const m = entry.body?.match(/^#\s+(.+?)\s*$/m);
  return m ? stripInline(m[1]) : entry.id;
}

/**
 * Descripción SEO = primer párrafo "de verdad" (ni encabezado, ni cita, ni
 * lista, ni imagen, ni HTML), sin sintaxis Markdown y cortado a ~160 chars.
 */
export function docDescription(entry: DocEntry, max = 160): string {
  const blocks = (entry.body ?? "").split(/\n\s*\n/);
  for (const raw of blocks) {
    const b = raw.trim();
    if (!b || /^(#|>|[-*+]\s|\d+\.\s|!\[|<|\||```|---)/.test(b)) continue;
    const text = stripInline(b).replace(/\s+/g, " ").trim();
    if (text.length < 40) continue;
    if (text.length <= max) return text;
    const cut = text.slice(0, max);
    return `${cut.slice(0, cut.lastIndexOf(" "))}…`;
  }
  return "";
}

/** Quita énfasis, código, enlaces e imágenes dejando el texto plano. */
export function stripInline(md: string): string {
  return md
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/<[^>]+>/g, "")
    .trim();
}

/** Nº de palabras del cuerpo (sin bloques de código ni sintaxis). */
export function docWordCount(entry: DocEntry): number {
  const text = stripInline((entry.body ?? "").replace(/```[\s\S]*?```/g, " "));
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Palabras clave = los comandos del juego que la guía menciona (`/comprar`,
 * `/alquiler`…): es exactamente lo que la gente busca. Únicos, en orden de
 * aparición, máximo `max`.
 */
export function docKeywords(entry: DocEntry, max = 20): string[] {
  const seen = new Set<string>();
  for (const m of (entry.body ?? "").matchAll(
    /(?:^|[\s(`"'])\/([a-záéíóúñ][\wáéíóúñ]{2,})/gi,
  )) {
    const cmd = `/${m[1].toLowerCase()}`;
    if (!seen.has(cmd)) seen.add(cmd);
    if (seen.size >= max) break;
  }
  return [...seen];
}

/** Primera imagen local de la guía (para og:image), o null. */
export function docFirstImage(entry: DocEntry): string | null {
  const body = entry.body ?? "";
  const m =
    body.match(/!\[[^\]]*\]\(([^)\s]+)/) ??
    body.match(/<img\b[^>]*\ssrc=["']([^"']+)["']/i);
  if (!m) return null;
  const url = rewriteImageUrl(m[1], knownAttachments());
  return url.startsWith("/images/docs/") ? url : null;
}

export interface DocDates {
  published?: string;
  modified?: string;
}

/**
 * Fechas de primer/último commit por guía, escritas por scripts/mirror-docs.mjs
 * en src/data/docs-dates.json (no commiteado). Vacío si no se pudo obtener.
 */
export function getDocDates(): Record<string, DocDates> {
  const mod = Object.values(datesModules)[0];
  return mod?.default?.files ?? {};
}

export interface DocLink {
  slug: string;
  title: string;
  href: string;
  group: string;
}

export interface DocGroup {
  name: string;
  docs: DocLink[];
}

// Orden fijo para las guías introductorias; el resto va por título.
const START_ORDER = ["que-es-sarp", "como-empezar", "panel-de-control", "foro"];

export function docGroup(slug: string): string {
  if (slug.startsWith("sistema-")) return "Sistemas";
  if (slug.startsWith("facciones-")) return "Facciones";
  return "Empezar";
}

const GROUP_ORDER = ["Empezar", "Facciones", "Sistemas"];

/** Todas las guías (sin el índice), agrupadas y ordenadas para la navegación. */
export async function getDocGroups(): Promise<DocGroup[]> {
  const entries = (await getCollection("docs")).filter((e) => e.id !== "index");
  const links: DocLink[] = entries.map((e) => ({
    slug: e.id,
    title: docTitle(e),
    href: `/docs/${e.id}`,
    group: docGroup(e.id),
  }));
  const collator = new Intl.Collator("es");
  links.sort((a, b) => {
    const ia = START_ORDER.indexOf(a.slug);
    const ib = START_ORDER.indexOf(b.slug);
    if (ia !== -1 || ib !== -1) {
      if (ia === -1) return 1;
      if (ib === -1) return -1;
      return ia - ib;
    }
    return collator.compare(a.title, b.title);
  });
  return GROUP_ORDER.map((name) => ({
    name,
    docs: links.filter((l) => l.group === name),
  })).filter((g) => g.docs.length > 0);
}

/** Lista plana en orden de navegación (para anterior / siguiente). */
export async function getDocSequence(): Promise<DocLink[]> {
  return (await getDocGroups()).flatMap((g) => g.docs);
}

/**
 * Guías relacionadas: las del mismo grupo, empezando por las que siguen a la
 * actual (así cada guía enlaza a un subconjunto distinto y el enlazado
 * interno se reparte). Si el grupo es corto, se completa con otras.
 */
export async function getRelatedDocs(slug: string, n = 6): Promise<DocLink[]> {
  const seq = await getDocSequence();
  const group = docGroup(slug);
  const same = seq.filter((d) => d.group === group && d.slug !== slug);
  const i = same.findIndex(
    (d) => seq.indexOf(d) > seq.findIndex((s) => s.slug === slug),
  );
  const rotated = i === -1 ? same : [...same.slice(i), ...same.slice(0, i)];
  const others = seq.filter((d) => d.group !== group);
  return [...rotated, ...others].slice(0, n);
}

/** Guías destacadas en la portada (las más buscadas), si existen. */
const HOME_TEASER_SLUGS = [
  "como-empezar",
  "sistema-de-propiedades",
  "sistema-de-armas",
  "sistema-de-carcel",
  "sistema-de-casino",
  "facciones-ilegales",
];

export interface DocTeaser extends DocLink {
  description: string;
}

export async function getHomeTeaser(): Promise<DocTeaser[]> {
  const entries = await getCollection("docs");
  const byId = new Map(entries.map((e) => [e.id, e]));
  return HOME_TEASER_SLUGS.flatMap((slug) => {
    const e = byId.get(slug);
    if (!e) return [];
    return [
      {
        slug,
        title: docTitle(e),
        href: `/docs/${slug}`,
        group: docGroup(slug),
        description: docDescription(e, 110),
      },
    ];
  });
}
