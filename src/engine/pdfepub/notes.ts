// PDF reader → footnote detection (design §3.4): a superscript number in the body and a small numbered
// line at the foot of the same page. Each page numbers its own notes, so the page is the matching scope.
import { matchNotes, type NoteFinding, type NoteMark } from '../structure/notes.ts'
import type { Line } from '../pdf/layout.ts'

export interface FootNote { id: number; label: string; page: number; text: string }

export interface NotePage { height: number; lines: Line[]; /** the printed page number, for the message */ label: string }

export function pdfNotes(pages: NotePage[], bodySize: number): NoteFinding[] {
  const refs: NoteMark[] = []
  const notes: NoteMark[] = []
  pages.forEach((p, i) => {
    const scope = String(i)
    const where = `page ${p.label}`
    for (const l of p.lines) {
      // a raised small number inside a body-sized line
      if (l.size >= bodySize * 0.9 && l.y < p.height * 0.88) {
        for (const r of l.runs) if (r.size <= l.size * 0.75 && /^\d{1,3}$/.test(r.text.trim())) refs.push({ label: r.text.trim(), scope, where })
      }
      // a small line at the foot that starts with its number
      const m = l.text.trim().match(/^(\d{1,3})(?!\d)[\s.)]/)
      if (m && l.size <= bodySize * 0.9 && l.y > p.height * 0.7) notes.push({ label: m[1], scope, where })
    }
  })
  // a numbered line at the foot with no superscript anywhere is a notes page or a list, not footnotes
  if (!notes.length || !refs.length) return []
  return [matchNotes('pdf-footnote', 0.8, ['a superscript number in the text and a small numbered line at the foot of the page'], refs, notes)]
}

/** A line at the foot of the page that starts with its number, plus the lines that continue it. */
const small = (l: Line, p: { height: number }, bodySize: number) => l.size <= bodySize * 0.9 && l.y > p.height * 0.7

/**
 * Turns matched footnotes into real notes: the raised number in the text is marked (`noteId`), and the foot lines leave
 * the page. A number with no partner on its page stays as it is (it is flagged by pdfNotes). Run once per book.
 */
export function extractFootnotes<L extends Line>(pages: { height: number; lines: L[] }[], bodySize: number): FootNote[] {
  const out: FootNote[] = []
  pages.forEach((p, pi) => {
    const refs = new Map<string, Line['runs'][number]>()
    for (const l of p.lines)
      if (l.size >= bodySize * 0.9 && l.y < p.height * 0.88) for (const r of l.runs) if (r.size <= l.size * 0.75 && /^\d{1,3}$/.test(r.text.trim()) && !refs.has(r.text.trim())) refs.set(r.text.trim(), r)
    const groups: { label: string; lines: L[] }[] = []
    for (const l of [...p.lines].filter((x) => small(x, p, bodySize)).sort((a, b) => a.y - b.y)) {
      const m = l.text.trim().match(/^(\d{1,3})(?!\d)[\s.)]/)
      if (m) groups.push({ label: m[1], lines: [l] })
      else groups[groups.length - 1]?.lines.push(l)
    }
    const used = new Set<L>()
    for (const g of groups) {
      const ref = refs.get(g.label)
      if (!ref || ref.noteId !== undefined) continue
      const id = out.length + 1
      ref.noteId = id
      const text = g.lines.map((l) => l.text.trim()).join(' ').replace(/^\d{1,3}[\s.)]+/, '').replace(/(\p{L})- (\p{Ll})/gu, '$1$2').replace(/\s+/g, ' ').trim()
      out.push({ id, label: g.label, page: pi, text })
      g.lines.forEach((l) => used.add(l))
    }
    p.lines = p.lines.filter((l) => !used.has(l))
  })
  return out
}
