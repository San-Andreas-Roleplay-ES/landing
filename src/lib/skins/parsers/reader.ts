import type { RwHeader } from "./types"

export class BinaryReader {
  public offset = 0
  private view: DataView
  private bytes: Uint8Array

  constructor(buffer: ArrayBuffer) {
    this.view = new DataView(buffer)
    this.bytes = new Uint8Array(buffer)
  }

  get size() {
    return this.view.byteLength
  }

  get eof() {
    return this.offset >= this.view.byteLength
  }

  skip(n: number) {
    this.offset += n
  }

  seek(n: number) {
    this.offset = n
  }

  readU8() {
    const v = this.view.getUint8(this.offset)
    this.offset += 1
    return v
  }

  readU16() {
    const v = this.view.getUint16(this.offset, true)
    this.offset += 2
    return v
  }

  readU32() {
    const v = this.view.getUint32(this.offset, true)
    this.offset += 4
    return v
  }

  readI32() {
    const v = this.view.getInt32(this.offset, true)
    this.offset += 4
    return v
  }

  readF32() {
    const v = this.view.getFloat32(this.offset, true)
    this.offset += 4
    return v
  }

  readBytes(n: number) {
    const out = this.bytes.subarray(this.offset, this.offset + n)
    this.offset += n
    return out
  }

  peekBytes(n: number) {
    return this.bytes.subarray(this.offset, this.offset + n)
  }

  readHeader(): RwHeader {
    return {
      type: this.readU32(),
      size: this.readU32(),
      version: this.readU32(),
    }
  }

  /** Read a fixed-length, null-padded ASCII string. */
  readFixedString(length: number) {
    const slice = this.readBytes(length)
    let end = slice.indexOf(0)
    if (end === -1) end = slice.length
    let out = ""
    for (let i = 0; i < end; i++) out += String.fromCharCode(slice[i])
    return out
  }
}
