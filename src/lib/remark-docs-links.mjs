// Remark plugin for the mirrored samp-docs Markdown (registered in
// astro.config.mjs). Two jobs:
//
// 1. Links: rewrite relative doc/asset/GitHub URLs to site routes (see
//    docs-urls.mjs).
// 2. Images (SEO / Core Web Vitals): every image becomes a full <img> with
//    real width/height (read from the self-hosted file with sharp, so no
//    layout shift), loading="lazy" + decoding="async" for all but the first
//    image of the page, and a descriptive alt when the author left none or a
//    generic one ("image", "captura", a file name…): the alt then becomes
//    "<guide title>: <nearest heading>".
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  knownAttachments,
  knownSlugs,
  rewriteDocUrl,
  rewriteImageUrl,
} from "./docs-urls.mjs";

const PUBLIC_DIR = fileURLToPath(new URL("../../public/", import.meta.url));
const GENERIC_ALT =
  /^(?:|image|imagen|img|screenshot|captura(?: de pantalla)?|foto|photo|picture|[\w-]+\.(?:png|jpe?g|gif|webp))$/i;

const sizeCache = new Map();
/** {width,height} of a self-hosted image (/images/docs/…), or null. */
async function localImageSize(url) {
  if (!url?.startsWith("/images/docs/")) return null;
  if (sizeCache.has(url)) return sizeCache.get(url);
  let size = null;
  try {
    const { width, height } = await sharp(
      readFileSync(`${PUBLIC_DIR}${url.slice(1)}`),
    ).metadata();
    if (width && height) size = { width, height };
  } catch {
    /* missing or unreadable image: leave it without dimensions */
  }
  sizeCache.set(url, size);
  return size;
}

function mdText(node) {
  if (typeof node.value === "string") return node.value;
  return (node.children ?? []).map(mdText).join("");
}

const esc = (s) =>
  String(s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");

function betterAlt(alt, title, heading) {
  const a = (alt ?? "").trim();
  if (!GENERIC_ALT.test(a)) return a;
  return heading && heading !== title ? `${title}: ${heading}` : title;
}

async function imgTag({ src, alt, width, height, index, title, heading }) {
  const size = width && height ? { width, height } : await localImageSize(src);
  const attrs = [
    `src="${esc(src)}"`,
    `alt="${esc(betterAlt(alt, title, heading))}"`,
  ];
  if (size) attrs.push(`width="${size.width}"`, `height="${size.height}"`);
  attrs.push(`loading="${index === 0 ? "eager" : "lazy"}"`, `decoding="async"`);
  return `<img ${attrs.join(" ")} />`;
}

/** Rewrite every <img …> inside a raw HTML block. */
async function rewriteHtmlImages(html, ctx) {
  const tags = [...html.matchAll(/<img\b[^>]*>/gi)];
  if (tags.length === 0) return html;
  let out = "";
  let last = 0;
  for (const m of tags) {
    const tag = m[0];
    const attr = (name) =>
      tag.match(new RegExp(`\\s${name}=["']([^"']*)["']`, "i"))?.[1];
    const src = rewriteImageUrl(attr("src") ?? "", ctx.attachments);
    const replacement = await imgTag({
      src,
      alt: attr("alt"),
      width: attr("width"),
      height: attr("height"),
      index: ctx.imgIndex++,
      title: ctx.title,
      heading: ctx.heading,
    });
    out += html.slice(last, m.index) + replacement;
    last = m.index + tag.length;
  }
  return out + html.slice(last);
}

export default function remarkDocsLinks() {
  const slugs = knownSlugs();
  const attachments = knownAttachments();

  return async (tree) => {
    const ctx = { title: "", heading: "", imgIndex: 0, attachments };
    // Depth-first, in document order, so "nearest heading" is right.
    const visit = async (node, parent, index) => {
      if (node.type === "heading") {
        const t = mdText(node).trim();
        if (node.depth === 1 && !ctx.title) ctx.title = t;
        else ctx.heading = t;
      } else if (node.type === "link" || node.type === "definition") {
        node.url = rewriteDocUrl(node.url, slugs);
      } else if (node.type === "image") {
        const src = rewriteImageUrl(node.url, attachments);
        const html = await imgTag({
          src,
          alt: node.alt,
          index: ctx.imgIndex++,
          title: ctx.title,
          heading: ctx.heading,
        });
        parent.children[index] = { type: "html", value: html };
        return; // replaced: no children to visit
      } else if (node.type === "html" && typeof node.value === "string") {
        node.value = node.value.replace(
          /\shref="([^"]+)"/g,
          (_, val) => ` href="${rewriteDocUrl(val, slugs)}"`,
        );
        node.value = await rewriteHtmlImages(node.value, ctx);
      }
      if (node.children) {
        for (let i = 0; i < node.children.length; i++) {
          await visit(node.children[i], node, i);
        }
      }
    };
    await visit(tree, null, 0);
  };
}
