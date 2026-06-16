# CLAUDE.md

Landing page para SARP (San Andreas Roleplay ES).

## Tecnologías

- **Astro 5** (output estático, islands).
- **Tailwind CSS 4** vía `@tailwindcss/vite`.
- **astro-icon** con set `mdi` (`@iconify-json/mdi`).
- TypeScript en endpoints/API routes (`src/pages/api/`).

## Comandos

- `npm run dev` — servidor de desarrollo.
- `npm run build` — build estático a `dist/`.
- `npm run preview` — previsualizar el build.

## Estructura

- `src/components/` — componentes `.astro` (subcarpeta `layout/` para Header/Footer/Container).
- `src/layouts/` — layouts base.
- `src/pages/` — páginas e endpoints (`api/`).
- `src/interfaces/`, `src/services/` — tipos y lógica de acceso a datos/APIs.
- `src/styles/global.css` — estilos globales.

## Convenciones

- Componentes `.astro` en PascalCase. Endpoints en `src/pages/api/`.
- Formato con Prettier (`prettier-plugin-astro`): 2 espacios de indentación.
- Estilos con utilidades de Tailwind; evitar CSS suelto salvo en `global.css`.

## Dominio y enlaces

- La web se despliega en **gta-rol.com**, pero **todos los links apuntan a sarp.es sin excepción**.
- `gta-rol.com` está registrado en **Cloudflare**, pero sirve un bucket de **Bunny CDN (Storage)**.

## Despliegue

El build (`dist/`) se sube al **Storage Zone `sarp-landing` de Bunny CDN** y luego se **purga la caché del CDN `sarp-landing`**.

- Credenciales en `.env` (Storage Zone password / endpoint). **`.env` nunca se commitea** (está en `.gitignore`).
- Endpoint de storage: `STORAGE_ZONE_REGION_ENDPOINT` (región `br`).
- Subida directa al storage `sarp-landing`; tras subir, purgar la caché del pull zone/CDN `sarp-landing`.
