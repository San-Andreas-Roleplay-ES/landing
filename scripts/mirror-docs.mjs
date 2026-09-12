// Mirrors the public documentation repo (San-Andreas-Roleplay-ES/samp-docs)
// into this project so Astro can render it at /docs as static HTML:
//
//   README.md        -> src/content/docs/index.md      (/docs)
//   docs/<slug>.md   -> src/content/docs/<slug>.md     (/docs/<slug>)
//   assets/**        -> public/images/docs/**          (self-hosted images)
//   GitHub uploads   -> public/images/docs/attachments/<id>.<ext>
//   commit dates     -> src/data/docs-dates.json       (SEO: dateModified,
//                                                       sitemap lastmod)
//
// One request for the content: the tarball of `main` from codeload (no token,
// no API rate limit), unpacked with a minimal ustar reader (no dependencies).
// Runs in `prebuild` (with --dates) and `predev`. Nothing here is committed
// (see .gitignore): on a download error an existing local mirror is kept;
// with no mirror at all the build fails loudly rather than shipping a site
// without /docs.
import { existsSync, readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const REPO = "San-Andreas-Roleplay-ES/samp-docs";
const BRANCH = "main";
const TARBALL = `https://codeload.github.com/${REPO}/tar.gz/${BRANCH}`;
const FORCE_DATES = process.argv.includes("--dates");

const CONTENT_DIR = fileURLToPath(
  new URL("../src/content/docs/", import.meta.url),
);
const ASSETS_DIR = fileURLToPath(
  new URL("../public/images/docs/", import.meta.url),
);
const DATES_FILE = fileURLToPath(
  new URL("../src/data/docs-dates.json", import.meta.url),
);

/** Read a NUL-terminated field from a tar header. */
function field(header, start, length) {
  return header
    .toString("utf8", start, start + length)
    .replace(/\0[\s\S]*$/, "");
}

/** Iterate regular files in a (gunzipped) ustar archive. */
function* tarFiles(tar) {
  let off = 0;
  while (off + 512 <= tar.length) {
    const header = tar.subarray(off, off + 512);
    if (header.every((b) => b === 0)) break;
    const name = field(header, 0, 100);
    const size = parseInt(field(header, 124, 12).trim() || "0", 8);
    const type = String.fromCharCode(header[156]);
    const prefix = field(header, 345, 155);
    const path = prefix ? `${prefix}/${name}` : name;
    const dataStart = off + 512;
    off = dataStart + Math.ceil(size / 512) * 512;
    // "0" / NUL = regular file. Skip dirs, pax headers, long-name records…
    if (type !== "0" && type !== "\0") continue;
    yield { path, data: tar.subarray(dataStart, dataStart + size) };
  }
}

/**
 * The README doubles as the /docs index. Its GitHub-only chrome (centered
 * logo block, badges, the "read this on the website" pointer) adds nothing on
 * the website itself, so it is stripped here; everything else is verbatim.
 */
function cleanReadme(md) {
  return md
    .replace(/<div align="center">[\s\S]*?<\/div>\s*/i, "")
    .replace(
      /^(?:\[?!\[[^\]]*\]\([^)]*(?:shields\.io|discord\.com\/api\/guilds)[^)]*\)\]?(?:\([^)]*\))?\s*)+$/gm,
      "",
    )
    .replace(/^>?.*gta-rol\.com\/docs.*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trimStart();
}

async function main() {
  let tar;
  try {
    const res = await fetch(TARBALL, { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    tar = gunzipSync(Buffer.from(await res.arrayBuffer()));
  } catch (err) {
    return bail(`could not download ${TARBALL} (${err.message})`);
  }

  const docs = [];
  const assets = [];
  let readme = null;
  for (const { path, data } of tarFiles(tar)) {
    // Strip the top-level "<repo>-<branch>/" folder.
    const rel = path.replace(/^[^/]+\//, "");
    if (rel === "README.md") readme = data.toString("utf8");
    else if (/^docs\/[^/]+\.md$/.test(rel))
      docs.push({ rel: rel.slice(5), data });
    else if (/^assets\//.test(rel)) assets.push({ rel: rel.slice(7), data });
  }

  if (!readme || docs.length === 0) {
    return bail("tarball had no README/docs");
  }

  // Clean replacement so docs deleted upstream disappear here too.
  await rm(CONTENT_DIR, { recursive: true, force: true });
  await rm(ASSETS_DIR, { recursive: true, force: true });
  await mkdir(CONTENT_DIR, { recursive: true });
  await mkdir(ASSETS_DIR, { recursive: true });

  await writeFile(`${CONTENT_DIR}index.md`, cleanReadme(readme));
  for (const d of docs) await writeFile(`${CONTENT_DIR}${d.rel}`, d.data);
  for (const a of assets) {
    const dest = `${ASSETS_DIR}${a.rel}`;
    await mkdir(dest.slice(0, dest.lastIndexOf("/")), { recursive: true });
    await writeFile(dest, a.data);
  }
  const attached = await mirrorAttachments([
    readme,
    ...docs.map((d) => d.data.toString("utf8")),
  ]);
  console.log(
    `[mirror-docs] ${docs.length} docs + README, ${assets.length} assets, ${attached} GitHub attachments mirrored from ${REPO}@${BRANCH}.`,
  );

  await mirrorDates(["README.md", ...docs.map((d) => `docs/${d.rel}`)]);
}

// Images uploaded through the GitHub editor live on github.com/user-attachments
// (not in the repo). They are fetched once here and self-hosted under
// public/images/docs/attachments/<id>.<ext>; the remark plugin rewrites the
// URLs. A failed download just leaves that image hotlinked.
const ATTACHMENT_RE =
  /https:\/\/github\.com\/user-attachments\/assets\/([0-9a-f-]+)/g;
const EXT_BY_TYPE = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

async function mirrorAttachments(markdowns) {
  const ids = new Set();
  for (const md of markdowns)
    for (const m of md.matchAll(ATTACHMENT_RE)) ids.add(m[1]);
  if (ids.size === 0) return 0;
  const dir = `${ASSETS_DIR}attachments/`;
  await mkdir(dir, { recursive: true });
  let ok = 0;
  const queue = [...ids];
  const worker = async () => {
    for (let id = queue.shift(); id; id = queue.shift()) {
      try {
        const res = await fetch(
          `https://github.com/user-attachments/assets/${id}`,
          { redirect: "follow" },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const ext =
          EXT_BY_TYPE[(res.headers.get("content-type") || "").split(";")[0]];
        if (!ext) throw new Error("not an image");
        await writeFile(
          `${dir}${id}.${ext}`,
          Buffer.from(await res.arrayBuffer()),
        );
        ok++;
      } catch (err) {
        console.warn(`[mirror-docs] attachment ${id} skipped (${err.message})`);
      }
    }
  };
  await Promise.all(Array.from({ length: 4 }, worker));
  return ok;
}

// Per-file first/last commit dates via the GitHub API (one request per file,
// up to 100 commits each). Unauthenticated the limit is 60 requests/hour per
// IP, so the result is cached in src/data/docs-dates.json and only refreshed
// with --dates (prebuild) or when the cache is older than 6 h. Set
// GITHUB_TOKEN (e.g. in CI) for a 5 000/h limit. Never fails the build: on
// error the previous cache is kept, and without any cache the pages simply
// carry no dates.
const DATES_MAX_AGE_MS = 6 * 60 * 60 * 1000;

function readDatesCache() {
  try {
    return JSON.parse(readFileSync(DATES_FILE, "utf8"));
  } catch {
    return null;
  }
}

async function mirrorDates(paths) {
  const cache = readDatesCache();
  const fresh =
    cache?.fetchedAt &&
    Date.now() - Date.parse(cache.fetchedAt) < DATES_MAX_AGE_MS;
  if (!FORCE_DATES && fresh) {
    console.log("[mirror-docs] commit dates: using cached copy.");
    return;
  }
  const headers = {
    Accept: "application/vnd.github+json",
    "User-Agent": "sarp-landing-mirror",
  };
  if (process.env.GITHUB_TOKEN)
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;

  const files = {};
  const queue = [...paths];
  let failed = null;
  const worker = async () => {
    for (let p = queue.shift(); p && !failed; p = queue.shift()) {
      const url = `https://api.github.com/repos/${REPO}/commits?sha=${BRANCH}&per_page=100&path=${encodeURIComponent(p)}`;
      const res = await fetch(url, { headers });
      if (!res.ok) {
        failed = `HTTP ${res.status} for ${p}`;
        return;
      }
      const commits = await res.json();
      if (!Array.isArray(commits) || commits.length === 0) continue;
      const key = p === "README.md" ? "index" : p.slice(5, -3);
      files[key] = {
        modified: commits[0].commit.committer.date,
        published: commits[commits.length - 1].commit.committer.date,
      };
    }
  };
  try {
    await Promise.all(Array.from({ length: 3 }, worker));
    if (failed) throw new Error(failed);
  } catch (err) {
    console.warn(
      `[mirror-docs] commit dates not refreshed (${err.message}); ${cache ? "keeping the previous cache." : "pages will carry no dates."}`,
    );
    return;
  }
  await mkdir(
    DATES_FILE.slice(0, DATES_FILE.lastIndexOf("/") + 1).replace(
      /[/\\][^/\\]*$/,
      "",
    ),
    { recursive: true },
  ).catch(() => {});
  await writeFile(
    DATES_FILE,
    JSON.stringify(
      {
        fetchedAt: new Date().toISOString(),
        repo: REPO,
        branch: BRANCH,
        files,
      },
      null,
      2,
    ),
  );
  console.log(
    `[mirror-docs] commit dates refreshed for ${Object.keys(files).length} files.`,
  );
}

/** Keep a previous local mirror if there is one; otherwise abort the build. */
async function bail(reason) {
  if (existsSync(`${CONTENT_DIR}index.md`)) {
    console.warn(`[mirror-docs] ${reason}; keeping the existing local mirror.`);
    return;
  }
  console.error(
    `[mirror-docs] ${reason} and there is no local mirror: /docs cannot be built.`,
  );
  process.exit(1);
}

main().catch((err) => bail(err.message));
