import type { PdfBook, PLine } from '../pdfepub/analyze.ts'
import { titleCase } from '../pdfepub/analyze.ts'
import { sectionTypeOf } from '../epub/locale.ts'
import type { SNode, Structure } from './structure.ts'

// End notes anywhere in the book: a small number in the text ("12", set as a superscript or in small type)
// belongs to the numbered entry of the notes section that follows it. Numbering that restarts (per chapter)
// starts a new run on both sides, and runs are paired in order.

export interface NoteEntry {
  n: number
  /** the line that carries the number */
  line: PLine
  /** element that holds the entry (the Lbl when the number is its own piece, else the body) */
  host: SNode
  /** the number is its own line, tagged by `host` */
  own: boolean
}
export interface NotePair {
  ref: PLine
  refHost: SNode
  entry: NoteEntry
}

const ENTRY = /^(\d{1,3})(?:[.)]|\s|$)/

/** Reading order of the tree: every owned line, in the order the elements are read. */
function readOrder(root: SNode): Map<PLine, number> {
  const order = new Map<PLine, number>()
  const walk = (n: SNode) => {
    for (const l of n.lines) if (!order.has(l)) order.set(l, order.size)
    n.kids.forEach(walk)
  }
  walk(root)
  return order
}

const runsOf = <T>(xs: T[], n: (x: T) => number): T[][] => {
  const out: T[][] = []
  let prev = 0
  for (const x of xs) {
    if (!out.length || n(x) < prev) out.push([])
    out[out.length - 1].push(x)
    prev = n(x)
  }
  return out
}

export function endnotePairs(st: Structure, book: PdfBook, skip: Set<PLine> = new Set()): NotePair[] {
  const order = readOrder(st.root)
  const at = (n: SNode) => Math.min(...n.lines.map((l) => order.get(l) ?? Infinity))
  // notes sections: the entries read after a "Notes" heading, up to the next heading of the same or a higher level
  const sections: { start: number; entries: NoteEntry[] }[] = []
  const flat: SNode[] = []
  const collect = (n: SNode) => (flat.push(n), n.kids.forEach(collect))
  collect(st.root)
  let open: { level: number; entries: NoteEntry[] } | null = null
  for (const n of flat) {
    if (/^H\d$/.test(n.tag)) {
      const level = Number(n.tag[1])
      if (open && level <= open.level) open = null
      if (!open && sectionTypeOf(titleCase((n.text ?? '').trim())) === 'notes' && n.lines.length) {
        open = { level, entries: [] }
        sections.push({ start: at(n), entries: open.entries })
      }
      continue
    }
    if (!open || (n.tag !== 'LI' && !n.lines.length)) continue
    let entry: NoteEntry | undefined
    if (n.tag === 'LI') {
      const lbl = n.kids.find((k) => k.tag === 'Lbl' && k.lines.length)
      const body = n.kids.find((k) => k.tag === 'LBody' && k.lines.length)
      const num = lbl?.lines[0].text.trim().match(ENTRY)
      if (lbl && num) entry = { n: Number(num[1]), line: lbl.lines[0], host: lbl, own: true }
      else if (body && ENTRY.test(body.lines[0].text.trim())) entry = { n: Number(body.lines[0].text.trim().match(ENTRY)![1]), line: body.lines[0], host: body, own: false }
    } else if (n.tag === 'P') {
      const m = n.lines[0].text.trim().match(ENTRY)
      if (m) entry = { n: Number(m[1]), line: n.lines[0], host: n, own: false }
    }
    if (entry) open.entries.push(entry)
  }
  const used = sections.filter((s) => s.entries.length)
  if (!used.length) return []

  // calls: small bare numbers in the text, before the section that lists them
  const inEntries = new Set(used.flatMap((s) => s.entries.map((e) => e.line)))
  const calls = [...st.owner]
    .filter(([l, host]) => /^\d{1,3}$/.test(l.text.trim()) && l.size <= book.bodySize * 0.8 && !skip.has(l) && !inEntries.has(l) && !/^(H\d|Note|Lbl|TOCI|TH|TD|Caption|Figure)$/.test(host.tag) && order.has(l))
    .map(([l, host]) => ({ l, host, at: order.get(l)! }))
    .sort((a, b) => a.at - b.at)

  const pairs: NotePair[] = []
  used.forEach((sec, k) => {
    const from = k ? used[k - 1].start : -Infinity
    const mine = calls.filter((c) => c.at > from && c.at < sec.start)
    const callRuns = runsOf(mine, (c) => Number(c.l.text.trim()))
    const entryRuns = runsOf(sec.entries, (e) => e.n)
    callRuns.forEach((cr, i) => {
      const er = entryRuns[i]
      if (!er) return
      const byN = new Map<number, NoteEntry>()
      for (const e of er) if (!byN.has(e.n)) byN.set(e.n, e)
      const done = new Set<number>()
      for (const c of cr) {
        const n = Number(c.l.text.trim())
        const entry = byN.get(n)
        if (!entry || done.has(n)) continue
        done.add(n)
        pairs.push({ ref: c.l, refHost: c.host, entry })
      }
    })
  })
  return pairs
}
