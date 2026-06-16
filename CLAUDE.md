# CLAUDE.md

Landing page para SARP (San Andreas Roleplay ES).

## Tecnologías

- **Astro 5** (output estático, islands).
- **Tailwind CSS 4** vía `@tailwindcss/vite` (config en `@theme` dentro de `src/styles/global.css`; el `tailwind.config.js` en la raíz es legado y no se usa).
- **astro-icon** con set `mdi` (`@iconify-json/mdi`).
- **@astrojs/sitemap** (genera `/sitemap-index.xml`).
- TypeScript estricto.

## Comandos

- `npm run dev` — servidor de desarrollo.
- `npm run mirror-events` — descarga las imágenes de eventos a `public/images/events/`.
- `npm run build` — `prebuild` (mirror de eventos) + build estático a `dist/`.
- `npm run preview` — previsualizar el build.
- `npm run deploy` — sube `dist/` a Bunny (ver Despliegue). **Solo ejecutar cuando se pida explícitamente.**

## Estructura

- `src/components/` — componentes `.astro` (subcarpeta `layout/` para Header/Footer/Container).
- `src/components/FeatureCard.astro` — **patrón estándar de las secciones de features**: imagen full-width como header desvanecido (overlay `from-[#0d0d0d]`) + `<h2>` + texto, con props `kicker`/`href`/`ctaLabel` y slot `extras` (galería, video, etc.). Lo usan IllegalFactions, CustomSkin, EmeraldCasino, Rogue, CityGovernment.
- `src/layouts/Layout.astro` — layout base, **props-driven** (`title`, `description`, `image`, `type`, `noindex`); centraliza todo el `<head>` SEO + JSON-LD.
- `src/pages/` — páginas (one-pager: `index.astro`).
- `src/interfaces/` — tipos (`metrics.ts`, `event.ts`).
- `src/services/data.ts` — único módulo de datos (fetch build-time con fallbacks).
- `scripts/` — `mirror-events.mjs` (descarga imágenes de eventos) y `deploy.mjs`.
- `src/styles/global.css` — `@theme` (color `--color-primary`), foco visible global y `prefers-reduced-motion`.

## Convenciones

- Componentes `.astro` en PascalCase. Prettier (`prettier-plugin-astro`), 2 espacios.
- Estilos con utilidades de Tailwind; evitar CSS suelto salvo en `global.css`.
- **Marca:** primario `#FCAF17` (oro), acento `#e23b3b` (rojo claro, accesible). Tema oscuro.

## Datos en vivo (build-time, sin cliente)

- Endpoints públicos: `sarp-public.b-cdn.net/launcher/global-metrics.json` (métricas) y `…/events.json` (eventos).
- **El CDN NO envía CORS** → no se puede hacer `fetch` desde el navegador. Todo se consume en **frontmatter `.astro` (build-time)** vía `src/services/data.ts`, horneando números/eventos en el HTML (mejor para SEO). `safeFetchJson` nunca lanza y hay snapshot de fallback (no se renderizan ceros).
- **Eventos:** se muestran siempre; los pasados llevan badge **"Terminado"** (`isPast`). Las imágenes de imgur se **auto-hostean** en `public/images/events/<id>.<ext>` (mirror en `prebuild`).

## Assets / imágenes

- **Todo vive en `public/`**; en producción `dist/` queda detrás de un CDN. **Nunca** referenciar `sarp-public.b-cdn.net` ni `i.imgur.com` en el HTML: usar rutas locales `/images/...`.
- Las imágenes del email de campaña ya se descargaron a `public/images/` (`1.png`–`11.png`, logos, `discord.png`). `logo-squared.png` (logo cuadrado, usado en Header + OG/JSON-LD) y `header.png` (banner decorativo del footer, `alt=""`) también son locales.
- Toda `<img>` con `width`/`height` reales + `loading="lazy"` (salvo el LCP del hero) + `alt` descriptivo **en español**.

## SEO y accesibilidad

- **Canonical / OG / JSON-LD = `https://gta-rol.com/`** (origen servido). Todos los links de acción → `sarp.es` (registro: `https://ucp.sarp.es/auth/signup`). `sarp.es` está en `Organization.sameAs`.
- Enlaces de cuerpos oficiales (en `OfficialForces.astro`): LSPD → `police.sarp.es`, LSSD → `sheriff.sarp.es`, LSFD → foro 203, Guardia Nacional → foro topic 8497. Gobierno → foro 197. Skins → foro topic 9527.
- Un solo `<h1>` (hero); un `<h2>` por sección; `<h3>` solo para sub-ítems.
- JSON-LD en `Layout.astro` (Organization + WebSite + VideoGame por `@id`) y en `Events.astro` (Event).
- Contraste: oro para texto; **el rojo `#b41919` falla AA** → usar `#e23b3b` o como acento grande. `global.css` añade foco visible y respeta `prefers-reduced-motion` (el count-up de `Statistics` también early-return en JS).

## Dominio

- Se despliega en **gta-rol.com** (registrado en Cloudflare, sirve un bucket de **Bunny CDN Storage**), pero **todos los links apuntan a sarp.es sin excepción**.

## Despliegue (`npm run deploy` — solo a pedido)

- `scripts/deploy.mjs` (Node ESM, sin dependencias) sube cada archivo de `dist/` al **Storage Zone `sarp-landing`** vía la API HTTP de Bunny (`PUT` con header `AccessKey`), derivando host/zona de `STORAGE_ZONE_REGION_ENDPOINT`.
- Credenciales en `.env` (gitignored, **nunca se commitea**): `STORAGE_ZONE_REGION_ENDPOINT`, `STORAGE_ZONE_PASSWORD`.
- **Purga de caché pendiente:** requiere `BUNNY_API_KEY` (+ `BUNNY_PULLZONE_ID`) de nivel cuenta, **aún no presentes en `.env`**. Sin ellas el script sube y **omite el purge con advertencia**; hay que purgar manual en el dashboard de Bunny.
