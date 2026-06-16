// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

import icon from 'astro-icon';

import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  // The site is served from the root of gta-rol.com (Bunny CDN). Canonical and
  // sitemap URLs are built from this. All in-page action links point to sarp.es.
  site: 'https://gta-rol.com',
  trailingSlash: 'never',

  vite: {
    plugins: [tailwindcss()]
  },

  integrations: [icon(), sitemap()]
});
