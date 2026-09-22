/**
 * Galería de skins (/skins). Todo se sirve desde el bucket público de
 * Backblaze B2 (NO desde Bunny):
 *
 *   <SKINS_BASE>/<fuente>.txt      artconfig (líneas `AddCharModel(...)`)
 *   <SKINS_BASE>/models/<archivo>  los .dff y .txd sueltos
 *
 * El bucket no permite listar sin credenciales, así que cada artconfig se
 * declara aquí: para publicar `gtac.txt`, añade "gtac" a `SKIN_SOURCES`. La
 * etiqueta visible es el nombre del archivo en mayúsculas (gtac → GTAC).
 *
 * El navegador descarga los .txt, .dff y .txd directamente, así que el bucket
 * necesita una regla CORS (operaciones `s3_get` y `s3_head`) que admita
 * https://gta-rol.com. En `npm run dev` las peticiones pasan por el proxy de
 * Vite `/_skins` (astro.config.mjs), así que localhost no necesita CORS.
 */
const REMOTE = "https://sarp-public.s3.us-east-005.backblazeb2.com/skins";

// En build (frontmatter) siempre la URL real; el proxy solo existe en el
// navegador durante el desarrollo.
export const SKINS_BASE: string =
  import.meta.env.DEV && !import.meta.env.SSR ? "/_skins" : REMOTE;

export const SKIN_SOURCES: readonly string[] = ["lsrp", "sols", "sarp", "vc"];

export const skinSourceUrl = (source: string): string =>
  `${SKINS_BASE}/${encodeURIComponent(source)}.txt`;

export const skinFileUrl = (file: string): string =>
  `${SKINS_BASE}/models/${encodeURIComponent(file)}`;

export const skinTag = (source: string): string => source.toUpperCase();
