// Word manuscript → EPUB 3. Chapters come from heading styles, kept only when the book's own
// contents list names them, so a heading that is not in the contents stays inside the current chapter.
// Page breaks stay inside the paragraph. A "run on" / no-indent paragraph joins the line above.
import { esc } from '../xml.ts'
import { labelsFor, sectionTypeOf, SECTION_META, type SectionType } from '../epub/locale.ts'
import { packageEpub, type BookMeta, type ReviewItem, type Section, type ImageOut } from '../epub/package.ts'
import { wordsOf, type CheckSource } from '../check/epub.ts'
import { imageSize, withRealExt } from '../epub/image.ts'
import { isPlaceholderAlt, type SpecPicture } from '../epub/alt.ts'
import { pdfImgHtml, pdfPictureAlt } from '../pdfepub/build.ts'
import { normTitle, type WordBlock, type WordBook, type WordInline, type WordPara, type WordTable } from './read.ts'

export interface WordBuildInput {
  meta: BookMeta
  cover: { name: string; data: Uint8Array }
  /** typed descriptions keyed by the picture path (images/foto.png). They win over the spec and a draft. */
  alt?: Record<string, string>
  pictures?: SpecPicture[]
  ai?: Record<string, { alt: string; approved?: boolean }>
  /** reviewer titles for parts that had none, same index as the outline */
  sectionNav?: Record<number, string>
}

export interface WordBuildResult {
  epub: Uint8Array
  files: Map<string, Uint8Array>
  sections: Section[]
  review: ReviewItem[]
  pictures: { path: string; alt: string; caption: string; decorative: boolean; longDesc: string; source: 'spec' | 'file' | 'decorative' | 'ai' | 'typed'; approved: boolean }[]
  source: CheckSource
}

const WORD_CSS = `body { font-family: serif; line-height: 1.45; }
h1, h2, h3, h4, h5, h6 { font-weight: bold; line-height: 1.2; margin: 1.2em 0 0.4em; }
h1 { font-size: 1.6em; }
h2 { font-size: 1.3em; }
p { margin: 0 0 0.6em; }
ul, ol { margin: 0 0 0.6em 1.4em; }
table { border-collapse: collapse; width: 100%; margin: 0.8em 0; }
th, td { border: 1px solid #ccc; padding: 0.3em 0.5em; vertical-align: top; }
th { font-weight: bold; }
figure { margin: 1em 0; }
img { max-width: 100%; height: auto; }
`

type Chunk = { kind: 'p' | 'h' | 'raw'; html: string }

function inlinesHtml(inlines: WordInline[], page: (n: string) => string): string {
  let html = ''
  for (const i of inlines) {
    if (i.t === 'page') {
      html += page(i.text)
      continue
    }
    let t = esc(i.text)
    if (i.italic && i.text.trim()) t = `<i>${t}</i>`
    if (i.bold && i.text.trim()) t = `<b>${t}</b>`
    html += t
  }
  return html
}

function headingHtml(level: number, title: string, id?: string): string {
  const n = Math.min(6, Math.max(1, level))
  const idAttr = id ? ` id="${esc(id)}"` : ''
  const cls = n === 1 ? 'chapter' : 'subhead'
  return `<h${n} class="${cls}"${idAttr} role="heading" aria-level="${n}">${esc(title)}</h${n}>`
}

function joinHtml(prev: string, next: string): string {
  if (!prev) return next
  if (!next) return prev
  const gap = /\s$/.test(prev) || /^\s/.test(next) ? '' : ' '
  return prev + gap + next
}

function renderList(items: { level: number; ordered: boolean; html: string }[]): string {
  const walk = (from: number, level: number): { html: string; next: number } => {
    const ordered = items[from]?.ordered ?? false
    const tag = ordered ? 'ol' : 'ul'
    let html = ''
    let i = from
    while (i < items.length && items[i].level >= level) {
      if (items[i].level > level) {
        const sub = walk(i, items[i].level)
        html = html.replace(/<\/li>\n$/, `\n${sub.html}\n</li>\n`)
        i = sub.next
        continue
      }
      if (items[i].ordered !== ordered && html) break
      html += `<li>${items[i].html}</li>\n`
      i++
    }
    return { html: `<${tag}>\n${html}</${tag}>`, next: i }
  }
  if (!items.length) return ''
  let html = ''
  let i = 0
  while (i < items.length) {
    const part = walk(i, items[i].level)
    html += part.html
    i = part.next
  }
  return html
}

interface Draft {
  type: SectionType
  nav: string
  head: string
  chunks: Chunk[]
}

/** Build an EPUB from a Word manuscript. The cover is still required; the ISBN is left for the reviewer. */
export function buildWordEpub(book: WordBook, input: WordBuildInput): WordBuildResult {
  const { meta } = input
  const L = labelsFor(meta.language || book.language)
  const review: ReviewItem[] = []
  const page = (n: string) => `<span aria-label="${esc(L.page)} ${esc(n)}" epub:type="pagebreak" id="page-${esc(n)}" role="doc-pagebreak" title="${esc(L.page)} ${esc(n)}"/>`
  // the contents list, at every level, decides which headings start a section; a wrapped heading still matches as part of its entry
  const tocKeys = new Set([...book.toc, ...book.tocEntries.map((e) => normTitle(e.text))].filter(Boolean))
  const tocBlob = ` ${[...tocKeys].join(' ')} `
  const inContents = (key: string) => tocKeys.has(key) || (key.length >= 6 && tocBlob.includes(` ${key} `))
  const gated = tocKeys.size > 0
  const images: ImageOut[] = []
  const pictures: WordBuildResult['pictures'] = []
  const spoken: string[] = []
  const drafts: Draft[] = []
  let cur: Draft | null = null
  const seenNames = new Map<string, number>()

  const ensure = (): Draft => {
    if (cur) return cur
    const next: Draft = { type: 'other', nav: '', head: '', chunks: [] }
    cur = next
    return next
  }
  const start = (title: string, type: SectionType) => {
    if (cur) drafts.push(cur)
    const n = drafts.length + 1
    const id = type === 'chapter' ? `chap${String(n).padStart(2, '0')}` : `h${n}`
    cur = { type, nav: title, head: title ? headingHtml(1, title, id) : '', chunks: [] }
  }
  const addPara = (para: WordPara) => {
    const html = inlinesHtml(para.inlines, page)
    if (!html.trim()) return
    const box = ensure()
    const last = box.chunks[box.chunks.length - 1]
    if (para.runOn && last?.kind === 'p') last.html = joinHtml(last.html, html)
    else box.chunks.push({ kind: 'p', html })
  }

  for (let i = 0; i < book.blocks.length; i++) {
    const block: WordBlock = book.blocks[i]
    if (block.role === 'heading') {
      const key = normTitle(block.text)
      const known = sectionTypeOf(block.text)
      // level 1 starts a section; so does a level 2 heading that the contents names, or that is a chapter or part by its own words
      const startsChapter = block.level === 1 ? !gated || inContents(key) || (!!known && known !== 'chapter') : block.level === 2 && (gated ? inContents(key) : known === 'chapter' || known === 'part')
      if (startsChapter) {
        start(block.text, known && known !== 'chapter' ? known : 'chapter')
        spoken.push(block.text)
      } else {
        ensure().chunks.push({ kind: 'h', html: headingHtml(block.level === 1 ? 2 : block.level, block.text) })
        spoken.push(block.text)
      }
      continue
    }
    if (block.role === 'tocmark') {
      if ((cur as Draft | null)?.type !== 'toc') {
        start(L.navTitle, 'toc')
        spoken.push(L.navTitle)
      }
      continue
    }
    if (block.role === 'list') {
      const items: { level: number; ordered: boolean; html: string }[] = []
      while (i < book.blocks.length && book.blocks[i].role === 'list') {
        const item = book.blocks[i] as WordPara
        items.push({ level: item.level, ordered: item.ordered, html: inlinesHtml(item.inlines, page) })
        spoken.push(item.text)
        i++
      }
      i--
      ensure().chunks.push({ kind: 'raw', html: renderList(items) })
      continue
    }
    if (block.role === 'table') {
      ensure().chunks.push({ kind: 'raw', html: tableHtml(block, page) })
      spoken.push(block.text)
      continue
    }
    if (block.role === 'image') {
      const count = (seenNames.get(block.name) ?? 0) + 1
      seenNames.set(block.name, count)
      const base = count > 1 ? block.name.replace(/(\.[a-z0-9]+)?$/i, `-${count}$1`) : block.name
      const path = `images/${base}`
      images.push({ path, data: block.data })
      const size = imageSize(block.data)
      const choice = pdfPictureAlt({
        name: path,
        typed: input.alt?.[path],
        pictures: input.pictures,
        ai: input.ai?.[path],
        jpeg: block.data,
        width: size.width || 200,
        height: size.height || 200,
      })
      pictures.push({ path, alt: choice.alt, caption: '', decorative: choice.decorative, longDesc: choice.longDesc, source: choice.source, approved: choice.approved })
      const { img, extra } = pdfImgHtml(path, choice)
      ensure().chunks.push({ kind: 'raw', html: `<figure>\n${img}${extra}\n</figure>` })
      continue
    }
    spoken.push(block.text)
    addPara(block)
  }
  if (cur) drafts.push(cur)

  for (const [i, nav] of Object.entries(input.sectionNav ?? {})) {
    const t = nav.trim()
    if (t && drafts[Number(i)]) drafts[Number(i)].nav = t
  }

  const counters = new Map<string, number>()
  const sections: Section[] = drafts.map((d) => {
    const meta0 = SECTION_META[d.type]
    const n = (counters.get(meta0.file) ?? 0) + 1
    counters.set(meta0.file, n)
    const stem = n > 1 || d.type === 'chapter' ? `${meta0.file}${d.type === 'chapter' ? String(n).padStart(2, '0') : n}` : meta0.file
    const id = d.type === 'chapter' ? `chap${String(n).padStart(2, '0')}` : stem
    const head = d.head.replace(/id="[^"]+"/, `id="${id}"`)
    const bodyInner = [head, ...d.chunks.map((c) => (c.kind === 'p' ? `<p>${c.html}</p>` : c.html))].filter(Boolean).join('\n')
    const labelled = head ? ` aria-labelledby="${id}"` : ` aria-label="${esc(d.nav || L.front)}"`
    const role = meta0.role ? ` role="${meta0.role}"` : ''
    return {
      file: `${stem}.xhtml`,
      id: stem,
      type: d.type,
      nav: d.nav,
      title: d.nav || L.front,
      body: `<section${labelled} epub:type="${meta0.epubType}"${role}>\n${bodyInner}\n</section>`,
    }
  })

  // the printed contents page: every entry links to the section it names
  const tocSection = sections.find((s) => s.type === 'toc')
  if (tocSection && book.tocEntries.length) {
    const targets = sections.filter((s) => s.type !== 'toc' && s.nav)
    const find = (text: string) => {
      const k = normTitle(text)
      return targets.find((t) => normTitle(t.nav) === k) ?? targets.find((t) => k.length >= 6 && (normTitle(t.nav).includes(k) || k.includes(normTitle(t.nav))))
    }
    let loose = 0
    const lines = book.tocEntries.map((e) => {
      const hit = find(e.text)
      if (!hit) loose++
      const cls = hit?.type === 'chapter' ? 'toc_1a' : hit?.type === 'part' || e.level >= 2 ? 'toc_2' : 'toc_1'
      return `<p class="${cls}">${hit ? `<a href="${esc(hit.file)}">${esc(e.text)}</a>` : esc(e.text)}</p>`
    })
    if (loose) review.push({ level: 'warn', msg: `${loose} entr${loose === 1 ? 'y' : 'ies'} of the contents page match no section, so they are not links.` })
    tocSection.body = tocSection.body.replace(/\n<\/section>$/, `\n${lines.join('\n')}\n</section>`)
  }

  const cover: ImageOut = { path: withRealExt('images/cover.jpg', input.cover.data), data: input.cover.data }
  const noAlt = pictures.filter((p) => !p.alt && !p.decorative)
  const draft = pictures.filter((p) => p.alt && p.source === 'ai' && !p.approved)
  if (draft.length) review.push({ level: 'warn', msg: `${draft.length} picture(s) have an AI-drafted description to approve before the book is certified.` })
  if (noAlt.length) review.push({ level: 'error', msg: `${noAlt.length} picture(s) need a description (alt text): ${noAlt.slice(0, 8).map((p) => p.path.replace('images/', '')).join(', ')}` })
  const pendingAi = pictures
    .filter((p) => p.source === 'ai' && !p.approved && !!p.alt.trim() && !isPlaceholderAlt(p.alt))
    .map((p) => p.path)
  let ship = meta
  if (pendingAi.length && (meta.certifiedBy.trim() || meta.conformsTo.trim())) {
    review.push({ level: 'error', msg: `${pendingAi.length} AI picture description${pendingAi.length === 1 ? '' : 's'} still need approval, so this book is not marked as certified.` })
    ship = { ...meta, certifiedBy: '', conformsTo: '' }
  }
  const { epub, files } = packageEpub({
    meta: ship,
    sections,
    cover,
    images,
    review,
    usedClasses: new Map(),
    bodyDecls: {},
    css: WORD_CSS,
  })
  const source: CheckSource = { words: wordsOf(spoken.join('\n')), dropped: book.tocLines, pendingAi }
  return { epub, files, sections, review, pictures, source }
}

function tableHtml(t: WordTable, page: (n: string) => string): string {
  const rows = t.rows.map((cells, r) => {
    const tag = t.header[r] ? 'th' : 'td'
    const inner = cells.map((c) => `<${tag}${tag === 'th' ? ' scope="col"' : ''}>${inlinesHtml(c, page)}</${tag}>`).join('')
    return `<tr>${inner}</tr>`
  })
  const caption = t.caption ? `<caption>${esc(t.caption)}</caption>\n` : ''
  const head = t.header[0] ? `<thead>\n${rows[0]}\n</thead>` : ''
  const body = (t.header[0] ? rows.slice(1) : rows).join('\n')
  return `<table>\n${caption}${head}${body ? `<tbody>\n${body}\n</tbody>` : ''}\n</table>`
}
