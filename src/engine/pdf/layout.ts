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
  /** set in small caps: capitals and smaller capitals of one font mixed in the line (the lowercase text reads "cambia tu mente") */
  sc?: boolean
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

/** A ruled line: a horizontal one runs from a to b at height p (or a vertical one from a to b at x = p); top-down points. */
export interface Rule {
  a: number
  b: number
  p: number
}

export interface PageLayout {
  /** the drawn lines of the page (table borders, rules) */
  rules?: { h: Rule[]; v: Rule[] }
  /** small tinted rectangles (a shaded table header cell) */
  shades?: FillBox[]
  index: number // 0-based page (a spread counts as two pages)
  /** 0-based PDF page this page was read from, and which half of a spread it is */
  src?: number
  half?: 0 | 1
  /** x of the page's left edge on the PDF page (points): 0, or half the width for the right page of a spread */
  ox?: number
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
  const rules: { h: Rule[]; v: Rule[] } = { h: [], v: [] }
  const shades: FillBox[] = []
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
        } else {
          if (/fill/i.test(kind) && b.x1 - b.x0 > 60 && b.y1 - b.y0 > 20 && b.x1 - b.x0 < (vx1 - vx0) * 0.98) fills.push({ x0: b.x0, x1: b.x1, y0: H - b.y1, y1: H - b.y0, color: fill })
          const w = b.x1 - b.x0
          const h = b.y1 - b.y0
          // a filled rectangle thin as a hairline is a rule; a small filled one shades a table cell
          if (/^fill|^eoFill/i.test(kind) && !/stroke/i.test(kind)) {
            if (h <= 1.6 && w > 3) rules.h.push({ a: b.x0, b: b.x1, p: H - (b.y0 + b.y1) / 2 })
            else if (w <= 1.6 && h > 3) rules.v.push({ a: H - b.y1, b: H - b.y0, p: (b.x0 + b.x1) / 2 })
            else if (w > 8 && h > 8 && w * h < (vx1 - vx0) * (vy1 - vy0) * 0.5) shades.push({ x0: b.x0, x1: b.x1, y0: H - b.y1, y1: H - b.y0, color: fill })
          }
          if (/stroke/i.test(kind)) {
            // stroked path: every horizontal or vertical segment is a rule (a rectangle gives its four sides)
            const path = (Array.isArray(args[1]) ? (args[1] as Any[])[0] : undefined) as ArrayLike<number> | undefined
            const seg = (x0: number, y0: number, x1: number, y1: number) => {
              const [ax, ay] = apply(ctm, x0, y0)
              const [bx, by] = apply(ctm, x1, y1)
              if (Math.abs(ay - by) < 0.6 && Math.abs(ax - bx) > 3) rules.h.push({ a: Math.min(ax, bx), b: Math.max(ax, bx), p: H - (ay + by) / 2 })
              else if (Math.abs(ax - bx) < 0.6 && Math.abs(ay - by) > 3) rules.v.push({ a: H - Math.max(ay, by), b: H - Math.min(ay, by), p: (ax + bx) / 2 })
            }
            if (path && path.length) {
              let cx = 0
              let cy = 0
              let sx = 0
              let sy = 0
              for (let k = 0; k < path.length; ) {
                const op = path[k++]
                if (op === 0) (cx = sx = path[k++]), (cy = sy = path[k++])
                else if (op === 1) {
                  const nx = path[k++]
                  const ny = path[k++]
                  seg(cx, cy, nx, ny)
                  ;[cx, cy] = [nx, ny]
                } else if (op === 2) (k += 6), ([cx, cy] = [path[k - 2], path[k - 1]])
                else if (op === 3) (k += 4), ([cx, cy] = [path[k - 2], path[k - 1]])
                else if (op === 4) (seg(cx, cy, sx, sy), ([cx, cy] = [sx, sy]))
                else break // an operator we do not know: stop reading this path
              }
            }
          }
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

  return { index, width: vx1 - vx0, height: vy1 - vy0, lines: lines.filter((l) => l.text.trim() || l.marker), images, fills, rules, shades }

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
    const ranked = [...weight].sort((a, b) => b[1] - a[1])
    let [font, size] = (ranked[0]?.[0] ?? `${its[0].font}|${its[0].size}`).split('|')
    // small caps: the same font at two sizes 0.62–0.86 apart (capitals and small capitals). The line belongs to the larger size.
    let sc = false
    if (ranked.length > 1) {
      const fam = (f: string) => f.replace(/-.*$/, '')
      const [f0, s0] = ranked[0][0].split('|')
      const big = ranked.map(([k]) => k.split('|')).find(([f1, s1]) => fam(f1) === fam(f0) && Number(s0) / Number(s1) > 0.62 && Number(s0) / Number(s1) < 0.86)
      if (big) [font, size, sc] = [big[0], big[1], true]
    }
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
      sc: sc || undefined,
    }
  }
}

/** A 2-up spread (two printed pages side by side) as two pages, left then right; things are placed by their centre. */
export function splitSpread(l: PageLayout, src: number): PageLayout[] {
  const mid = l.width / 2
  return ([0, 1] as const).map((h) => {
    const ox = h ? mid : 0
    const mine = (a: number, b: number) => ((a + b) / 2 >= mid) === !!h
    const runs = (ln: Line): Line => ({ ...ln, x0: ln.x0 - ox, x1: ln.x1 - ox, runs: ln.runs.map((r) => ({ ...r, x0: r.x0 - ox, x1: r.x1 - ox })) })
    return {
      index: 0, src, half: h, ox, width: mid, height: l.height,
      lines: l.lines.filter((ln) => mine(ln.x0, ln.x1)).map(runs),
      images: l.images.filter((im) => mine(im.x0, im.x1)).map((im) => ({ ...im, x0: im.x0 - ox, x1: im.x1 - ox })),
      fills: l.fills.filter((f) => mine(f.x0, f.x1)).map((f) => ({ ...f, x0: f.x0 - ox, x1: f.x1 - ox })),
      rules: {
        h: (l.rules?.h ?? []).filter((r) => mine(r.a, r.b)).map((r) => ({ ...r, a: r.a - ox, b: r.b - ox })),
        v: (l.rules?.v ?? []).filter((r) => mine(r.p, r.p)).map((r) => ({ ...r, p: r.p - ox })),
      },
      shades: (l.shades ?? []).filter((f) => mine(f.x0, f.x1)).map((f) => ({ ...f, x0: f.x0 - ox, x1: f.x1 - ox })),
    }
  })
}
