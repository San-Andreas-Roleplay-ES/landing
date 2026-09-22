// GTA SA .txd (RenderWare Texture Dictionary) parser — D3D8/D3D9 platform.
// DXT1/3/5 are passed through as raw compressed blocks, with every mip level
// stored in the file (the builder uploads them to the GPU or decodes them with
// parsers/dxt.ts). Uncompressed formats are decoded to RGBA8 here (first level).
//
// Pixel rows are stored top-down, matching D3D's top-left UV origin: textures
// must be uploaded WITHOUT flipping (flipY = false).

import { BinaryReader } from "./reader"
import { RW_SECTIONS } from "./types"
import type { ParsedTxd, ParsedTxdTexture, TxdMipLevel, TxdTextureFormat } from "./types"
import { dxtLevelSize } from "./dxt"

const PLATFORM_D3D8 = 0x8
const PLATFORM_D3D9 = 0x9

// Raster format bits (GTA SA)
const RASTER_FORMAT_MASK = 0xf00
const RASTER_1555 = 0x0100
const RASTER_565 = 0x0200
const RASTER_4444 = 0x0300
const RASTER_LUM8 = 0x0400
const RASTER_8888 = 0x0500
const RASTER_888 = 0x0600

const RASTER_EXT_PAL8 = 0x2000
const RASTER_EXT_PAL4 = 0x4000

function fourCC(a: number, b: number, c: number, d: number) {
  return a | (b << 8) | (c << 16) | (d << 24)
}

const FOURCC_DXT1 = fourCC(68, 88, 84, 49) // 'DXT1'
const FOURCC_DXT3 = fourCC(68, 88, 84, 51) // 'DXT3'
const FOURCC_DXT5 = fourCC(68, 88, 84, 53) // 'DXT5'

function decode1555(data: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    const px = data[i * 2] | (data[i * 2 + 1] << 8)
    const a = (px >> 15) & 0x1 ? 255 : 0
    const r = ((px >> 10) & 0x1f) << 3
    const g = ((px >> 5) & 0x1f) << 3
    const b = (px & 0x1f) << 3
    out[i * 4] = r | (r >> 5)
    out[i * 4 + 1] = g | (g >> 5)
    out[i * 4 + 2] = b | (b >> 5)
    out[i * 4 + 3] = a
  }
  return out
}

function decode565(data: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    const px = data[i * 2] | (data[i * 2 + 1] << 8)
    const r = ((px >> 11) & 0x1f) << 3
    const g = ((px >> 5) & 0x3f) << 2
    const b = (px & 0x1f) << 3
    out[i * 4] = r | (r >> 5)
    out[i * 4 + 1] = g | (g >> 6)
    out[i * 4 + 2] = b | (b >> 5)
    out[i * 4 + 3] = 255
  }
  return out
}

function decode4444(data: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    const px = data[i * 2] | (data[i * 2 + 1] << 8)
    const a = (px >> 12) & 0xf
    const r = (px >> 8) & 0xf
    const g = (px >> 4) & 0xf
    const b = px & 0xf
    out[i * 4] = (r << 4) | r
    out[i * 4 + 1] = (g << 4) | g
    out[i * 4 + 2] = (b << 4) | b
    out[i * 4 + 3] = (a << 4) | a
  }
  return out
}

function decodeBgra8888(data: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    out[i * 4] = data[i * 4 + 2] // R <- B slot (BGRA source)
    out[i * 4 + 1] = data[i * 4 + 1]
    out[i * 4 + 2] = data[i * 4 + 0]
    out[i * 4 + 3] = data[i * 4 + 3]
  }
  return out
}

function decodePal8(
  indices: Uint8Array,
  palette: Uint8Array, // 256 * 4 BGRA
  width: number,
  height: number
): Uint8Array {
  const out = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    const idx = indices[i] * 4
    out[i * 4] = palette[idx + 2]
    out[i * 4 + 1] = palette[idx + 1]
    out[i * 4 + 2] = palette[idx + 0]
    out[i * 4 + 3] = palette[idx + 3]
  }
  return out
}

// PAL4 on PC is stored either one index per byte or two per byte.
function decodePal4(indices: Uint8Array, palette: Uint8Array, width: number, height: number): Uint8Array {
  const packed = indices.length < width * height
  const out = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    const index = packed ? (indices[i >> 1] >> ((i & 1) * 4)) & 0xf : indices[i] & 0xf
    out[i * 4] = palette[index * 4 + 2]
    out[i * 4 + 1] = palette[index * 4 + 1]
    out[i * 4 + 2] = palette[index * 4]
    out[i * 4 + 3] = palette[index * 4 + 3]
  }
  return out
}

function decodeLum8(data: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(width * height * 4)
  for (let i = 0; i < width * height; i++) {
    out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = data[i]
    out[i * 4 + 3] = 255
  }
  return out
}

// An alpha channel that never reaches "visible" is exporter garbage (the ped
// would be invisible in game too): treat the texture as opaque.
function sanitizeAlpha(rgba: Uint8Array): boolean {
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] >= 128) return true
  for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255
  return false
}

function parseTextureNative(r: BinaryReader, end: number): ParsedTxdTexture | null {
  // Struct
  const structHeader = r.readHeader()
  if (structHeader.type !== RW_SECTIONS.STRUCT) {
    r.seek(end)
    return null
  }

  const platformId = r.readU32()
  if (platformId !== PLATFORM_D3D8 && platformId !== PLATFORM_D3D9) {
    // Unsupported (PS2/Xbox) — skip everything
    r.seek(end)
    return null
  }

  r.skip(4) // filterFlags (u16) + uAddress/vAddress (u16)
  const name = r.readFixedString(32)
  r.readFixedString(32) // mask name (unused)

  const rasterFormat = r.readU32()

  let d3dFormat = 0
  let hasAlpha = false
  if (platformId === PLATFORM_D3D9) {
    d3dFormat = r.readU32()
  } else {
    hasAlpha = r.readU32() !== 0
  }

  const width = r.readU16()
  const height = r.readU16()
  const depth = r.readU8()
  const numLevels = r.readU8()
  r.readU8() // rasterType
  // D3D8: DXT variant (0 = none). D3D9: flags (1 alpha, 2 cube, 4 auto-mips, 8 compressed).
  const compression = r.readU8()
  if (platformId === PLATFORM_D3D9) hasAlpha = (compression & 1) !== 0

  let compressedFormat: "dxt1" | "dxt3" | "dxt5" | null = null
  if (platformId === PLATFORM_D3D9) {
    if (d3dFormat === FOURCC_DXT1) compressedFormat = "dxt1"
    else if (d3dFormat === FOURCC_DXT3) compressedFormat = "dxt3"
    else if (d3dFormat === FOURCC_DXT5) compressedFormat = "dxt5"
  } else {
    // D3D8: compression field indicates DXT variant
    if (compression === 1) compressedFormat = "dxt1"
    else if (compression === 3) compressedFormat = "dxt3"
    else if (compression === 5) compressedFormat = "dxt5"
  }

  const isPal8 = (rasterFormat & RASTER_EXT_PAL8) !== 0
  const isPal4 = (rasterFormat & RASTER_EXT_PAL4) !== 0
  const formatBits = rasterFormat & RASTER_FORMAT_MASK

  // Palette (if any)
  let palette: Uint8Array | null = null
  if (isPal8) {
    palette = r.readBytes(256 * 4).slice()
  } else if (isPal4) {
    palette = r.readBytes(32 * 4).slice()
  }

  let outFormat: TxdTextureFormat | null = null
  let outData: Uint8Array | null = null
  const levels: TxdMipLevel[] = []
  const firstMipWidth = Math.max(1, width)
  const firstMipHeight = Math.max(1, height)

  for (let level = 0; level < numLevels; level++) {
    if (r.offset + 4 > end) break
    const dataSize = r.readU32()
    if (r.offset + dataSize > end) break
    const raw = r.readBytes(dataSize)

    if (level > 0) {
      // Extra mip levels are only kept for DXT, and only while the chain is
      // sane (exporters often leave empty or truncated tail levels).
      const levelWidth = Math.max(1, firstMipWidth >> level)
      const levelHeight = Math.max(1, firstMipHeight >> level)
      if (!compressedFormat || levels.length !== level) continue
      if (dataSize !== dxtLevelSize(compressedFormat, levelWidth, levelHeight)) continue
      levels.push({ width: levelWidth, height: levelHeight, data: raw.slice() })
    } else {
      try {
        if (compressedFormat) {
          // Pass raw compressed blocks through; GPU decodes them.
          // We .slice() to detach from the underlying ArrayBuffer.
          outFormat = compressedFormat
          outData = raw.slice()
        } else if (isPal8 && palette) {
          outFormat = "rgba8"
          outData = decodePal8(raw, palette, firstMipWidth, firstMipHeight)
        } else if (isPal4 && palette) {
          outFormat = "rgba8"
          outData = decodePal4(raw, palette, firstMipWidth, firstMipHeight)
        } else if (depth === 8 && formatBits === RASTER_LUM8) {
          outFormat = "rgba8"
          outData = decodeLum8(raw, firstMipWidth, firstMipHeight)
        } else if (depth === 32 && (formatBits === RASTER_8888 || formatBits === RASTER_888)) {
          // depth 32 abarca tanto 8888 (BGRA) como 888 marcado como 32bpp con
          // byte de padding/alpha (muy común en TXD de GTA SA). Ambos se leen
          // como 4 bytes/píxel en orden BGRA. Para 888 (sin alpha) forzamos
          // alpha opaco para no volver invisible la textura.
          outFormat = "rgba8"
          outData = decodeBgra8888(raw, firstMipWidth, firstMipHeight)
          if (formatBits === RASTER_888) {
            for (let i = 0; i < firstMipWidth * firstMipHeight; i++) outData[i * 4 + 3] = 255
          }
        } else if (depth === 24 && formatBits === RASTER_888) {
          outFormat = "rgba8"
          // D3D stores 888 as X8R8G8B8 (4 bytes); some tools write packed BGR.
          const stride = raw.length >= firstMipWidth * firstMipHeight * 4 ? 4 : 3
          outData = new Uint8Array(firstMipWidth * firstMipHeight * 4)
          for (let i = 0; i < firstMipWidth * firstMipHeight; i++) {
            outData[i * 4] = raw[i * stride + 2]
            outData[i * 4 + 1] = raw[i * stride + 1]
            outData[i * 4 + 2] = raw[i * stride + 0]
            outData[i * 4 + 3] = 255
          }
        } else if (depth === 16 && formatBits === RASTER_1555) {
          outFormat = "rgba8"
          outData = decode1555(raw, firstMipWidth, firstMipHeight)
        } else if (depth === 16 && formatBits === RASTER_565) {
          outFormat = "rgba8"
          outData = decode565(raw, firstMipWidth, firstMipHeight)
        } else if (depth === 16 && formatBits === RASTER_4444) {
          outFormat = "rgba8"
          outData = decode4444(raw, firstMipWidth, firstMipHeight)
        } else {
          // Unknown format: fill magenta so it's visually obvious
          outFormat = "rgba8"
          outData = new Uint8Array(firstMipWidth * firstMipHeight * 4)
          for (let i = 0; i < firstMipWidth * firstMipHeight; i++) {
            outData[i * 4] = 255
            outData[i * 4 + 1] = 0
            outData[i * 4 + 2] = 255
            outData[i * 4 + 3] = 255
          }
        }
      } catch (e) {
        outData = null
      }
      if (outData) levels.push({ width: firstMipWidth, height: firstMipHeight, data: outData })
    }
  }

  // Skip extension chunk if any
  if (r.offset < end) r.seek(end)

  if (!outData || !outFormat) return null
  if (outFormat === "rgba8" && hasAlpha) hasAlpha = sanitizeAlpha(outData)

  return {
    name,
    width: firstMipWidth,
    height: firstMipHeight,
    format: outFormat,
    data: outData,
    levels,
    hasAlpha,
  }
}

export function parseTxd(buffer: ArrayBuffer): ParsedTxd {
  const r = new BinaryReader(buffer)
  const result: ParsedTxd = { textures: [] }

  const dictHeader = r.readHeader()
  if (dictHeader.type !== RW_SECTIONS.TEXTURE_DICTIONARY) {
    throw new Error(`Invalid TXD: expected TextureDictionary (0x16), got 0x${dictHeader.type.toString(16)}`)
  }
  const dictEnd = r.offset + dictHeader.size

  // Struct (numTextures:u16, deviceId:u16)
  const structHeader = r.readHeader()
  if (structHeader.type !== RW_SECTIONS.STRUCT) {
    throw new Error("Invalid TXD: missing struct")
  }
  const numTextures = r.readU16()
  r.readU16() // deviceId

  for (let i = 0; i < numTextures && r.offset < dictEnd; i++) {
    const h = r.readHeader()
    const chunkEnd = r.offset + h.size
    if (h.type === RW_SECTIONS.TEXTURE_NATIVE) {
      const tex = parseTextureNative(r, chunkEnd)
      if (tex) result.textures.push(tex)
    }
    r.seek(chunkEnd)
  }

  return result
}
