// Parser de artconfig (formato Texture Studio / open.mp), limitado a skins:
//   AddCharModel(baseid, newid, "archivo.dff", "archivo.txd");
// Las líneas AddSimpleModel (objetos) y cualquier otra cosa se ignoran.
// Portado de samp-models-viewer/server/artconfig.ts. Se usa tanto en build
// (recuento para el HTML) como en el navegador (catálogo en vivo).

export interface SkinEntry {
  /** Skin original del que parte (primer argumento). */
  baseId: number;
  /** ID de modelo asignado en el servidor (segundo argumento). */
  newId: number | null;
  dff: string;
  txd: string;
}

export interface Skin extends SkinEntry {
  /** Clave estable: pareja dff+txd en minúsculas. */
  key: string;
  /** Nombre visible: el del .dff sin extensión (0xEDA3D408, dnmylc…). */
  name: string;
  /** Etiquetas de los artconfig donde aparece la pareja. */
  tags: string[];
}

const LINE_RE = /^\s*AddCharModel\s*\(([^)]*)\)/i;
const DFF_RE = /"([^"]+\.dff)"/i;
const TXD_RE = /"([^"]+\.txd)"/i;

export function parseSkins(content: string): SkinEntry[] {
  const entries: SkinEntry[] = [];
  for (const raw of content.replace(/^﻿/, "").split(/\r?\n/)) {
    const m = LINE_RE.exec(raw);
    if (!m) continue;
    const args = m[1];
    const dff = DFF_RE.exec(args)?.[1].trim();
    const txd = TXD_RE.exec(args)?.[1].trim();
    if (!dff || !txd) continue;

    // Números antes del primer literal entrecomillado.
    const nums = args
      .slice(0, args.indexOf('"'))
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map(Number)
      .filter(Number.isFinite);
    if (!nums.length) continue;

    // El skin base 0 es CJ: no se puede usar como personaje y en la práctica
    // marca entradas de relleno o de prueba en los artconfig.
    if (nums[0] === 0) continue;

    entries.push({ baseId: nums[0], newId: nums[1] ?? null, dff, txd });
  }
  return entries;
}

/**
 * Une varios artconfig en un solo catálogo. Una misma pareja dff+txd que
 * aparezca en varias fuentes sale una sola vez, con todas sus etiquetas.
 */
export function mergeSkins(
  sources: { tag: string; entries: SkinEntry[] }[],
): Skin[] {
  const byKey = new Map<string, Skin>();
  for (const { tag, entries } of sources) {
    for (const e of entries) {
      const key = `${e.dff}|${e.txd}`.toLowerCase();
      const found = byKey.get(key);
      if (found) {
        if (!found.tags.includes(tag)) found.tags.push(tag);
      } else {
        byKey.set(key, {
          ...e,
          key,
          name: e.dff.replace(/\.dff$/i, ""),
          tags: [tag],
        });
      }
    }
  }
  return [...byKey.values()];
}
