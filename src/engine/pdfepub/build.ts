import { type PdfBook, type PLine, type PdfRole, type PdfStyleInfo, columnStarts, columnOf, titleCase } from './analyze.ts'
import type { ImgBox, FillBox } from '../pdf/layout.ts'
import type { Raster } from '../pdf/raster.ts'
import { esc } from '../xml.ts'
import { labelsFor, sectionTypeOf, SECTION_META, type SectionType } from '../epub/locale.ts'
import { packageEpub, type BookMeta, type ReviewItem, type Section, type ImageOut } from '../epub/package.ts'
import { transformImprint, PRINT_RIGHTS, type CopyrightRules, type ImprintPara } from '../epub/imprint.ts'
import { wordsOf, type CheckSource } from '../check/epub.ts'
import { withRealExt } from '../epub/image.ts'
import { pdfBookCss } from './css.ts'
import { entriesOf, rowsOf, norm as cnorm, type ContentsEntry } from './contents.ts'
import { detectTables, type PdfTable } from '../pdf/tables.ts'
import { settings } from '../settings.ts'

// =============================================================================================
// Print PDF → EPUB, step 2: rebuild the text flow, pictures and navigation.
// Rules deduced from the Contemporary Ceramics sample (print PDF vs the hand-made EPUB).
// =============================================================================================

export interface PdfBuildInput {
  styles: PdfStyleInfo[]
  meta: BookMeta
  rules: CopyrightRules
  cover?: { name: string; data: Uint8Array }
  /** optional alt text per picture file name (images/pg-53-2.jpg → text) */
  alt?: Record<string, string>
}

export interface PdfBuildResult {
  epub: Uint8Array
  files: Map<string, Uint8Array>
  sections: Section[]
  review: ReviewItem[]
  pictures: { path: string; alt: string; caption: string }[]
  /** what the quality check compares the EPUB against */
  source: CheckSource
}

type Seg = { t: string; b?: boolean; i?: boolean; raw?: boolean }
type Block = { kind: 'p' | 'extract' | 'raw' | 'li'; cls?: string; html: string }
interface PSec {
  type: SectionType
  stem: string
  number?: string
  title: Seg[][]
  headRole: PdfRole
  blocks: Block[]
  raw: PLine[] // toc / index lines
  firstPage?: number // printed page of the heading
  nav: string
  /** the printed contents, read (contents page of a book with parts and chapters) */
  entries?: ContentsEntry[]
  /** page markers of the later contents pages, by PDF page: each goes before the first entry of its page */
  marks?: Map<number, string>
  /** marker of the page the heading is on, in front of it */
  lead?: string
  parent?: string
}
interface Float {
  page: number // pdf page
  html: string
  /** picture on a page without text (chapter/section opener): travels to the next section */
  opener: boolean
}

const segHtml = (segs: Seg[]) => {
  // merge neighbours with the same face, then escape and wrap
  const out: Seg[] = []
  for (const s of segs) {
    const l = out[out.length - 1]
    if (l && !l.raw && !s.raw && ((!!l.b === !!s.b && !!l.i === !!s.i) || !s.t.trim())) l.t += s.t
    else if (l && !l.raw && !s.raw && !l.t.trim()) out[out.length - 1] = { ...s, t: l.t + s.t }
    else out.push({ ...s })
  }
  return out
    .map((s) => {
      if (s.raw) return s.t
      let h = autolink(esc(s.t))
      if (s.i && s.t.trim()) h = `<em>${h}</em>`
      if (s.b && s.t.trim()) h = `<strong>${h}</strong>`
      return h
    })
    .join('')
    .replace(/ <\/(em|strong)>/g, '</$1> ')
    .replace(/<(em|strong)> /g, ' <$1>')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"“”]*[^\s<>"“”.,;:)\]]|[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}/gi
function autolink(escaped: string) {
  return escaped.replace(URL_RE, (m) => `<a href="${m.includes('@') && !m.startsWith('http') ? 'mailto:' + m : m.startsWith('www.') ? 'https://' + m : m}">${m}</a>`)
}

const segsOf = (l: PLine, bodyItalic = false): Seg[] => l.replaceWith ? [{ t: l.replaceWith }] : l.runs.map((r) => ({ t: r.text, b: r.bold, i: r.italic !== bodyItalic ? r.italic : false }))
const plain = (segs: Seg[]) => segs.filter((s) => !s.raw).map((s) => s.t).join('').replace(/\s+/g, ' ').trim()

export async function buildPdfEpub(book: PdfBook, input: PdfBuildInput, raster: Raster): Promise<PdfBuildResult> {
  const { meta } = input
  const L = labelsFor(meta.language)
  const review: ReviewItem[] = []
  const dropped: string[] = [] // text deliberately left out, for the completeness check
  const role = new Map<string, PdfRole>(input.styles.map((s) => [s.key, s.role]))
  const roleOf = (l: PLine): PdfRole => l.forced ?? role.get(l.key) ?? 'text'
  const printNo = (pdfIdx: number) => String(book.numbers[pdfIdx])
  const lead = book.lead
  const step = book.step

  // words the book hyphenates mid-line: line-end hyphens in these words are kept
  const hyphenated = new Set<string>()
  for (const p of book.pages) for (const l of p.lines) for (const m of l.text.matchAll(/(\p{L}+)-(\p{L}+)(?!$)/gu)) hyphenated.add(m[0].toLowerCase())
  // every word the book prints whole: "sixteen-|year-old" keeps its hyphen (both halves are words,
  // "sixteenyear" never occurs), "recon-|figura" is joined ("recon" is not a word of the book)
  const known = new Set<string>()
  for (const p of book.pages) for (const l of p.lines) for (const w of l.text.replace(/\p{L}+-$/u, '').match(/\p{L}+/gu) ?? []) known.add(w.toLowerCase())
  const keepHyphen = (a: string, b: string) => {
    const [x, y] = [a.toLowerCase(), b.toLowerCase()]
    return hyphenated.has(`${x}-${y}`) || (known.has(x) && known.has(y) && !known.has(x + y) && x.length > 1 && y.length > 1)
  }

  // ---------------------------------------------------------------- pictures & page markers
  const images: ImageOut[] = []
  const pictures: PdfBuildResult['pictures'] = []
  const markerDone = new Set<string>()
  let anchorNo = 0 // ids given to subheads the contents links to
  let tableNo = 0
  const marker = (pdfIdx: number) => {
    const n = printNo(pdfIdx)
    if (markerDone.has(n)) return ''
    markerDone.add(n)
    return `<span aria-label="${L.page} ${n}" epub:type="pagebreak" id="page-${n}" role="doc-pagebreak" title="${L.page} ${n}"/>`
  }

  // ---------------------------------------------------------------- sections
  const secs: PSec[] = []
  let cur = null as PSec | null // assigned inside newSec(); the cast stops TS narrowing it to null
  const newSec = (type: SectionType, headRole: PdfRole, first?: number): PSec => {
    closePara()
    flushFloats(lastPdf.page - 1, false) // this page's pictures and openers belong to the new section
    const s: PSec = { type, stem: '', title: [], headRole, blocks: [], raw: [], nav: '', firstPage: first }
    // the marker of the page the heading is on goes in front of the heading
    if (pending) (s.lead = pending), (pending = '')
    secs.push(s)
    cur = s
    return s
  }

  // ---------------------------------------------------------------- paragraphs
  type Para = { kind: 'body' | 'extract' | 'text' | 'caption' | 'hang' | 'li'; first: string; segs: Seg[]; last?: PLine; lastPage: number; dropcap?: string; cont?: boolean; bx?: number }
  let para: Para | null = null
  let pending = '' // page marker waiting for the next text
  let floats: Float[] = []
  const lastPdf = { page: 0 }
  const tocLike = (s: PSec | null) => s?.type === 'toc' || s?.type === 'index' || s?.type === 'list'

  function closePara() {
    if (!para || !cur) {
      para = null
      return
    }
    const p = para
    para = null
    let html = segHtml(p.segs)
    if (!html) return
    // a page marker at the start stays before the drop cap, so the first word is not split ("I|n this")
    if (p.dropcap) html = html.replace(/^((?:<span[^>]*epub:type="pagebreak"[^>]*\/>)*)/, `$1<span class="dropcap">${esc(p.dropcap.length === 1 ? p.dropcap.toLocaleUpperCase() : p.dropcap)}</span>`)
    const sec = cur
    if (p.kind === 'extract') sec.blocks.push({ kind: 'extract', html, cls: p.cont ? 'cont' : 'start' })
    else if (p.kind === 'li') sec.blocks.push({ kind: 'li', html })
    else {
      const cls =
        p.kind === 'caption' ? 'caption1'
        : p.kind === 'hang' ? 'hang'
        : sec.type === 'dedication' ? 'ded-1'
        : sec.type === 'acknowledgments' ? 'ack1'
        : p.first === 'step' && !p.dropcap ? 'indent' : 'noindent'
      sec.blocks.push({ kind: 'p', cls, html })
    }
    flushFloats(p.lastPage)
  }
  function flushFloats(upto: number, openers = true) {
    if (!cur) return
    const keep: Float[] = []
    for (const f of floats) f.page <= upto && (openers || !f.opener) && !tocLike(cur) ? cur.blocks.push({ kind: 'raw', html: f.html }) : keep.push(f)
    floats = keep
  }
  const kindOf = (l: PLine) => {
    const off = l.x0 - l.col
    return off < step * 0.5 ? 'flush' : off < step * 1.5 ? 'step' : off < step * 2.5 ? 'step2' : 'deep'
  }
  const appendLine = (l: PLine, into: Para) => {
    const segs = segsOf(l)
    if (l.dropcap && !into.segs.length) into.dropcap = l.dropcap
    const prevText = plain(into.segs)
    if (into.segs.length) {
      const m = prevText.match(/(\p{L}+)-$/u)
      const next = segs.find((s) => s.t.trim())
      const nextWord = next?.t.trim().match(/^\p{L}+/u)?.[0]
      if (m && nextWord && /^\p{Ll}/u.test(nextWord)) {
        // line-end hyphen: keep it only for words the book writes hyphenated
        if (!keepHyphen(m[1], nextWord)) {
          const last = [...into.segs].reverse().find((s) => !s.raw && s.t.trim())!
          last.t = last.t.replace(/-\s*$/, '')
        }
      } else if (!/\s$/.test(into.segs[into.segs.length - 1].t)) into.segs.push({ t: ' ' })
    }
    if (pending) {
      into.segs.push({ t: pending, raw: true })
      pending = ''
    }
    into.segs.push(...segs)
    into.last = l
    into.lastPage = l.page
  }

  // ---------------------------------------------------------------- page by page
  const frontSet = new Set(book.front)
  for (const page of book.pages) {
    if (frontSet.has(page.index)) continue
    lastPdf.page = page.index
    // the marker of the previous page was never used (a part or chapter page holds only its heading): it goes in front of that heading
    if (pending && cur) {
      if (!cur.blocks.length && cur.title.length) cur.lead = (cur.lead ?? '') + pending
      else cur.blocks.push({ kind: 'raw', html: pending })
      pending = ''
    }
    // a page with nothing on it (only the slug) has no page marker, as in the hand-made e-books
    if (!page.lines.length && !page.images.length && !page.fills.length) continue
    if (book.contents?.pages.includes(page.index) && book.contents.entries.some((e) => e.kind === 'part' || sectionTypeOf(e.text) === 'chapter')) {
      // the printed contents of a book with parts and chapters: read once (analyze), rendered from its entries
      const mk = marker(page.index)
      if (page.index === book.contents.pages[0]) {
        const head = page.lines.filter((l) => l.size >= book.bodySize * 1.2 && sectionTypeOf(l.text.trim()) === 'toc').sort((a, b) => a.y - b.y)[0]
        const s = newSec('toc', 'title', book.numbers[page.index])
        if (head) s.title.push(segsOf(head))
        s.entries = book.contents.entries
        s.lead = mk
        s.marks = new Map()
      } else if (cur?.type === 'toc') cur.marks?.set(page.index, mk)
      continue
    }
    const lines = page.lines.filter((l) => roleOf(l) !== 'drop' && !l.imprint && !l.skip)

    // drop caps: a giant first letter spanning several lines belongs to the paragraph's first line
    for (const l of [...lines]) {
      const big = l.runs[0] && l.runs[0].size >= l.size * 2.5 && l.runs[0].text.trim().length <= 2 ? l.runs[0] : null
      const alone = roleOf(l) === 'dropcap' && l.text.trim().length <= 2
      if (!big && !alone) continue
      const letter = (big ?? l.runs[0]).text.trim()
      const right = (big ?? l.runs[0]).x1
      const target = lines
        .filter((t) => t !== l && Math.abs(t.x0 - right) < 8 && t.y >= l.y - lead * 4.5 && t.y <= l.y + lead)
        .sort((a, b) => a.y - b.y)[0] ?? (big ? l : undefined)
      if (!target) continue
      target.dropcap = letter
      if (big) {
        l.runs = l.runs.slice(1)
        if (target !== l) l.x0 = l.runs[0]?.x0 ?? l.x0
        l.text = l.runs.map((r) => r.text).join('')
      } else lines.splice(lines.indexOf(l), 1)
    }

    // boxes: tinted panels holding text (a header bar on top of a panel counts as one box)
    const pageArea = page.width * page.height
    const tints = page.fills.filter((f) => (f.x1 - f.x0) * (f.y1 - f.y0) < pageArea * 0.6 && !/^#f{6}$/i.test(f.color))
    const boxes: { rect: FillBox; head?: FillBox; lines: PLine[] }[] = []
    for (const f of tints.sort((a, b) => (b.x1 - b.x0) * (b.y1 - b.y0) - (a.x1 - a.x0) * (a.y1 - a.y0))) {
      const host = boxes.find((b) => f.x0 >= b.rect.x0 - 2 && f.x1 <= b.rect.x1 + 2 && f.y0 >= b.rect.y0 - 2 && f.y1 <= b.rect.y1 + 2)
      if (host) {
        if (f.y0 - host.rect.y0 < 5 && f.y1 - f.y0 < 40) host.head = f
        continue
      }
      const inside = lines.filter((l) => (l.x0 + l.x1) / 2 > f.x0 && (l.x0 + l.x1) / 2 < f.x1 && l.y + l.size / 2 > f.y0 && l.y + l.size / 2 < f.y1)
      if (!inside.length) continue
      // a panel that carries section headings (dedication, acknowledgements) is decoration, not a box
      if (inside.some((l) => roleOf(l) !== 'body' && roleOf(l) !== 'text' && sectionTypeOf(titleCase(l.text.trim())))) continue
      boxes.push({ rect: f, lines: inside })
    }
    const inBox = new Set(boxes.flatMap((b) => b.lines))

    // captions → pictures
    const caps = lines.filter((l) => roleOf(l) === 'caption' && !inBox.has(l)).sort((a, b) => a.y - b.y || a.x0 - b.x0)
    const groups: { lines: PLine[]; x0: number; x1: number; y0: number; y1: number }[] = []
    for (const c of caps) {
      const g = !c.marker && groups.find((g) => Math.abs(g.x0 - c.x0) < 14 && c.y - g.y1 < c.size * 1.2 && c.y >= g.y1 - 2)
      if (g) {
        g.lines.push(c)
        g.y1 = c.y + c.size
        g.x1 = Math.max(g.x1, c.x1)
      } else groups.push({ lines: [c], x0: c.x0, x1: c.x1, y0: c.y, y1: c.y + c.size })
    }
    const pics = page.images.filter((im) => im.jpeg).sort((a, b) => (Math.abs(a.y0 - b.y0) < 25 ? a.x0 - b.x0 : a.y0 - b.y0))
    const capOf = new Map<ImgBox, (typeof groups)[number]>()
    for (const g of groups) {
      // gap between the caption block and each picture; captions sit below, beside or (last) above
      const scored = pics
        .filter((im) => !capOf.has(im))
        .map((im) => {
          const dx = Math.max(0, im.x0 - g.x1, g.x0 - im.x1)
          const dy = Math.max(0, im.y0 - g.y1, g.y0 - im.y1)
          return { im, d: Math.hypot(dx, dy) + (g.y1 <= im.y0 + 4 ? 40 : 0) }
        })
        .filter((x) => x.d < 90)
        .sort((a, b) => a.d - b.d)
      if (scored[0]) capOf.set(scored[0].im, g)
    }
    const used = new Set([...capOf.values()])
    // ruled grids are tables: their text goes into cells, and the table is placed where its first line stands
    const tables = detectTables(page)
    const inTable = new Set<PLine>(tables.flatMap((t) => t.lines))
    const tableAt = new Map<PLine, PdfTable<PLine>>(tables.map((t) => [[...t.lines].sort((a, b) => a.y - b.y || a.x0 - b.x0)[0], t]))
    const flow = lines.filter((l) => !inBox.has(l) && (!inTable.has(l) || tableAt.has(l)) && !(roleOf(l) === 'caption' && groups.some((g) => used.has(g) && g.lines.includes(l))))
    const hasText = flow.length > 0

    // page marker: goes with the first text of the page, or with its first picture/box
    let pageMarker = marker(page.index)
    if (hasText) {
      pending = pageMarker
      pageMarker = ''
    }
    pics.forEach((im, k) => {
      const name = `images/pg-${printNo(page.index)}${pics.length > 1 ? `-${k + 1}` : ''}.jpg`
      images.push({ path: name, data: im.jpeg! })
      const g = capOf.get(im)
      const capSegs: Seg[] = []
      for (const l of g?.lines ?? []) {
        const segs = segsOf(l)
        const tail = plain(capSegs).match(/(\p{L}+)-$/u)?.[1]
        const head = segs.find((s) => s.t.trim())?.t.trim().match(/^\p{Ll}+/u)?.[0]
        if (tail && head) {
          // line-end hyphen in a caption: "smoke-|fired" stays hyphenated, "recon-|figura" is joined
          if (!keepHyphen(tail, head)) {
            const last = [...capSegs].reverse().find((s) => !s.raw && s.t.trim())!
            last.t = last.t.replace(/-\s*$/, '')
          }
        } else if (capSegs.length) capSegs.push({ t: ' ' })
        capSegs.push(...segs)
      }
      const caption = g ? segHtml(capSegs) : ''
      const alt = input.alt?.[name] ?? (g ? plain(capSegs) : '')
      pictures.push({ path: name, alt, caption: g ? plain(capSegs) : '' })
      floats.push({
        page: page.index,
        opener: !page.lines.some((l) => roleOf(l) !== 'caption'),
        html: `<figure class="img_cont">\n<p class="image_Container">${k === 0 ? pageMarker : ''}<img alt="${esc(alt)}" src="${name}"/></p>${caption ? `\n<figcaption class="caption1">${caption}</figcaption>` : ''}\n</figure>`,
      })
    })
    if (pics.length) pageMarker = ''
    for (const b of boxes) floats.push({ page: page.index, opener: false, html: renderBox(b, pageMarker) }), (pageMarker = '')
    if (pageMarker && cur) cur.blocks.push({ kind: 'raw', html: pageMarker }) // blank page

    // reading order: columns left to right, full-width lines (headings) where they fall
    // columns come from body text only (captions and pictures sit anywhere)
    const bodyLines = flow.filter((l) => roleOf(l) === 'body')
    const starts = columnStarts(bodyLines.length > 3 ? bodyLines : flow.filter((l) => roleOf(l) === 'body' || roleOf(l) === 'text'))
    const colStarts = starts.length ? starts : columnStarts(flow)
    for (const l of flow) l.col = columnOf(colStarts, l.x0)
    const isFull = (l: PLine) => colStarts.some((s) => s > l.x0 + 20 && l.x1 > s + 10)
    const fulls = flow.filter(isFull).sort((a, b) => a.y - b.y)
    const ordered: PLine[] = []
    let top = -Infinity
    for (const f of [...fulls, null]) {
      const bottom = f ? f.y : Infinity
      const band = flow.filter((l) => !isFull(l) && l.y >= top && l.y < bottom)
      for (const c of colStarts) ordered.push(...band.filter((l) => l.col === c).sort((a, b) => a.y - b.y))
      if (f) ordered.push(f)
      top = bottom
    }

    // ---- feed the lines ----
    for (let i = 0; i < ordered.length; i++) {
      const l = ordered[i]
      const r = roleOf(l)
      const tbl = tableAt.get(l)
      if (tbl) {
        closePara()
        if (!cur) newSec('other', 'title')
        const lead = pending
        pending = ''
        cur!.blocks.push({ kind: 'raw', html: lead + renderTable(tbl) })
        continue
      }
      const text = titleCase(l.text.trim())
      // contents / index pages are rebuilt from their raw lines (chapter numbers there are just text)
      const startsSection = r === 'title' || ((r === 'subhead' || r === 'subhead2') && !!sectionTypeOf(text) && sectionTypeOf(text) !== cur?.type)
      if (tocLike(cur) && cur!.title.length && !startsSection && r !== 'chapter-number') {
        if (pending) (l.mark = pending), (pending = '')
        cur!.raw.push(l)
        continue
      }
      if (r === 'chapter-number') {
        const s = cur && cur.number === undefined && !cur.blocks.length && cur.title.length && cur.firstPage === book.numbers[page.index] ? cur : newSec('chapter', 'title', book.numbers[page.index])
        // "Primera parte" / "Part One" opens a part; anything else ("Capítulo 1", "3") a chapter
        const kind = sectionTypeOf(l.text.trim())
        s.type = kind === 'part' || kind === 'appendix' ? kind : 'chapter'
        s.number = l.text.trim()
        continue
      }
      if (r === 'title') {
        const prev = ordered[i - 1]
        if (cur && !cur.blocks.length && !para && ((cur.number !== undefined && !cur.title.length) || (prev && roleOf(prev) === 'title' && l.y - prev.y < l.size * 2))) {
          cur.title.push(segsOf(l))
          continue
        }
        newSec(sectionTypeOf(text) ?? 'other', 'title', book.numbers[page.index]).title.push(segsOf(l))
        continue
      }
      if (r === 'subhead' || r === 'subhead2') {
        const t = sectionTypeOf(text)
        const prev = ordered[i - 1]
        const lastBlock = cur?.blocks[cur.blocks.length - 1]
        if (t && t !== 'chapter' && cur?.type !== t) {
          newSec(t, r, book.numbers[page.index]).title.push(segsOf(l))
          continue
        }
        if (cur && !cur.blocks.length && cur.headRole === r && cur.title.length && prev && roleOf(prev) === r && l.y - prev.y < l.size * 2) {
          cur.title.push(segsOf(l)) // two-line section heading
          continue
        }
        closePara()
        // subheads sit one level under the chapter heading (h1); a book with a single subhead style uses h2 for it
        const h = r === 'subhead' || !book.styles.some((x) => x.role === 'subhead' && x.count >= 10) ? 'h2' : 'h3'
        if (lastBlock?.kind === 'raw' && lastBlock.html.startsWith(`<${h}`) && prev && roleOf(prev) === r && l.y - prev.y < l.size * 2) {
          lastBlock.html = lastBlock.html.replace(`</${h}>`, ` ${segHtml(segsOf(l))}</${h}>`) // two-line subhead
          continue
        }
        if (!cur) newSec('other', 'title')
        const lead0 = pending
        pending = ''
        cur!.blocks.push({ kind: 'raw', html: `<${h} class="${r === 'subhead' ? 'subhead' : 'subhead1'}">${lead0}${segHtml(segsOf(l))}</${h}>` })
        continue
      }
      if (!cur) newSec('other', 'title')
      if (tocLike(cur)) {
        if (pending) (l.mark = pending), (pending = '')
        cur!.raw.push(l)
        continue
      }
      // ---- paragraph logic ----
      const prev = para?.last
      const k = kindOf(l)
      // list items: a bullet starts an item, its wrapped lines are set deeper than the bullet; anything else ends the list
      if (r === 'body' && /^[•▪●◦■·]\s*\S/.test(l.text.trim())) {
        closePara()
        para = { kind: 'li', first: k, segs: [], lastPage: l.page, bx: l.x0 }
        appendLine(l, para)
        const first = para.segs.find((x) => !x.raw && x.t.trim())
        if (first) first.t = first.t.replace(/^\s*[•▪●◦■·]\s*/, '')
        continue
      }
      if (para?.kind === 'li' && r === 'body') {
        if (prev && prev.page === l.page && prev.col === l.col && l.x0 > (para.bx ?? 0) + 4 && l.y - prev.y < lead * 1.6) {
          appendLine(l, para)
          continue
        }
        closePara()
      }
      const next = ordered.slice(i + 1).find((x) => roleOf(x) === r)
      const nk = next && !/^[•▪●◦■·]\s*\S/.test(next.text.trim()) ? kindOf(next) : 'flush' // a list item is not the second line of an extract
      const sameFlow = prev && prev.page === l.page && prev.col === l.col
      const gap = sameFlow && l.y - prev!.y > lead * 1.45
      const kind: Para['kind'] = r === 'caption' ? 'caption' : cur!.type === 'bibliography' ? 'hang' : r === 'body' ? 'body' : 'text'
      let start = !para || gap || (kind === 'caption' && l.marker) || (para.kind !== kind && !(para.kind === 'extract' && kind === 'body'))
      let asExtract = false
      let cont = false
      // a flush-left paragraph ends on a short line that closes a sentence (bios, lists)
      const colRight = Math.max(...ordered.filter((x) => x.col === (prev?.col ?? l.col) && roleOf(x) === r).map((x) => x.x1))
      const shortEnd = !!prev && prev.x1 - prev.col < (colRight - prev.col) * 0.72 && /[.!?:)’”]$/.test(prev.text.trim()) && /^[\p{Lu}‘“(]/u.test(l.text.trim())
      if (!start && para && shortEnd && (k === 'flush' || para.kind === 'extract') && para.kind !== 'hang') (start = true), (asExtract = para.kind === 'extract')
      else if (!start && para) {
        if (kind === 'hang') start = k === 'flush'
        else if (para.kind === 'body' && prev && Math.abs(l.x0 - prev.x0) < 2 && k !== 'flush') {
          // same left edge as the line above: text wrapped around a drop cap or picture, not an indent
        } else if (para.kind === 'body') {
          if (k === 'step' || k === 'step2') {
            start = true
            asExtract = k === 'step' && nk !== 'flush'
          }
        } else if (para.kind === 'extract') {
          if (k === 'flush') start = true
          else if (k === 'step2') (start = true), (asExtract = true), (cont = true)
        } else if (para.kind === 'text' && k === 'step') start = true
      } else if (start && kind === 'body') asExtract = k === 'step' && nk === 'step'
      if (start) {
        closePara()
        para = { kind: asExtract ? 'extract' : kind, first: k, segs: [], lastPage: l.page, cont }
      }
      appendLine(l, para!)
    }
  }
  closePara()
  flushFloats(Infinity)

  // ---------------------------------------------------------------- front matter pages
  const front: PSec[] = []
  let halfDone = false
  let fm = 0
  for (const idx of book.front) {
    if (idx === book.imprintPage) continue // the imprint page becomes the copyright page below
    const p = book.pages[idx]
    const mk = marker(idx)
    if (p.lines.length) {
      const author = meta.authors && p.lines.some((l) => l.text.toLowerCase().includes(meta.authors.toLowerCase()))
      const type: SectionType = !halfDone && !author ? 'halftitle' : 'title'
      if (type === 'halftitle') halfDone = true
      const page = await book.doc.getPage(idx + 1)
      const jpg = await raster.page(page, 1200)
      page.cleanup()
      const path = `images/${type}.jpg`
      images.push({ path, data: jpg })
      const alt = p.lines.map((l) => l.text.trim()).join(' ').replace(/\s+/g, ' ')
      front.push({ type, stem: type, title: [], headRole: 'title', blocks: [{ kind: 'raw', html: `<p class="cover">${mk}<img alt="${esc(alt)}" class="cv" src="${path}"/></p>` }], raw: [], nav: type === 'halftitle' ? L.halftitle : L.title })
    } else {
      const im = [...p.images].filter((x) => x.jpeg).sort((a, b) => (b.x1 - b.x0) * (b.y1 - b.y0) - (a.x1 - a.x0) * (a.y1 - a.y0))[0]
      if (!im) continue
      const path = `images/pg-${printNo(idx)}.jpg`
      images.push({ path, data: im.jpeg! })
      pictures.push({ path, alt: input.alt?.[path] ?? '', caption: '' })
      front.push({ type: 'other', stem: fm++ ? `fm${fm - 1}` : 'fm', title: [], headRole: 'title', blocks: [{ kind: 'raw', html: `<figure class="img_cont">\n<p class="image_Container">${mk}<img alt="${esc(input.alt?.[path] ?? '')}" class="cv" src="${path}"/></p>\n</figure>` }], raw: [], nav: '' })
    }
  }

  // ---------------------------------------------------------------- copyright page
  const imprintLines = book.imprintPage !== undefined ? book.pages[book.imprintPage].lines.filter((l) => l.imprint).sort((a, b) => a.y - b.y) : []
  let copyright: PSec | undefined
  if (imprintLines.length) {
    const right = Math.max(...imprintLines.map((l) => l.x1))
    const left = Math.min(...imprintLines.map((l) => l.x0))
    const paras: ImprintPara[] = []
    let prev: PLine | undefined
    let segs: Seg[] = []
    let gapBefore = false
    const flush = () => {
      if (segs.length) paras.push({ html: segHtml(segs), text: plain(segs), gap: gapBefore })
      segs = []
    }
    for (const l of imprintLines) {
      const gap = !!prev && l.y - prev.y > (prev.size + 3) * 1.45
      const shortPrev = !!prev && prev.x1 - left < (right - left) * 0.8
      if (!prev || gap || shortPrev) {
        flush()
        gapBefore = gap || !prev
      } else segs.push({ t: ' ' })
      segs.push(...segsOf(l))
      prev = l
    }
    flush()
    const year = paras.map((p) => p.text).join(' ').match(/\b(19|20)\d{2}\b/)?.[0] ?? String(new Date().getFullYear())
    const res = transformImprint(paras, { eisbn: meta.eisbn, eisbnLabel: meta.language.startsWith('en') ? undefined : L.eisbn, rules: input.rules, author: meta.authors, year, esc })
    for (const r of res.removed) review.push({ level: 'info', msg: `Removed print-only imprint line: "${r}"`, where: 'copyright.xhtml' })
    dropped.push(...res.removed, res.isbnReplaced ?? '', ...(input.rules.rightsStatement ? paras.filter((p) => PRINT_RIGHTS.test(p.text)).map((p) => p.text) : []))
    if (res.isbnReplaced) review.push({ level: 'info', msg: `Print ISBN line "${res.isbnReplaced}" replaced by the e-book ISBN.`, where: 'copyright.xhtml' })
    copyright = {
      type: 'copyright', stem: 'copyright', title: [], headRole: 'title', raw: [], nav: L.copyright,
      blocks: res.paras.map((p) => ({ kind: 'p' as const, cls: p.cls === 'first' ? 'copyr-top' : p.cls === 'spaced' ? 'copyr2' : 'copyr1', html: p.html })),
    }
    copyright.lead = marker(book.imprintPage!)
    if (book.imprintPage !== undefined && book.imprintPage < book.pages.length - 3) front.push(copyright)
  } else review.push({ level: 'warn', msg: 'No imprint (ISBN / copyright lines) found in the PDF — the EPUB has no copyright page.' })
  const all = [...front, ...secs, ...(copyright && !front.includes(copyright) ? [copyright] : [])]
  // the publisher's own last page (advertising for other titles) is print promotion, not part of the book
  const tail = all[all.length - 1]
  if (tail && tail.type === 'other' && all.length > 4 && all.slice(0, -1).some((x) => x.type === 'about' || x.type === 'bibliography' || x.type === 'index' || x.type === 'glossary')) {
    const said = [...tail.title.map(plain), ...tail.blocks.map((x) => x.html.replace(/<[^>]+>/g, ' ')), ...tail.raw.map((l) => l.text)].join(' ').replace(/\s+/g, ' ').trim()
    if (said.split(' ').length < 90 && /www\.|https?:|@|tel[.:é]|visit[ae]?|m[áa]s informaci[óo]n|more information|newsletter|suscr[ií]b|subscribe|s[íi]guenos|follow us/i.test(said)) {
      all.pop()
      dropped.push(said)
      review.push({ level: 'info', msg: `Left out the publisher’s last page (“${said.slice(0, 70)}…”): advertising for other titles, not part of the book.` })
    }
  }

  // ---------------------------------------------------------------- names and labels
  let chapterNo = 0
  let lastPart: PSec | undefined
  const counters = new Map<string, number>()
  const sentence = (t: string) => (t ? t.charAt(0).toLocaleUpperCase() + t.slice(1).toLocaleLowerCase() : t)
  for (const s of all) {
    if (s.stem) continue
    if (s.type === 'chapter') s.stem = `chapter${String(++chapterNo).padStart(2, '0')}`
    else {
      const base = s.type === 'other' ? 'sec' : SECTION_META[s.type].file
      const n = (counters.get(base) ?? 0) + 1
      counters.set(base, n)
      s.stem = n > 1 || s.type === 'part' ? `${base}${n}` : base
    }
    const title = titleCase(s.title.map(plain).join(' '))
    // "Capítulo 1. Title", "Primera parte: Title", "3: Title" — as the InDesign workflow names them
    s.nav ||= !s.number ? title : s.type === 'part' ? `${sentence(s.number)}: ${title}` : /\p{L}/u.test(s.number) && /\d$/.test(s.number) ? `${s.number}. ${title}` : `${s.number}: ${title}`
    if (s.type === 'part') lastPart = s
    else if (s.type === 'chapter' && lastPart) s.parent = `${lastPart.stem}.xhtml`
    else if (s.type !== 'chapter') lastPart = undefined
  }

  // ---------------------------------------------------------------- render sections
  const sections: Section[] = []
  const pageFile = new Map<string, string>()
  const bodyOf = new Map<PSec, string>()
  for (const s of all) {
    const meta0 = SECTION_META[s.type]
    const headId = s.type === 'chapter' ? `chap${chapterIndex(s)}` : s.stem
    let heading = ''
    if (s.title.length) {
      const t = s.title.map(segHtml).join(' ')
      const cls = s.type === 'chapter' ? 'ch-head1' : s.type === 'dedication' ? 'ded-h' : s.type === 'acknowledgments' ? 'ack-h' : s.headRole === 'title' ? 'ch-head' : 'subhead'
      heading = s.number !== undefined
        ? `<h1 class="${cls}" id="${headId}"><span class="ch-num">${esc(s.number)}</span> <span class="ch2">${t}</span></h1>`
        : `<h1 class="${cls}" id="${headId}">${t}</h1>`
    }
    // page markers that arrived before the heading text go in front of it
    let body = (s.lead ? `${s.lead}\n` : '') + (heading ? `${heading}\n` : '')
    if (s.type === 'toc' || s.type === 'list') body += renderToc(s)
    else if (s.type === 'index') body += renderIndex(s)
    else body += renderBlocks(s.blocks)
    bodyOf.set(s, body)
    for (const m of body.matchAll(/id="page-([^"]+)"/g)) pageFile.set(m[1], `${s.stem}.xhtml`)
  }
  function chapterIndex(s: PSec) {
    return all.filter((x) => x.type === 'chapter').indexOf(s) + 1
  }
  for (const s of all) {
    const meta0 = SECTION_META[s.type]
    let body = bodyOf.get(s)!
    // index links: page N → the file that holds page N's marker (or the closest page before it)
    body = body.replace(/href="#pg:(\d+)"/g, (_, n: string) => {
      let k = Number(n)
      while (k > 0 && !pageFile.has(String(k))) k--
      if (!pageFile.has(String(k))) return 'href="#"'
      return `href="${pageFile.get(String(k))}#page-${k}"`
    })
    const label = s.title.length ? ` aria-labelledby="${s.type === 'chapter' ? `chap${chapterIndex(s)}` : s.stem}"` : ` aria-label="${esc(s.nav || s.stem)}"`
    sections.push({
      file: `${s.stem}.xhtml`, id: s.stem, type: s.type, nav: s.nav, parent: s.parent, title: s.nav || meta.title,
      body: `<section${label} epub:type="${s.stem.startsWith('fm') ? 'frontmatter' : meta0.epubType}"${meta0.role && !s.stem.startsWith('fm') ? ` role="${meta0.role}"` : ''}>\n${body}\n</section>`,
    })
  }
  // untitled full-page pictures have no navigation entry
  const navSections = sections.map((s) => (s.nav ? s : { ...s, nav: '' }))

  // ---------------------------------------------------------------- cover
  let cover: ImageOut
  if (input.cover) cover = { path: withRealExt('images/cover.jpg', input.cover.data), data: input.cover.data }
  else throw new Error('A cover image is required (upload the front cover, or the cover PDF).')

  // ---------------------------------------------------------------- review notes
  const noAlt = pictures.filter((p) => !p.alt)
  const capAlt = pictures.filter((p) => p.alt && p.alt === p.caption)
  if (capAlt.length) review.push({ level: 'warn', msg: `${capAlt.length} picture(s) use their caption as alt text. Replace with a description where the caption doesn't describe the image.` })
  if (noAlt.length) review.push({ level: 'error', msg: `${noAlt.length} picture(s) need a description (alt text): ${noAlt.slice(0, 8).map((p) => p.path.replace('images/', '')).join(', ')}${noAlt.length > 8 ? '…' : ''}` })
  const failed = book.pages.flatMap((p) => p.images.filter((i) => !i.jpeg).map(() => printNo(p.index)))
  if (failed.length) review.push({ level: 'warn', msg: `Could not extract ${failed.length} picture(s) (pages ${[...new Set(failed)].join(', ')}): check against the PDF.` })

  const { epub, files } = packageEpub({
    meta, sections: navSections, cover, images, review,
    usedClasses: new Map(), bodyDecls: {}, css: pdfBookCss(book.brand, boxColours(book)),
  })
  // source text: every line the analysis kept (running heads and folios are already gone), de-hyphenated
  for (const p of book.pages) for (const l of p.lines) if (roleOf(l) === 'drop') dropped.push(l.text)
  // line-end hyphens are joined like the build joins them: kept in words the book hyphenates mid-line
  const srcText = book.pages
    // drop caps are separate text in the PDF ("T" + "his"): joined back to their word, as in the e-book
    .map((p) => p.lines.filter((l) => roleOf(l) !== 'dropcap').map((l) => (l.dropcap ?? '') + l.text).join('\n'))
    .join('\n')
    .replace(/(\p{L}+)[-­]\n(\p{Ll}+)/gu, (_, a: string, b: string) => (keepHyphen(a, b) ? `${a}-${b}` : a + b))
  const source: CheckSource = { words: wordsOf(srcText), dropped, printPages: book.numbers.filter((_, i) => book.pages[i].lines.length || book.pages[i].images.length).map(String) }
  return { epub, files, sections: navSections, review, pictures, source }

  // ================================================================ helpers (need closure state)
  /** A table as the InDesign workflow writes it: colgroup widths that add up to 100%, header row as <thead><th> (Settings can keep plain cells). */
  function renderTable(t: PdfTable<PLine>): string {
    const nC = t.cols.length - 1
    const span = t.cols[nC] - t.cols[0]
    const widths = Array.from({ length: nC }, (_, c) => Math.max(10, Math.round(((t.cols[c + 1] - t.cols[c]) / span) * 100)))
    for (let over = widths.reduce((a, b) => a + b, 0) - 100; over !== 0; over -= Math.sign(over)) {
      const k = over > 0 ? widths.indexOf(Math.max(...widths)) : widths.indexOf(Math.min(...widths))
      widths[k] -= Math.sign(over)
    }
    const text = (ls: PLine[]) => {
      const segs: Seg[] = []
      for (const l of ls) {
        const now = segsOf(l)
        const tail = plain(segs).match(/(\p{L}+)-$/u)?.[1]
        const head = now.find((x) => x.t.trim())?.t.trim().match(/^\p{Ll}+/u)?.[0]
        if (tail && head && !keepHyphen(tail, head)) {
          const last = [...segs].reverse().find((x) => !x.raw && x.t.trim())!
          last.t = last.t.replace(/-\s*$/, '')
        } else if (segs.length) segs.push({ t: ' ' })
        segs.push(...now)
      }
      return segHtml(segs)
    }
    const nR = t.rows.length - 1
    const asTh = settings().tableHeaders === 'th'
    const row = (r: number, head: boolean) =>
      `<tr>\n${t.cells
        .filter((k) => k.r === r)
        .sort((a, b) => a.c - b.c)
        .map((k) => {
          const tag = head && asTh ? 'th' : 'td'
          const attrs = `${tag === 'th' ? ' scope="col"' : ''}${head && !asTh ? ' class="tbl-h"' : ''}${k.colspan > 1 ? ` colspan="${k.colspan}"` : ''}${k.rowspan > 1 ? ` rowspan="${k.rowspan}"` : ''}`
          const inner = text(k.lines)
          return inner ? `<${tag}${attrs}>${inner}</${tag}>` : `<${tag}${attrs}/>`
        })
        .join('\n')}\n</tr>`
    const body = Array.from({ length: nR }, (_, r) => r).filter((r) => !(t.head && r === 0 && asTh))
    return [
      `<table class="tbl" id="table${String(++tableNo).padStart(3, '0')}">`,
      `<colgroup>\n${widths.map((w) => `<col style="width:${w}%;"/>`).join('\n')}\n</colgroup>`,
      t.head && asTh ? `<thead>\n${row(0, true)}\n</thead>` : '',
      `<tbody>\n${body.map((r) => row(r, t.head && r === 0)).join('\n')}\n</tbody>`,
      `</table>`,
    ].filter(Boolean).join('\n')
  }

  function renderBlocks(blocks: Block[]): string {
    const out: string[] = []
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i]
      if (b.kind === 'li') {
        // consecutive items (a page marker may sit between two of them) are one list
        const items: string[] = []
        while (i < blocks.length && (blocks[i].kind === 'li' || (blocks[i].kind === 'raw' && blocks[i].html.startsWith('<span') && blocks[i + 1]?.kind === 'li'))) {
          if (blocks[i].kind === 'li') items.push(`<li>${blocks[i].html}</li>`)
          else items[items.length - 1] = items[items.length - 1].replace(/<\/li>$/, `${blocks[i].html}</li>`)
          i++
        }
        i--
        out.push(`<ul class="bull">\n${items.join('\n')}\n</ul>`)
        continue
      }
      if (b.kind !== 'extract') {
        out.push(b.kind === 'raw' ? b.html : `<p class="${b.cls}">${b.html}</p>`)
        continue
      }
      // a run of extract paragraphs: extract1 alone, else extractt … extractint0 … extractint
      const run: Block[] = []
      while (i < blocks.length && (blocks[i].kind === 'extract' || (blocks[i].kind === 'raw' && blocks[i + 1]?.kind === 'extract' && blocks[i].html.startsWith('<span')))) run.push(blocks[i++])
      i--
      const paras = run.filter((x) => x.kind === 'extract')
      let k = 0
      for (const x of run) {
        if (x.kind === 'raw') {
          out.push(x.html)
          continue
        }
        const cls = paras.length === 1 ? 'extract1' : k === 0 ? 'extractt' : k === paras.length - 1 ? 'extractint' : 'extractint0'
        k++
        out.push(`<p class="${cls}">${x.html}</p>`)
      }
    }
    return out.join('\n')
  }

  function renderBox(b: { rect: FillBox; head?: FillBox; lines: PLine[] }, lead0: string): string {
    const starts = columnStarts(b.lines)
    for (const l of b.lines) l.col = columnOf(starts, l.x0)
    const ordered = starts.flatMap((c) => b.lines.filter((l) => l.col === c).sort((x, y) => x.y - y.y))
    const head = ordered.filter((l) => b.head && l.y + l.size / 2 >= b.head.y0 && l.y + l.size / 2 <= b.head.y1)
    const out: string[] = []
    let segs: Seg[] = []
    let prev: PLine | undefined
    let subs = 0
    const flush = (cls: string) => {
      if (segs.length) out.push(`<p class="${cls}">${segHtml(segs)}</p>`)
      segs = []
    }
    for (const l of ordered.filter((x) => !head.includes(x))) {
      const r = roleOf(l)
      const bold = l.runs.every((x) => x.bold) && l.text.length < 80
      if (bold || r === 'subhead' || r === 'subhead2') {
        flush('box-noindent')
        out.push(`<h3 class="${subs++ ? 'box-subhead1' : 'box-subhead'}">${segHtml(segsOf(l))}</h3>`)
        prev = undefined
        continue
      }
      const gap = prev && (prev.col !== l.col || l.y - prev.y > l.size * 1.7)
      if (gap) flush('box-noindent')
      else if (segs.length) segs.push({ t: ' ' })
      segs.push(...segsOf(l))
      prev = l
    }
    flush('box-noindent')
    const headHtml = head.length ? `<div class="brownbox">\n<h2 class="box-head">${lead0}${segHtml(head.flatMap((l, i) => [...(i ? [{ t: " " }] : []), ...segsOf(l)]))}</h2>\n</div>\n` : lead0
    return `<aside class="box">\n${headHtml}<div class="brownbox_1">\n${out.join('\n')}\n</div>\n</aside>`
  }

  /** Contents page of a book with parts and chapters, from the entries read in the analysis: every entry linked to its section. */
  function renderEntries(s: PSec, entries: ContentsEntry[]): string {
    const others = all.filter((x) => x !== s && x.type !== 'toc')
    const full = (x: PSec) => cnorm(`${x.number ?? ''}${x.title.map(plain).join(' ')}`)
    const titleOf = (x: PSec) => cnorm(x.title.map(plain).join(' '))
    const findSec = (e: ContentsEntry): PSec | undefined => {
      const n = cnorm(e.text)
      if (e.kind === 'part') return others.find((x) => x.type === 'part' && (full(x) === n || n.startsWith(cnorm(x.number ?? '#')) && (titleOf(x) === n.slice(cnorm(x.number ?? '').length) || !titleOf(x))))
      if (e.kind === 'label') return others.find((x) => x.type === 'chapter' && x.number && cnorm(x.number) === n)
      // a list of exercises names things inside the chapters, not the chapters themselves
      if (s.type === 'list') return undefined
      return (
        others.find((x) => full(x) === n) ??
        others.find((x) => titleOf(x).length > 3 && (n === titleOf(x) || n.endsWith(titleOf(x)))) ??
        others.find((x) => e.page !== undefined && x.firstPage === e.page && x.type !== 'part') ??
        others.find((x) => x.type === 'chapter' && titleOf(x).length > 3 && titleOf(x).startsWith(n))
      )
    }
    // an exercise under a chapter label links to the subhead with its wording, in the chapter that holds its page
    const anchor = (e: ContentsEntry): string | undefined => {
      if (e.page === undefined) return undefined
      const holder = [...others].filter((x) => x.firstPage !== undefined && x.firstPage <= e.page!).sort((a, b) => b.firstPage! - a.firstPage!)[0]
      if (!holder) return undefined
      const want = cnorm(e.text)
      for (const b of holder.blocks) {
        const m = b.html.match(/^<(h[23]) class="subhead1?"( id="([^"]+)")?>(.*)<\/\1>$/)
        if (b.kind !== 'raw' || !m || cnorm(m[4].replace(/<[^>]+>/g, '')) !== want) continue
        if (m[3]) return `${holder.stem}.xhtml#${m[3]}`
        const id = `sec${++anchorNo}`
        b.html = b.html.replace(/^<(h[23]) class="([^"]+)"/, `<$1 class="$2" id="${id}"`)
        return `${holder.stem}.xhtml#${id}`
      }
      return undefined
    }
    const out: string[] = []
    let prevCls = ''
    const first = new Map<number, ContentsEntry>()
    for (const e of entries) if (!first.has(e.on)) first.set(e.on, e)
    for (const e of entries) {
      const mk = (first.get(e.on) === e && e.on !== entries[0].on ? (s.marks?.get(e.on) ?? '') : '') + e.lines.map((l) => l.mark ?? '').join('')
      const target = findSec(e)
      let cls: string
      let html: string
      if (e.kind === 'part' && target) {
        cls = 'toc_2'
        const label = (target.number ?? '').toLocaleUpperCase()
        html = `<a href="${target.stem}.xhtml">${esc(label)} <span class="toc_2a">${esc(titleCase(target.title.map(plain).join(' ')))}</span></a>`
      } else if (e.kind === 'label') {
        cls = 'toc_3'
        html = target ? `<a href="${target.stem}.xhtml">${esc(titleCase(target.number ?? e.text))}</a>` : esc(e.text)
      } else {
        const href = target ? `${target.stem}.xhtml` : anchor(e)
        cls = target?.type === 'chapter' || (!target && href) ? 'toc_1a' : prevCls === 'toc_1a' ? 'toc_1t' : 'toc_1'
        const label = target ? target.nav : e.text
        html = href ? `<a href="${href}">${esc(label)}</a>` : esc(label)
        if (!href) review.push({ level: 'warn', msg: `Contents entry "${e.text}" could not be linked to a section.`, where: 'toc.xhtml' })
      }
      prevCls = cls
      out.push(`${mk ? mk + '\n' : ''}<p class="${cls}">${html}</p>`)
    }
    return out.join('\n')
  }

  function renderToc(s: PSec): string {
    if (s.entries) return renderEntries(s, s.entries)
    if (s.type === 'list' && s.raw.length) {
      // page by page, in reading order
      const pages = [...new Set(s.raw.map((l) => l.page))].sort((a, b) => a - b)
      const entries = pages.flatMap((pg) => entriesOf(rowsOf(s.raw.filter((l) => l.page === pg), book.pages[pg]?.width ?? 400, pg), pg))
      if (entries.length) return renderEntries(s, entries)
    }
    // entries: text + page number on the same baseline (the number is often a separate line)
    const rows: { l: PLine; segs: Seg[]; page?: number }[] = []
    for (const l of [...s.raw].sort((a, b) => a.y - b.y || a.x0 - b.x0)) {
      const num = l.text.trim().match(/^(\d{1,4})$/)
      const row = rows.find((r) => Math.abs(r.l.base - l.base) < 2)
      // a number left of the entry is its chapter number, one on the right is the page number
      if (num && row && l.x0 < row.l.x0) (row.segs = [...segsOf(l), { t: ' ' }, ...row.segs]), (row.l = l)
      else if (num && row) row.page = Number(num[1])
      else if (row) row.segs.push({ t: ' ' }, ...segsOf(l))
      else {
        const m = l.text.match(/\s(\d{1,4})\s*$/)
        rows.push({ l, segs: [...markOf(l), ...segsOf(l)], page: m ? Number(m[1]) : undefined })
      }
    }
    const out: string[] = []
    for (const r of rows) {
      const text = plain(r.segs).replace(/\s+\d{1,4}$/, '')
      // several sections can start on one page (dedication + acknowledgements): prefer the title match
      const sameTitle = (x: PSec) => titleCase(x.title.map(plain).join(' ')).toLowerCase() === text.replace(/^\d+\s+/, '').toLowerCase()
      const onPage = all.filter((x) => x !== s && r.page !== undefined && x.firstPage === r.page)
      const target = onPage.find(sameTitle) ?? all.find((x) => x !== s && sameTitle(x)) ?? onPage[0]
      const num = text.match(/^(\d{1,3})\s+(.*)$/)
      const mk = r.segs.filter((x) => x.raw).map((x) => x.t).join('')
      const label = mk + (num ? `<span class="space-toc-${num[1].length > 1 ? 11 : 10}">${num[1]}</span> ${esc(num[2])}` : esc(text))
      if (!target) {
        review.push({ level: 'warn', msg: `Contents entry "${text}" could not be linked to a section.`, where: 'toc.xhtml' })
        out.push(`<p class="TOC-2">${label}</p>`)
        continue
      }
      if (num && target.type === 'chapter') target.nav = `${num[1]}: ${num[2]}`
      else target.nav = text
      out.push(`<p class="TOC-2"><a href="${target.stem}.xhtml">${label}</a></p>`)
    }
    return out.join('\n')
  }

  function renderIndex(s: PSec): string {
    type Entry = { level: 1 | 2; text: string; segs: Seg[]; groupStart: boolean }
    const entries: Entry[] = []
    let prev: PLine | undefined
    for (const l of s.raw) {
      const t = l.text.trim()
      if (/^[\d–-]/.test(t) && entries.length) {
        const e = entries[entries.length - 1]
        e.segs.push({ t: ' ' }, ...markOf(l), ...segsOf(l))
        prev = l
        continue
      }
      const gap = !!prev && prev.col === l.col && l.y - prev.y > lead * 1.45
      entries.push({ level: l.x0 - l.col > 3 ? 2 : 1, text: t, segs: [...markOf(l), ...segsOf(l)], groupStart: gap })
      prev = l
    }
    return entries
      .map((e) => {
        const html = segHtml(e.segs).replace(/(^|[\s,–-])(\d{1,4})(?=$|[\s,–-])/g, (_, pre: string, n: string) => `${pre}<a href="#pg:${n}">${n}</a>`)
        return `<p class="${e.level === 2 ? 'Index2' : e.groupStart ? 'Index1-t' : 'Index1'}">${html}</p>`
      })
      .join('\n')
  }
}

const markOf = (l: PLine): Seg[] => (l.mark ? [{ t: l.mark, raw: true }] : [])

function boxColours(book: PdfBook) {
  const panels = new Map<string, number>()
  for (const p of book.pages) for (const f of p.fills) if ((f.x1 - f.x0) * (f.y1 - f.y0) < p.width * p.height * 0.6) panels.set(f.color, (panels.get(f.color) ?? 0) + 1)
  const light = [...panels.keys()].filter((c) => [1, 3, 5].every((i) => parseInt(c.slice(i, i + 2), 16) > 225) && !/^#f{6}$/i.test(c))
  return { panel: light.sort((a, b) => panels.get(b)! - panels.get(a)!)[0] ?? '#f5f5f5' }
}
