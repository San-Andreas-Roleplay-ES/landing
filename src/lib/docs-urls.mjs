// URL helpers shared by the remark plugin (build pipeline) and src/lib/docs.ts
// (page frontmatter). Pure functions + two readers of the mirrored folders.
//
//   sistema-x.md / docs/sistema-x.md / ./sistema-x.md   -> /docs/sistema-x
//   README.md / ../README.md                            -> /docs
//   github.com/<repo>/blob/main/docs/sistema-x.md       -> /docs/sistema-x
//   ../assets/a/b.png / assets/a/b.png                  -> /images/docs/a/b.png
//   github.com/user-attachments/assets/<id>             -> /images/docs/attachments/<id>.<ext>
//
// A link to a doc that does not exist in the snapshot (upstream typo or a
// page not merged yet) falls back to the GitHub URL instead of a dead link.
import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const REPO_URL = "https://github.com/San-Andreas-Roleplay-ES/samp-docs";

const CONTENT_DIR = fileURLToPath(new URL("../content/docs/", import.meta.url));
const ATTACHMENTS_DIR = fileURLToPath(
  new URL("../../public/images/docs/attachments/", import.meta.url),
);

/** Slugs of the mirrored docs (without extension). */
export function knownSlugs() {
  try {
    return new Set(
      readdirSync(CONTENT_DIR)
        .filter((f) => f.endsWith(".md"))
        .map((f) => f.slice(0, -3)),
    );
  } catch {
    return new Set();
  }
}

/** id -> "/images/docs/attachments/<id>.<ext>" for the attachments mirrored at prebuild. */
export function knownAttachments() {
  try {
    return new Map(
      readdirSync(ATTACHMENTS_DIR).map((f) => [
        f.replace(/\.[^.]+$/, ""),
        `/images/docs/attachments/${f}`,
      ]),
    );
  } catch {
    return new Map();
  }
}

const DOC_RE = /^(?:\.\/)?(?:docs\/)?([a-z0-9][a-z0-9-]*)\.md(#[^)]*)?$/i;
const README_RE = /^(?:\.\.\/|\.\/)?README\.md(#.*)?$/i;
const GH_DOC_RE = new RegExp(
  `^${REPO_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/blob/[^/]+/docs/([a-z0-9-]+)\\.md(#.*)?$`,
  "i",
);
const ASSET_RE = /^(?:\.\.\/|\.\/)?assets\/(.+)$/i;
const ATTACHMENT_RE =
  /^https:\/\/github\.com\/user-attachments\/assets\/([0-9a-f-]+)$/i;

export function rewriteDocUrl(url, slugs) {
  if (!url) return url;
  let m;
  if ((m = url.match(README_RE))) return `/docs${m[1] ?? ""}`;
  if ((m = url.match(DOC_RE)) || (m = url.match(GH_DOC_RE))) {
    const [, slug, hash = ""] = m;
    if (slug === "index") return `/docs${hash}`;
    return slugs.has(slug)
      ? `/docs/${slug}${hash}`
      : `${REPO_URL}/blob/main/docs/${slug}.md${hash}`;
  }
  return url;
}

export function rewriteImageUrl(url, attachments = new Map()) {
  let m;
  if ((m = url?.match(ASSET_RE))) return `/images/docs/${m[1]}`;
  if ((m = url?.match(ATTACHMENT_RE)) && attachments.has(m[1]))
    return attachments.get(m[1]);
  return url;
}
