// Downloads the event images referenced in events.json (hosted on imgur) into
// public/images/events/<id>.<ext> so the site self-hosts them instead of
// hotlinking a third party. Run before `astro build`:  npm run prebuild
//
// Idempotent: skips images already present. Never fails the build — a missing
// image just means that event card renders without art.
import { mkdir, writeFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const EVENTS_URL = "https://sarp-public.b-cdn.net/launcher/events.json";
const OUT_DIR = fileURLToPath(new URL("../public/images/events/", import.meta.url));

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  let events;
  try {
    const res = await fetch(EVENTS_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    events = (await res.json()).data ?? [];
  } catch (err) {
    console.warn(`[mirror-events] could not fetch events.json (${err.message}); skipping.`);
    return;
  }

  let downloaded = 0;
  for (const e of events) {
    const ext = (e.image_url.split(".").pop().split("?")[0] || "png").toLowerCase();
    const dest = `${OUT_DIR}${e.id}.${ext}`;
    if (await exists(dest)) continue;
    try {
      const res = await fetch(e.image_url, { headers: { "User-Agent": "Mozilla/5.0" } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      await writeFile(dest, buf);
      downloaded++;
      console.log(`[mirror-events] saved ${e.id}.${ext} (${(buf.length / 1024) | 0}KB)`);
    } catch (err) {
      console.warn(`[mirror-events] failed ${e.id}: ${err.message}`);
    }
  }
  console.log(`[mirror-events] done — ${downloaded} new, ${events.length} total.`);
}

main();
