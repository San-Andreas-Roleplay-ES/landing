/**
 * The feature sections of the one-pager, in page order. Shared by the hero
 * mosaic (one tile per section), the side section-nav and the GA4 events, so
 * ids/labels stay in sync. Each `id` is the DOM id of the section it links to.
 */
export interface SectionDef {
  id: string;
  /** Short label (side nav, tile title). */
  label: string;
  /** Small chip on the tile. */
  kicker: string;
  /** Basename under public/images/tiles/ (without -480/-960.webp). */
  tile: string;
  alt: string;
}

export const SECTIONS: SectionDef[] = [
  {
    id: "facciones",
    label: "Facciones criminales",
    kicker: "Mundo ilegal",
    tile: "facciones",
    alt: "Pandilleros posando frente a sus lowriders de noche en Los Santos",
  },
  {
    id: "departamentos",
    label: "Policía, bomberos y militares",
    kicker: "Departamentos",
    tile: "departamentos",
    alt: "Patrullas del LSPD con las luces encendidas en un control nocturno",
  },
  {
    id: "casino",
    label: "Emerald Casino",
    kicker: "Economía",
    tile: "casino",
    alt: "Fachada iluminada del Emerald Isle Casino de noche",
  },
  {
    id: "gobierno",
    label: "Gobierno de Los Santos",
    kicker: "Política",
    tile: "gobierno",
    alt: "Acto público del Gobierno de Los Santos con banderas y ciudadanos",
  },
  {
    id: "skins",
    label: "Tu skin, gratis",
    kicker: "Personalización",
    tile: "skins",
    alt: "Personajes con skins personalizados reunidos en un garaje",
  },
  {
    id: "pasarelas",
    label: "Moda y pasarelas",
    kicker: "Moda y cine",
    tile: "pasarelas",
    alt: "Cartel de moda gigante en un rascacielos de Los Santos de noche",
  },
  {
    id: "reglas",
    label: "Reglas claras",
    kicker: "Normativa",
    tile: "reglas",
    alt: "Sala del Tribunal Superior del Estado de San Andreas",
  },
  {
    id: "events",
    label: "Eventos semanales",
    kicker: "Eventos",
    tile: "gobierno",
    alt: "Multitud reunida en un evento público de San Andreas Roleplay",
  },
];

export function tileSrcSet(base: string): { src: string; srcset: string } {
  return {
    src: `/images/tiles/${base}-960.webp`,
    srcset: `/images/tiles/${base}-480.webp 480w, /images/tiles/${base}-960.webp 960w`,
  };
}
