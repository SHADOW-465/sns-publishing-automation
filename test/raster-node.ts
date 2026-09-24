// Node implementation of Raster (CLI / tests) using @napi-rs/canvas, which pdf.js installs.
import { createCanvas, ImageData } from '@napi-rs/canvas'
import { toRGBA, type Raster } from '../src/engine/pdf/raster.ts'

export const nodeRaster: Raster = {
  async image(obj, crop, maxSide) {
    const o = obj as { width: number; height: number; kind?: number; data?: Uint8Array }
    const rgba = toRGBA(o)
    if (!rgba) return null
    const full = createCanvas(o.width, o.height)
    full.getContext('2d').putImageData(new ImageData(rgba, o.width, o.height), 0, 0)
    const sx = crop.l * o.width
    const sy = crop.t * o.height
    const sw = (crop.r - crop.l) * o.width
    const sh = (crop.b - crop.t) * o.height
    const k = Math.min(1, maxSide / Math.max(sw, sh))
    const out = createCanvas(Math.max(1, Math.round(sw * k)), Math.max(1, Math.round(sh * k)))
    out.getContext('2d').drawImage(full, sx, sy, sw, sh, 0, 0, out.width, out.height)
    return new Uint8Array(await out.encode('jpeg', 85))
  },
  async page(page, height, rect) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = page as any
    const vp1 = p.getViewport({ scale: 1 })
    const box = rect ?? { x0: 0, y0: 0, x1: vp1.width, y1: vp1.height }
    const scale = height / (box.y1 - box.y0)
    const vp = p.getViewport({ scale })
    const canvas = createCanvas(Math.round(vp.width), Math.round(vp.height))
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    // 'print' intent: display rendering waits for animation frames, which stall in background windows
    await p.render({ canvasContext: ctx, viewport: vp, canvas, intent: 'print' }).promise
    const out = createCanvas(Math.round((box.x1 - box.x0) * scale), Math.round(height))
    out.getContext('2d').drawImage(canvas, box.x0 * scale, box.y0 * scale, out.width, out.height, 0, 0, out.width, out.height)
    return new Uint8Array(await out.encode('jpeg', 88))
  },
}
