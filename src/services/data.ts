import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type {
  GlobalMetrics,
  GlobalMetricsResponse,
} from "../interfaces/metrics";
import type {
  DisplayEvent,
  EventsResponse,
  ServerEvent,
} from "../interfaces/event";
import type {
  DisplayRule,
  RulesResponse,
  ServerRule,
} from "../interfaces/rule";

const CDN = "https://sarp-public.b-cdn.net";

export const ENDPOINTS = {
  metrics: `${CDN}/launcher/global-metrics.json`,
  events: `${CDN}/launcher/events.json`,
  rules: `${CDN}/launcher/rules.json`,
} as const;

/**
 * A day-granular cache-busting token (YYYYMMDD, UTC). Some feeds only change
 * once a day, so a per-second token would defeat all caching for no benefit;
 * this lets the CDN serve a cached copy within the same day. Exposed so client
 * scripts can use the exact same value.
 */
export function dailyStamp(now: number = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10).replace(/-/g, "");
}

const FETCH_TIMEOUT_MS = 5000;

/**
 * Last-known-good snapshot. Used when the endpoint is unreachable at build time
 * so the page never renders zeros. These are real values captured 2026-06-16.
 */
export const FALLBACK_METRICS: GlobalMetrics = {
  onlineAccountCounter: 0,
  weeklyPeakPlayers: 238,
  accountCounter: 11961,
  characterCounter: 13053,
  propertyCounter: 2957,
  vehicleCounter: 16198,
  factionCounter: 42,
  weaponCounter: 2981,
};

/**
 * Append a cache-busting `?t=<timestamp>` so the intermediate CDN (Bunny) can't
 * serve a stale copy of these dynamic endpoints at build time. The value is
 * fixed per build run, so every build pulls fresh metrics/events.
 */
const CACHE_BUST = String(Date.now());

function withCacheBust(url: string): string {
  const u = new URL(url);
  u.searchParams.set("t", CACHE_BUST);
  return u.toString();
}

/**
 * Resilient JSON fetch for use at build time. Never throws: returns null on
 * timeout, non-2xx, network error or parse failure, so a flaky third-party
 * endpoint can never fail the build.
 */
export async function safeFetchJson<T>(
  url: string,
  timeoutMs: number = FETCH_TIMEOUT_MS,
): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(withCacheBust(url), {
      signal: controller.signal,
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Build-time global metrics with a last-known-good fallback. */
export async function getGlobalMetrics(): Promise<{
  metrics: GlobalMetrics;
  stale: boolean;
}> {
  const res = await safeFetchJson<GlobalMetricsResponse>(ENDPOINTS.metrics);
  if (res?.data) return { metrics: res.data, stale: false };
  return { metrics: FALLBACK_METRICS, stale: true };
}

const IMAGE_EXTS = ["png", "jpg", "jpeg", "webp", "gif"] as const;

/** Resolve the mirrored local image for an event, or null if it isn't on disk. */
function resolveLocalImage(id: number): string | null {
  for (const ext of IMAGE_EXTS) {
    const rel = `images/events/${id}.${ext}`;
    const abs = fileURLToPath(new URL(`../../public/${rel}`, import.meta.url));
    if (existsSync(abs)) return `/${rel}`;
  }
  return null;
}

/** Parse "YYYY-MM-DD HH:mm:ss" (server-local) into a Date. */
function parseEventDate(raw: string): Date {
  return new Date(raw.replace(" ", "T"));
}

/**
 * Build-time events, newest-first, capped at `limit`. Every event is shown
 * (past events are flagged isPast for the "TERMINADO" badge). Returns [] only
 * when the endpoint is unreachable, so the section can hide itself.
 */
export async function getEvents(limit = 6): Promise<DisplayEvent[]> {
  const res = await safeFetchJson<EventsResponse>(ENDPOINTS.events);
  if (!res?.data?.length) return [];

  const now = Date.now();
  return [...res.data]
    .sort(
      (a, b) =>
        parseEventDate(b.event_date).getTime() -
        parseEventDate(a.event_date).getTime(),
    )
    .slice(0, limit)
    .map((e: ServerEvent) => ({
      ...e,
      localImage: resolveLocalImage(e.id),
      isPast: parseEventDate(e.event_date).getTime() < now,
    }));
}

// Last-known-good rules snapshot, refreshed on every successful build by
// scripts/mirror-rules.mjs (prebuild). Imported statically so it's bundled at
// build time and the rules page never renders empty if the CDN is unreachable.
import rulesSnapshot from "../data/rules.json";

/**
 * Normalize a rule's "keywords" field into a clean list. The feed encodes them
 * as "kw1|kw2", with dashes standing in for spaces ("chat-de-voz"). Empty in,
 * empty out. Shared with the client so build and live render identically.
 */
export function parseKeywords(raw: string): string[] {
  if (!raw) return [];
  return raw
    .split("|")
    .map((k) => k.replace(/-/g, " ").trim())
    .filter(Boolean);
}

function toDisplayRule(rule: ServerRule, i: number): DisplayRule {
  return {
    ...rule,
    index: i + 1,
    keywordList: parseKeywords(rule.keywords),
  };
}

/**
 * Build-time rules, in feed order, excluding disabled ones. Falls back to the
 * committed snapshot when the endpoint is unreachable so the page is never
 * empty. `stale` flags the fallback path.
 */
export async function getRules(): Promise<{
  rules: DisplayRule[];
  stale: boolean;
}> {
  const res = await safeFetchJson<RulesResponse>(ENDPOINTS.rules);
  const live = res?.data?.filter((r) => !r.isdisabled);
  if (live?.length) return { rules: live.map(toDisplayRule), stale: false };

  const fallback = (rulesSnapshot as RulesResponse).data
    .filter((r) => !r.isdisabled)
    .map(toDisplayRule);
  return { rules: fallback, stale: true };
}
