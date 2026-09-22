// Software S3TC decoder (DXT1 / DXT3 / DXT5 -> RGBA8, top-down).
// Most mobile GPUs do not expose WEBGL_compressed_texture_s3tc, and the GPU
// path also needs dimensions that are multiples of 4; in both cases the raw
// blocks are decoded here instead of showing a flat placeholder.

export type DxtFormat = "dxt1" | "dxt3" | "dxt5"

export function dxtLevelSize(format: DxtFormat, width: number, height: number): number {
  const blocks = Math.max(1, (width + 3) >> 2) * Math.max(1, (height + 3) >> 2)
  return blocks * (format === "dxt1" ? 8 : 16)
}

export function decodeDxt(format: DxtFormat, width: number, height: number, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(width * height * 4)
  const blocksX = Math.max(1, (width + 3) >> 2)
  const blocksY = Math.max(1, (height + 3) >> 2)
  const blockSize = format === "dxt1" ? 8 : 16
  const colors = new Uint8Array(16) // 4 palette entries, RGBA
  const alphas = new Uint8Array(8)

  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      const block = (by * blocksX + bx) * blockSize
      if (block + blockSize > data.length) return out
      const colorAt = format === "dxt1" ? block : block + 8

      const c0 = data[colorAt] | (data[colorAt + 1] << 8)
      const c1 = data[colorAt + 2] | (data[colorAt + 3] << 8)
      for (let k = 0; k < 2; k++) {
        const c = k === 0 ? c0 : c1
        const r = (c >> 11) & 0x1f
        const g = (c >> 5) & 0x3f
        const b = c & 0x1f
        colors[k * 4] = (r << 3) | (r >> 2)
        colors[k * 4 + 1] = (g << 2) | (g >> 4)
        colors[k * 4 + 2] = (b << 3) | (b >> 2)
        colors[k * 4 + 3] = 255
      }
      // DXT3/5 always use the 4-colour mode; DXT1 switches to 3 colours +
      // transparent black when c0 <= c1.
      const fourColors = format !== "dxt1" || c0 > c1
      for (let ch = 0; ch < 3; ch++) {
        const a = colors[ch]
        const b = colors[4 + ch]
        colors[8 + ch] = fourColors ? (2 * a + b + 1) / 3 : (a + b) >> 1
        colors[12 + ch] = fourColors ? (a + 2 * b + 1) / 3 : 0
      }
      colors[11] = 255
      colors[15] = fourColors ? 255 : 0

      if (format === "dxt5") {
        const a0 = (alphas[0] = data[block])
        const a1 = (alphas[1] = data[block + 1])
        if (a0 > a1) {
          for (let k = 1; k < 7; k++) alphas[k + 1] = ((7 - k) * a0 + k * a1 + 3) / 7
        } else {
          for (let k = 1; k < 5; k++) alphas[k + 1] = ((5 - k) * a0 + k * a1 + 2) / 5
          alphas[6] = 0
          alphas[7] = 255
        }
      }

      for (let py = 0; py < 4; py++) {
        const y = by * 4 + py
        if (y >= height) break
        const colorBits = data[colorAt + 4 + py]
        for (let px = 0; px < 4; px++) {
          const x = bx * 4 + px
          if (x >= width) break
          const src = ((colorBits >> (px * 2)) & 3) * 4
          const dst = (y * width + x) * 4
          out[dst] = colors[src]
          out[dst + 1] = colors[src + 1]
          out[dst + 2] = colors[src + 2]

          const texel = py * 4 + px
          if (format === "dxt1") {
            out[dst + 3] = colors[src + 3]
          } else if (format === "dxt3") {
            const nibble = (data[block + (texel >> 1)] >> ((texel & 1) * 4)) & 0xf
            out[dst + 3] = nibble * 17
          } else {
            // 16 three-bit indices packed little-endian in 6 bytes.
            const bit = texel * 3
            const byte = block + 2 + (bit >> 3)
            const word = data[byte] | ((data[byte + 1] ?? 0) << 8)
            out[dst + 3] = alphas[(word >> (bit & 7)) & 7]
          }
        }
      }
    }
  }
  return out
}
