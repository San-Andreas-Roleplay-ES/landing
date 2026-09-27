/**
 * Google AdSense. Rellena `CLIENT` con el ID de editor (AdSense > Cuenta >
 * Información de la cuenta, formato `ca-pub-0000000000000000`) y cada hueco
 * con el ID del bloque de anuncios creado en AdSense > Anuncios > Por bloque
 * de anuncios (tipo "Display", tamaño "Responsivo"). Ninguno es secreto: van
 * en el HTML público. Mientras `CLIENT` esté vacío no se carga nada de Google
 * y los huecos no ocupan espacio; en `npm run dev` se dibujan como cajas
 * punteadas para revisar el layout.
 *
 * Huecos:
 *   heroBottom  portada, entre el mosaico y la marquesina
 *   homeRules   portada, antes de "Reglas de rol"
 *   homeBottom  portada, debajo de "Empezar es gratis"
 *   docsTop     /docs, antes de la tarjeta de contenido de cada guía
 *   docsBottom  /docs, debajo de "Empezar es gratis"
 *   rulesTop    /reglas, entre la cabecera y la lista de reglas
 *   rulesBottom /reglas, debajo de "Empezar es gratis"
 *   skinsTop    /skins, entre la cabecera y el buscador de la galería
 *   skinsBottom /skins, debajo de "Empezar es gratis"
 *   sideRail    rascacielos fijo en el margen derecho de pantallas anchas
 *               (/docs, /reglas y /skins; un mismo bloque, tamaño responsivo
 *               vertical: 160×600 / 300×600)
 */
const CLIENT = "ca-pub-5469092232048502";

export type AdName =
  | "heroBottom"
  | "homeRules"
  | "homeBottom"
  | "docsTop"
  | "docsBottom"
  | "rulesTop"
  | "rulesBottom"
  | "skinsTop"
  | "skinsBottom"
  | "sideRail";

const SLOTS: Record<AdName, string> = {
  heroBottom: "6301439562",
  homeRules: "1479609292",
  homeBottom: "1775122768",
  docsTop: "5563072966",
  docsBottom: "7853445951",
  rulesTop: "8831485700",
  rulesBottom: "4892240698",
  skinsTop: "6869424936",
  skinsBottom: "3675276220",
  sideRail: "5227282611",
};

export const ADS = {
  client: CLIENT,
  slots: SLOTS,
  /** Solo se emite código de AdSense con un ID de editor válido. */
  enabled: /^ca-pub-\d{10,}$/.test(CLIENT),
} as const;
