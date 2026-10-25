// A manuscript converted from PDF often has no heading styles at all: every line is "Body Text", the contents list is typed.
// Then the typed contents names the chapters: each entry's first line, found again in the body after the contents, is a chapter title.
import { normTitle, type WordBlock, type WordPara } from './read.ts'

const CONTENTS = /^(contents|table of contents|indice|índice|indice general|contenido|sumario|inhalt|inhaltsverzeichnis|sommaire|table des matieres|table des matières|sommario|indice dei contenuti)$/i
const ENDS_PAGE = /(?:\.\s*){0,}\s*\d{1,4}$/

// a numbered entry or chapter title ("1. Constituciones…") comes in as a list item: it is a line of text all the same
const isBody = (b: WordBlock): b is WordPara => b.role === 'body' || (b.role === 'list' && typeof (b as WordPara).text === 'string')

/** Headings for a book that has none. Returns the blocks unchanged when there is no typed contents to go by. */
export function headingsFromTypedContents(blocks: WordBlock[]): WordBlock[] {
  const heads = blocks.filter((b) => b.role === 'heading' && b.level <= 2)
  const limit = Math.max(40, Math.floor(blocks.length * 0.2))
  const at = blocks.findIndex((b, i) => i < limit && isBody(b) && CONTENTS.test(b.text.trim()))
  if (at < 0) return blocks
  // entries: lines up to the one that ends with a page number; running heads ("8ÍNDICE", "7 •") are skipped
  const entries: string[][] = []
  let lines: string[] = []
  let end = at + 1
  for (let i = at + 1; i < blocks.length && i < at + 400; i++) {
    const b = blocks[i]
    if (!isBody(b)) continue
    const t = b.text.trim()
    if (!t) continue
    if (t.length > 220) break
    if (/^\d{1,4}\s*[•·|]?$/.test(t) || CONTENTS.test(t.replace(/^\d+\s*|\s*\d+$/g, ''))) continue
    lines.push(t)
    if (ENDS_PAGE.test(t)) {
      end = i + 1
      entries.push(lines)
      lines = []
    } else if (lines.length > 4) break
  }
  if (entries.length < 2) return blocks
  // headings the reader guessed from formatting count only when they are the book's own: as many as the contents lists.
  // A PDF converted to Word gives a few stray ones ("52 JOHN KINCAID", a running head set bold): the contents decides then.
  if (heads.length >= Math.ceil(entries.length / 2)) return blocks
  const out = blocks.map((b) => (b.role === 'heading' && b.level <= 2 ? ({ ...b, role: 'body' } as WordBlock) : b))
  out[at] = { role: 'tocmark' }
  for (let i = at + 1; i < end; i++) if (isBody(out[i])) (out[i] as WordPara).text.trim() && (out[i] = { ...(out[i] as WordPara), text: '', inlines: [] })
  let from = end
  const strip = (t: string) => normTitle(t.replace(/(?:\s*\.){2,}\s*\d+$|\d+$/, ''))
  const caps = (t: string) => /\p{Lu}/u.test(t) && t === t.toLocaleUpperCase()
  for (const entry of entries) {
    // the title is every line but the last when the last one names the authors (it carries the page number)
    const lines = entry.length > 1 ? entry.slice(0, -1) : entry
    const full = normTitle(lines.map((l) => l.replace(/(?:\s*\.){2,}\s*\d+$|\d+$/, '')).join(' '))
    if (full.length < 4) continue
    const starts = (i: number) => {
      const b = out[i]
      if (!isBody(b)) return false
      const k = normTitle(b.text)
      return !!k && (k === full || (k.length >= Math.min(12, full.length) && full.startsWith(k + ' ')))
    }
    // the book's own title is set in capitals; a chapter's "Conclusions" subhead is not
    let hit = -1
    for (let i = from; i < out.length; i++) if (starts(i) && caps((out[i] as WordPara).text)) { hit = i; break }
    if (hit < 0) for (let i = from; i < out.length; i++) if (starts(i)) { hit = i; break }
    if (hit < 0) continue
    let title = (out[hit] as WordPara).text.trim()
    let acc = normTitle(title)
    let j = hit + 1
    while (acc !== full && j < out.length && isBody(out[j])) {
      const next = normTitle((out[j] as WordPara).text)
      if (!next || !(full === `${acc} ${next}` || full.startsWith(`${acc} ${next} `))) break
      title += ' ' + (out[j] as WordPara).text.trim()
      acc = `${acc} ${next}`
      out[j] = { ...(out[j] as WordPara), text: '', inlines: [] }
      j++
    }
    out[hit] = { ...(out[hit] as WordPara), role: 'heading', level: 1, text: title, inlines: [{ t: 'text', text: title }] }
    from = j
    void strip
  }
  return out
}
