// Page layout from a print PDF via pdf.js: text lines with real font names, placed images
// (visible area after frame clipping) and filled boxes (tinted panels). Coordinates are
// top-down page points. pdf.js is injected (browser worker build or Node legacy build).

/** A bare list marker: bullet, dash, "12.", "(a)". */
export const LIST_MARK = /^([•●◦▪■–—-]|\(?\d{1,3}[.)]|\(?[a-z][.)])$/

export interface Run {
  text: string
  x0: number
  x1: number
  font: string // PostScript name without subset prefix, e.g. WarnockPro-It
  size: number
  bold: boolean
  italic: boolean
  /** a footnote reference mark that was matched to its note at the foot of the page (pdfepub/notes.ts) */
  noteId?: number
  /** baseline, top-down, so a raised digit can be told from the line it sits on */
  base?: number
  /** smaller and raised (or lowered) against the line's own size */
  sup?: boolean
  sub?: boolean
  /** lowercase letters drawn with capital-sized glyphs: small caps (InDesign span.small-caps) */
  sc?: boolean
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
  /** the line opens with a list marker drawn as its own text piece ("•", "12."): where it ends and the text begins */
  lead?: { text: string; x1: number; next: number }
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
  /** path boxes that are neither hairlines nor a page tint (a chart drawn as vectors) */
  drawings?: { x0: number; y0: number; x1: number; y1: number }[]
  /** boxes of text turned a quarter on an upright page (the state names under a bar chart's axis), which are not lines */
  sideways?: { x0: number; y0: number; x1: number; y1: number }[]
  /** lowercase words drawn as small caps on this page (glyph widths). The runs are marked later, on the EPUB path only. */
  scTokens?: string[]
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

const ORD_SUF = 'st|nd|rd|th'

/** The English ordinal suffix of a number ("11" → "th", "21" → "st"). */
export function ordinalSuffix(n: number): string {
  const d = Math.abs(n) % 100
  if (d >= 11 && d <= 13) return 'th'
  return ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[Math.abs(n) % 10] ?? 'th'
}

/**
 * Ordinals whose raised suffix was read as its own line, or glued onto the next word
 * ("16the century", "13 century", a paragraph that is only "th").
 * Already-marked superscripts stay as they are.
 */
export function repairOrdinalHtml(html: string): string {
  let s = html
  s = s.replace(new RegExp(`(\\d{1,2})(${ORD_SUF})e(\\s+centur(?:y|ies))`, 'gi'), (_m, n: string, suf: string, tail: string) => `${n}<sup>${suf.toLowerCase()}</sup> the${tail}`)
  s = s.replace(new RegExp(`(\\d{1,2})<sup>(${ORD_SUF})</sup>e(\\s+centur(?:y|ies))`, 'gi'), '$1<sup>$2</sup> the$3')
  s = s.replace(new RegExp(`(\\d{1,2})(\\s+and\\s+)(\\d{1,2})(?:<sup>(${ORD_SUF})</sup>|(${ORD_SUF}))(?=\\s+centur)`, 'gi'), (m, a: string, mid: string, b: string, sup: string | undefined, plain: string | undefined) => {
    const suf = (sup ?? plain ?? '').toLowerCase()
    if (!suf || ordinalSuffix(Number(a)) !== suf) return m
    const second = sup ? `${b}<sup>${suf}</sup>` : `${b}<sup>${suf}</sup>`
    return `${a}<sup>${suf}</sup>${mid}${second}`
  })
  s = s.replace(/(\d{1,2})(?!\s*(?:st|nd|rd|th)\b)(\s+centur(?:y|ies))/gi, (m, n: string, tail: string, offset: number, whole: string) => {
    const before = whole.slice(Math.max(0, offset - 6), offset)
    if (/<sup>$/i.test(before) || /\d$/.test(before)) return m
    return `${n}<sup>${ordinalSuffix(Number(n))}</sup>${tail}`
  })
  s = s.replace(/<p\b[^>]*>\s*(st|nd|rd|th)\s*<\/p>\s*/gi, (full, suf: string, offset: number, whole: string) => {
    if (suf !== suf.toLowerCase()) return full
    const prev = whole.slice(Math.max(0, offset - 600), offset)
    return /\d(?:<sup>[a-z]+<\/sup>)?\s+centur/i.test(prev) ? '' : full
  })
  return s
}

/** "Love Your Book Love Your Book" and "slugslug" — the same phrase painted twice — is one phrase. */
function collapseRepeat(s: string): string {
  const t = s.trim()
  const m = t.match(/^(.{8,}?)(?:\s+)?\1$/)
  return m ? s.replace(t, m[1]) : s
}

export async function pageLayout(pdfjs: Any, page: Any, index: number, opts: { /** a landscape page drawn sideways: read it upright. Off for PDF/UA, whose tags use the PDF's own coordinates. */ unrotate?: boolean } = {}): Promise<PageLayout> {
  const OPS = pdfjs.OPS
  const opName: Record<number, string> = Object.fromEntries(Object.entries(OPS).map(([k, v]) => [v as number, k]))
  const [vx0, vy0, vx1, vy1] = page.view as number[]
  const H = vy1
  const ops = await page.getOperatorList()

  // ---- images and filled boxes from the operator list ----
  const images: ImgBox[] = []
  const drawings: { x0: number; y0: number; x1: number; y1: number }[] = []
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
          if (w > 6 && h > 6 && w * h < (vx1 - vx0) * (vy1 - vy0) * 0.5) drawings.push({ x0: b.x0, x1: b.x1, y0: H - b.y1, y1: H - b.y0 })
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
  const horizontal: Item[] = []
  const sideways: { x0: number; y0: number; x1: number; y1: number }[] = []
  const vertical: { str: string; pdfX: number; pdfY: number; width: number; size: number; font: string; up: boolean }[] = []
  for (const it of tc.items as Any[]) {
    if (typeof it.str !== 'string' || !it.str) continue
    const [a, b, c, d, e, f] = it.transform as number[]
    const size = Math.hypot(c, d) || Math.hypot(a, b)
    const advance = Math.hypot(a, b) || size
    // a quarter turn: a landscape table set on a portrait page. Anything else rotated (a spine) is not body text.
    const quarter = Math.abs(a) < advance * 0.25 && Math.abs(d) < advance * 0.25 && Math.abs(b) > advance * 0.75
    if (quarter) {
      const w = Math.abs(it.width)
      sideways.push({ x0: Math.min(e, e + c), x1: Math.max(e, e + c), y0: H - (b > 0 ? f + w : f), y1: H - (b > 0 ? f : f - w) })
    }
    if (quarter && opts.unrotate) vertical.push({ str: it.str, pdfX: e, pdfY: f, width: it.width, size, font: fontOf(it.fontName), up: b > 0 })
    else if (!quarter && Math.abs(b) <= 0.01 * Math.abs(a || 1)) horizontal.push({ str: it.str, x: e, x1: e + it.width, base: H - f, size, font: fontOf(it.fontName) })
  }
  const vChars = vertical.reduce((n, it) => n + it.str.length, 0)
  const hChars = horizontal.reduce((n, it) => n + it.str.length, 0)
  // the page is turned when the text is: read it upright, and turn the rules with it
  const turned = !!opts.unrotate && vChars > 80 && vChars > hChars * 2
  let pageW = vx1 - vx0
  let pageH = vy1 - vy0
  const items: Item[] = []
  if (turned) {
    const up = vertical.filter((it) => it.up).length >= vertical.length / 2
    for (const it of vertical) {
      if (it.up !== up) continue
      const x = up ? it.pdfY : H - it.pdfY
      const x1 = x + Math.abs(it.width)
      const base = up ? it.pdfX : pageW - it.pdfX
      items.push({ str: it.str, x: Math.min(x, x1), x1: Math.max(x, x1), base, size: it.size, font: it.font })
    }
    const rh: Rule[] = []
    const rv: Rule[] = []
    if (up) {
      for (const r of rules.v) rh.push({ a: H - r.b, b: H - r.a, p: r.p })
      for (const r of rules.h) rv.push({ a: r.a, b: r.b, p: H - r.p })
    } else {
      for (const r of rules.v) rh.push({ a: r.a, b: r.b, p: pageW - r.p })
      for (const r of rules.h) rv.push({ a: H - r.b, b: H - r.a, p: r.p })
    }
    rules.h = rh
    rules.v = rv
    drawings.length = 0
    pageW = vy1 - vy0
    pageH = vx1 - vx0
  } else items.push(...horizontal)
  items.sort((p, q) => p.base - q.base || p.x - q.x)
  const lines: Line[] = []
  const rows: Item[][] = []
  let row: Item[] = []
  const flushRow = () => {
    if (row.length) rows.push(row)
    row = []
  }
  for (const it of items) {
    if (row.length && Math.abs(it.base - row[0].base) > Math.min(it.size, row[0].size) * 0.3) flushRow()
    row.push(it)
  }
  flushRow()
  const gutters = columnGutters(rows)
  for (const r of rows) {
    // one baseline can hold several lines (columns): split at wide gaps, and at a gutter the page keeps in every column row
    r.sort((p, q) => p.x - q.x)
    let cur: Item[] = []
    const emit = () => {
      if (cur.length) lines.push(makeLine(cur))
      cur = []
    }
    for (const it of r) {
      const prev = cur[cur.length - 1]
      // a gap wider than one em is a column gutter (index columns sit ~1.2em apart), not a word space
      if (prev && (it.x - prev.x1 > Math.max(prev.size, it.size) * 1.0 || gutters.some((g) => prev.x1 <= g && it.x >= g))) emit()
      // two strings drawn on the same spot (a later layer over an earlier one): keep the top layer
      const paintsOver = (a: Item, b: Item) => {
        const ov = Math.min(a.x1, b.x1) - Math.max(a.x, b.x)
        if (ov <= 2) return false
        const aw = a.x1 - a.x
        const bw = b.x1 - b.x
        const both = ov > aw * 0.7 && ov > bw * 0.7
        // a later layer that starts on the same edge covers the text under it, even when one string is longer
        const sameEdge = Math.abs(a.x - b.x) < 4 && ov > Math.min(aw, bw) * 0.7
        return both || sameEdge
      }
      if (cur.some((p) => paintsOver(p, it))) cur = cur.filter((p) => !paintsOver(p, it))
      cur.push(it)
    }
    emit()
  }

  return { index, width: pageW, height: pageH, lines: liftScripts(lines.filter((l) => l.text.trim() || l.marker)), images, fills, rules, shades, drawings, sideways: turned ? [] : sideways, scTokens: smallCapTokens(glyphChunks(ops, OPS)) }

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
        runs.push({ text, x0: it.x, x1: it.x1, font: it.font, size: it.size, bold: isBoldFont(it.font), italic: isItalicFont(it.font), base: it.base })
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
    const shown = its.filter((it) => !DINGBAT.test(it.font) && it.str.replace(PUA, '').trim())
    const lead = shown.length > 1 && LIST_MARK.test(shown[0].str.trim()) ? { text: shown[0].str.trim(), x1: shown[0].x1, next: shown[1].x } : undefined
    return {
      lead,
      runs,
      x0: runs[0]?.x0 ?? its[0].x,
      x1: runs[runs.length - 1]?.x1 ?? its[its.length - 1].x1,
      base: its[0].base,
      y: its[0].base - sz,
      size: sz,
      font,
      text: collapseRepeat(runs.map((r) => r.text).join('').replace(/\s+/g, ' ')),
      marker,
      sc: sc || undefined,
    }
  }
}

/** Mark raised and lowered runs that already share a line. A lone raised line stays a line: PDF/UA matches each glyph to it. */
function liftScripts(lines: Line[]): Line[] {
  for (const l of lines) {
    const dom = l.runs.filter((r) => r.base !== undefined && Math.abs(r.size - l.size) < 0.35)
    const base0 = dom.length ? dom.reduce((s, r) => s + r.base!, 0) / dom.length : l.base
    for (const r of l.runs) {
      if (r.base === undefined) continue
      if (r.size <= l.size * 0.82 && r.base < base0 - Math.max(0.6, l.size * 0.08)) r.sup = true
      else if (r.size <= l.size * 0.82 && r.base > base0 + Math.max(0.6, l.size * 0.08)) r.sub = true
    }
  }
  return lines
}

/**
 * Pull a lone raised ordinal onto the line it sits on. pdf.js reads "13th" as two lines, and the "th" is often
 * in the middle of the host, not at its end. Footnote digits stay their own lines so the note matcher can see them.
 * EPUB only: dropping the line here would leave the PDF/UA tagger with a glyph and no line.
 */
export function joinRaisedLines<L extends Line>(lines: L[]): L[] {
  const drop = new Set<Line>()
  for (const l of lines) {
    const t = l.text.trim()
    if (!/^(st|nd|rd|th)$/i.test(t)) continue
    const endHost = lines.find((h) => h !== l && !drop.has(h) && h.size >= l.size * 1.2 && Math.abs(h.base - l.base) < h.size * 0.85 && l.x0 + 1 >= h.x1 - h.size * 0.35 && l.x0 - h.x1 < h.size * 1.6)
    if (endHost) {
      for (const r of l.runs) endHost.runs.push({ ...r, sup: true, base: l.base })
      endHost.text = `${endHost.text}${t}`.replace(/\s+/g, ' ')
      endHost.x1 = Math.max(endHost.x1, l.x1)
      drop.add(l)
      continue
    }
    let best: { host: Line; run: number; at: number; dist: number } | undefined
    for (const h of lines) {
      if (h === l || drop.has(h) || h.size < l.size * 1.15 || Math.abs(h.base - l.base) > h.size * 0.9) continue
      h.runs.forEach((r, ri) => {
        if (l.x0 < r.x0 - h.size * 0.4 || l.x0 > r.x1 + h.size * 0.4 || !r.text.length) return
        const avg = (r.x1 - r.x0) / r.text.length
        if (!(avg > 0)) return
        // the ordinal follows the whole number ("13th"), never a digit in the middle ("1th3")
        let at = -1
        let near = Infinity
        for (const m of r.text.matchAll(/\d+/g)) {
          const startX = r.x0 + m.index * avg
          const endX = r.x0 + (m.index + m[0].length) * avg
          if (l.x0 < startX - h.size * 0.35 || l.x0 > endX + h.size * 0.6) continue
          const d = Math.abs(l.x0 - endX)
          if (d < near) (near = d), (at = m.index + m[0].length)
        }
        if (at < 0) return
        const dist = Math.abs(r.x0 + at * avg - l.x0)
        if (dist > h.size * 1.1) return
        if (!best || dist < best.dist) best = { host: h, run: ri, at, dist }
      })
    }
    if (!best) continue
    const host = best.host
    const r = host.runs[best.run]
    const avg = (r.x1 - r.x0) / r.text.length
    const before = r.text.slice(0, best.at)
    const after = r.text.slice(best.at)
    const supRun: Run = { ...l.runs[0], text: t, sup: true, base: l.base, x0: l.x0, x1: l.x1, size: l.size }
    const next = []
    if (before) next.push({ ...r, text: before, x1: r.x0 + best.at * avg })
    next.push(supRun)
    if (after) next.push({ ...r, text: after, x0: l.x1 })
    host.runs.splice(best.run, 1, ...next)
    host.text = host.runs.map((run) => run.text).join('').replace(/\s+/g, ' ')
    host.x1 = Math.max(host.x1, l.x1)
    drop.add(l)
  }
  // "1" + raised "th" + "9" is the ordinal 19th. The suffix was read between the digits.
  for (const l of lines) {
    if (drop.has(l)) continue
    const rs = l.runs
    for (let i = 0; i < rs.length - 2; i++) {
      const a = rs[i]
      const b = rs[i + 1]
      const c = rs[i + 2]
      if (!/^\d+$/.test(a.text) || !b.sup || !/^(st|nd|rd|th)$/i.test(b.text.trim()) || !/^\d+$/.test(c.text)) continue
      rs.splice(i, 3, { ...a, text: a.text + c.text, x1: c.x1 }, b)
      l.text = rs.map((run) => run.text).join('').replace(/\s+/g, ' ')
    }
  }
  // a note call pdf.js lifted onto its own line: a short raised digit at the end of the line it belongs to.
  // EPUB only (this function is not used by the PDF/UA tagger, which matches each glyph to its own line).
  for (const l of lines) {
    const t = l.text.trim()
    if (drop.has(l) || !/^\d{1,3}$/.test(t)) continue
    const host = lines.find((h) => h !== l && !drop.has(h) && h.size >= l.size * 1.2 && h.base - l.base >= Math.max(0.4, h.size * 0.06) && h.base - l.base <= h.size * 0.9 && l.x0 >= h.x1 - h.size * 0.45 && l.x0 - h.x1 < h.size * 1.4)
    if (!host) continue
    for (const r of l.runs) host.runs.push({ ...r, text: t, sup: true, base: l.base })
    host.text = `${host.text}${t}`.replace(/\s+/g, ' ')
    host.x1 = Math.max(host.x1, l.x1)
    drop.add(l)
  }
  return lines.filter((l) => !drop.has(l))
}

/** One shown string and the average width of its letters, in font units (1000 = 1 em). */
export interface GlyphChunk { text: string; avg: number }

/** showText / showSpacedText arguments → chunks. pdf.js merges these into one item, which hides a small-caps word. */
export function glyphChunks(ops: { fnArray: number[]; argsArray: Any[] }, OPS: { showText: number; showSpacedText: number }): GlyphChunk[] {
  const out: GlyphChunk[] = []
  for (let i = 0; i < ops.fnArray.length; i++) {
    const fn = ops.fnArray[i]
    if (fn !== OPS.showText && fn !== OPS.showSpacedText) continue
    const arr = ops.argsArray[i]?.[0]
    if (!Array.isArray(arr)) continue
    let text = ''
    let sum = 0
    let n = 0
    for (const g of arr) {
      if (typeof g === 'number' || !g) continue
      const u = String(g.unicode ?? '')
      text += u
      if (/\p{L}/u.test(u) && typeof g.width === 'number') (sum += g.width), (n += 1)
    }
    if (n && text) out.push({ text, avg: sum / n })
  }
  return out
}

/**
 * Lowercase words drawn with capital-sized glyphs. A whole line of body text (spaces, narrow letters) sets the
 * page's normal width; a short lowercase word far wider than that is small caps ("uaem", "cnpq").
 */
export function smallCapTokens(chunks: GlyphChunk[]): string[] {
  const lettersOf = (t: string) => t.replace(/[^\p{L}]/gu, '')
  const body = chunks.filter((c) => {
    const letters = lettersOf(c.text)
    return letters.length >= 12 && /\p{Ll}/u.test(letters) && /\s/u.test(c.text)
  })
  if (body.length < 2) return []
  const avgs = body.map((c) => c.avg).sort((a, b) => a - b)
  const med = avgs[Math.floor(avgs.length / 2)]
  const wide = (c: GlyphChunk) => c.avg >= med * 1.22 && c.avg >= med + 70
  // A small-cap word is its own showText ("uaem"). A last letter sometimes shares a showText with the
  // punctuation ("q)."). Dots in "no.uaemex.mx" are not letters of a small-cap word, and two whole words
  // ("abc", "ufabc") stay two tokens.
  const piece = (c: GlyphChunk): string => {
    if (!wide(c)) return ''
    const raw = c.text.trim()
    const pure = /^(\p{Ll}{2,10})$/u.exec(raw)
    if (pure) return pure[1]
    const tail = /^(\p{Ll}{1,2})[^\p{L}\p{N}]+$/u.exec(raw)
    return tail ? tail[1] : ''
  }
  const out: string[] = []
  let buf = ''
  let bufAvg = 0
  const flush = () => {
    if (buf.length >= 2 && buf.length <= 10) out.push(buf)
    buf = ''
    bufAvg = 0
  }
  for (const c of chunks) {
    const raw = c.text.trim()
    // the last letter of a small-cap word often shares its showText with the punctuation ("q).")
    // and can sit just under the page's wide-glyph cutoff
    const tail = /^(\p{Ll})[^\p{L}\p{N}]+$/u.exec(raw)
    if (buf && tail && buf.length < 10 && c.avg >= bufAvg * 0.82) {
      buf += tail[1]
      continue
    }
    const p = piece(c)
    if (p.length >= 2) { flush(); buf = p; bufAvg = c.avg; continue }
    flush()
  }
  flush()
  return [...new Set(out)]
}

const reEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Mark small-cap words on the runs of an EPUB build. Does not drop a line, so a PDF/UA tagger that kept the original lines is unchanged. */
export function markSmallCapRuns<L extends Line>(lines: L[], tokens: string[]): L[] {
  const list = [...new Set(tokens.map((t) => t.toLocaleLowerCase()).filter((t) => t.length >= 2))].sort((a, b) => b.length - a.length)
  if (!list.length) return lines
  // a dot before the word, or a dot and a letter after it, is a hostname (www.am.com), not small caps
  const re = new RegExp(`(?<![\\p{L}\\p{N}.])(${list.map(reEscape).join('|')})(?!\\p{L}|\\p{N}|\\.(?=\\p{L}))`, 'giu')
  for (const l of lines) {
    const next: Run[] = []
    for (const r of l.runs) {
      if (r.sup || r.sub || r.sc || r.noteId || !r.text) {
        next.push(r)
        continue
      }
      re.lastIndex = 0
      let cursor = 0
      let hit = false
      let m: RegExpExecArray | null
      while ((m = re.exec(r.text))) {
        hit = true
        const at = m.index
        if (at > cursor) next.push({ ...r, text: r.text.slice(cursor, at) })
        next.push({ ...r, text: m[1], sc: true })
        cursor = at + m[1].length
        if (m.index === re.lastIndex) re.lastIndex += 1
      }
      if (!hit) next.push(r)
      else if (cursor < r.text.length) next.push({ ...r, text: r.text.slice(cursor), sc: false })
    }
    if (next.length) l.runs = next
  }
  return lines
}

/** Every small-cap word in a print PDF, from glyph widths. One pass of the operator list per page. */
export async function smallCapTokensOf(pdfjs: Any, data: Uint8Array): Promise<string[]> {
  const doc = await pdfjs.getDocument({ data: data.slice(), disableFontFace: true, isEvalSupported: false }).promise
  const all = new Set<string>()
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const ops = await page.getOperatorList()
    for (const t of smallCapTokens(glyphChunks(ops, pdfjs.OPS))) all.add(t)
  }
  return [...all]
}

/**
 * A wide page is a 2-up spread when the middle is a gutter. A landscape table is wide too,
 * but its rules and lines cross the middle, so cutting it would drop the right-hand columns.
 */
export function isTwoUpSpread(l: PageLayout): boolean {
  if (l.width < l.height * 1.2) return false
  const mid = l.width / 2
  const band = Math.max(8, l.width * 0.03)
  const crossing = l.lines.filter((ln) => ln.x0 < mid - 2 && ln.x1 > mid + 2).length
  const rulesCross = (l.rules?.h ?? []).filter((r) => r.a < mid - band && r.b > mid + band).length
  if (rulesCross >= 3 || crossing >= 2) return false
  const left = l.lines.filter((ln) => (ln.x0 + ln.x1) / 2 < mid).length
  return left >= 4 && l.lines.length - left >= 4
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
      scTokens: l.scTokens,
    }
  })
}

/**
 * Narrow column gutters: a vertical channel that many rows leave empty at the same x, with nothing crossing it.
 * Columns set close together (a 3-column index) leave gaps below one em, which the plain gap rule reads as word spaces.
 */
export function columnGutters(rows: { x: number; x1: number; size: number }[][]): number[] {
  const gaps: { x: number; row: number }[] = []
  rows.forEach((r, k) => {
    const xs = [...r].sort((a, b) => a.x - b.x)
    for (let i = 1; i < xs.length; i++) {
      const gap = xs[i].x - xs[i - 1].x1
      if (gap >= Math.max(xs[i].size, xs[i - 1].size) * 0.45) gaps.push({ x: (xs[i].x + xs[i - 1].x1) / 2, row: k })
    }
  })
  gaps.sort((a, b) => a.x - b.x)
  const out: number[] = []
  for (let i = 0; i < gaps.length; ) {
    let j = i
    while (j + 1 < gaps.length && gaps[j + 1].x - gaps[i].x < 4) j++
    const cluster = gaps.slice(i, j + 1)
    const g = cluster.reduce((t, c) => t + c.x, 0) / cluster.length
    const nrows = new Set(cluster.map((c) => c.row)).size
    const crossing = rows.filter((r) => r.some((it) => it.x < g - 1 && it.x1 > g + 1)).length
    if (nrows >= 8 && crossing <= nrows * 0.2) out.push(g)
    i = j + 1
  }
  return out
}
