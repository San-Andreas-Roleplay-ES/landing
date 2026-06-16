// Deploys the built `dist/` to the Bunny CDN storage zone `sarp-landing` over
// the Storage HTTP API, then purges the pull-zone cache (if a key is present).
//
// Run with:  npm run deploy   (which loads .env via `node --env-file=.env`)
//
// Required env (already in .env):
//   STORAGE_ZONE_REGION_ENDPOINT  e.g. https://br.storage.bunnycdn.com/sarp-landing
//   STORAGE_ZONE_PASSWORD         read-write storage zone access key
// Optional env (NOT in .env yet — needed only for automatic cache purge):
//   BUNNY_API_KEY                 account-level API key (Bunny dashboard > Account > API)
//   BUNNY_PULLZONE_ID             numeric id of the `sarp-landing` pull zone
//
// Never logs secret values. Without the purge key, uploads still succeed and the
// script warns you to purge manually in the Bunny dashboard.
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const DIST = fileURLToPath(new URL("../dist/", import.meta.url));
const CONCURRENCY = 8;

const endpoint = process.env.STORAGE_ZONE_REGION_ENDPOINT;
const accessKey = process.env.STORAGE_ZONE_PASSWORD;

if (!endpoint || !accessKey) {
  console.error(
    "[deploy] Missing STORAGE_ZONE_REGION_ENDPOINT or STORAGE_ZONE_PASSWORD. Did you run via `npm run deploy` (which loads .env)?",
  );
  process.exit(1);
}

// endpoint = https://<host>/<zone>  ->  base for per-file PUTs (no trailing slash)
const storageBase = endpoint.replace(/\/+$/, "");

const CONTENT_TYPES = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  json: "application/json",
  xml: "application/xml",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  ico: "image/x-icon",
  txt: "text/plain; charset=utf-8",
  webmanifest: "application/manifest+json",
  woff2: "font/woff2",
};

async function listFiles(dir, base = dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const full = `${dir}${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...(await listFiles(`${full}/`, base)));
    } else {
      files.push(full);
    }
  }
  return files;
}

async function uploadFile(absPath) {
  // Build the dist-relative key with forward slashes (Windows uses backslashes).
  const rel = absPath.slice(DIST.length).replace(/\\/g, "/");
  const ext = rel.split(".").pop()?.toLowerCase() ?? "";
  const body = await readFile(absPath);
  const res = await fetch(`${storageBase}/${rel}`, {
    method: "PUT",
    headers: {
      AccessKey: accessKey,
      "Content-Type": CONTENT_TYPES[ext] ?? "application/octet-stream",
    },
    body,
  });
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`${res.status} ${res.statusText} for ${rel}`);
  }
  return rel;
}

async function runPool(items, worker) {
  let i = 0;
  let ok = 0;
  const failures = [];
  async function next() {
    while (i < items.length) {
      const idx = i++;
      try {
        await worker(items[idx]);
        ok++;
      } catch (err) {
        failures.push(err.message);
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, next));
  return { ok, failures };
}

async function purgeCache() {
  const apiKey = process.env.BUNNY_API_KEY;
  const pullZoneId = process.env.BUNNY_PULLZONE_ID;
  if (!apiKey || !pullZoneId) {
    console.warn(
      "\n[deploy] ⚠ Cache purge SKIPPED — set BUNNY_API_KEY and BUNNY_PULLZONE_ID in .env to enable it.",
    );
    console.warn(
      "[deploy]   Files were uploaded, but the CDN will keep serving the cached version until you purge manually in the Bunny dashboard.",
    );
    return;
  }
  const res = await fetch(
    `https://api.bunny.net/pullzone/${pullZoneId}/purgeCache`,
    { method: "POST", headers: { AccessKey: apiKey } },
  );
  if (!res.ok) {
    console.error(`[deploy] ⚠ Cache purge failed: ${res.status} ${res.statusText}`);
    return;
  }
  console.log("[deploy] ✓ Cache purged.");
}

async function main() {
  let files;
  try {
    files = await listFiles(DIST);
  } catch {
    console.error("[deploy] dist/ not found. Run `npm run build` first.");
    process.exit(1);
  }
  if (files.length === 0) {
    console.error("[deploy] dist/ is empty. Run `npm run build` first.");
    process.exit(1);
  }

  console.log(`[deploy] Uploading ${files.length} files to the storage zone…`);
  const { ok, failures } = await runPool(files, uploadFile);
  console.log(`[deploy] Uploaded ${ok}/${files.length} files.`);
  if (failures.length) {
    console.error(`[deploy] ${failures.length} upload(s) failed:`);
    failures.forEach((f) => console.error("  - " + f));
  }

  await purgeCache();

  if (failures.length) process.exit(1);
  console.log("[deploy] Done.");
}

main();
