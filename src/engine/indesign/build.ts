import { type Block, type Export, type Profile, type Role, type StyleInfo, readExport, inferProfile, cssClassName } from './read.ts'
import { inlineHtml, inlineText, type InlineCtx } from './inline.ts'
import { px, type Decls } from './css.ts'
import { type Files } from '../zip.ts'
import { esc, classesOf, textOf, tag, pageBreakOf, epubType } from '../xml.ts'
import { labelsFor, sectionTypeOf, SECTION_META, type Labels, type SectionType } from '../epub/locale.ts'
import { packageEpub, type BookMeta, type Section, type ReviewItem, type ImageOut } from '../epub/package.ts'
import { imageSize, withRealExt } from '../epub/image.ts'
import { fillMissingPages } from '../pdf/fill-pages.ts'
import { PRINT_ONLY, ISBN_LINE, formatLike } from '../epub/imprint.ts'
import { wordsOf, type CheckSource } from '../check/epub.ts'
import { detectMeta, bodyStart, splitPages, classifyFront } from './front.ts'
import type { PrintPage } from '../pdf/pages.ts'

// =============================================================================================
// InDesign EPUB export  →  house-style accessible EPUB 3
// Rules deduced by diffing the InDesign export against the hand-finished reference EPUB
// (Automation/Indesin-to-EPUB-Automation): see README.md in this app for the full list.
// =============================================================================================

export interface ImageChoice {
  src: string // path inside the export
  placement: 'inline' | 'logo' | 'drop'
  alt: string
  /** purely decorative: empty alt on purpose (screen readers skip it) */
  decorative?: boolean
  width: number
  height: number
}

export interface Analysis {
  ex: Export
  styles: StyleInfo[]
  meta: BookMeta
  /** where each detected book detail was found, shown next to the field */
  sources: Partial<Record<keyof BookMeta, string>>
  images: ImageChoice[]
  review: ReviewItem[]
}

export interface BuildInput {
  styles: StyleInfo[]
  meta: BookMeta
  images: ImageChoice[]
  cover?: { name: string; data: Uint8Array }
  /** pages read from the print PDF: used to restore page markers InDesign left out */
  printPages?: PrintPage[]
}

export interface BuildResult {
  epub: Uint8Array
  files: Files
  sections: Section[]
  review: ReviewItem[]
  /** what the quality check compares the EPUB against */
  source: CheckSource
}

type PBlock = Extract<Block, { t: 'p' }>

// ---------------------------------------------------------------------------------------------
// Step 1: analyse — everything the reviewer needs to confirm before the EPUB is generated
// ---------------------------------------------------------------------------------------------

export function analyze(files: Files, saved: Profile = {}): Analysis {
  const ex = readExport(files)
  const styles = inferProfile(ex, saved)
  const role = new Map(styles.map((s) => [s.key, s.role]))
  const review: ReviewItem[] = []

  const fm = detectMeta(ex, (b) => role.get(b.key) ?? 'p')
  const meta: BookMeta = {
    title: fm.title,
    subtitle: fm.subtitle,
    authors: fm.author,
    publisher: fm.publisher,
    language: ex.lang,
    eisbn: '',
    printIsbn: fm.printIsbn,
    rights: fm.rights,
    certifiedBy: fm.publisher,
    conformsTo: 'EPUB Accessibility 1.1 - WCAG 2.0 Level AA',
  }
  const publisher = fm.publisher
  for (const [k, label] of [['title', 'Title'], ['author', 'Author'], ['publisher', 'Publisher']] as const) {
    const v = k === 'author' ? fm.author : fm[k]
    if (!v) review.push({ level: 'warn', msg: `${label} could not be found in the book — type it in under Book details.` })
    else if (/check/.test(fm.source[k])) review.push({ level: 'warn', msg: `${label} “${v}” was taken from the ${fm.source[k]}.` })
  }

  // images: guess where each belongs (cover placeholder is replaced by the uploaded cover)
  const lastText = ex.blocks.findLastIndex((b) => b.t === 'p' && !!b.text)
  const images: ImageChoice[] = []
  for (const [src, data] of ex.images) {
    if (src === ex.coverImage) continue
    const { width, height } = imageSize(data)
    const at = ex.blocks.findIndex((b) => b.t === 'img' && b.src === src)
    const given = at < 0 ? '' : (ex.blocks[at] as { alt: string }).alt // alt text set in InDesign's object export options
    const logo = width > 0 && width / Math.max(1, height) > 2.5 && width < 1200
    const placement = logo ? 'logo' : at < 0 || at > lastText ? 'drop' : 'inline'
    images.push({
      src, width, height, placement,
      alt: logo ? `${labelsFor(ex.lang).logoAlt}: ${publisher}` : /\.(jpe?g|png|gif|tiff?|psd|ai|eps)$/i.test(given) ? '' : given,
    })
  }
  if (!ex.footnotes.size && ex.blocks.some((b) => b.t === 'p' && b.el.querySelector('a[href*="footnote"]')))
    review.push({ level: 'warn', msg: 'Footnote references found but no footnote text — check the InDesign export options.' })
  const sources = { title: fm.source.title, subtitle: fm.source.subtitle, authors: fm.source.author, publisher: fm.source.publisher, printIsbn: fm.printIsbn ? 'copyright page' : '' }
  return { ex, styles, meta, sources, images, review }
}

export const norm = (s: string) =>
  s.toLocaleLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, '')

// ---------------------------------------------------------------------------------------------
// Step 2: build
// ---------------------------------------------------------------------------------------------

interface Sec {
  type: SectionType
  stem: string
  headId: string
  label: PBlock[]
  title: PBlock[]
  items: Block[]
  labelText: string
  titleText: string
  nav: string
  parent?: Sec
  firstPage?: string
}

export function build(a: Analysis, input: BuildInput): BuildResult {
  const { ex } = a
  const { meta } = input
  const L = labelsFor(meta.language)
  const review: ReviewItem[] = [...a.review]
  const dropped: string[] = [] // text deliberately left out, for the completeness check
  const prof = new Map(input.styles.map((s) => [s.key, s]))
  const roleOf = (b: PBlock): Role => prof.get(b.key)?.role ?? 'p'
  const classOf = (b: PBlock) => prof.get(b.key)?.outClass ?? 'noindent'
  const declsOf = (b: PBlock): Decls => ex.css.decls('p', b.classes)

  // ---- 2a. split the block stream into sections --------------------------------------------
  const opening: Block[] = []
  const imprint: PBlock[] = []
  const secs: Sec[] = []
  let cur = null as Sec | null // assigned inside newSec(); the cast stops TS narrowing it to null
  let seenChapter = false
  // page markers after the last line of text are back-cover / blank pages: not in the e-book
  const lastText = ex.blocks.findLastIndex((b) => b.t === 'p' && !!b.text)
  const blocks = ex.blocks.filter((b, i) => i <= lastText || b.t !== 'pb')
  // everything before the first chapter / known section is front matter, sorted by content in 2b
  const start = bodyStart(blocks, roleOf)
  for (const b of blocks.slice(0, start)) {
    if (b.t === 'p' && !b.text) {
      for (const el of Array.from(b.el.querySelectorAll('*'))) {
        const n = pageBreakOf(el)
        if (n !== null) opening.push({ t: 'pb', n })
      }
    } else if (b.t !== 'p' || roleOf(b) !== 'drop') opening.push(b)
    else dropped.push(b.text)
  }
  const newSec = (type: SectionType): Sec => {
    const s: Sec = { type, stem: '', headId: '', label: [], title: [], items: [], labelText: '', titleText: '', nav: '' }
    // page markers right before a heading belong to the new section
    const prev = cur ? cur.items : opening
    const moved: Block[] = []
    // a section holding only its heading (a part page) keeps the marker of its own page
    const keep = cur && !prev.some((x) => x.t !== 'pb') ? 1 : 0
    while (prev.length > keep && prev[prev.length - 1].t === 'pb') moved.unshift(prev.pop()!)
    s.items.push(...moved)
    secs.push(s)
    cur = s
    return s
  }
  for (let i = start; i < blocks.length; i++) {
    const b = blocks[i]
    if (b.t !== 'p') {
      ;(cur ? cur.items : opening).push(b)
      continue
    }
    const r = roleOf(b)
    if (!b.text) {
      // empty paragraph: keep only page markers hidden inside it
      for (const el of Array.from(b.el.querySelectorAll('*'))) {
        const n = pageBreakOf(el)
        if (n !== null) (cur ? cur.items : opening).push({ t: 'pb', n })
      }
      continue
    }
    if (r === 'imprint') {
      imprint.push(b)
      continue
    }
    if (r === 'drop') {
      dropped.push(b.text)
      continue
    }
    const takeFollowing = (want: Role, into: PBlock[]) => {
      while (i + 1 < blocks.length) {
        const n = blocks[i + 1]
        if (n.t === 'p' && !n.text) i++
        else if (n.t === 'p' && roleOf(n) === want) into.push(blocks[++i] as PBlock)
        else break
      }
    }
    if (r === 'part-label') {
      const s = newSec('part')
      s.label.push(b)
      takeFollowing('part-title', s.title)
    } else if (r === 'chapter-label') {
      const t = sectionTypeOf(b.text)
      const s = newSec(t && t !== 'toc' && t !== 'index' ? t : 'chapter')
      s.label.push(b)
      takeFollowing('chapter-title', s.title)
      seenChapter = true
    } else if (r === 'chapter-title') {
      // "Índice", "Prólogo", "Agradecimientos" set in the chapter-title style are not chapters
      const t = sectionTypeOf(b.text)
      const s = newSec(t && t !== 'chapter' ? t : 'chapter')
      s.title.push(b)
      takeFollowing('chapter-title', s.title)
      seenChapter = true
    } else if (r === 'section-title') {
      const s = newSec(sectionTypeOf(b.text) ?? 'other')
      s.title.push(b)
      if (s.type === 'other') review.push({ level: 'warn', msg: `Section "${b.text}" has an unknown type — exported as generic ${seenChapter ? 'back' : 'front'} matter.`, where: b.text })
    } else (cur ? cur.items : opening).push(b)
  }

  // ---- 2b. front pages by content: half-title, title page, copyright, dedication, epigraph ----
  const mk = (type: SectionType, items: Block[]): Sec => ({ type, stem: '', headId: '', label: [], title: [], items, labelText: '', titleText: '', nav: '' })
  const front: Sec[] = []
  for (const fp of classifyFront(splitPages(opening), roleOf, meta.title)) {
    const type: SectionType = fp.kind
    const last = front[front.length - 1]
    if (last && last.type === type && type !== 'other') last.items.push(...fp.blocks)
    else front.push(mk(type, fp.blocks))
  }
  // headings of known kinds that sat among the front pages keep their own section
  for (const f of front) {
    if (f.type !== 'other') continue
    const h = f.items.find((x): x is PBlock => x.t === 'p' && !!x.text && roleOf(x) === 'section-title')
    if (h) {
      f.title.push(h)
      f.items = f.items.filter((x) => x !== h)
    }
  }
  // imprint lines printed elsewhere in the book (often on the last page) join the copyright page
  let cp = front.find((f) => f.type === 'copyright')
  if (imprint.length) {
    if (!cp) {
      cp = mk('copyright', [])
      const tp = front.findLastIndex((f) => f.type === 'title' || f.type === 'halftitle')
      const prev = front[tp]
      if (prev) while (prev.items.length && prev.items[prev.items.length - 1].t === 'pb') cp.items.unshift(prev.items.pop()!)
      front.splice(tp + 1, 0, cp)
    }
    cp.items.push(...imprint)
  }
  if (!cp) review.push({ level: 'warn', msg: 'No imprint / copyright text found — the EPUB has no copyright page.' })
  const all = [...front, ...secs]

  // ---- 2c. names, ids, navigation labels -----------------------------------------------------
  const counters = new Map<string, number>()
  let chapterNo = 0
  let lastPart: Sec | undefined
  for (const s of all) {
    const m = SECTION_META[s.type]
    const n = (counters.get(m.file) ?? 0) + 1
    counters.set(m.file, n)
    if (s.type === 'chapter') {
      chapterNo++
      s.stem = `chapter${String(chapterNo).padStart(2, '0')}`
      s.headId = `chap${chapterNo}`
    } else if (s.type === 'part') {
      s.stem = `part${n}`
      s.headId = s.stem
    } else {
      s.stem = s.type === 'other' ? `${all.indexOf(s) < all.findIndex((x) => x.type === 'chapter') ? 'fm' : 'bm'}${n}` : n > 1 ? `${m.file}${n}` : m.file
      s.headId = s.stem
    }
    const say = (b: PBlock) => inlineText(b.el, ex.css, meta.language)
    s.labelText = s.label.map(say).join(' ')
    s.titleText = s.title.map(say).join(' ')
    s.nav =
      s.type === 'part' && s.labelText
        ? `${sentence(s.labelText)}: ${s.titleText}`
        : s.labelText && s.titleText
          ? `${s.labelText}${/[.:]$/.test(s.labelText) ? '' : '.'} ${s.titleText}`
          : s.labelText || s.titleText
    if (s.type === 'part') lastPart = s
    else if (s.type === 'chapter' && lastPart) s.parent = lastPart
    else if (s.type !== 'chapter') lastPart = undefined
    s.firstPage = s.items.find((x) => x.t === 'pb')?.t === 'pb' ? (s.items.find((x) => x.t === 'pb') as { n: string }).n : undefined
  }
  const setNav = (type: SectionType, label: string) => all.filter((s) => s.type === type).forEach((s) => (s.nav ||= label))
  setNav('halftitle', L.halftitle)
  setNav('title', L.title)
  setNav('copyright', L.copyright)

  // ---- 2d. link table-of-contents style sections -------------------------------------------
  const headingIds = new Map<PBlock, string>()
  const tocHtml = new Map<Sec, string[]>()
  let secNo = 0
  const repaired: string[] = []
  const headings = all.flatMap((s) =>
    s.items.filter((b): b is PBlock => b.t === 'p' && /^h[345]$/.test(roleOf(b))).map((b) => ({ b, s })),
  )
  for (const s of all) {
    const entries = s.items.filter((b): b is PBlock => b.t === 'p')
    const tocLike = s.type === 'toc' || s.type === 'list' || (entries.length > 2 && entries.filter((b) => roleOf(b) === 'toc').length / entries.length >= 0.5)
    if (!tocLike) continue
    const out: string[] = []
    let lastTarget: Sec | undefined
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i]
      const raw = e.el.textContent ?? ''
      const page = raw.match(/\t\s*(\d+|[ivxlcdm]+)\s*$/i)?.[1]
      const n = norm(raw.replace(/\t\s*(\d+|[ivxlcdm]+)\s*$/i, ''))
      const ctx = inlineCtx(ex, meta.language, L, () => '', () => '')
      const html = inlineHtml(e.el, ctx, { heading: true, stripPageNumber: true })
      const target = all.find((x) => x !== s && n && (norm(x.labelText + x.titleText) === n || norm(x.titleText) === n || norm(x.nav) === n))
      const labelOnly = !target && all.find((x) => x !== s && x.labelText && norm(x.labelText) === n)
      if (labelOnly && labelOnly.type === 'part') {
        // "Primera parte" + next entry "Identifica tu…" → one linked entry
        const next = entries[i + 1]
        if (next && norm(next.text) === norm(labelOnly.titleText)) i++
        out.push(`<p class="toc_2"><a href="${labelOnly.stem}.xhtml">${headingInner(labelOnly, 'toc_2a')}</a></p>`)
        continue
      }
      // a line that only continues the previous entry's title ("…débil / de Sheinbaum 175") is not an entry
      if (!target && lastTarget && n && norm(lastTarget.titleText).endsWith(n) && n !== norm(lastTarget.titleText)) {
        dropped.push(e.text)
        continue
      }
      if (target) {
        lastTarget = target
        const cls = target.type === 'part' ? 'toc_2' : target.label.length || target.type === 'chapter' ? 'toc_1a' : 'toc_1'
        out.push(`<p class="${cls}"><a href="${target.stem}.xhtml">${target.type === 'part' ? headingInner(target, 'toc_2a') : html}</a></p>`)
        continue
      }
      if (labelOnly) {
        lastTarget = labelOnly
        // the export lost the chapter title ("2." only): rebuild the entry from the chapter heading
        if (s.type === 'toc' && labelOnly.titleText && !n.replace(norm(labelOnly.labelText), '')) {
          out.push(`<p class="toc_1a"><a href="${labelOnly.stem}.xhtml">${esc(labelOnly.nav)}</a></p>`)
          repaired.push(labelOnly.nav)
        } else out.push(`<p class="toc_3"><a href="${labelOnly.stem}.xhtml">${html}</a></p>`)
        continue
      }
      const h = headings.find((x) => norm(x.b.text) === n) ?? headings.find((x) => page && x.b.page === page && (norm(x.b.text).includes(n) || n.includes(norm(x.b.text))))
      if (h) {
        if (!headingIds.has(h.b)) headingIds.set(h.b, `sec${++secNo}`)
        out.push(`<p class="toc_1a"><a href="${h.s.stem}.xhtml#${headingIds.get(h.b)}">${html}</a></p>`)
        continue
      }
      const byPage = page && all.find((x) => x.firstPage === page)
      if (byPage && byPage === lastTarget) continue
      if (byPage) {
        out.push(`<p class="toc_1"><a href="${byPage.stem}.xhtml">${html}</a></p>`)
        review.push({ level: 'warn', msg: `TOC entry "${e.text}" linked by page number only (text did not match a heading).`, where: s.stem })
        continue
      }
      out.push(`<p class="toc_1">${html}</p>`)
      review.push({ level: 'error', msg: `TOC entry "${e.text}" could not be linked to any section.`, where: s.stem })
    }
    tocHtml.set(s, out)
    if (repaired.length) review.push({ level: 'info', msg: `Contents: ${repaired.length} entr${repaired.length === 1 ? 'y' : 'ies'} had lost their chapter title in the InDesign export and were rebuilt from the chapter headings (${repaired.slice(0, 3).join('; ')}${repaired.length > 3 ? '…' : ''}).`, where: s.stem })
    // every chapter and part should be reachable from the printed contents
    const linked = new Set([...out.join('\n').matchAll(/href="([^"#]+)\.xhtml/g)].map((m) => m[1]))
    const missing = all.filter((x) => (x.type === 'chapter' || x.type === 'part') && !linked.has(x.stem))
    if (s.type === 'toc' && missing.length) review.push({ level: 'warn', msg: `Contents page does not list: ${missing.map((x) => x.nav).slice(0, 5).join('; ')}${missing.length > 5 ? '…' : ''}. They are still in the navigation menu.`, where: s.stem })
  }

  // ---- 2e. render every section ---------------------------------------------------------------
  const seenPages = new Set<string>()
  const idFile = new Map<string, string>()
  const usedClasses = new Map<string, { tag: string; decls: Decls }>()
  const imgOut: ImageOut[] = []
  const imgChoice = new Map(input.images.map((i) => [i.src, i]))
  const imgName = (src: string) => withRealExt('images/' + src.split('/').pop()!.toLowerCase().replace(/[^a-z0-9._-]+/g, '_'), ex.images.get(src) ?? new Uint8Array())
  let linkedNotes = 0
  let fnNo = 0
  const fnSeen = new Map<string, string>()
  const logos = input.images.filter((i) => i.placement === 'logo')

  const sections: Section[] = []
  for (const s of all) {
    const file = `${s.stem}.xhtml`
    const notes: string[] = []
    const ctx = inlineCtx(
      ex, meta.language, L,
      (n) => {
        if (seenPages.has(n)) return ''
        seenPages.add(n)
        return pageSpan(n, L)
      },
      (id) => {
        const li = ex.footnotes.get(id)
        if (!li) {
          review.push({ level: 'error', msg: `Footnote "${id}" is referenced but its text is missing.`, where: file })
          return ''
        }
        const num = String(++fnNo).padStart(2, '0')
        fnSeen.set(id, num)
        const marker = footnoteMarker(li)
        notes.push(renderFootnote(li, num, marker, ex, meta.language, L))
        return `<a epub:type="noteref" href="#fn-${num}" id="fn_${num}" role="doc-noteref">${esc(marker)}</a>`
      },
    )
    const use = (tg: string, cls: string, d: Decls) => {
      if (!usedClasses.has(`${tg}.${cls}`)) usedClasses.set(`${tg}.${cls}`, { tag: tg, decls: d })
    }
    let body = ''
    const meta0 = SECTION_META[s.type]
    const heading = renderHeading(s, ctx, classOf, declsOf, use)
    const items: Item[] = []
    const isFront = s.type === 'halftitle' || s.type === 'title' || s.type === 'copyright'
    // end-of-chapter notes: a "Notes" subheading followed by numbered paragraphs
    let inNotes = false
    for (const b of isFront ? [] : s.items) {
      if (b.t === 'pb') {
        items.push({ kind: 'other', html: ctx.pageMarker(b.n) })
        continue
      }
      if (b.t === 'img') {
        const c = imgChoice.get(b.src)
        if (!c || c.placement !== 'inline') continue
        const name = imgName(b.src)
        imgOut.push({ path: name, data: ex.images.get(b.src)! })
        if (!c.alt && !c.decorative) review.push({ level: 'error', msg: `Picture ${name.replace('images/', '')} needs a description (alt text), or mark it as decorative.`, where: file })
        items.push({ kind: 'other', html: `<p class="img"><img alt="${c.decorative ? '' : esc(c.alt)}"${c.decorative ? ' role="presentation"' : ''} src="${name}"/></p>` })
        continue
      }
      if (b.t === 'table') {
        items.push({ kind: 'other', html: renderTable(b.el, ctx, ex) })
        continue
      }
      for (const el of Array.from(b.el.querySelectorAll('[id]'))) idFile.set(el.id, file)
      if (b.el.id) idFile.set(b.el.id, file)
      const r = roleOf(b)
      const cls = classOf(b)
      if (tocHtml.has(s)) continue
      if (r === 'bullet') {
        use('li', 'bull', {})
        items.push({ kind: 'li', html: inlineHtml(b.el, ctx, { stripBullet: true }) })
      } else if (r === 'h3' || r === 'h4' || r === 'h5') {
        use(r, cls, declsOf(b))
        const id = headingIds.get(b)
        inNotes = sectionTypeOf(b.text) === 'notes'
        items.push({ kind: inNotes ? 'note' : 'other', html: `<${r} class="${cls}"${id ? ` id="${id}"` : ''}>${inlineHtml(b.el, ctx, { heading: true })}</${r}>` })
      } else {
        const d = declsOf(b)
        use('p', cls, d)
        // a whole block set in from the margin (exercises, extracts) — not just a first-line indent
        const inset = px(d['margin-left']) > 0 && px(d['margin-left']) + px(d['text-indent']) > 0
        const note = inNotes ? b.text.match(/^(\d{1,3})(?!\d)/)?.[1] : undefined
        items.push({ kind: inNotes ? 'note' : inset ? 'inset' : 'other', note, html: `<p class="${cls}">${inlineHtml(b.el, ctx, { stripPageNumber: r === 'toc' })}</p>` })
      }
    }
    linkedNotes += linkNotes(items, s.headId || s.stem)
    if (tocHtml.has(s)) {
      // keep page markers of the printed TOC pages, then the rebuilt linked entries
      body += items.filter((x) => x.html.startsWith('<span')).map((x) => x.html).join('\n') + '\n'
      body += heading + '\n' + tocHtml.get(s)!.join('\n')
    } else if (isFront) {
      body += renderFront(s, ctx, meta, logos, imgName, imgOut, ex, L, review, declsOf, dropped)
    } else {
      // page markers that precede the heading stay above it
      let k = 0
      while (k < items.length && items[k].html.startsWith('<span') && items[k].kind === 'other') body += items[k++].html + '\n'
      body += heading + '\n' + groupItems(items.slice(k))
    }
    if (notes.length) body += `\n<div class="footnotes">\n${notes.join('\n')}\n</div>`
    const name = s.nav || (s.type === 'dedication' ? L.dedication : s.type === 'epigraph' ? L.epigraph : L.front)
    const lbl = s.headId && heading ? ` aria-labelledby="${s.headId}"` : ` aria-label="${esc(name)}"`
    const etype = s.type === 'other' && s.stem.startsWith('fm') ? 'frontmatter' : meta0.epubType
    const sectionHtml = `<section${lbl} epub:type="${etype}"${meta0.role ? ` role="${meta0.role}"` : ''}>\n${body}\n</section>`
    sections.push({ file, id: s.stem, type: s.type, nav: s.nav, parent: s.parent ? `${s.parent.stem}.xhtml` : undefined, body: sectionHtml, title: s.nav || name })
  }

  // cross references (InDesign hyperlinks to text anchors) → the file that now holds the anchor
  for (const sec of sections) {
    sec.body = sec.body.replace(/href="xref:([^"]*)"/g, (_, id: string) => {
      const f = idFile.get(id)
      if (!f) review.push({ level: 'warn', msg: `Internal link to "${id}" points nowhere; link removed.`, where: sec.file })
      return `href="${f ?? sec.file}"`
    })
  }
  const gaps = fillMissingPages(sections, input.printPages ?? [], (n) => pageSpan(n, L))
  if (gaps.added.length) review.push({ level: 'info', msg: `Added page markers missing from the InDesign export, placed from the print PDF: ${gaps.added.join(', ')}.` })
  if (gaps.removed.length) review.push({ level: 'info', msg: `Removed page markers of blank printed pages: ${gaps.removed.join(', ')}.` })
  if (gaps.missing.length)
    review.push({ level: 'warn', msg: `No page marker for page(s) ${gaps.missing.join(', ')}${input.printPages?.length ? ' (could not be located in the print PDF)' : ' — upload the print PDF to place them automatically'}.` })
  if (linkedNotes) review.push({ level: 'info', msg: `Linked ${linkedNotes} note number(s) in the text to their notes and back.` })
  if (fnSeen.size < ex.footnotes.size)
    review.push({ level: 'warn', msg: `${ex.footnotes.size - fnSeen.size} footnote(s) are never referenced in the text and were dropped.` })

  // cover
  let cover: ImageOut
  if (input.cover) cover = { path: withRealExt('images/cover.jpg', input.cover.data), data: input.cover.data }
  else if (ex.coverImage && ex.images.get(ex.coverImage)) {
    cover = { path: withRealExt('images/cover.jpg', ex.images.get(ex.coverImage)!), data: ex.images.get(ex.coverImage)! }
    review.push({ level: 'error', msg: 'No cover uploaded — used the cover image from the InDesign export. InDesign often exports a blank placeholder: check it.' })
  } else throw new Error('A cover image is required.')

  const { epub, files } = packageEpub({
    meta, sections, cover, images: imgOut, usedClasses,
    bodyDecls: ex.css.decls('p', a.ex.blocks.find((b): b is PBlock => b.t === 'p' && prof.get(b.key)?.outClass === 'indent')?.classes ?? []),
    review,
  })
  // the source text the e-book must contain: every paragraph, table cell and footnote of the export
  const srcText = [
    ...ex.blocks.map((b) => (b.t === 'p' ? b.text : b.t === 'table' ? textOf(b.el) : '')),
    ...[...fnSeen.keys()].map((id) => textOf(ex.footnotes.get(id))),
  ]
  const source: CheckSource = { words: srcText.flatMap(wordsOf), dropped, printPages: input.printPages?.filter((p) => !p.blank).map((p) => p.n) }
  return { epub, files, sections, review, source }
}

// ---------------------------------------------------------------------------------------------
// rendering helpers
// ---------------------------------------------------------------------------------------------

function inlineCtx(ex: Export, lang: string, _L: Labels, pageMarker: (n: string) => string, noteRef: (id: string) => string): InlineCtx {
  return { css: ex.css, lang, pageMarker, noteRef }
}

export const pageSpan = (n: string, L: Labels) =>
  `<span aria-label="${L.page} ${esc(n)}" epub:type="pagebreak" id="page-${esc(n)}" role="doc-pagebreak" title="${L.page} ${esc(n)}"/>`

const sentence = (s: string) => {
  const t = s.toLocaleLowerCase()
  return t.charAt(0).toLocaleUpperCase() + t.slice(1)
}

function headingInner(s: Sec, titleClass: string): string {
  // used for linked TOC entries of parts: "PRIMERA PARTE <span class="toc_2a">Title</span>"
  const lbl = s.label.map((b) => b.text).join(' ')
  return `${esc(lbl.toLocaleUpperCase())} <span class="${titleClass}">${esc(s.titleText)}</span>`
}

function renderHeading(
  s: Sec, ctx: InlineCtx, classOf: (b: PBlock) => string, declsOf: (b: PBlock) => Decls,
  use: (tg: string, cls: string, d: Decls) => void,
): string {
  if (!s.label.length && !s.title.length) return ''
  const h = s.type === 'part' ? 'h1' : 'h2'
  const html = (bs: PBlock[]) => bs.map((b) => inlineHtml(b.el, ctx, { heading: true })).join(' ')
  if (s.label.length && s.title.length) {
    const lc = classOf(s.label[0])
    const tc = classOf(s.title[0])
    use(h, lc, declsOf(s.label[0]))
    use('span', tc, declsOf(s.title[0]))
    return `<${h} class="${lc}" id="${s.headId}">${html(s.label)} <span class="${tc}">${html(s.title)}</span></${h}>`
  }
  const only = s.label.length ? s.label : s.title
  const c = classOf(only[0])
  use(h, c, declsOf(only[0]))
  return `<${h} class="${c}" id="${s.headId}">${html(only)}</${h}>`
}

type Item = { kind: 'li' | 'inset' | 'note' | 'other'; html: string; note?: string }

/** Note numbers in the text (<sup>3</sup>) ↔ numbered notes under the "Notes" subheading: links both ways. */
function linkNotes(items: Item[], key: string): number {
  const nums = new Set(items.filter((x) => x.note).map((x) => x.note!))
  if (!nums.size) return 0
  const refd = new Set<string>()
  const SUP = /<sup>(?:<span[^>]*>)?\s*(\d{1,3})\s*(?:<\/span>)?<\/sup>/g
  for (const it of items) {
    if (it.kind === 'note') continue
    it.html = it.html.replace(SUP, (m, n: string) => {
      if (!nums.has(n)) return m
      const first = !refd.has(n)
      refd.add(n)
      return `<sup><a epub:type="noteref" href="#${key}-n${n}"${first ? ` id="${key}-r${n}"` : ''} role="doc-noteref">${n}</a></sup>`
    })
  }
  for (const it of items) {
    if (!it.note) continue
    const n = it.note
    it.html = it.html.replace(/^<p([^>]*)>\s*(?:<sup>)?(?:<span[^>]*>)?\s*(\d{1,3})\s*(?:<\/span>)?(?:<\/sup>)?[\s.]*/, (_, attrs: string) =>
      `<p${attrs} epub:type="endnote" id="${key}-n${n}">${refd.has(n) ? `<a epub:type="backlink" href="#${key}-r${n}" role="doc-backlink">${n}</a>` : n} `)
  }
  return refd.size
}

/** consecutive list items → <ul>, indented blocks → <div class="top">, notes → <section role="doc-endnotes"> */
function groupItems(items: Item[]): string {
  const out: string[] = []
  for (let i = 0; i < items.length; ) {
    const k = items[i].kind
    if (k === 'other') {
      out.push(items[i++].html)
      continue
    }
    const run: string[] = []
    while (i < items.length) {
      const it = items[i]
      const isMarker = it.kind === 'other' && it.html.startsWith('<span') && items[i + 1]?.kind === k
      if (it.kind !== k && !isMarker) break
      if (k === 'li') {
        if (isMarker) run[run.length - 1] = run[run.length - 1] + it.html // page marker inside a list: keep in the item before it
        else run.push(`<li>${it.html}</li>`)
      } else run.push(it.html)
      i++
    }
    out.push(
      k === 'li'
        ? `<ul class="bull">\n${run.map((r) => (r.endsWith('</li>') ? r : r.replace(/<\/li>(.*)$/, '$1</li>'))).join('\n')}\n</ul>`
        : k === 'note'
          ? `<section epub:type="endnotes" role="doc-endnotes">\n${run.join('\n')}\n</section>`
          : `<div class="top">\n${run.join('\n')}\n</div>`,
    )
  }
  return out.join('\n')
}

function footnoteMarker(li: Element): string {
  const a = li.querySelector('a')
  const m = (a?.textContent ?? '').trim()
  return /^\*+$/.test(m) || !m ? '*' : m
}

function renderFootnote(li: Element, num: string, marker: string, ex: Export, lang: string, L: Labels): string {
  const ctx = inlineCtx(ex, lang, L, (n) => pageSpan(n, L), () => '')
  const ps = Array.from(li.querySelectorAll('p')).length ? Array.from(li.querySelectorAll('p')) : [li]
  const paras = ps.map((p, i) => {
    const clone = p.cloneNode(true) as Element
    for (const a of Array.from(clone.querySelectorAll('a'))) {
      if (a.getAttribute('role') === 'doc-backlink' || classesOf(a).includes('_idFootnoteAnchor') || epubType(a) === 'backlink') a.remove()
    }
    const back = i === 0 ? `<a epub:type="backlink" href="#fn_${num}" role="doc-backlink">${esc(marker)}</a> ` : ''
    return `<p class="Nota-al-pie">${back}${inlineHtml(clone, ctx)}</p>`
  })
  return `<div epub:type="footnote" id="fn-${num}" role="doc-footnote">\n${paras.join('\n')}\n</div>`
}

function renderTable(el: Element, ctx: InlineCtx, ex: Export): string {
  const rows = Array.from(el.querySelectorAll('tr'))
  const cellsOf = (tr: Element) => Array.from(tr.children).filter((c) => /^t[dh]$/.test(tag(c)))
  const ncol = Math.max(...rows.map((r) => cellsOf(r).reduce((n, c) => n + Number(c.getAttribute('colspan') ?? 1), 0)))
  const len = new Array(ncol).fill(4)
  rows.forEach((r) => cellsOf(r).forEach((c, i) => (len[i] = Math.max(len[i] ?? 4, Math.min(60, textOf(c).length)))))
  const total = len.reduce((a, b) => a + b, 0)
  const widths = len.map((l) => Math.max(10, Math.round((l / total) * 100)))
  const isHead = (tr: Element) =>
    cellsOf(tr).every((c) => {
      const d = ex.css.decls('td', classesOf(c))
      const p = c.querySelector('p')
      return !!d['background-color'] || tag(c) === 'th' || (p ? /cabecer|head|titul/i.test(p.getAttribute('class') ?? '') || ex.css.paragraphFace(classesOf(p)).bold : false)
    })
  const headRows = rows.length > 1 && isHead(rows[0]) ? 1 : 0
  const cell = (c: Element, th: boolean) => {
    const span = ['colspan', 'rowspan'].map((a) => (c.getAttribute(a) ? ` ${a}="${c.getAttribute(a)}"` : '')).join('')
    const ps = Array.from(c.querySelectorAll('p'))
    const inner = ps.length ? ps.map((p) => inlineHtml(p, ctx)).join('<br/>') : inlineHtml(c, ctx)
    return th ? `<th scope="col"${span}>${inner}</th>` : `<td${span}>${inner}</td>`
  }
  const tr = (r: Element, th: boolean) => `<tr>${cellsOf(r).map((c) => cell(c, th)).join('')}</tr>`
  const cls = cssClassName(classesOf(el)[0] ?? 'table')
  return [
    `<table class="${cls}"${el.id ? ` id="${el.id}"` : ''}>`,
    `<colgroup>${widths.map((w) => `<col style="width:${w}%;"/>`).join('')}</colgroup>`,
    headRows ? `<thead>\n${tr(rows[0], true)}\n</thead>` : '',
    `<tbody>\n${rows.slice(headRows).map((r) => tr(r, false)).join('\n')}\n</tbody>`,
    `</table>`,
  ].filter(Boolean).join('\n')
}

function renderFront(
  s: Sec, ctx: InlineCtx, meta: BookMeta, logos: ImageChoice[], imgName: (s: string) => string, imgOut: ImageOut[],
  ex: Export, L: Labels, review: ReviewItem[], declsOf: (b: PBlock) => Decls, dropped: string[],
): string {
  const out: string[] = []
  const eq = (a: string, b: string) => !!b && norm(a) === norm(b)
  const authors = meta.authors.split(/\s*[,;&]\s*|\s+y\s+|\s+and\s+/).filter(Boolean)
  let isbnDone = false
  let first = true
  // the e-ISBN is written with the same hyphenation as the print ISBN it replaces
  const eisbnShown = /[ -]/.test(meta.eisbn) || !meta.printIsbn ? meta.eisbn : formatLike(meta.eisbn, meta.printIsbn)
  // copyright page: print lines broken mid-sentence become one paragraph again
  // ("…en el ámbito de las ideas y el conocimiento," + "promueve la libre expresión…")
  const items: Block[] = []
  const joined = new Map<PBlock, PBlock[]>()
  let prev: PBlock | undefined
  for (const b of s.items) {
    const cont =
      s.type === 'copyright' && b.t === 'p' && prev && b.text &&
      !/[.!?…»”")\]]$/.test(prev.text) && !/^(https?:|www\.|\S+@\S+$|[\w-]+(\.[\w-]+)+(\/\S*)?$)/i.test(b.text) &&
      !ISBN_LINE.test(b.text) && !ISBN_LINE.test(prev.text) && !b.text.includes('©') &&
      (/^[\p{Ll}(]/u.test(b.text) || /[,;:–-]$/.test(prev.text))
    if (cont && prev) {
      joined.get(prev)!.push(b)
      prev.text += ' ' + b.text
      continue
    }
    if (b.t === 'p') {
      prev = { ...b }
      joined.set(prev, [b])
      items.push(prev)
    } else items.push(b)
  }
  const html = (b: PBlock) => (joined.get(b) ?? [b]).map((x) => inlineHtml(x.el, ctx)).join(' ')
  for (const b of s.type === 'copyright' ? items : s.items) {
    if (b.t === 'pb') {
      out.push(ctx.pageMarker(b.n))
      continue
    }
    if (b.t !== 'p') continue
    if (s.type === 'halftitle') {
      out.push(`<h1 class="title">${inlineHtml(b.el, ctx, { heading: true })}</h1>`)
      continue
    }
    if (s.type === 'title') {
      if (eq(b.text, meta.title)) out.push(`<h1 class="title_1">${inlineHtml(b.el, ctx, { heading: true })}</h1>`)
      else if (authors.some((a) => eq(b.text, a))) out.push(`<p class="title-3">${inlineHtml(b.el, ctx, { heading: true })}</p>`)
      else if (eq(b.text, meta.subtitle)) out.push(`<p class="title-4">${inlineHtml(b.el, ctx, { heading: true })}</p>`)
      else out.push(`<p class="title-2">${inlineHtml(b.el, ctx, { heading: true })}</p>`)
      continue
    }
    // copyright page
    if (PRINT_ONLY.test(b.text)) {
      review.push({ level: 'info', msg: `Removed print-only imprint line: "${b.text}"`, where: 'copyright.xhtml' })
      dropped.push(b.text)
      continue
    }
    const cls = first ? 'copy_top' : px(declsOf(b)['margin-left']) > 0 ? 'copy_t' : 'copy1'
    first = false
    if (ISBN_LINE.test(b.text)) {
      if (!isbnDone && meta.eisbn) out.push(`<p class="${cls}">${esc(L.eisbn)}: ${esc(eisbnShown)}</p>`)
      if (!isbnDone) review.push({ level: 'info', msg: `Print ISBN line "${b.text}" replaced by the e-book ISBN.`, where: 'copyright.xhtml' })
      dropped.push(b.text)
      isbnDone = true
      continue
    }
    out.push(`<p class="${cls}">${html(b)}</p>`)
  }
  if (s.type === 'copyright' && !isbnDone && meta.eisbn) out.push(`<p class="copy1">${esc(L.eisbn)}: ${esc(eisbnShown)}</p>`)
  if (s.type === 'title') {
    if (!out.some((h) => h.includes('class="title_1"'))) review.push({ level: 'warn', msg: `Title page: no line matches the book title "${meta.title}", so no <h1> was set.`, where: 'title.xhtml' })
    for (const l of logos) {
      const name = imgName(l.src)
      imgOut.push({ path: name, data: ex.images.get(l.src)! })
      out.push(`<p class="tit_img"><img alt="${esc(l.alt)}" class="w1" src="${name}"/></p>`)
    }
  }
  if (s.type === 'halftitle' && !out.some((h) => h.startsWith('<h1'))) out.push(`<h1 class="title">${esc(meta.title)}</h1>`)
  return out.join('\n')
}
