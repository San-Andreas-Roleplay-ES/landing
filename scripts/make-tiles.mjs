// Generates the lightweight WebP thumbnails used by the hero mosaic
// (public/images/tiles/). The source screenshots in public/images are 1-3 MB
// PNGs; eight of them above the fold would be unacceptable, so we render each
// one as a 4:3 "attention"-cropped WebP in two widths (480 / 960) for srcset.
//
// Also thumbnails every mirrored event image (public/images/events/*) so the
// "Eventos" tile can show the latest event art. Runs in `prebuild` after
// mirror-events. Idempotent: skips outputs that already exist.
import { mkdir, readdir, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const IMAGES = fileURLToPath(new URL("../public/images/", import.meta.url));
const OUT = `${IMAGES}tiles/`;
const WIDTHS = [480, 960];

/** name -> source file (relative to public/images) */
const TILES = {
  facciones: "2.png",
  departamentos: "15.png",
  casino: "5.png",
  gobierno: "16.png",
  skins: "1.png",
  pasarelas: "18.png",
  reglas: "19.png",
};

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function render(src, destBase) {
  let made = 0;
  for (const w of WIDTHS) {
    const dest = `${destBase}-${w}.webp`;
    if (await exists(dest)) continue;
    await sharp(src)
      .resize(w, Math.round((w * 3) / 4), {
        fit: "cover",
        position: sharp.strategy.attention,
      })
      .webp({ quality: 78 })
      .toFile(dest);
    made++;
  }
  return made;
}

async function main() {
  await mkdir(`${OUT}events/`, { recursive: true });
  let made = 0;

  for (const [name, file] of Object.entries(TILES)) {
    made += await render(`${IMAGES}${file}`, `${OUT}${name}`);
  }

  let eventFiles = [];
  try {
    eventFiles = await readdir(`${IMAGES}events/`);
  } catch {
    /* no mirrored events yet */
  }
  for (const f of eventFiles) {
    if (!/\.(png|jpe?g|webp|gif)$/i.test(f)) continue;
    const id = f.replace(/\.[^.]+$/, "");
    try {
      made += await render(`${IMAGES}events/${f}`, `${OUT}events/${id}`);
    } catch (err) {
      console.warn(`[make-tiles] skipped event ${f}: ${err.message}`);
    }
  }

  console.log(`[make-tiles] ${made} thumbnail(s) generated.`);
}

main().catch((err) => {
  // Never fail the build: the mosaic falls back to the full-size images.
  console.warn(`[make-tiles] ${err.message}`);
});
