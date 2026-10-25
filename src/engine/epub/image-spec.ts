// Picture files that go into an EPUB: RGB, a resolution tag, and a cap on the long side.
// The numbers come from settings (IMG-006, IMG-007, IMG-008). A PNG that has a transparent pixel stays a PNG.
// A file this module cannot decode is left as it is (a test stub with only a header, a SVG).
import * as jpegMod from 'jpeg-js'
import UPNG from 'upng-js'
import { settings } from '../settings.ts'
import { extOf, imageSize, withRealExt } from './image.ts'
import type { ImageOut } from './package.ts'

export interface ImageFacts {
  ext: string
  width: number
  height: number
  /** rgb, gray, cmyk, or '' when the file is not a JPEG/PNG we can read */
  mode: '' | 'rgb' | 'gray' | 'cmyk'
  /** dots per inch written in the file, or 0 when the tag is missing */
  dpi: number
  /** a complete JPEG (has a scan) or PNG (has IDAT), not a header stub */
  real: boolean
  transparent: boolean
}

const u16 = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1]
const u32 = (b: Uint8Array, i: number) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0

function jpegMode(b: Uint8Array): '' | 'rgb' | 'gray' | 'cmyk' {
  let i = 2
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) return ''
    const marker = b[i + 1]
    if (marker === 0xda || marker === 0xd9) return ''
    const len = u16(b, i + 2)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const n = b[i + 9]
      return n >= 4 ? 'cmyk' : n === 1 ? 'gray' : 'rgb'
    }
    i += 2 + len
  }
  return ''
}

function jpegDpi(b: Uint8Array): number {
  const s = new TextDecoder('latin1').decode(b.subarray(0, Math.min(b.length, 512)))
  const at = s.indexOf('JFIF\0')
  if (at < 0 || at + 12 >= b.length) return 0
  const units = b[at + 7]
  const x = u16(b, at + 8)
  if (!x) return 0
  if (units === 1) return x
  if (units === 2) return Math.round(x * 2.54)
  return 0
}

function pngDpi(b: Uint8Array): number {
  let i = 8
  while (i + 12 <= b.length) {
    const len = u32(b, i)
    const type = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7])
    if (type === 'pHYs' && len >= 9 && b[i + 16] === 1) return Math.round(u32(b, i + 8) * 0.0254)
    if (type === 'IEND') break
    i += 12 + len
  }
  return 0
}

function pngColourType(b: Uint8Array): number {
  if (b.length < 26 || String.fromCharCode(b[12], b[13], b[14], b[15]) !== 'IHDR') return 2
  return b[25]
}

function pngMode(b: Uint8Array): '' | 'rgb' | 'gray' {
  const t = pngColourType(b)
  if (t === 0 || t === 4) return 'gray'
  return 'rgb'
}

/** Colour types 4 and 6 carry an alpha channel. An indexed PNG can hide transparency in a tRNS chunk. */
function pngClaimsTransparency(b: Uint8Array): boolean {
  const t = pngColourType(b)
  if (t === 4 || t === 6) return true
  let i = 8
  while (i + 12 <= b.length) {
    const len = u32(b, i)
    const type = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7])
    if (type === 'tRNS') return true
    if (type === 'IEND') break
    i += 12 + len
  }
  return false
}

/** What the bytes say, without decoding the pixels. */
export function imageFacts(b: Uint8Array): ImageFacts {
  const ext = extOf(b)
  const { width, height } = imageSize(b)
  if (ext === 'jpg') {
    const mode = jpegMode(b)
    return { ext, width, height, mode, dpi: jpegDpi(b), real: mode !== '', transparent: false }
  }
  if (ext === 'png') {
    const real = indexOf(b, [0x49, 0x44, 0x41, 0x54]) >= 0
    const mode = pngMode(b)
    return { ext, width, height, mode, dpi: pngDpi(b), real, transparent: pngClaimsTransparency(b) }
  }
  return { ext, width, height, mode: '', dpi: 0, real: ext === 'gif' || ext === 'webp', transparent: false }
}

const CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
const crc32 = (buf: Uint8Array) => {
  let c = 0xffffffff
  for (const x of buf) c = CRC[(c ^ x) & 255] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** Write a 300 ppi tag. JPEG gets a JFIF density; PNG gets a pHYs chunk. Other types come back unchanged. */
export function stampDpi(b: Uint8Array, dpi: number): Uint8Array {
  const ext = extOf(b)
  if (ext === 'jpg') return stampJpegDpi(b, dpi)
  if (ext === 'png') return stampPngDpi(b, dpi)
  return b
}

function stampJpegDpi(b: Uint8Array, dpi: number): Uint8Array {
  const head = new TextDecoder('latin1').decode(b.subarray(0, Math.min(b.length, 512)))
  const at = head.indexOf('JFIF\0')
  if (at >= 0 && at + 12 < b.length) {
    const out = new Uint8Array(b)
    out[at + 7] = 1
    out[at + 8] = dpi >> 8
    out[at + 9] = dpi & 255
    out[at + 10] = dpi >> 8
    out[at + 11] = dpi & 255
    return out
  }
  const app = new Uint8Array([0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x02, 0x01, dpi >> 8, dpi & 255, dpi >> 8, dpi & 255, 0x00, 0x00])
  const out = new Uint8Array(b.length + app.length)
  out[0] = 0xff
  out[1] = 0xd8
  out.set(app, 2)
  out.set(b.subarray(2), 2 + app.length)
  return out
}

function stampPngDpi(b: Uint8Array, dpi: number): Uint8Array {
  const ppm = Math.round(dpi / 0.0254)
  const data = new Uint8Array(9)
  data[0] = ppm >>> 24
  data[1] = (ppm >>> 16) & 255
  data[2] = (ppm >>> 8) & 255
  data[3] = ppm & 255
  data[4] = ppm >>> 24
  data[5] = (ppm >>> 16) & 255
  data[6] = (ppm >>> 8) & 255
  data[7] = ppm & 255
  data[8] = 1
  const type = new Uint8Array([0x70, 0x48, 0x59, 0x73])
  const body = new Uint8Array(4 + 9)
  body.set(type, 0)
  body.set(data, 4)
  const crc = crc32(body)
  const chunk = new Uint8Array(4 + body.length + 4)
  chunk[0] = 0
  chunk[1] = 0
  chunk[2] = 0
  chunk[3] = 9
  chunk.set(body, 4)
  const crcAt = 4 + body.length
  chunk[crcAt] = crc >>> 24
  chunk[crcAt + 1] = (crc >>> 16) & 255
  chunk[crcAt + 2] = (crc >>> 8) & 255
  chunk[crcAt + 3] = crc & 255
  // drop an existing pHYs, then insert after IHDR
  const stripped = stripChunk(b, 'pHYs')
  const ihdrLen = u32(stripped, 8)
  const at = 8 + 12 + ihdrLen
  const out = new Uint8Array(stripped.length + chunk.length)
  out.set(stripped.subarray(0, at), 0)
  out.set(chunk, at)
  out.set(stripped.subarray(at), at + chunk.length)
  return out
}

function stripChunk(b: Uint8Array, name: string): Uint8Array {
  const parts: Uint8Array[] = [b.subarray(0, 8)]
  let i = 8
  let dropped = false
  while (i + 12 <= b.length) {
    const len = u32(b, i)
    const type = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7])
    const next = i + 12 + len
    if (type === name) dropped = true
    else parts.push(b.subarray(i, Math.min(next, b.length)))
    if (type === 'IEND') break
    i = next
  }
  if (!dropped) return b
  const n = parts.reduce((s, p) => s + p.length, 0)
  const out = new Uint8Array(n)
  let o = 0
  for (const p of parts) (out.set(p, o), (o += p.length))
  return out
}

export interface RgbaImage {
  width: number
  height: number
  rgba: Uint8Array
}

export interface ImageCodec {
  decode(b: Uint8Array): RgbaImage | null
  jpeg(img: RgbaImage, quality: number): Uint8Array
  png(img: RgbaImage): Uint8Array
}

let codec: ImageCodec | null = null

/** A faster codec (the Node canvas) may replace the pure-JS one. The browser keeps the pure-JS codec. */
export function setImageCodec(c: ImageCodec | null) {
  codec = c
}

function ensureBuffer() {
  const g = globalThis as { Buffer?: { from(data: Uint8Array): Uint8Array } }
  if (typeof g.Buffer !== 'undefined') return
  // jpeg-js calls Buffer.from. The browser build has no Node Buffer; the bytes are already a Uint8Array.
  g.Buffer = { from: (data) => data }
}

function jsCodec(): ImageCodec {
  return {
    decode(b) {
      const ext = extOf(b)
      try {
        if (ext === 'jpg') {
          // jpeg-js is CJS; the namespace import is the function bag
          const jpeg = jpegJs()
          const raw = jpeg.decode(b, { useTArray: true, formatAsRGBA: true, maxResolutionInMP: 40 })
          return { width: raw.width, height: raw.height, rgba: raw.data }
        }
        if (ext === 'png') {
          const UPNG = upng()
          const decoded = UPNG.decode(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength))
          const frames = UPNG.toRGBA8(decoded)
          const rgba = new Uint8Array(frames[0])
          return { width: decoded.width, height: decoded.height, rgba }
        }
      } catch {
        return null
      }
      return null
    },
    jpeg(img, quality) {
      ensureBuffer()
      const jpeg = jpegJs()
      const out = jpeg.encode({ data: img.rgba, width: img.width, height: img.height }, quality) as { data?: Uint8Array } | Uint8Array
      const data = out instanceof Uint8Array ? out : out.data
      return data ? new Uint8Array(data) : new Uint8Array()
    },
    png(img) {
      const UPNG = upng()
      const copy = img.rgba.buffer.slice(img.rgba.byteOffset, img.rgba.byteOffset + img.rgba.byteLength)
      return new Uint8Array(UPNG.encode([copy], img.width, img.height, 0))
    },
  }
}

function jpegJs() {
  return jpegMod
}
function upng() {
  return UPNG
}

function indexOf(b: Uint8Array, needle: number[]): number {
  const n = needle.length
  for (let i = 0; i + n <= b.length; i++) {
    let ok = true
    for (let j = 0; j < n; j++) if (b[i + j] !== needle[j]) { ok = false; break }
    if (ok) return i
  }
  return -1
}

/** A decode that comes back as empty pixels (some decoders do this for a JPEG they cannot paint) is not usable. */
function painted(img: RgbaImage | null): RgbaImage | null {
  if (!img || img.rgba.length < 4) return null
  const s = img.rgba
  const last = s.length - 4
  if ((s[last] | s[last + 1] | s[last + 2] | s[last + 3]) !== 0) return img
  for (let i = 0; i < s.length; i += 64) if ((s[i] | s[i + 1] | s[i + 2] | s[i + 3]) !== 0) return img
  return null
}

function hasTransparentPixel(rgba: Uint8Array): boolean {
  for (let i = 3; i < rgba.length; i += 4) if (rgba[i] < 250) return true
  return false
}

/** Scale down so the long side is at most `max`. Never scales up. */
export function scaleDown(img: RgbaImage, max: number): RgbaImage {
  const long = Math.max(img.width, img.height)
  if (long <= max || long < 1) return img
  const k = max / long
  const w = Math.max(1, Math.round(img.width * k))
  const h = Math.max(1, Math.round(img.height * k))
  const out = new Uint8Array(w * h * 4)
  const x0 = new Float64Array(w)
  const x1 = new Float64Array(w)
  for (let x = 0; x < w; x++) {
    const a = (x * img.width) / w
    const b = ((x + 1) * img.width) / w
    x0[x] = a
    x1[x] = b
  }
  for (let y = 0; y < h; y++) {
    const ya = (y * img.height) / h
    const yb = ((y + 1) * img.height) / h
    const yStart = Math.floor(ya)
    const yEnd = Math.min(img.height, Math.ceil(yb))
    for (let x = 0; x < w; x++) {
      const xa = x0[x]
      const xb = x1[x]
      const xStart = Math.floor(xa)
      const xEnd = Math.min(img.width, Math.ceil(xb))
      let r = 0
      let g = 0
      let bl = 0
      let a = 0
      let n = 0
      for (let yy = yStart; yy < yEnd; yy++) {
        const wy = Math.min(yy + 1, yb) - Math.max(yy, ya)
        if (wy <= 0) continue
        for (let xx = xStart; xx < xEnd; xx++) {
          const wx = Math.min(xx + 1, xb) - Math.max(xx, xa)
          if (wx <= 0) continue
          const p = (yy * img.width + xx) * 4
          const wgt = wx * wy
          r += img.rgba[p] * wgt
          g += img.rgba[p + 1] * wgt
          bl += img.rgba[p + 2] * wgt
          a += img.rgba[p + 3] * wgt
          n += wgt
        }
      }
      const o = (y * w + x) * 4
      if (n <= 0) continue
      out[o] = r / n
      out[o + 1] = g / n
      out[o + 2] = bl / n
      out[o + 3] = a / n
    }
  }
  return { width: w, height: h, rgba: out }
}

/**
 * RGB, density tag, long side capped. Opaque pictures become JPEG at the quality setting.
 * A PNG with a transparent pixel stays a PNG. Returns the same bytes when nothing has to change,
 * and when the file cannot be decoded.
 */
export function normaliseEpubImage(b: Uint8Array): Uint8Array {
  const facts = imageFacts(b)
  if (!facts.real || (facts.ext !== 'jpg' && facts.ext !== 'png')) return b
  const max = settings().imageMaxPx
  const dpi = settings().imageDpi
  const over = facts.width > max || facts.height > max
  const badMode = facts.mode === 'cmyk' || facts.mode === 'gray'
  const densityOff = facts.dpi !== dpi
  // An RGB JPEG already inside the cap is only tagged. Re-encoding would change the pixels for no reason.
  if (facts.ext === 'jpg' && !over && !badMode) return densityOff ? stampDpi(b, dpi) : b
  const active = codec ?? jsCodec()
  const decoded = painted(active.decode(b)) ?? (codec ? painted(jsCodec().decode(b)) : null)
  if (!decoded) return densityOff && !over && !badMode ? stampDpi(b, dpi) : b
  const transparent = facts.ext === 'png' && facts.transparent && hasTransparentPixel(decoded.rgba)
  if (transparent && !over && !badMode) return densityOff ? stampDpi(b, dpi) : b
  const scaled = scaleDown(decoded, max)
  const encoded = transparent ? active.png(scaled) : active.jpeg(scaled, settings().imageJpegQuality)
  const fallback = transparent ? jsCodec().png(scaled) : jsCodec().jpeg(scaled, settings().imageJpegQuality)
  const bytes = encoded.length ? encoded : fallback
  return stampDpi(bytes, dpi)
}

/** Normalise cover and pictures, and rename a file whose type changed (a PNG that became a JPEG). */
export function prepareEpubImages(cover: ImageOut, images: ImageOut[]): { cover: ImageOut; images: ImageOut[]; renames: [string, string][] } {
  const used = new Set<string>()
  const renames: [string, string][] = []
  const one = (im: ImageOut): ImageOut => {
    const data = normaliseEpubImage(im.data)
    let path = withRealExt(im.path, data)
    if (path !== im.path) {
      const stem = path.replace(/\.[a-z0-9]+$/i, '')
      const ext = path.slice(stem.length)
      let n = 2
      while (used.has(path)) path = `${stem}-${n++}${ext}`
      renames.push([im.path, path])
    }
    used.add(path)
    return data === im.data && path === im.path ? im : { path, data }
  }
  const nextCover = one(cover)
  return { cover: nextCover, images: images.map(one), renames }
}

/** Replace picture paths in the chapter HTML after a PNG became a JPEG. Longest old path first. */
export function rewriteImagePaths(body: string, renames: [string, string][]): string {
  const ordered = [...renames].sort((a, b) => b[0].length - a[0].length)
  let out = body
  for (const [from, to] of ordered) out = out.split(from).join(to)
  return out
}
