// Mitad "pesada" de la carga de un skin, SIN three.js ni DOM: parsea el .dff y
// el .txd, endereza el modelo, elige el nivel de cada textura y decodifica el
// DXT cuando la GPU no lo soporta. Corre en un Web Worker (modelWorker.ts)
// para no bloquear el scroll; modelBuilder.ts solo ensambla el resultado.

import { parseDff } from "./parsers/dff";
import { decodeDxt, type DxtFormat } from "./parsers/dxt";
import { parseTxd } from "./parsers/txd";
import type { ParsedTxdTexture, TxdMipLevel } from "./parsers/types";

export interface PrepareOptions {
  /** La GPU acepta S3TC *y* su variante sRGB (WEBGL_compressed_texture_s3tc[_srgb]). */
  hasS3tc: boolean;
  /**
   * Lado máximo de textura en píxeles. Las tarjetas son pequeñas: no merece la
   * pena subir 1024² por skin a la GPU. Sin límite en el visor ampliado.
   */
  maxTextureSize?: number;
}

export interface PreparedTexture {
  name: string;
  hasAlpha: boolean;
  /** null = RGBA8 ya decodificado (un solo nivel); si no, bloques DXT tal cual. */
  compressed: DxtFormat | null;
  levels: TxdMipLevel[];
}

export interface PreparedSubMesh {
  indices: Uint32Array;
  /** Nombre (en minúsculas) de una textura de `textures`, o null. */
  texture: string | null;
  color: [number, number, number, number];
}

export interface PreparedMesh {
  /** Ya en ejes de Three (Y arriba), de pie y mirando a +Z. */
  positions: Float32Array;
  normals: Float32Array | null;
  uvs: Float32Array | null;
  subMeshes: PreparedSubMesh[];
}

export interface PreparedModel {
  meshes: PreparedMesh[];
  textures: PreparedTexture[];
  /** Caja envolvente de todos los vértices (ejes de Three). */
  bounds: { min: [number, number, number]; max: [number, number, number] };
}

/** Reduce a la mitad (filtro de caja) una imagen RGBA8. */
function halveRgba(level: TxdMipLevel): TxdMipLevel {
  const width = Math.max(1, level.width >> 1);
  const height = Math.max(1, level.height >> 1);
  const src = level.data;
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const y0 = Math.min(level.height - 1, y * 2);
    const y1 = Math.min(level.height - 1, y * 2 + 1);
    for (let x = 0; x < width; x++) {
      const x0 = Math.min(level.width - 1, x * 2);
      const x1 = Math.min(level.width - 1, x * 2 + 1);
      const a = (y0 * level.width + x0) * 4;
      const b = (y0 * level.width + x1) * 4;
      const c = (y1 * level.width + x0) * 4;
      const d = (y1 * level.width + x1) * 4;
      const o = (y * width + x) * 4;
      for (let ch = 0; ch < 4; ch++)
        out[o + ch] = (src[a + ch] + src[b + ch] + src[c + ch] + src[d + ch] + 2) >> 2;
    }
  }
  return { width, height, data: out };
}

function shrink(level: TxdMipLevel, max: number): TxdMipLevel {
  while (Math.max(level.width, level.height) > max) level = halveRgba(level);
  return level;
}

function prepareTexture(tex: ParsedTxdTexture, opts: PrepareOptions): PreparedTexture {
  const max = opts.maxTextureSize ?? Infinity;
  const base = { name: tex.name.toLowerCase(), hasAlpha: tex.hasAlpha };

  if (tex.format === "rgba8")
    return { ...base, compressed: null, levels: [shrink(tex.levels[0], max)] };

  // Primer nivel del archivo que ya cabe en el límite (evita subir o
  // decodificar 1024² para una tarjeta de 200 px).
  let first = tex.levels.findIndex((l) => Math.max(l.width, l.height) <= max);
  if (first === -1) first = tex.levels.length - 1;
  const levels = tex.levels.slice(first);
  const top = levels[0];

  if (opts.hasS3tc && top.width % 4 === 0 && top.height % 4 === 0) {
    // Una cadena de mipmaps incompleta deja la textura negra en WebGL: solo
    // se usa si llega hasta 1×1; si no, se sube únicamente el primer nivel.
    const last = levels[levels.length - 1];
    const complete = last.width === 1 && last.height === 1;
    return { ...base, compressed: tex.format, levels: complete ? levels : [top] };
  }

  // Sin S3TC (casi todo móvil) o tamaño no múltiplo de 4: a RGBA por CPU.
  const decoded = {
    width: top.width,
    height: top.height,
    data: decodeDxt(tex.format, top.width, top.height, top.data),
  };
  return { ...base, compressed: null, levels: [shrink(decoded, max)] };
}

// GTA SA (X derecha, Y adelante, Z arriba) → Three (X derecha, Y arriba, Z atrás).
// `transform` (RwGeometry.transform: 4x4 row-major, v' = v * M) lleva antes los
// vértices a la pose de reposo; a las normales solo se les aplica la rotación.
function toThreeSpace(
  src: Float32Array,
  transform: Float32Array | null,
  isNormal = false,
): Float32Array {
  const out = new Float32Array(src.length);
  const m = transform;
  const t = isNormal ? 0 : 1;
  for (let i = 0; i < src.length; i += 3) {
    // Algún DFF trae vértices NaN sueltos: a cero, o la caja envolvente (y con
    // ella el encuadre de la cámara) sale NaN.
    let x = Number.isFinite(src[i]) ? src[i] : 0;
    let y = Number.isFinite(src[i + 1]) ? src[i + 1] : 0;
    let z = Number.isFinite(src[i + 2]) ? src[i + 2] : 0;
    if (m) {
      const px = x * m[0] + y * m[4] + z * m[8] + t * m[12];
      const py = x * m[1] + y * m[5] + z * m[9] + t * m[13];
      const pz = x * m[2] + y * m[6] + z * m[10] + t * m[14];
      x = px;
      y = py;
      z = pz;
    }
    out[i] = x;
    out[i + 1] = z;
    out[i + 2] = -y;
  }
  return out;
}

export function prepareModel(
  dffBuffer: ArrayBuffer,
  txdBuffer: ArrayBuffer,
  opts: PrepareOptions,
): PreparedModel {
  const dff = parseDff(dffBuffer);
  if (!dff.geometries.length) throw new Error("El modelo no contiene geometría.");

  let parsed: ParsedTxdTexture[] = [];
  try {
    parsed = parseTxd(txdBuffer).textures;
  } catch {
    parsed = []; // TXD corrupto/no soportado: se pinta con los colores de material
  }
  const available = new Map(
    parsed.filter((t) => t.levels.length).map((t) => [t.name.toLowerCase(), t]),
  );

  // Solo se preparan las texturas que algún material con triángulos usa: los
  // TXD de mods suelen traer una docena de sobra y decodificarlas cuesta.
  const textures = new Map<string, PreparedTexture>();
  const meshes: PreparedMesh[] = [];

  for (const g of dff.geometries) {
    if (g.positions.length === 0) continue;
    const subMeshes: PreparedSubMesh[] = [];
    for (const sub of g.subMeshes) {
      if (sub.indices.length === 0) continue;
      const mat = g.materials[sub.materialIndex];
      const name = mat?.textureName?.toLowerCase() ?? null;
      const source = name ? available.get(name) : undefined;
      if (name && source && !textures.has(name))
        textures.set(name, prepareTexture(source, opts));
      subMeshes.push({
        indices: sub.indices,
        texture: source ? name : null,
        color: mat?.color ?? [1, 1, 1, 1],
      });
    }
    if (!subMeshes.length) continue;
    meshes.push({
      positions: toThreeSpace(g.positions, g.transform),
      normals: g.normals ? toThreeSpace(g.normals, g.transform, true) : null,
      uvs: g.uvs,
      subMeshes,
    });
  }

  if (!meshes.length) throw new Error("El modelo no contiene geometría.");

  // Se calcula aquí, una vez, para que el hilo principal no tenga que recorrer
  // los vértices (three lo haría por cada submalla para encuadrar y descartar).
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (const { positions } of meshes)
    for (let i = 0; i < positions.length; i++) {
      const axis = i % 3;
      if (positions[i] < min[axis]) min[axis] = positions[i];
      if (positions[i] > max[axis]) max[axis] = positions[i];
    }
  return { meshes, textures: [...textures.values()], bounds: { min, max } };
}

/** Buffers que se pueden transferir (sin copia) al devolver el modelo. */
export function transferables(model: PreparedModel): ArrayBuffer[] {
  const buffers = new Set<ArrayBufferLike>();
  for (const mesh of model.meshes) {
    buffers.add(mesh.positions.buffer);
    if (mesh.normals) buffers.add(mesh.normals.buffer);
    if (mesh.uvs) buffers.add(mesh.uvs.buffer);
    for (const sub of mesh.subMeshes) buffers.add(sub.indices.buffer);
  }
  for (const tex of model.textures)
    for (const level of tex.levels) buffers.add(level.data.buffer);
  return [...buffers] as ArrayBuffer[];
}
