// Web Worker: descarga, parsea y prepara los skins fuera del hilo principal
// para que el scroll de la galería no dé tirones mientras llegan los modelos.
// Los .dff/.txd (≈2 MB por skin) nunca pisan el hilo principal: ni su fetch,
// ni su copia, ni su recogida de basura.

import { prepareModel, transferables, type PrepareOptions } from "./modelData";

export interface PrepareRequest {
  id: number;
  dffUrl: string;
  txdUrl: string;
  opts: PrepareOptions;
}

export type PrepareResponse =
  | { id: number; model: ReturnType<typeof prepareModel> }
  | { id: number; error: string; missing: boolean };

class MissingFileError extends Error {}

// Caché pequeña: abrir el visor ampliado de una tarjeta recién vista no vuelve
// a descargar nada (viewer.ts manda cada skin siempre al mismo worker).
const CACHE_SIZE = 24;
const cache = new Map<string, Promise<ArrayBuffer>>();

export function fetchFile(url: string): Promise<ArrayBuffer> {
  const cached = cache.get(url);
  if (cached) {
    cache.delete(url);
    cache.set(url, cached);
    return cached;
  }
  const request = fetch(url).then((res) => {
    if (res.status === 404 || res.status === 403) throw new MissingFileError(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.arrayBuffer();
  });
  request.catch(() => cache.delete(url));
  cache.set(url, request);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  return request;
}

export async function handle(request: PrepareRequest): Promise<PrepareResponse> {
  try {
    const [dff, txd] = await Promise.all([
      fetchFile(request.dffUrl),
      fetchFile(request.txdUrl),
    ]);
    return { id: request.id, model: prepareModel(dff, txd, request.opts) };
  } catch (err) {
    return {
      id: request.id,
      error: err instanceof Error ? err.message : String(err),
      missing: err instanceof MissingFileError,
    };
  }
}

// Este módulo también se importa desde el hilo principal (respaldo sin
// workers): el listener solo se instala cuando de verdad corre como worker.
if (typeof document === "undefined") {
  const scope = self as unknown as {
    onmessage: ((ev: MessageEvent<PrepareRequest>) => void) | null;
    postMessage(message: unknown, transfer?: Transferable[]): void;
  };
  scope.onmessage = async ({ data }) => {
    const response = await handle(data);
    scope.postMessage(response, "model" in response ? transferables(response.model) : []);
  };
}
