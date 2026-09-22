// GTA San Andreas .dff (RenderWare Clump) parser.
// Parses only what is needed for a static preview: per-geometry positions,
// normals, uvs, materials with their texture name references, and per-material
// triangle groups via Bin Mesh PLG (0x50E).
//
// Skinning is not animated, but the Skin PLG inverse bind matrices and the
// frame hierarchy ARE read: every exporter leaves the vertices of a skinned
// ped in a different space (lying down, upright, mirrored...) and only
// `inverseBind * boneFrameLTM` tells how to stand the model up (see
// restPoseTransform). Morph targets beyond the first and any other extensions
// are ignored on purpose.

import { BinaryReader } from "./reader"
import { RW_SECTIONS } from "./types"
import type { ParsedDff, RwGeometry, RwMaterial, RwSubMesh } from "./types"

// Parse Bin Mesh PLG (0x50E), the canonical way GTA SA groups triangles
// per-material. When this extension is present it is the source of truth
// for rendering; the triangle list in the main Geometry struct is ignored.
function parseBinMeshPlg(r: BinaryReader, end: number): RwSubMesh[] | null {
  const submeshes: RwSubMesh[] = []
  const flags = r.readU32() // 0 = trilist, 1 = tristrip
  const numMeshes = r.readU32()
  r.readU32() // totalIndices — unused, derivable

  for (let i = 0; i < numMeshes && r.offset < end; i++) {
    const numIndices = r.readU32()
    const materialIndex = r.readU32()

    if (flags === 1) {
      // Triangle strip — expand to triangle list.
      const stripIndices = new Uint32Array(numIndices)
      for (let j = 0; j < numIndices; j++) stripIndices[j] = r.readU32()

      const triIndices: number[] = []
      for (let j = 0; j < numIndices - 2; j++) {
        const a = stripIndices[j]
        const b = stripIndices[j + 1]
        const c = stripIndices[j + 2]
        if (a === b || b === c || a === c) continue // degenerate
        if (j % 2 === 0) triIndices.push(a, b, c)
        else triIndices.push(a, c, b)
      }
      submeshes.push({ materialIndex, indices: new Uint32Array(triIndices) })
    } else {
      // Triangle list.
      const indices = new Uint32Array(numIndices)
      for (let j = 0; j < numIndices; j++) indices[j] = r.readU32()
      submeshes.push({ materialIndex, indices })
    }
  }

  return submeshes
}

function readString(r: BinaryReader, chunkSize: number) {
  // String section payload is raw ASCII padded to 4 bytes. Size is the chunk size.
  const bytes = r.readBytes(chunkSize)
  let end = bytes.indexOf(0)
  if (end === -1) end = bytes.length
  let out = ""
  for (let i = 0; i < end; i++) out += String.fromCharCode(bytes[i])
  return out
}

function skipChunk(r: BinaryReader, size: number) {
  r.skip(size)
}

function parseTexture(r: BinaryReader, end: number): { name: string; mask: string } {
  let name = ""
  let mask = ""

  // Struct: filterFlags (u16) + uvAddressing (u16)
  const structHeader = r.readHeader()
  if (structHeader.type !== RW_SECTIONS.STRUCT) {
    r.seek(end)
    return { name, mask }
  }
  r.skip(structHeader.size)

  // String (name)
  if (r.offset < end) {
    const nameHeader = r.readHeader()
    if (nameHeader.type === RW_SECTIONS.STRING) {
      name = readString(r, nameHeader.size)
    } else {
      r.skip(nameHeader.size)
    }
  }

  // String (mask)
  if (r.offset < end) {
    const maskHeader = r.readHeader()
    if (maskHeader.type === RW_SECTIONS.STRING) {
      mask = readString(r, maskHeader.size)
    } else {
      r.skip(maskHeader.size)
    }
  }

  // Skip any remaining (extensions)
  if (r.offset < end) r.seek(end)

  return { name, mask }
}

function parseMaterial(r: BinaryReader, end: number): RwMaterial {
  const material: RwMaterial = {
    color: [1, 1, 1, 1],
    textureName: null,
    maskName: null,
  }

  // Struct
  const structHeader = r.readHeader()
  if (structHeader.type === RW_SECTIONS.STRUCT) {
    const structEnd = r.offset + structHeader.size
    // flags (u32), color r/g/b/a (4x u8), unused (u32), textured (u32), ambient/diffuse/specular (3x f32)
    r.skip(4)
    const cr = r.readU8()
    const cg = r.readU8()
    const cb = r.readU8()
    const ca = r.readU8()
    material.color = [cr / 255, cg / 255, cb / 255, ca / 255]
    r.seek(structEnd)
  } else {
    r.skip(structHeader.size)
  }

  // Optional Texture chunk + Extension
  while (r.offset < end) {
    const h = r.readHeader()
    const chunkEnd = r.offset + h.size
    if (h.type === RW_SECTIONS.TEXTURE) {
      const tex = parseTexture(r, chunkEnd)
      material.textureName = tex.name || null
      material.maskName = tex.mask || null
    } else {
      skipChunk(r, h.size)
    }
    r.seek(chunkEnd)
  }

  return material
}

function parseMaterialList(r: BinaryReader, end: number): RwMaterial[] {
  const materials: RwMaterial[] = []

  // Struct: numMaterials (u32) + int32[numMaterials] indices (unused for us)
  const structHeader = r.readHeader()
  if (structHeader.type !== RW_SECTIONS.STRUCT) {
    r.seek(end)
    return materials
  }
  const numMaterials = r.readU32()
  r.skip(4 * numMaterials) // material indices

  for (let i = 0; i < numMaterials && r.offset < end; i++) {
    const h = r.readHeader()
    const chunkEnd = r.offset + h.size
    if (h.type === RW_SECTIONS.MATERIAL) {
      materials.push(parseMaterial(r, chunkEnd))
    } else {
      skipChunk(r, h.size)
    }
    r.seek(chunkEnd)
  }

  return materials
}

function parseGeometry(r: BinaryReader, end: number): RwGeometry | null {
  // Struct
  const structHeader = r.readHeader()
  if (structHeader.type !== RW_SECTIONS.STRUCT) {
    r.seek(end)
    return null
  }
  const structEnd = r.offset + structHeader.size

  // Geometry header: u32 format, u32 numTriangles, u32 numVertices, u32 numMorphTargets
  //   format low 16 bits: feature bits (hasColors, hasUV, etc)
  //   format bits 16-23:  numTexCoordSets (RW 3.5+)
  //   format bit 24:      isNativeGeometry
  const flags = r.readU32()
  const numTriangles = r.readU32()
  const numVertices = r.readU32()
  const numMorphTargets = r.readU32()

  const numTexSetsFromFlags = (flags >>> 16) & 0xff
  const isNative = (flags & 0x01000000) !== 0
  const hasColors = (flags & 0x08) !== 0
  const hasUVs = (flags & 0x04) !== 0 || (flags & 0x80) !== 0 || numTexSetsFromFlags > 0
  const numTexSets = numTexSetsFromFlags

  let colors: Uint8Array | null = null
  let uvs: Float32Array | null = null
  let positions = new Float32Array(numVertices * 3)
  let normals: Float32Array | null = null

  // Fallback triangles (used only if Bin Mesh PLG extension is missing).
  const fallbackIndices = new Uint32Array(numTriangles * 3)
  const fallbackMatIds = new Int32Array(numTriangles)

  if (!isNative) {
    // Colors (RGBA per vertex)
    if (hasColors) {
      colors = new Uint8Array(numVertices * 4)
      for (let i = 0; i < numVertices * 4; i++) colors[i] = r.readU8()
    }

    // UVs (one or more sets; we only use the first).
    // RenderWare stores UVs with origin at top-left (DirectX convention).
    // Three.js expects bottom-left (OpenGL). DataTexture honors flipY,
    // and DDSLoader flips automatically too, so we pass UVs unchanged
    // and rely on texture.flipY = true on the Three side.
    if (hasUVs) {
      const sets = Math.max(1, numTexSets)
      uvs = new Float32Array(numVertices * 2)
      for (let s = 0; s < sets; s++) {
        for (let i = 0; i < numVertices; i++) {
          const u = r.readF32()
          const v = r.readF32()
          if (s === 0) {
            uvs[i * 2] = u
            uvs[i * 2 + 1] = v
          }
        }
      }
    }

    // Triangles: [vertex2(u16), vertex1(u16), materialId(u16), vertex3(u16)]
    // In GTA SA DFFs the matId here is usually 0 — the real per-material
    // grouping lives in the Bin Mesh PLG extension. We keep these as a
    // fallback for older / simpler DFFs where the extension is missing.
    for (let i = 0; i < numTriangles; i++) {
      const v2 = r.readU16()
      const v1 = r.readU16()
      const matId = r.readU16()
      const v3 = r.readU16()
      fallbackIndices[i * 3] = v1
      fallbackIndices[i * 3 + 1] = v2
      fallbackIndices[i * 3 + 2] = v3
      fallbackMatIds[i] = matId
    }
  }

  // Morph targets: boundingSphere (4f) + hasPositions (u32) + hasNormals (u32)
  // + positions (only if hasPositions) + normals (only if hasNormals)
  for (let m = 0; m < numMorphTargets; m++) {
    r.skip(4 * 4) // bounding sphere
    const hasPos = r.readU32()
    const hasNorm = r.readU32()

    if (hasPos) {
      if (m === 0) {
        positions = new Float32Array(numVertices * 3)
        for (let i = 0; i < numVertices * 3; i++) positions[i] = r.readF32()
      } else {
        r.skip(numVertices * 3 * 4)
      }
    }

    if (hasNorm) {
      if (m === 0) {
        normals = new Float32Array(numVertices * 3)
        for (let i = 0; i < numVertices * 3; i++) normals[i] = r.readF32()
      } else {
        r.skip(numVertices * 3 * 4)
      }
    }
  }

  r.seek(structEnd)

  // After the geometry struct come MaterialList and Extension chunks.
  let materials: RwMaterial[] = []
  let binMeshSubMeshes: RwSubMesh[] | null = null
  let inverseBind: Float32Array[] | null = null

  while (r.offset < end) {
    const h = r.readHeader()
    const chunkEnd = r.offset + h.size

    if (h.type === RW_SECTIONS.MATERIAL_LIST) {
      materials = parseMaterialList(r, chunkEnd)
    } else if (h.type === RW_SECTIONS.EXTENSION) {
      // Walk nested extension chunks looking for Bin Mesh PLG.
      while (r.offset < chunkEnd) {
        const extHeader = r.readHeader()
        const extEnd = r.offset + extHeader.size
        if (extHeader.type === RW_SECTIONS.BIN_MESH_PLG) {
          binMeshSubMeshes = parseBinMeshPlg(r, extEnd)
        } else if (extHeader.type === RW_SECTIONS.SKIN_PLG) {
          inverseBind = parseSkinPlg(r, extEnd, numVertices)
        } else {
          skipChunk(r, extHeader.size)
        }
        r.seek(extEnd)
      }
    } else {
      skipChunk(r, h.size)
    }
    r.seek(chunkEnd)
  }

  // Build subMeshes: prefer BinMeshPLG; fall back to the per-triangle matId
  // grouping from the main struct.
  let subMeshes: RwSubMesh[]
  if (binMeshSubMeshes && binMeshSubMeshes.length > 0) {
    subMeshes = binMeshSubMeshes
  } else {
    const byMat = new Map<number, number[]>()
    for (let i = 0; i < numTriangles; i++) {
      const mi = fallbackMatIds[i]
      let arr = byMat.get(mi)
      if (!arr) {
        arr = []
        byMat.set(mi, arr)
      }
      arr.push(fallbackIndices[i * 3], fallbackIndices[i * 3 + 1], fallbackIndices[i * 3 + 2])
    }
    subMeshes = []
    byMat.forEach((indices, materialIndex) => {
      subMeshes.push({ materialIndex, indices: new Uint32Array(indices) })
    })
  }

  return {
    positions,
    normals,
    uvs,
    colors,
    subMeshes,
    materials,
    inverseBind,
    transform: null,
  }
}

// Skin PLG (0x116): only the per-bone inverse bind matrices are kept.
function parseSkinPlg(r: BinaryReader, end: number, numVertices: number): Float32Array[] | null {
  const numBones = r.readU8()
  const numUsedBones = r.readU8()
  r.skip(2) // maxWeightsPerVertex + padding
  r.skip(numUsedBones)
  r.skip(numVertices * 4) // bone indices
  r.skip(numVertices * 16) // weights
  // Pre-3.7 files without a used-bone list prefix each matrix with 0xDEADDEAD.
  const prefix = numUsedBones === 0 ? 4 : 0
  if (r.offset + numBones * (64 + prefix) > end) return null

  const matrices: Float32Array[] = []
  for (let b = 0; b < numBones; b++) {
    r.skip(prefix)
    const m = new Float32Array(16)
    for (let k = 0; k < 16; k++) m[k] = r.readF32()
    // The 4th column holds RW matrix flags / garbage, not a projective part.
    m[3] = m[7] = m[11] = 0
    m[15] = 1
    matrices.push(m)
  }
  return matrices
}

interface RwFrame {
  matrix: Float32Array // 4x4, row-major, row-vector convention
  parent: number
  boneId: number | null
}

function parseFrameList(r: BinaryReader, end: number): { frames: RwFrame[]; boneOrder: number[] } {
  const frames: RwFrame[] = []
  let boneOrder: number[] = []

  const structHeader = r.readHeader()
  if (structHeader.type !== RW_SECTIONS.STRUCT) return { frames, boneOrder }
  const numFrames = r.readU32()
  for (let i = 0; i < numFrames; i++) {
    const m = new Float32Array(16)
    for (let row = 0; row < 4; row++) for (let col = 0; col < 3; col++) m[row * 4 + col] = r.readF32()
    m[15] = 1
    const parent = r.readI32()
    r.skip(4) // flags
    frames.push({ matrix: m, parent, boneId: null })
  }

  // One Extension chunk per frame; HAnim PLG carries the bone id and, on the
  // hierarchy root, the bone order that Skin PLG indices refer to.
  for (let i = 0; i < numFrames && r.offset < end; i++) {
    const ext = r.readHeader()
    const extEnd = r.offset + ext.size
    while (ext.type === RW_SECTIONS.EXTENSION && r.offset < extEnd) {
      const h = r.readHeader()
      const chunkEnd = r.offset + h.size
      if (h.type === RW_SECTIONS.HANIM_PLG) {
        r.skip(4) // version
        frames[i].boneId = r.readU32()
        const numBones = r.readU32()
        if (numBones > 0) {
          r.skip(8) // flags + keyframe size
          boneOrder = []
          for (let b = 0; b < numBones; b++) {
            boneOrder.push(r.readU32())
            r.skip(8) // index + flags
          }
        }
      }
      r.seek(chunkEnd)
    }
    r.seek(extEnd)
  }
  return { frames, boneOrder }
}

function multiply(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(16)
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      let sum = 0
      for (let k = 0; k < 4; k++) sum += a[i * 4 + k] * b[k * 4 + j]
      out[i * 4 + j] = sum
    }
  return out
}

function frameLtm(frames: RwFrame[], index: number): Float32Array {
  let m = frames[index].matrix
  let parent = frames[index].parent
  for (let guard = 0; parent >= 0 && parent < frames.length && guard < frames.length; guard++) {
    m = multiply(m, frames[parent].matrix)
    parent = frames[parent].parent
  }
  return m
}

// HAnim bone ids of the standard GTA SA ped skeleton.
const BONE = { HEAD: 5, L_THIGH: 41, L_FOOT: 43, R_THIGH: 51, R_FOOT: 53 } as const

type Vec3 = [number, number, number]
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const normalize = (a: Vec3): Vec3 | null => {
  const len = Math.hypot(a[0], a[1], a[2])
  return len > 1e-6 ? [a[0] / len, a[1] / len, a[2] / len] : null
}

// Bone origin in vertex space: the point the inverse bind matrix sends to 0
// (row-vector convention: o * R + t = 0  =>  o = -t * R^-1).
function boneOrigin(m: Float32Array): Vec3 | null {
  const [a, b, c, d, e, f, g, h, i] = [m[0], m[1], m[2], m[4], m[5], m[6], m[8], m[9], m[10]]
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g)
  if (Math.abs(det) < 1e-9) return null
  const inv = [
    (e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det,
    (f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det,
    (d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det,
  ]
  const t: Vec3 = [-m[12], -m[13], -m[14]]
  return [
    t[0] * inv[0] + t[1] * inv[3] + t[2] * inv[6],
    t[0] * inv[1] + t[1] * inv[4] + t[2] * inv[7],
    t[0] * inv[2] + t[1] * inv[5] + t[2] * inv[8],
  ]
}

// Every exporter leaves the vertices of a skinned ped in a different space
// (lying down, upright, facing either way) and the bone frames stored in the
// file are just as inconsistent: in game they are overwritten by the
// animation. The inverse bind matrices, however, MUST be right for the game to
// skin the mesh, so they tell where the skeleton sits inside the mesh: head
// over feet gives "up", right thigh minus left thigh gives the ped's right.
// The result turns the mesh to the canonical pose: Z up, facing -Y (which the
// RW -> Three axis swap turns into "standing, looking at the camera").
function restPoseTransform(
  geometry: RwGeometry,
  frames: RwFrame[],
  boneOrder: number[],
  atomicFrame: number
): Float32Array | null {
  const origin = (boneId: number): Vec3 | null => {
    const index = boneOrder.indexOf(boneId)
    const inverse = index === -1 ? undefined : geometry.inverseBind?.[index]
    return inverse ? boneOrigin(inverse) : null
  }
  const head = origin(BONE.HEAD)
  const leftFoot = origin(BONE.L_FOOT)
  const rightFoot = origin(BONE.R_FOOT)
  const leftThigh = origin(BONE.L_THIGH)
  const rightThigh = origin(BONE.R_THIGH)

  if (head && leftFoot && rightFoot && leftThigh && rightThigh) {
    const feet: Vec3 = [
      (leftFoot[0] + rightFoot[0]) / 2,
      (leftFoot[1] + rightFoot[1]) / 2,
      (leftFoot[2] + rightFoot[2]) / 2,
    ]
    const up = normalize(sub(head, feet))
    const side = sub(rightThigh, leftThigh)
    const right = up && normalize(sub(side, up.map((u) => u * dot(side, up)) as Vec3))
    if (up && right) {
      const forward = cross(up, right)
      // v' = v * M  with  x' = -v.right, y' = -v.forward, z' = v.up
      const m = new Float32Array(16)
      for (let k = 0; k < 3; k++) {
        m[k * 4] = -right[k]
        m[k * 4 + 1] = -forward[k]
        m[k * 4 + 2] = up[k]
      }
      m[15] = 1
      return m
    }
  }

  // Not a (standard) skinned ped: place it as its atomic's frame says.
  return atomicFrame >= 0 && atomicFrame < frames.length ? frameLtm(frames, atomicFrame) : null
}

function parseGeometryList(r: BinaryReader, end: number): RwGeometry[] {
  const list: RwGeometry[] = []

  const structHeader = r.readHeader()
  if (structHeader.type !== RW_SECTIONS.STRUCT) {
    r.seek(end)
    return list
  }
  const numGeometries = r.readU32()

  for (let i = 0; i < numGeometries && r.offset < end; i++) {
    const h = r.readHeader()
    const chunkEnd = r.offset + h.size
    if (h.type === RW_SECTIONS.GEOMETRY) {
      const g = parseGeometry(r, chunkEnd)
      if (g) list.push(g)
    } else {
      skipChunk(r, h.size)
    }
    r.seek(chunkEnd)
  }

  return list
}

export function parseDff(buffer: ArrayBuffer): ParsedDff {
  const r = new BinaryReader(buffer)
  const result: ParsedDff = { geometries: [] }

  // Top-level chunk must be a Clump
  const clumpHeader = r.readHeader()
  if (clumpHeader.type !== RW_SECTIONS.CLUMP) {
    throw new Error(`Invalid DFF: expected Clump (0x10), got 0x${clumpHeader.type.toString(16)}`)
  }
  const clumpEnd = r.offset + clumpHeader.size

  // Clump Struct (numAtomics + numLights + numCameras)
  const clumpStruct = r.readHeader()
  if (clumpStruct.type !== RW_SECTIONS.STRUCT) {
    throw new Error("Invalid DFF: missing clump struct")
  }
  r.skip(clumpStruct.size)

  let frames: RwFrame[] = []
  let boneOrder: number[] = []
  const atomics: { frame: number; geometry: number }[] = []

  while (r.offset < clumpEnd) {
    const h = r.readHeader()
    const chunkEnd = r.offset + h.size

    if (h.type === RW_SECTIONS.FRAME_LIST) {
      ;({ frames, boneOrder } = parseFrameList(r, chunkEnd))
    } else if (h.type === RW_SECTIONS.GEOMETRY_LIST) {
      result.geometries = parseGeometryList(r, chunkEnd)
    } else if (h.type === RW_SECTIONS.ATOMIC) {
      const atomicStruct = r.readHeader()
      if (atomicStruct.type === RW_SECTIONS.STRUCT) atomics.push({ frame: r.readU32(), geometry: r.readU32() })
    } else {
      skipChunk(r, h.size)
    }
    r.seek(chunkEnd)
  }

  for (const atomic of atomics) {
    const geometry = result.geometries[atomic.geometry]
    if (geometry) geometry.transform = restPoseTransform(geometry, frames, boneOrder, atomic.frame)
  }

  return result
}
