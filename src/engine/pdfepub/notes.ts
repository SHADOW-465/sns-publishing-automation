// PDF reader → footnote detection (design §3.4): a superscript number in the body and a small numbered
// line at the foot of the same page. Each page numbers its own notes, so the page is the matching scope.
import { matchNotes, type NoteFinding, type NoteMark } from '../structure/notes.ts'
import type { Line } from '../pdf/layout.ts'

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
