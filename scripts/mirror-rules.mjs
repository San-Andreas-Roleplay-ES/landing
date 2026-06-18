// Downloads rules.json (hosted on the CDN) into src/data/rules.json so the
// build has a last-known-good local fallback and never renders an empty rules
// page if the endpoint is unreachable. Run before `astro build`: npm run prebuild
//
// Never fails the build: on any error it keeps whatever snapshot is already on
// disk. The committed snapshot is the floor; each successful build refreshes it.
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const RULES_URL = "https://sarp-public.b-cdn.net/launcher/rules.json";
const OUT_DIR = fileURLToPath(new URL("../src/data/", import.meta.url));
const OUT_FILE = `${OUT_DIR}rules.json`;

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  try {
    // Cache-bust so Bunny can't serve a stale rules.json at build time.
    const res = await fetch(`${RULES_URL}?t=${Date.now()}`, {
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    if (!Array.isArray(json?.data)) throw new Error("unexpected shape");
    await writeFile(OUT_FILE, JSON.stringify(json), "utf8");
    console.log(`[mirror-rules] saved ${json.data.length} rules.`);
  } catch (err) {
    console.warn(
      `[mirror-rules] could not refresh rules.json (${err.message}); keeping existing snapshot.`,
    );
  }
}

main();
