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

const CDN = "https://sarp-public.b-cdn.net";

export const ENDPOINTS = {
  metrics: `${CDN}/launcher/global-metrics.json`,
  events: `${CDN}/launcher/events.json`,
} as const;

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
    const res = await fetch(url, { signal: controller.signal });
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
