// PDF reader → footnote detection (design §3.4): a superscript number in the body and a small numbered
// line at the foot of the same page. Each page numbers its own notes, so the page is the matching scope.
import { matchNotes, type NoteFinding, type NoteMark } from '../structure/notes.ts'
import type { Line } from '../pdf/layout.ts'

export interface FootNote { id: number; label: string; page: number; text: string }

type Ref = { label: string; run: Line['runs'][number]; host: Line; lone?: Line }

/** Raised numbers in the text. pdf.js often reads a superscript as a line of its own (it sits a few points higher),
 *  so a small lone number that ends right where a body line ends counts too; `lone` is that extra line. */
function raisedRefs(lines: Line[], pageHeight: number, bodySize: number): Ref[] {
  const out: Ref[] = []
  const body = lines.filter((l) => l.size >= bodySize * 0.9 && l.y < pageHeight * 0.88)
  for (const l of body) for (const r of l.runs) if (r.size <= l.size * 0.75 && /^\d{1,3}$/.test(r.text.trim())) out.push({ label: r.text.trim(), run: r, host: l })
  for (const l of lines) {
    if (l.size > bodySize * 0.75 || !/^\d{1,3}$/.test(l.text.trim()) || l.y > pageHeight * 0.88) continue
    const host = body.find((b) => Math.abs(b.y - l.y) <= bodySize * 1.2 && Math.abs(b.x1 - l.x0) <= bodySize * 0.6)
    if (host) out.push({ label: l.text.trim(), run: l.runs[0], host, lone: l })
  }
  return out
}

export interface NotePage { height: number; lines: Line[]; /** the printed page number, for the message */ label: string }

export function pdfNotes(pages: NotePage[], bodySize: number): NoteFinding[] {
  const refs: NoteMark[] = []
  const notes: NoteMark[] = []
  pages.forEach((p, i) => {
    const scope = String(i)
    const where = `page ${p.label}`
    for (const r of raisedRefs(p.lines, p.height, bodySize)) refs.push({ label: r.label, scope, where })
    for (const l of p.lines) {
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
    const refs = new Map<string, Ref>()
    for (const r of raisedRefs(p.lines, p.height, bodySize)) if (!refs.has(r.label)) refs.set(r.label, r)
    const groups: { label: string; lines: L[] }[] = []
    for (const l of [...p.lines].filter((x) => small(x, p, bodySize)).sort((a, b) => a.y - b.y)) {
      const m = l.text.trim().match(/^(\d{1,3})(?!\d)[\s.)]/)
      if (m) groups.push({ label: m[1], lines: [l] })
      else groups[groups.length - 1]?.lines.push(l)
    }
    const used = new Set<L>()
    for (const g of groups) {
      const ref = refs.get(g.label)
      if (!ref || ref.run.noteId !== undefined) continue
      const id = out.length + 1
      ref.run.noteId = id
      if (ref.lone) {
        // the number was a line of its own: it moves into the line it belongs to, and the lone line leaves the page
        ref.host.runs.push(ref.run)
        ref.host.x1 = Math.max(ref.host.x1, ref.run.x1)
        ref.host.text += ref.run.text
        used.add(ref.lone as L)
      }
      const text = g.lines.map((l) => l.text.trim()).join(' ').replace(/^\d{1,3}[\s.)]+/, '').replace(/(\p{L})- (\p{Ll})/gu, '$1$2').replace(/\s+/g, ' ').trim()
      out.push({ id, label: g.label, page: pi, text })
      g.lines.forEach((l) => used.add(l))
    }
    p.lines = p.lines.filter((l) => !used.has(l))
  })
  return out
}
