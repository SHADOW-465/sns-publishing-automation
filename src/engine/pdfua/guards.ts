import type { ReviewItem } from '../epub/package.ts'
import type { PdfBook } from '../pdfepub/analyze.ts'
import { figureLabel, type SNode, type Structure, type UaOptions } from './structure.ts'

// Guards on the tag tree the writer is about to save. Each message starts with the rulebook rule it enforces.

const lvl = (tag: string) => Number(tag[1])

/**
 * PHD-002: two headings that stand together (a kicker above a title) carry the same tag.
 * PHD-005: a heading that reads as the rest of a sentence is body text.
 * PHD-008: when the client wants the same level for the same print style, no style carries two.
 */
export function headingGuards(st: Pick<Structure, 'headings' | 'owner'> & Partial<Pick<Structure, 'nodes'>>, book: Pick<PdfBook, 'pages'>, options: Pick<UaOptions, 'headingLevels'> = {}): ReviewItem[] {
  const out: ReviewItem[] = []
  const heads = st.headings.filter((h) => h.lines.length)
  for (let i = 1; i < heads.length; i++) {
    const a = heads[i - 1]
    const b = heads[i]
    const la = a.lines[a.lines.length - 1]
    const lb = b.lines[0]
    if (la.page !== lb.page || lb.y - la.y > Math.max(la.size, lb.size) * 3.5 || la.size > lb.size || a.tag === b.tag || lvl(a.tag) < lvl(b.tag)) continue
    out.push({ level: 'error', msg: `PHD-002: the heading “${(a.text ?? '').slice(0, 40)}” (${a.tag}) stands right above “${(b.text ?? '').slice(0, 40)}” (${b.tag}) on page ${la.page + 1}. A kicker and its title get the same tag.` })
    break
  }
  const above = (h: (typeof heads)[number]) => {
    const l = h.lines[0]
    return book.pages[l.page]?.lines.filter((x) => x !== l && x.y < l.y && l.y - x.y < l.size * 2.2).sort((p, q) => q.y - p.y)[0]
  }
  const lower = heads.find((h) => /^\p{Ll}/u.test((h.text ?? '').trim()) && st.owner.get(above(h)!)?.tag === 'P')
  if (lower) out.push({ level: 'error', msg: `PHD-005: “${(lower.text ?? '').slice(0, 50)}” on page ${lower.lines[0].page + 1} is tagged ${lower.tag} but starts in lower case under a line of text: it is the rest of that paragraph.` })
  // PHD-006: the name of a chapter inside the notes is a heading, not the end of the note list item before it
  const swallowed = st.nodes?.find((n) => n.tag === 'LBody' && n.lines.length === 1 && n.lines[0].text.trim().length >= 12 && n.lines[0].text.trim() === n.lines[0].text.trim().toUpperCase() && /\p{Lu}{3}/u.test(n.lines[0].text) && /\s/.test(n.lines[0].text.trim()) && !/^\d/.test(n.lines[0].text.trim()))
  if (swallowed) out.push({ level: 'error', msg: `PHD-006: “${swallowed.lines[0].text.trim().slice(0, 50)}” on page ${swallowed.lines[0].page + 1} is inside a list item but reads as the name of a chapter. It is a heading, not a note.` })
  if (options.headingLevels === 'consistent') {
    const levels = new Map<string, Set<string>>()
    for (const h of heads) levels.set(h.lines[0].key, (levels.get(h.lines[0].key) ?? new Set()).add(h.tag))
    for (const [key, tags] of levels)
      if (tags.size > 1) {
        const sample = heads.find((h) => h.lines[0].key === key)!
        out.push({ level: 'error', msg: `PHD-008: headings set in ${key} (for example “${(sample.text ?? '').slice(0, 40)}”) carry different tags: ${[...tags].sort().join(', ')}. The same print style gets one tag.` })
        break
      }
  }
  return out
}

/**
 * PFG-003: the caption under a figure is a Caption, not a P. PLS-002: a list of illustrations is a list, not a run of P.
 * PTC-002: a contents entry holds one topic. PRO-008: a contents list holds only entries, no Figure.
 */
export function structureGuards(st: Pick<Structure, 'nodes'>): ReviewItem[] {
  const out: ReviewItem[] = []
  const text = (n: SNode) => (n.text ?? n.lines.map((l) => l.text).join(' ')).trim()
  for (const n of st.nodes) {
    n.kids.forEach((k, i) => {
      const next = n.kids[i + 1]
      if (k.tag === 'Figure' && next?.tag === 'P' && figureLabel(text(next)) && !out.some((x) => x.msg.startsWith('PFG-003')))
        out.push({ level: 'error', msg: `PFG-003: “${text(next).slice(0, 50)}” follows a Figure as a P. A caption is a Caption element.` })
    })
    if (n.tag === 'TOC' && n.kids.some((k) => k.tag === 'Figure') && !out.some((x) => x.msg.startsWith('PRO-008')))
      out.push({ level: 'error', msg: 'PRO-008: a Figure sits inside a contents list. The list holds only entries; the picture belongs after it.' })
    if (n.tag === 'TOCI' && (text(n).match(/•/g)?.length ?? 0) >= 1 && !out.some((x) => x.msg.startsWith('PTC-002')))
      out.push({ level: 'error', msg: `PTC-002: the contents entry “${text(n).slice(0, 60)}” holds several topics separated by bullets. Each topic is its own entry.` })
    if (n.tag === 'P' && n.lines[0] && /^(\d{1,2}|[IVXLC]{1,4})\s*\.\s*\d{1,2}\.?$/.test(n.lines[0].text.trim()) && n.lines.length === 1 && !out.some((x) => x.msg.startsWith('PLS-002')))
      out.push({ level: 'error', msg: `PLS-002: “${n.lines[0].text.trim()}” is a figure number standing alone as a P. A list of illustrations is a list with one item for each figure.` })
  }
  // PNT-001: the number beside a footnote belongs to that note. A second note that opens with that number has taken the wrap.
  const notes = st.nodes.filter((n) => n.tag === 'Note' && n.lines.length)
  for (let i = 0; i < notes.length - 1 && !out.some((x) => x.msg.startsWith('PNT-001')); i++) {
    const num = notes[i + 1].lines[0]
    const prev = notes[i].lines[notes[i].lines.length - 1]
    if (num.page === prev.page && /^\d{1,3}$/.test(num.text.trim()) && Math.abs(num.base - prev.base) < 2)
      out.push({ level: 'error', msg: `PNT-001: the footnote number “${num.text.trim()}” on page ${num.page + 1} sits beside “${prev.text.trim().slice(0, 40)}” but opens another note. The number and the text are one note.` })
  }
  return out
}
