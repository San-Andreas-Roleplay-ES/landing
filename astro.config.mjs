// @ts-check
import { defineConfig } from "astro/config";

import tailwindcss from "@tailwindcss/vite";

import icon from "astro-icon";

import sitemap from "@astrojs/sitemap";
import remarkDocsLinks from "./src/lib/remark-docs-links.mjs";
import { readFileSync } from "node:fs";

// Fechas de commit de las guías (src/data/docs-dates.json, generado por
// scripts/mirror-docs.mjs) para el <lastmod> del sitemap. Vacío si no existe.
/** @type {Record<string, { modified?: string; published?: string }>} */
let docsDates = {};
try {
  docsDates =
    JSON.parse(
      readFileSync(
        new URL("./src/data/docs-dates.json", import.meta.url),
        "utf8",
      ),
    ).files ?? {};
} catch {
  /* sin fechas: el sitemap sale sin lastmod para /docs */
}
const docsLastmod = Object.values(docsDates)
  .map((d) => d.modified ?? "")
  .sort()
  .at(-1);
const DOCS_URL_RE = /\/docs(?:\/([a-z0-9-]+))?\/?$/;

// https://astro.build/config
export default defineConfig({
  // The site is served from the root of gta-rol.com (Bunny CDN). Canonical and
  // sitemap URLs are built from this. All in-page action links point to sarp.es.
  site: "https://gta-rol.com",
  trailingSlash: "never",

  // /docs: los .md espejados de samp-docs traen enlaces e imágenes relativas
  // al repo; este plugin los reescribe a rutas del sitio.
  markdown: {
    remarkPlugins: [remarkDocsLinks],
  },

  vite: {
    plugins: [tailwindcss()],
    // /skins (solo dev): el bucket de Backblaze no envía CORS a localhost, así
    // que el navegador pide los artconfig y modelos a través de este proxy.
    server: {
      proxy: {
        "/_skins": {
          target: "https://sarp-public.s3.us-east-005.backblazeb2.com",
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/_skins/, "/skins"),
        },
      },
    },
  },

  integrations: [
    icon(),
    sitemap({
      serialize(item) {
        const m = item.url.match(DOCS_URL_RE);
        if (m) {
          const d = m[1] ? docsDates[m[1]]?.modified : docsLastmod;
          if (d) item.lastmod = d;
        }
        return item;
      },
    }),
  ],
});
