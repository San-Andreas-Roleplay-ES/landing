import { defineCollection } from "astro:content";
import { glob } from "astro/loaders";

// Documentación pública (espejo de San-Andreas-Roleplay-ES/samp-docs, ver
// scripts/mirror-docs.mjs). Los .md no llevan frontmatter: el título se toma
// del primer `#` y la descripción del primer párrafo (src/lib/docs.ts).
const docs = defineCollection({
  loader: glob({ pattern: "**/*.md", base: "./src/content/docs" }),
});

export const collections = { docs };
