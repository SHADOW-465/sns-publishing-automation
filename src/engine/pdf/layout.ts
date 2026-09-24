// Page layout from a print PDF via pdf.js: text lines with real font names, placed images
// (visible area after frame clipping) and filled boxes (tinted panels). Coordinates are
// top-down page points. pdf.js is injected (browser worker build or Node legacy build).

export interface Run {
  text: string
  x0: number
  x1: number
  font: string // PostScript name without subset prefix, e.g. WarnockPro-It
  size: number
  bold: boolean
  italic: boolean
}

export interface Line {
  runs: Run[]
  x0: number
  x1: number
  y: number // top of the line
  base: number // baseline
  size: number // dominant font size
  font: string // dominant font
  text: string
  /** line started with a dingbat (Wingdings ▶ caption marker, bullet) that was removed */
  marker: boolean
}

export interface ImgBox {
  id: string
  x0: number
  y0: number
  x1: number
  y1: number
  /** visible part of the image, as fractions of its full size (frame clipping) */
  crop: { l: number; t: number; r: number; b: number }
  /** encoded picture (filled in by the caller that owns a Raster) */
  jpeg?: Uint8Array | null
}

export interface FillBox {
  x0: number
  y0: number
  x1: number
  y1: number
  color: string
}

export interface PageLayout {
  index: number // 0-based PDF page
  width: number
  height: number
  lines: Line[]
  images: ImgBox[]
  fills: FillBox[]
}

type M = number[]
const mul = (m: M, n: M): M => [
  m[0] * n[0] + m[1] * n[2], m[0] * n[1] + m[1] * n[3],
  m[2] * n[0] + m[3] * n[2], m[2] * n[1] + m[3] * n[3],
  m[4] * n[0] + m[5] * n[2] + n[4], m[4] * n[1] + m[5] * n[3] + n[5],
]
const apply = (m: M, x: number, y: number) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]]
function bboxOf(m: M, x0: number, y0: number, x1: number, y1: number) {
  const pts = [apply(m, x0, y0), apply(m, x1, y0), apply(m, x0, y1), apply(m, x1, y1)]
  return { x0: Math.min(...pts.map((p) => p[0])), y0: Math.min(...pts.map((p) => p[1])), x1: Math.max(...pts.map((p) => p[0])), y1: Math.max(...pts.map((p) => p[1])) }
}

const DINGBAT = /wingding|dingbat|zapf|symbol|webding/i
const PUA = /[-\u0000-\u0008\u000b-\u001f�]/g
export const cleanFont = (n: string) => n.replace(/^[A-Z]{6}\+/, '')
export const isBoldFont = (f: string) => /bold|black|heavy|semibold|demi|-[6-9]00\b|-[6-9]\d\d$/i.test(f)
export const isItalicFont = (f: string) => /italic|oblique|-it$|-\w*it$|It$/.test(f) && !/italian/i.test(f)

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any

export async function pageLayout(pdfjs: Any, page: Any, index: number): Promise<PageLayout> {
  const OPS = pdfjs.OPS
  const opName: Record<number, string> = Object.fromEntries(Object.entries(OPS).map(([k, v]) => [v as number, k]))
  const [vx0, vy0, vx1, vy1] = page.view as number[]
  const H = vy1
  const ops = await page.getOperatorList()

  // ---- images and filled boxes from the operator list ----
  const images: ImgBox[] = []
  const fills: FillBox[] = []
  let ctm: M = [1, 0, 0, 1, 0, 0]
  let fill = '#000000'
  let clip = null as { x0: number; y0: number; x1: number; y1: number } | null
  let pendingClip = false
  const stack: { ctm: M; fill: string; clip: typeof clip }[] = []
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i]
    const args = ops.argsArray[i]
    switch (opName[fn]) {
      case 'save':
        stack.push({ ctm, fill, clip })
        break
      case 'restore':
        ;({ ctm, fill, clip } = stack.pop() ?? { ctm, fill, clip })
        break
      case 'transform':
        ctm = mul(args as M, ctm)
        break
      case 'paintFormXObjectBegin':
        stack.push({ ctm, fill, clip })
        if (Array.isArray(args[0]) || args[0]?.length === 6) ctm = mul(Array.from(args[0]) as M, ctm)
        break
      case 'paintFormXObjectEnd':
        ;({ ctm, fill, clip } = stack.pop() ?? { ctm, fill, clip })
        break
      case 'setFillRGBColor':
        fill = String(args[0])
        break
      case 'clip':
      case 'eoClip':
        pendingClip = true
        break
      case 'constructPath': {
        const mm = args[2]
        if (!mm || mm[0] === undefined) break
        const b = bboxOf(ctm, mm[0], mm[1], mm[2], mm[3])
        const kind = opName[args[0]] ?? ''
        if (pendingClip) {
          clip = clip ? { x0: Math.max(clip.x0, b.x0), y0: Math.max(clip.y0, b.y0), x1: Math.min(clip.x1, b.x1), y1: Math.min(clip.y1, b.y1) } : b
          pendingClip = false
        } else if (/fill/i.test(kind) && b.x1 - b.x0 > 60 && b.y1 - b.y0 > 20 && b.x1 - b.x0 < (vx1 - vx0) * 0.98) {
          fills.push({ x0: b.x0, x1: b.x1, y0: H - b.y1, y1: H - b.y0, color: fill })
        }
        break
      }
      case 'paintImageXObject':
      case 'paintInlineImageXObject':
      case 'paintImageXObjectRepeat': {
        const id = typeof args[0] === 'string' ? args[0] : `inline-${i}`
        const full = bboxOf(ctm, 0, 0, 1, 1)
        const vis = clip ? { x0: Math.max(full.x0, clip.x0), y0: Math.max(full.y0, clip.y0), x1: Math.min(full.x1, clip.x1), y1: Math.min(full.y1, clip.y1) } : full
        const w = full.x1 - full.x0
        const h = full.y1 - full.y0
        if (vis.x1 - vis.x0 < 20 || vis.y1 - vis.y0 < 20 || w <= 0 || h <= 0) break // tiny / invisible
        images.push({
          id,
          x0: vis.x0, x1: vis.x1, y0: H - vis.y1, y1: H - vis.y0,
          crop: { l: (vis.x0 - full.x0) / w, r: (vis.x1 - full.x0) / w, t: (full.y1 - vis.y1) / h, b: (full.y1 - vis.y0) / h },
        })
        break
      }
    }
  }

  // ---- text ----
  const tc = await page.getTextContent()
  const fontCache = new Map<string, string>()
  const fontOf = (id: string) => {
    if (!fontCache.has(id)) fontCache.set(id, cleanFont(page.commonObjs.has(id) ? (page.commonObjs.get(id)?.name ?? id) : id))
    return fontCache.get(id)!
  }
  type Item = { str: string; x: number; x1: number; base: number; size: number; font: string }
  const items: Item[] = []
  for (const it of tc.items as Any[]) {
    if (typeof it.str !== 'string' || !it.str) continue
    const [a, b, c, d, e, f] = it.transform
    const size = Math.hypot(c, d) || Math.hypot(a, b)
    if (Math.abs(b) > 0.01 * Math.abs(a)) continue // rotated text (spines, credits): not body text
    items.push({ str: it.str, x: e, x1: e + it.width, base: H - f, size, font: fontOf(it.fontName) })
  }
  items.sort((p, q) => p.base - q.base || p.x - q.x)
  const lines: Line[] = []
  let row: Item[] = []
  const flushRow = () => {
    // one baseline can hold several lines (columns): split at wide gaps
    row.sort((p, q) => p.x - q.x)
    let cur: Item[] = []
    const emit = () => {
      if (cur.length) lines.push(makeLine(cur))
      cur = []
    }
    for (const it of row) {
      const prev = cur[cur.length - 1]
      // a gap wider than one em is a column gutter (index columns sit ~1.2em apart), not a word space
      if (prev && it.x - prev.x1 > Math.max(prev.size, it.size) * 1.0) emit()
      cur.push(it)
    }
    emit()
    row = []
  }
  for (const it of items) {
    if (row.length && Math.abs(it.base - row[0].base) > Math.min(it.size, row[0].size) * 0.3) flushRow()
    row.push(it)
  }
  flushRow()

  return { index, width: vx1 - vx0, height: vy1 - vy0, lines: lines.filter((l) => l.text.trim() || l.marker), images, fills }

  function makeLine(its: Item[]): Line {
    const runs: Run[] = []
    let marker = false
    for (const it of its) {
      if (DINGBAT.test(it.font)) {
        if (!runs.length) marker = true
        continue
      }
      const text = it.str.replace(PUA, '')
      if (!text) continue
      const last = runs[runs.length - 1]
      if (last && last.font === it.font && Math.abs(last.size - it.size) < 0.2) {
        if (it.x - last.x1 > it.size * 0.12 && !/\s$/.test(last.text) && !/^\s/.test(text)) last.text += ' '
        last.text += text
        last.x1 = it.x1
      } else {
        if (last && it.x - last.x1 > it.size * 0.12 && !/\s$/.test(last.text) && !/^\s/.test(text)) last.text += ' '
        runs.push({ text, x0: it.x, x1: it.x1, font: it.font, size: it.size, bold: isBoldFont(it.font), italic: isItalicFont(it.font) })
      }
    }
    // dominant font = most characters
    const weight = new Map<string, number>()
    for (const r of runs) weight.set(`${r.font}|${r.size.toFixed(1)}`, (weight.get(`${r.font}|${r.size.toFixed(1)}`) ?? 0) + r.text.trim().length)
    const [font, size] = ([...weight].sort((a, b) => b[1] - a[1])[0]?.[0] ?? `${its[0].font}|${its[0].size}`).split('|')
    const sz = Number(size)
    return {
      runs,
      x0: runs[0]?.x0 ?? its[0].x,
      x1: runs[runs.length - 1]?.x1 ?? its[its.length - 1].x1,
      base: its[0].base,
      y: its[0].base - sz,
      size: sz,
      font,
      text: runs.map((r) => r.text).join('').replace(/\s+/g, ' '),
      marker,
    }
  }
}
