// Pixel work the pipelines need, implemented per platform: browser (OffscreenCanvas) in
// src/ui/raster-browser.ts, Node (@napi-rs/canvas) in test/raster-node.ts.

export interface Crop {
  l: number
  t: number
  r: number
  b: number
}

export interface Raster {
  /** JPEG of a decoded pdf.js image object, cropped (fractions) and scaled so the long side ≤ maxSide */
  image(obj: unknown, crop: Crop, maxSide: number): Promise<Uint8Array | null>
  /** JPEG of a rendered PDF page, `height` px tall; `rect` (page points, top-down) crops a region */
  page(page: unknown, height: number, rect?: { x0: number; y0: number; x1: number; y1: number }): Promise<Uint8Array>
}

/** Normalise a pdf.js image object (raw pixel data) to RGBA. ImageBitmap objects are handled by the caller. */
export function toRGBA(o: { width: number; height: number; kind?: number; data?: Uint8Array | Uint8ClampedArray }): Uint8ClampedArray | null {
  const { width: w, height: h, kind, data } = o
  if (!data) return null
  const out = new Uint8ClampedArray(w * h * 4)
  if (kind === 3) out.set(data.subarray(0, w * h * 4))
  else if (kind === 2) {
    for (let i = 0, j = 0; i < w * h; i++, j += 3) {
      out[i * 4] = data[j]
      out[i * 4 + 1] = data[j + 1]
      out[i * 4 + 2] = data[j + 2]
      out[i * 4 + 3] = 255
    }
  } else if (kind === 1) {
    // 1 bit per pixel, rows padded to bytes; 1 = white in pdf.js' GRAYSCALE_1BPP
    const rowBytes = (w + 7) >> 3
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const bit = (data[y * rowBytes + (x >> 3)] >> (7 - (x & 7))) & 1
        const v = bit ? 255 : 0
        const i = (y * w + x) * 4
        out[i] = out[i + 1] = out[i + 2] = v
        out[i + 3] = 255
      }
  } else return null
  return out
}
