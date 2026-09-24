// Browser implementation of Raster: OffscreenCanvas (works in the desktop shell too).
import { toRGBA, type Raster } from '../engine/pdf/raster.ts'

const jpeg = async (c: OffscreenCanvas, q: number) => new Uint8Array(await (await c.convertToBlob({ type: 'image/jpeg', quality: q })).arrayBuffer())

export const browserRaster: Raster = {
  async image(obj, crop, maxSide) {
    const o = obj as { width: number; height: number; kind?: number; data?: Uint8Array; bitmap?: ImageBitmap }
    let src: CanvasImageSource
    let w = o.width
    let h = o.height
    if (o.bitmap) src = o.bitmap
    else if (typeof ImageBitmap !== 'undefined' && obj instanceof ImageBitmap) (src = obj), (w = obj.width), (h = obj.height)
    else {
      const rgba = toRGBA(o)
      if (!rgba) return null
      const full = new OffscreenCanvas(w, h)
      full.getContext('2d')!.putImageData(new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, w, h), 0, 0)
      src = full
    }
    const sx = crop.l * w
    const sy = crop.t * h
    const sw = (crop.r - crop.l) * w
    const sh = (crop.b - crop.t) * h
    const k = Math.min(1, maxSide / Math.max(sw, sh))
    const out = new OffscreenCanvas(Math.max(1, Math.round(sw * k)), Math.max(1, Math.round(sh * k)))
    const ctx = out.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, out.width, out.height)
    ctx.drawImage(src, sx, sy, sw, sh, 0, 0, out.width, out.height)
    return jpeg(out, 0.85)
  },
  async page(page, height, rect) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = page as any
    const vp1 = p.getViewport({ scale: 1 })
    const box = rect ?? { x0: 0, y0: 0, x1: vp1.width, y1: vp1.height }
    const scale = height / (box.y1 - box.y0)
    const vp = p.getViewport({ scale })
    const canvas = new OffscreenCanvas(Math.round(vp.width), Math.round(vp.height))
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    // 'print' intent: display rendering waits for animation frames, which stall in background windows
    await p.render({ canvasContext: ctx, viewport: vp, canvas, intent: 'print' }).promise
    const out = new OffscreenCanvas(Math.round((box.x1 - box.x0) * scale), Math.round(height))
    out.getContext('2d')!.drawImage(canvas, box.x0 * scale, box.y0 * scale, out.width, out.height, 0, 0, out.width, out.height)
    return jpeg(out, 0.88)
  },
}
