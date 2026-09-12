// Deploys the built `dist/` to the Bunny CDN storage zone `sarp-landing` over
// the Storage HTTP API, then purges the pull-zone cache (if a key is present).
//
// Run with:  npm run deploy   (loads .env if present; in CI the same variables
//                              come from GitHub Actions secrets)
//
// Order matters for an automated pipeline: files are uploaded FIRST (overwrite
// in place) and only then are the objects that no longer exist in dist/
// deleted, so the site is never empty or half-built while deploying.
//
// Required env:
//   STORAGE_ZONE_REGION_ENDPOINT  e.g. https://br.storage.bunnycdn.com/sarp-landing
//   STORAGE_ZONE_PASSWORD         read-write storage zone access key
// Optional env (needed for the automatic cache purge):
//   BUNNY_API_KEY                 account-level API key (Bunny dashboard > Account > API)
//   BUNNY_PULLZONE_ID             numeric id of the `sarp-landing` pull zone
//   DEPLOY_DRY_RUN=1              only list what would be uploaded / deleted
//
// Never logs secret values. Without the purge key, uploads still succeed and the
// script warns you to purge manually in the Bunny dashboard.
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const DIST = fileURLToPath(new URL("../dist/", import.meta.url));
const CONCURRENCY = 8;
const DRY_RUN = process.env.DEPLOY_DRY_RUN === "1";

const endpoint = process.env.STORAGE_ZONE_REGION_ENDPOINT;
const accessKey = process.env.STORAGE_ZONE_PASSWORD;

if (!endpoint || !accessKey) {
  console.error(
    "[deploy] Missing STORAGE_ZONE_REGION_ENDPOINT or STORAGE_ZONE_PASSWORD (from .env locally, from Actions secrets in CI).",
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

/** dist-relative key with forward slashes (Windows uses backslashes). */
const relKey = (absPath) => absPath.slice(DIST.length).replace(/\\/g, "/");

async function uploadFile(absPath) {
  const rel = relKey(absPath);
  if (DRY_RUN) return rel;
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

// Lists the objects directly under a storage-zone path (relative to the zone
// root, e.g. "" or "images/"). Returns the raw Bunny objects.
async function listZone(relDir = "") {
  const url = `${storageBase}/${relDir}`;
  const res = await fetch(url, { headers: { AccessKey: accessKey } });
  if (res.status === 404) return [];
  if (!res.ok) {
    throw new Error(`list ${relDir || "/"}: ${res.status} ${res.statusText}`);
  }
  return res.json();
}

/** Every file key currently in the zone, plus every directory key ("a/b/"). */
async function listZoneRecursive(relDir = "", files = [], dirs = []) {
  for (const obj of await listZone(relDir)) {
    const path = `${relDir}${obj.ObjectName}${obj.IsDirectory ? "/" : ""}`;
    if (obj.IsDirectory) {
      dirs.push(path);
      await listZoneRecursive(path, files, dirs);
    } else {
      files.push(path);
    }
  }
  return { files, dirs };
}

async function deleteObject(path) {
  if (DRY_RUN) return path;
  const res = await fetch(`${storageBase}/${path}`, {
    method: "DELETE",
    headers: { AccessKey: accessKey },
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`delete ${path}: ${res.status} ${res.statusText}`);
  }
  return path;
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
      "\n[deploy] ⚠ Cache purge SKIPPED — set BUNNY_API_KEY and BUNNY_PULLZONE_ID to enable it.",
    );
    console.warn(
      "[deploy]   Files were uploaded, but the CDN will keep serving the cached version until you purge manually in the Bunny dashboard.",
    );
    return;
  }
  if (DRY_RUN) {
    console.log("[deploy] (dry run) would purge the pull-zone cache.");
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
  if (DRY_RUN) console.log("[deploy] DRY RUN — nothing will be written.");

  // 1) Snapshot what the zone holds now (to delete the stale part afterwards).
  let zone;
  try {
    zone = await listZoneRecursive();
  } catch (err) {
    console.error(`[deploy] ✖ Could not list the storage zone: ${err.message}`);
    process.exit(1);
  }

  // 2) Upload everything (overwrites in place; the site stays online).
  console.log(`[deploy] Uploading ${files.length} files to the storage zone…`);
  const { ok, failures } = await runPool(files, uploadFile);
  console.log(`[deploy] Uploaded ${ok}/${files.length} files.`);
  if (failures.length) {
    console.error(`[deploy] ${failures.length} upload(s) failed:`);
    failures.forEach((f) => console.error("  - " + f));
    console.error("[deploy]   Skipping the cleanup so nothing is removed on a partial deploy.");
    process.exit(1);
  }

  // 3) Remove what is no longer built (old hashed assets, deleted pages…),
  //    then any directory left empty (deepest first).
  const wanted = new Set(files.map(relKey));
  const stale = zone.files.filter((f) => !wanted.has(f));
  const wantedDirs = new Set(
    [...wanted].flatMap((f) => {
      const parts = f.split("/").slice(0, -1);
      return parts.map((_, i) => parts.slice(0, i + 1).join("/") + "/");
    }),
  );
  const staleDirs = zone.dirs
    .filter((d) => !wantedDirs.has(d))
    .sort((a, b) => b.length - a.length);
  if (stale.length || staleDirs.length) {
    console.log(
      `[deploy] Removing ${stale.length} stale file(s) and ${staleDirs.length} empty folder(s)…`,
    );
    if (DRY_RUN) [...stale, ...staleDirs].forEach((p) => console.log("  - " + p));
    const del = await runPool(stale, deleteObject);
    for (const d of staleDirs) {
      try {
        await deleteObject(d);
      } catch (err) {
        del.failures.push(err.message);
      }
    }
    if (del.failures.length) {
      console.warn(`[deploy] ⚠ ${del.failures.length} deletion(s) failed (site is still complete):`);
      del.failures.forEach((f) => console.warn("  - " + f));
    }
  } else {
    console.log("[deploy] Nothing stale to remove.");
  }

  await purgeCache();
  console.log("[deploy] Done.");
}

main();
