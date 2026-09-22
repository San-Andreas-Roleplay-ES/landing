// RenderWare binary stream types for GTA SA (.dff / .txd)
// Only the chunks needed for static geometry rendering are parsed.

export const RW_SECTIONS = {
  STRUCT: 0x01,
  STRING: 0x02,
  EXTENSION: 0x03,
  TEXTURE: 0x06,
  MATERIAL: 0x07,
  MATERIAL_LIST: 0x08,
  FRAME_LIST: 0x0e,
  GEOMETRY: 0x0f,
  CLUMP: 0x10,
  ATOMIC: 0x14,
  GEOMETRY_LIST: 0x1a,
  TEXTURE_NATIVE: 0x15,
  TEXTURE_DICTIONARY: 0x16,
  BIN_MESH_PLG: 0x50e,
  SKIN_PLG: 0x116,
  HANIM_PLG: 0x11e,
} as const

export interface RwHeader {
  type: number
  size: number
  version: number
}

export interface RwMaterial {
  color: [number, number, number, number]
  textureName: string | null
  maskName: string | null
}

export interface RwSubMesh {
  materialIndex: number
  // Triangle list indices for this submesh (expanded from tristrips if needed).
  indices: Uint32Array
}

export interface RwGeometry {
  positions: Float32Array
  normals: Float32Array | null
  uvs: Float32Array | null
  colors: Uint8Array | null
  subMeshes: RwSubMesh[]
  materials: RwMaterial[]
  // Skin PLG: one inverse bind matrix (4x4, row-major, row-vector) per bone.
  inverseBind: Float32Array[] | null
  // Rest-pose transform from vertex space to model space (4x4, row-major,
  // row-vector convention: v' = v * M). null = identity. See parseDff.
  transform: Float32Array | null
}

export interface ParsedDff {
  geometries: RwGeometry[]
}

export type TxdTextureFormat = "rgba8" | "dxt1" | "dxt3" | "dxt5"

export interface TxdMipLevel {
  width: number
  height: number
  data: Uint8Array
}

export interface ParsedTxdTexture {
  name: string
  width: number
  height: number
  format: TxdTextureFormat
  // For "rgba8": decoded RGBA8 pixel data, top-down.
  // For "dxt1/3/5": raw compressed block data of the first mip level.
  data: Uint8Array
  // Every usable mip level stored in the file, largest first (levels[0] is
  // `data`). Uncompressed textures only keep the first one.
  levels: TxdMipLevel[]
  // The raster declares an alpha channel (cut-out hair, glasses...).
  hasAlpha: boolean
}

export interface ParsedTxd {
  textures: ParsedTxdTexture[]
}
