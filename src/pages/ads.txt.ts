import type { APIRoute } from "astro";
import { ADS } from "../data/ads";

// /ads.txt (obligatorio para AdSense): se genera a partir del ID de editor de
// src/data/ads.ts, así nunca queda desincronizado. Sin ID, solo un comentario.
export const GET: APIRoute = () => {
  const body = ADS.enabled
    ? `google.com, ${ADS.client.replace(/^ca-/, "")}, DIRECT, f08c47fec0942fa0\n`
    : "# AdSense no configurado (ver src/data/ads.ts)\n";
  return new Response(body, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
};
