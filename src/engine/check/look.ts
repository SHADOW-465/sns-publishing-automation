import { type Files, text } from '../zip.ts'
import { parseXml, resolvePath, epubType } from '../xml.ts'
import type { PrintLine, PrintPage } from '../pdf/pages.ts'

// =============================================================================================
// Does the e-book look like the print book? Each paragraph's alignment in the e-book (from the
// stylesheet the reader will apply) is compared with how its lines sit on the printed page.
// Catches the kind of fault a person sees at a glance — body text set right-aligned or centred,
// a centred title set flush left — and says on which page.
// =============================================================================================

export type Align = 'left' | 'justify' | 'center' | 'right'
export interface LookFinding {
  page: string
  file: string
  text: string
  ebook: Align
  print: Align
}
/** How a paragraph's lines start: first line and the lines after it, inside the margin or at it. */
export type Indent = 'indent' | 'block' | 'hang' | 'flush' | 'in' // 'in': one line, starts inside
export interface IndentFinding {
  page: string
  file: string
  text: string
  cls: string
  ebook: Indent
  print: Indent
}

const norm = (s: string) => s.toLocaleLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, '')

/** text-align per "tag.class" from the stylesheet, later rules winning (as in the reader). */
function alignRules(css: string): Map<string, { align: string; order: number }> {
  const out = new Map<string, { align: string; order: number }>()
  let order = 0
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    const align = m[2].match(/text-align\s*:\s*([a-z-]+)/i)?.[1]
    if (!align) continue
    order++
    for (const sel of m[1].split(',').map((x) => x.trim())) if (/^[a-z0-9]*\.[\w-]+$/i.test(sel)) out.set(sel.toLowerCase(), { align, order })
  }
  return out
}

/** margin-left and text-indent (em) per "tag.class", shorthand margins read too, later rules winning. */
function indentRules(css: string): Map<string, { ml?: number; ti?: number; order: number }> {
  const out = new Map<string, { ml?: number; ti?: number; order: number }>()
  let order = 0
  const num = (v: string) => (/^0(\D|$)/.test(v) ? 0 : /em$/.test(v) ? parseFloat(v) : /px$/.test(v) ? parseFloat(v) / 12 : /%$/.test(v) ? parseFloat(v) / 5 : NaN)
  for (const m of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    order++
    const d = Object.fromEntries(m[2].split(';').map((x) => [x.slice(0, x.indexOf(':')).trim().toLowerCase(), x.slice(x.indexOf(':') + 1).trim()]).filter(([k]) => k))
    let ml = d['margin-left'] !== undefined ? num(d['margin-left']) : undefined
    if (d['margin'] !== undefined) {
      const p = d['margin'].split(/\s+/)
      ml = num(p[3] ?? p[1] ?? p[0])
    }
    const ti = d['text-indent'] !== undefined ? num(d['text-indent']) : undefined
    if (ml === undefined && ti === undefined) continue
    for (const sel of m[1].split(',').map((x) => x.trim().toLowerCase())) {
      if (!/^[a-z0-9]*\.[\w-]+$/i.test(sel)) continue
      const prev = out.get(sel)
      out.set(sel, { ml: ml ?? prev?.ml, ti: ti ?? prev?.ti, order })
    }
  }
  return out
}

function ebookIndent(el: Element, rules: ReturnType<typeof indentRules>, oneLine: boolean): Indent | undefined {
  let ml = 0
  let ti = 0
  let found = false
  const hits = (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean).flatMap((c) => [`${el.localName}.${c}`, `.${c}`].map((k) => rules.get(k.toLowerCase())).filter((x) => !!x)).sort((a, b) => a!.order - b!.order)
  for (const h of hits) {
    if (h!.ml !== undefined && !isNaN(h!.ml)) ((ml = h!.ml), (found = true))
    if (h!.ti !== undefined && !isNaN(h!.ti)) ((ti = h!.ti), (found = true))
  }
  if (!found) return undefined
  return indentOf(ml + ti > 0.2, ml > 0.2, oneLine)
}

const indentOf = (firstIn: boolean, restIn: boolean, oneLine: boolean): Indent =>
  oneLine ? (firstIn ? 'in' : 'flush') : firstIn ? (restIn ? 'block' : 'indent') : restIn ? 'hang' : 'flush'

/** How a paragraph's printed lines start, relative to its text column. */
export function printIndent(lines: PrintLine[], { L }: Col): Indent {
  const firstIn = lines[0].x0 > L + 3
  if (lines.length < 2) return indentOf(firstIn, false, true)
  return indentOf(firstIn, Math.min(...lines.slice(1).map((l) => l.x0)) > L + 3, false)
}

function ebookAlign(el: Element, rules: ReturnType<typeof alignRules>): Align {
  let best: { align: string; order: number } | undefined
  for (const c of (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)) {
    for (const key of [`${el.localName}.${c}`, `.${c}`].map((k) => k.toLowerCase())) {
      const r = rules.get(key)
      if (r && (!best || r.order > best.order)) best = r
    }
  }
  const a = best?.align ?? 'left'
  return a === 'center' || a === 'right' || a === 'justify' ? a : 'left'
}

const mode = (xs: number[]) => {
  const c = new Map<number, number>()
  for (const x of xs.map(Math.round)) c.set(x, (c.get(x) ?? 0) + 1)
  return [...c].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0
}

/** The text columns of left-hand and right-hand pages (their margins differ; a page may have two
 *  columns), from where the book's long lines start and end. */
export function textColumns(pages: PrintPage[]): [Col[], Col[]] {
  const cols = (ps: PrintPage[]): Col[] => {
    const lines = ps.flatMap((p) => p.lines)
    // a full line is as wide as most long lines (a heading across two columns is not the measure)
    const widths = lines.map((l) => l.x1 - l.x0).sort((a, b) => a - b)
    const width = widths[Math.floor(widths.length * 0.8)] ?? 1
    const full = lines.filter((l) => l.x1 - l.x0 > width * 0.85 && l.x1 - l.x0 < width * 1.2)
    const starts = new Map<number, number>()
    for (const x of full.map((l) => Math.round(l.x0))) starts.set(x, (starts.get(x) ?? 0) + 1)
    // column starts: x positions where many long lines begin; of neighbouring ones (an indent next to
    // the edge) the leftmost is the column edge
    const cands = [...starts].filter(([, n]) => n >= Math.max(5, full.length * 0.05)).map(([x]) => x).sort((a, b) => a - b)
    const out: Col[] = []
    let group: number[] = []
    const close = () => {
      if (!group.length) return
      const lo = group[0]
      const hi = group[group.length - 1]
      out.push({ L: lo, R: mode(full.filter((l) => l.x0 >= lo - 3 && l.x0 <= hi + 3).map((l) => l.x1)) })
      group = []
    }
    for (const x of cands) {
      if (group.length && x - group[group.length - 1] >= 20) close()
      group.push(x)
    }
    close()
    return out.sort((a, b) => a.L - b.L)
  }
  return [cols(pages.filter((_, i) => i % 2 === 0)), cols(pages.filter((_, i) => i % 2 === 1))]
}
type Col = { L: number; R: number }
/** the column a line belongs to: the last one starting at or before it */
const columnOf = (cols: Col[], l: PrintLine): Col => [...cols].reverse().find((c) => l.x0 >= c.L - 4) ?? cols[0] ?? { L: 0, R: 1e4 }

/** How a paragraph's lines sit on the printed page, given the book's text column. */
export function printAlign(lines: PrintLine[], { L, R }: Col, page: PrintLine[] = lines): Align {
  const mid = (L + R) / 2
  const inset = (l: PrintLine) => l.x0 > L + 4 && l.x1 < R - 4 // shorter than the column on both sides
  const centred = (l: PrintLine) => Math.abs((l.x0 + l.x1) / 2 - mid) < 4 && inset(l)
  const atRight = (l: PrintLine) => Math.abs(l.x1 - R) < 4
  const x0s = lines.map((l) => l.x0)
  const spread = Math.max(...x0s) - Math.min(...x0s)
  // a lone line whose middle happens to fall on the column's middle is not centred when other lines
  // on the page start where it starts (a list, an indented block)
  const aligned = (l: PrintLine) => page.some((o) => !lines.includes(o) && Math.abs(o.x0 - l.x0) < 1.5 && !centred(o) && o.x1 - o.x0 > (R - L) * 0.3)
  // centred lines start at different places; an indented quotation's lines all start at the same place
  if (lines.every(centred) && (lines.length === 1 ? !aligned(lines[0]) : spread > 2)) return 'center'
  // right-aligned: every line ends at the column edge and none starts at it (a hanging indent or a
  // drop cap starts its first line at the column edge)
  if (lines.every(atRight) && lines.every((l) => l.x0 > L + 8) && (lines.length === 1 ? !aligned(lines[0]) : spread > 2)) return 'right'
  return lines.length > 1 && lines.slice(0, -1).every(atRight) ? 'justify' : 'left'
}

/** Paragraphs whose alignment in the e-book differs from print (justified vs flush left is not a
 *  difference), and paragraphs that start differently: flush where print indents the first line, a
 *  hanging indent where print sets an indented block (client feedback V3: Pregunta/Respuesta). */
export function compareLook(files: Files, pages: PrintPage[]): { checked: number; findings: LookFinding[]; indents: IndentFinding[] } {
  const byNo = new Map(pages.map((p, i) => [p.n, i]))
  const cols = textColumns(pages)
  const container = files.get('META-INF/container.xml')
  const opfPath = container ? text(container).match(/full-path="([^"]+)"/)?.[1] : undefined
  if (!opfPath || !files.has(opfPath)) return { checked: 0, findings: [], indents: [] }
  const opf = parseXml(text(files.get(opfPath)!))
  const items = new Map(Array.from(opf.getElementsByTagName('item')).map((i) => [i.getAttribute('id'), resolvePath(opfPath, i.getAttribute('href') ?? '')]))
  const css = [...files].filter(([p]) => p.endsWith('.css')).map(([, d]) => text(d)).join('\n')
  const rules = alignRules(css)
  const irules = indentRules(css)
  const findings: LookFinding[] = []
  const indents: IndentFinding[] = []
  let checked = 0
  let page = ''
  for (const ref of Array.from(opf.getElementsByTagName('itemref'))) {
    const path = items.get(ref.getAttribute('idref'))
    if (!path || !files.has(path) || !path.endsWith('html')) continue
    let doc: Document
    try {
      doc = parseXml(text(files.get(path)!))
    } catch {
      continue
    }
    // cover, title pages, copyright and contents follow the house layout, not the print one
    const kind = Array.from(doc.querySelectorAll('section, body')).map(epubType).join(' ')
    if (/cover|titlepage|halftitlepage|copyright-page|toc/.test(kind) || doc.querySelector('[role="doc-toc"]')) {
      for (const pb of Array.from(doc.querySelectorAll('*'))) if (/pagebreak/.test(epubType(pb))) page = pb.id.replace(/^page-?/, '') || page
      continue
    }
    const walk = (el: Element) => {
      for (const c of Array.from(el.children)) {
        if (/\bpagebreak\b/.test(epubType(c)) || c.getAttribute('role') === 'doc-pagebreak') {
          page = c.id.replace(/^page-?/, '') || page
          continue
        }
        if (/^(p|h[1-6])$/.test(c.localName)) {
          const t = norm(c.textContent ?? '')
          const at = byNo.get(page)
          if (t.length >= 12 && at !== undefined) {
            // the paragraph starts on this printed page (or the next, when the marker sits inside it)
            for (const pi of [at, at + 1]) {
              const pl = pages[pi]?.lines ?? []
              const i = pl.findIndex((l) => {
                const n = norm(l.text)
                return n.length >= 5 && t.startsWith(n.slice(0, Math.min(20, n.length)))
              })
              if (i < 0) continue
              // the paragraph continues in its own column (on a two-column page the next line in the
              // list may belong to the other column)
              const col = columnOf(cols[pi % 2], pl[i])
              const inCol = pl.filter((l) => columnOf(cols[pi % 2], l) === col)
              const mine: PrintLine[] = []
              let got = 0
              for (let k = inCol.indexOf(pl[i]); k < inCol.length && got < t.length - 2; k++) {
                const n = norm(inCol[k].text)
                if (mine.length && !t.includes(n.slice(0, 15))) break
                mine.push(inCol[k])
                got += n.length
              }
              const print = printAlign(mine, col, inCol)
              const ebook = ebookAlign(c, rules)
              checked++
              const odd = (a: Align) => a === 'center' || a === 'right'
              const said = (c.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 70)
              if (odd(print) !== odd(ebook) || (odd(print) && print !== ebook))
                findings.push({ page: pages[pi].n, file: path.split('/').pop()!, text: said, ebook, print })
              else if (!odd(print) && c.localName === 'p' && !c.querySelector('.dropcap, img') && !c.closest('li, td, th')) {
                // a paragraph that runs on to the next page is compared on its lines on this page
                const pi2 = printIndent(mine, col)
                const ei = ebookIndent(c, irules, mine.length < 2)
                if (ei && ei !== pi2) indents.push({ page: pages[pi].n, file: path.split('/').pop()!, text: said, cls: c.getAttribute('class') ?? '', ebook: ei, print: pi2 })
              }
              break
            }
          }
          for (const pb of Array.from(c.querySelectorAll('*'))) if (/\bpagebreak\b/.test(epubType(pb))) page = pb.id.replace(/^page-?/, '') || page
          continue
        }
        walk(c)
      }
    }
    walk(doc.body ?? doc.documentElement)
  }
  return { checked, findings, indents }
}
