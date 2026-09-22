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
- `src/components/HeroMosaic.astro` — **hero "bento"** (LCP, sin `data-reveal`): celda de marca (único `<h1>`, CTAs, IP, cifra en vivo) + una celda-teaser por sección enlazada por ancla (`href="#id"`, `data-tile`). Miniaturas WebP en `public/images/tiles/` generadas por `scripts/make-tiles.mjs` (prebuild; `npm run tiles`). La celda "Eventos" usa el arte del último evento. Incluye marquesina y tilt 3D (solo puntero fino).
- `src/components/StickyCta.astro` — barra fija inferior (solo `<lg`) con "Crear cuenta gratis" + Discord; aparece al salir el hero y se oculta en `#empezar`. **Un solo verbo de conversión en toda la página: "Crear cuenta gratis"** (header, hero, tarjetas, barra, CTA final).
- `src/data/sections.ts` — lista de secciones (id, label, kicker, tile) compartida por el hero, `SectionNav.astro` (puntos laterales, solo `lg+`) y GA4. **Si añades una sección de features, añádela aquí y pásale `id` al `FeatureCard`.**
- `src/components/FeatureCard.astro` — **patrón estándar de las secciones de features**: imagen full-width como header desvanecido (overlay `from-[#0d0d0d]`, parallax scroll-driven) + `<h2>` + texto, con props `id`/`kicker`/`href`/`ctaLabel` y slot `extras` (galería, video, etc.). **Cada tarjeta lleva el CTA primario "Crear cuenta gratis"**; `href`/`ctaLabel` es el enlace informativo secundario. Lo usan IllegalFactions, OfficialForces, EmeraldCasino, CityGovernment, CustomSkin, Rogue, RulesPromo.
- `src/layouts/Layout.astro` — el fondo de gang tags es un `<div>` `fixed -z-10` propio, **no** `bg-fixed` en el `<body>` (`background-attachment: fixed` obliga a repintar en cada frame de scroll y en iOS ni se respeta). Layout base, **props-driven** (`title`, `description`, `image`, `type`, `noindex`); centraliza todo el `<head>` SEO + JSON-LD.
- `src/pages/` — páginas: one-pager `index.astro`, `reglas.astro` y **`docs/`** (`index.astro` = README del repo de docs, `[slug].astro` = una página por `docs/<slug>.md`).
- **`/docs` (documentación espejada):** `scripts/mirror-docs.mjs` (en `predev` y `prebuild`, `npm run mirror-docs`) descarga el tarball de `San-Andreas-Roleplay-ES/samp-docs` y lo vuelca en `src/content/docs/` (README → `index.md`) y `public/images/docs/` (assets + adjuntos de GitHub `user-attachments`). **Ambas carpetas están en `.gitignore`: la fuente de verdad es ese repo**; sin descarga y sin copia local el build falla a propósito. Colección `docs` en `src/content.config.ts` (glob, sin frontmatter); `src/lib/docs.ts` saca título (primer `#`), descripción (primer párrafo) y agrupa el índice (Empezar / Facciones / Sistemas); `src/lib/remark-docs-links.mjs` (registrado en `astro.config.mjs`) reescribe enlaces `x.md` → `/docs/x`, `README.md` → `/docs`, `../assets/…` → `/images/docs/…` (si el doc no existe, cae al blob de GitHub). `src/layouts/DocsLayout.astro` = índice lateral con filtro, TOC (xl), anclas en encabezados, botón copiar en `<pre>`, anterior/siguiente, JSON-LD TechArticle + BreadcrumbList, enlace "Mejorar en GitHub". Estilos en `.docs-prose` (`global.css`). Título SEO: `<Título> · Guía de San Andreas Roleplay` (≤ 60 chars). **SEO extra:** `mirror-docs.mjs --dates` (prebuild) guarda en `src/data/docs-dates.json` (gitignored; caché 6 h; `GITHUB_TOKEN` opcional) el primer/último commit de cada guía → `datePublished`/`dateModified`, `article:*_time` y `<lastmod>` del sitemap (`astro.config.mjs`). El plugin remark convierte cada imagen en `<img>` con `width`/`height` reales (sharp), `loading="lazy"` salvo la primera y `alt` descriptivo si el autor puso uno genérico. `og:image` = primera imagen de la guía. JSON-LD lleva `articleSection`, `keywords` (los `/comandos` citados) y `wordCount`. Bloque "Guías relacionadas" (mismo grupo, rotado) al pie de cada guía y sección `DocsTeaser.astro` (`#guias`) en la portada con 6 guías destacadas. El README de samp-docs enlaza a gta-rol.com/docs (la línea se elimina al espejar).
- **`/skins` (galería de skins 3D):** `src/pages/skins.astro` + `src/lib/skins/`. Los datos viven en el bucket público de **Backblaze B2** (`https://sarp-public.s3.us-east-005.backblazeb2.com/skins`, **no Bunny**; es la excepción a la regla de no referenciar hosts externos): `<fuente>.txt` = artconfig (solo se leen las líneas `AddCharModel`) y `models/` = los `.dff`/`.txd` sueltos. El bucket no deja listar sin credenciales → **cada .txt se declara en `SKIN_SOURCES` (`src/data/skins.ts`)**; la etiqueta es el nombre en mayúsculas (`gtac.txt` → GTAC). Una fuente declarada que aún no existe (404) cuenta como vacía y su chip se oculta. **Multi-etiqueta por diseño:** `mergeSkins` (`artconfig.ts`) une las fuentes por pareja dff+txd; la misma pareja en varios .txt es una sola tarjeta con todas sus etiquetas (el filtro de etiquetas es un O lógico). Nombre del skin = `baseid` (primer argumento; se repite). El catálogo se carga **en vivo en el navegador** (`gallery.ts`: buscador por ID / rango `100-150` / archivo / etiqueta, estado en la URL `?q=&tag=&orden=&skin=`, grid virtualizado sobre el scroll de la página, cola de carga LIFO, caché LRU de archivos, descarga de la pareja en un ZIP sin compresión con `zip.ts`, eventos GA4 `skin_download`/`skin_view`/`skin_filter`); en build solo se hornean los recuentos. `viewer.ts` + `sharedRenderer.ts` + `modelBuilder.ts` + `parsers/` (three.js 0.149 **fijado**: el código usa `outputEncoding`) vienen de `samp-models-viewer` y se cargan con `import()` dinámico (chunk aparte de ~440 KB). Un solo contexto WebGL pinta todas las tarjetas. **Orientación:** cada exportador deja los vértices en un espacio distinto; `restPoseTransform` (`parsers/dff.ts`) coloca el modelo de pie y de frente a partir de las matrices inversas del Skin PLG (cabeza/pies/muslos), no de los frames. **Rendimiento del scroll (no romper):** la descarga de los .dff/.txd, su parseo, la decodificación DXT y la caja envolvente corren en **Web Workers** (`modelWorker.ts` + `modelData.ts`, sin three ni DOM; `viewer.ts` reparte cada skin siempre al mismo worker para aprovechar su caché); el hilo principal solo ensambla (`modelBuilder.ts`), como mucho un modelo por frame y nunca mientras el scroll va rápido (`nextBuildTurn`), y libera la GPU en ratos libres (`disposeLater`). Las tarjetas **no usan OrbitControls** (registra un listener de rueda no pasivo por canvas → el navegador espera al hilo principal para desplazar): llevan un giro propio con listeners pasivos + `touch-pan-y`; OrbitControls solo en el `<dialog>`. Tarjetas en posición absoluta con `transform` propio y `contain` (entrar/salir no recoloca a las demás), posición del grid en caché (`hostTop`, nada de `getBoundingClientRect` por frame), tamaño del canvas vía `ResizeObserver` (no `clientWidth` al pintar), `renderer.setSize` solo si cambia el tamaño (three realoja el buffer siempre) y `frustumCulled = false`. El buscador fijo va sin `backdrop-blur`. Medir con Playwright + GPU real (`--use-angle=d3d11`), CPU ×4 y contra el build (`astro preview`), no contra dev: la auditoría a11y de la barra de Astro mete tareas largas propias. **Texturas (`modelBuilder.ts` + `parsers/txd.ts` + `parsers/dxt.ts`):** los TXD guardan la imagen de arriba abajo igual que las UV de D3D → **`flipY = false` siempre** (WebGL solo voltea las texturas sin comprimir: con `flipY` las RGBA/paletizadas de los skins originales salían invertidas respecto a las DXT). DXT va comprimido a la GPU solo si hay `WEBGL_compressed_texture_s3tc` **y** `_s3tc_srgb` y el tamaño es múltiplo de 4; si no (casi todo móvil) se decodifica por CPU con `decodeDxt`. Se conservan los mipmaps del archivo (solo se usan si la cadena llega a 1×1, o la textura sale negra), las tarjetas limitan la textura a 512 px, solo se construyen las texturas que usa algún material, y las que declaran alfa se recortan con `alphaTest`. Tarjetas: giro horizontal tipo tornamesa con `touch-action: pan-y` (el scroll vertical sigue funcionando en móvil); clic/expandir abre el `<dialog>` con órbita libre, zoom y ← →. **CORS:** el bucket debe tener una regla CORS (`s3_get`, `s3_head`) para `https://gta-rol.com`; en `npm run dev` el navegador usa el proxy de Vite `/_skins` (`astro.config.mjs`). Huecos de anuncios: `skinsTop` (entre cabecera y buscador) y `skinsBottom`.
- `src/interfaces/` — tipos (`metrics.ts`, `event.ts`).
- `src/services/data.ts` — único módulo de datos (fetch build-time con fallbacks).
- `scripts/` — `mirror-events.mjs` (descarga imágenes de eventos), `make-tiles.mjs` (miniaturas del hero vía `sharp`) y `deploy.mjs`.
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
- **Scroll-reveal (SEO-safe):** las secciones aparecen con fade-up al entrar en viewport. El contenido es **visible por defecto**; el estado oculto (`.js-reveal [data-reveal]` en `global.css`) SOLO aplica cuando el script de `Layout.astro` añade `js-reveal` a `<html>` en runtime. Sin JS / con `prefers-reduced-motion` → todo visible sin animar. Para animar una sección nueva, añade `data-reveal` a su `<section>` raíz (los componentes con `FeatureCard` ya lo heredan). El hero (`HeroMosaic.astro`) NO se marca (es el LCP).
- **Spotlight (una a una):** los elementos con `data-spotlight` (el `article` de `FeatureCard`, el bloque de `Events`) solo se ven al 100 % cuando cruzan la franja central del viewport; el resto queda atenuado. Igual que el reveal, solo aplica bajo `.js-reveal`. `section:target` hace un flash al llegar desde una ancla.
- **GA4 (script de `Layout.astro`):** `section_view` (id de sección al revelarse), `tile_click` (celda del mosaico) y `cta_click` (`signup`/`discord`/`connect` + sección de origen).

## Publicidad (Google AdSense)

- Config en **`src/data/ads.ts`** (`CLIENT` = `ca-pub-…`, un ID de bloque por hueco). IDs públicos, se commitean. Con `CLIENT` vacío no se emite nada de Google y los huecos no ocupan espacio; en `npm run dev` se ven como cajas punteadas.
- **`AdSlot.astro`** reserva la altura por container queries (`.ad-banner` en `global.css`: 320×100 / 468×60 / 728×90) → CLS 0. Huecos: `heroBottom` (HeroMosaic, entre el mosaico y la marquesina, para no empujar el hero), `homeRules` (antes de RulesPromo), `homeBottom` (tras FinalCta), `docsTop` (antes de la tarjeta de cada guía), `docsBottom` (tras FinalCta en docs), `rulesTop` (tras la cabecera de /reglas), `rulesBottom` (tras FinalCta en /reglas), `skinsTop` / `skinsBottom` (/skins, ver Estructura). **`AdRail.astro`** (`sideRail`, un solo bloque para las tres páginas): rascacielos 160×600 / 300×600 fijo en el margen derecho, solo si el margen libre lo admite (umbrales por ancho de columna en `.ad-rail--home/docs/rules`, y alto ≥ 720 px); en ≥ 1600 px los puntos de `SectionNav` pasan al margen izquierdo. El script `adsbygoogle.js` se inyecta en `Layout.astro` solo si está habilitado.
- `/ads.txt` lo genera `src/pages/ads.txt.ts` desde el mismo ID. `/privacidad` (obligatoria para AdSense; también cubre GA4) enlazada en el footer. El aviso de consentimiento RGPD lo sirve el propio script de AdSense si en la cuenta está activado **Privacidad y mensajes**.

## Dominio

- Se despliega en **gta-rol.com** (registrado en Cloudflare, sirve un bucket de **Bunny CDN Storage**), pero **todos los links apuntan a sarp.es sin excepción**.

## Despliegue (`npm run deploy` — solo a pedido; en CI es automático)

- **CI (`.github/workflows/deploy.yml`):** construye y despliega a Bunny en cada push a `main`, cuando samp-docs envía un `repository_dispatch` `docs-updated` (workflow `rebuild-landing.yml` en ese repo, que necesita el secreto `LANDING_DISPATCH_TOKEN`), a mano, y a diario a las 05:17 UTC. Secretos en landing: `STORAGE_ZONE_REGION_ENDPOINT`, `STORAGE_ZONE_PASSWORD`, `BUNNY_API_KEY`, `BUNNY_PULLZONE_ID`. Un despliegue a la vez (`concurrency`). Los workflows antiguos de GitHub Pages se eliminaron.
- El script **sube primero y borra después** lo que ya no existe en `dist/` (el sitio nunca queda vacío); `DEPLOY_DRY_RUN=1` solo lista lo que haría. `npm run deploy` carga `.env` si existe (`--env-file-if-exists`, Node ≥ 22.9).

- `scripts/deploy.mjs` (Node ESM, sin dependencias) sube cada archivo de `dist/` al **Storage Zone `sarp-landing`** vía la API HTTP de Bunny (`PUT` con header `AccessKey`), derivando host/zona de `STORAGE_ZONE_REGION_ENDPOINT`.
- Credenciales en `.env` (gitignored, **nunca se commitea**): `STORAGE_ZONE_REGION_ENDPOINT`, `STORAGE_ZONE_PASSWORD`.
- **Purga de caché pendiente:** requiere `BUNNY_API_KEY` (+ `BUNNY_PULLZONE_ID`) de nivel cuenta, **aún no presentes en `.env`**. Sin ellas el script sube y **omite el purge con advertencia**; hay que purgar manual en el dashboard de Bunny.
