// Reference diff for accessible PDFs: our tagged PDF against the client's finished one, as scores and plain sentences.
// The numbers come from pdfstats.ts; nothing here reads a PDF.
import { SCORED_ROLES, type PdfStats } from './pdfstats.ts'
import type { Dimension, RefScore } from './refscore.ts'

const pct = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 1000) / 10
const norm = (s: string | undefined) => (s ?? '').normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
/** 1 when equal, falling towards 0 as the two counts drift apart */
const ratio = (a: number, b: number) => (a === b ? 1 : Math.min(a, b) / Math.max(a, b, 1))
const more = (xs: string[], n = 6) => (xs.length > n ? [...xs.slice(0, n), `…and ${xs.length - n} more`] : xs)
const clip = (s: string, n = 60) => (s.length > n ? `${s.slice(0, n)}…` : s)

/** longest common subsequence of two word lists (two rows, so a long page stays cheap) */
function lcs(a: string[], b: string[]): number {
  let prev = new Uint32Array(b.length + 1)
  let cur = new Uint32Array(b.length + 1)
  for (const x of a) {
    for (let j = 1; j <= b.length; j++) cur[j] = x === b[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1])
    ;[prev, cur] = [cur, prev]
  }
  return prev[b.length]
}

/** Reading order (the tagged text of each page in tag-tree order, as an LCS ratio against the reference's) and role F1
 *  (captions and headings found by their text). Only when both stats were read with pdfjs; `pages` limits both to those
 *  pages (the eval set). Pages are paired by number. */
export function readingDims(mine: PdfStats, ref: PdfStats, pages?: number[]): Dimension[] {
  if (!mine.order || !ref.order) return []
  const keep = (p: number) => !pages || pages.includes(p)
  const out: Dimension[] = []
  {
    let same = 0
    let total = 0
    const worst: [number, number][] = []
    // a page the reference does not tag (or tags only as artifacts) cannot judge the build's order
    const unjudged = Object.keys(mine.order.pages).map(Number).filter((p) => keep(p) && !ref.order!.pages[p]).length
    const all = Object.keys(ref.order.pages).map(Number).filter(keep)
    for (const p of all.sort((x, y) => x - y)) {
      const a = mine.order.pages[p] ?? []
      const b = ref.order.pages[p] ?? []
      const l = lcs(a, b)
      const n = Math.max(a.length, b.length)
      same += l
      total += n
      if (l < n) worst.push([p, l / n])
    }
    worst.sort((x, y) => x[1] - y[1])
    const diffs = worst.slice(0, 6).map(([p, r]) => `Page ${p} reads ${pct(r)}% in the reference’s order.`)
    if (worst.length > 6) diffs.push(`…and ${worst.length - 6} more pages read differently.`)
    if (unjudged) diffs.push(`${unjudged} page${unjudged === 1 ? '' : 's'} with tagged text in the build have none in the reference and are not scored.`)
    out.push({ id: 'order', label: 'Reading order (tagged text page by page)', weight: 20, score: total ? pct(same / total) : null, diffs })
  }
  {
    const f1s: number[] = []
    const diffs: string[] = []
    for (const role of SCORED_ROLES) {
      const texts = (s: PdfStats) => s.order!.roles.filter((r) => r.role === role && keep(r.page)).map((r) => r.text)
      const a = texts(mine)
      const b = texts(ref)
      if (!a.length && !b.length) continue
      const left = new Map<string, number>()
      for (const t of b) left.set(t, (left.get(t) ?? 0) + 1)
      let agree = 0
      for (const t of a) if (left.get(t)) left.set(t, left.get(t)! - 1), agree++
      const f1 = (2 * agree) / (a.length + b.length)
      f1s.push(f1)
      diffs.push(`${role}: F1 ${Math.round(f1 * 100) / 100} (${a.length} in the build, ${b.length} in the reference, ${agree} with the same text).`)
    }
    // a report: the headings dimension already weighs the counts
    out.push({ id: 'roles', label: 'Captions and headings with the reference’s text (F1, report only)', weight: 0, score: f1s.length ? pct(f1s.reduce((x, y) => x + y, 0) / f1s.length) : null, diffs })
  }
  return out
}

export function comparePdfs(mine: PdfStats, ref: PdfStats, opts: { pages?: number[] } = {}): RefScore {
  const dims: Dimension[] = []
  const dim = (id: string, label: string, weight: number, score: number | null, diffs: string[]) => dims.push({ id, label, weight, score: score === null ? null : pct(score), diffs })
  const T = (s: PdfStats, k: string) => s.types[k] ?? 0

  // ---- document settings ----
  {
    const checks: [boolean, string][] = [
      [mine.pages === ref.pages, `The build has ${mine.pages} pages; the reference has ${ref.pages}.`],
      [norm(mine.doc.lang) === norm(ref.doc.lang), `Document language is “${mine.doc.lang ?? 'not set'}” in the build and “${ref.doc.lang ?? 'not set'}” in the reference.`],
      [norm(mine.doc.title) === norm(ref.doc.title), `Document title is “${clip(mine.doc.title ?? 'not set')}” in the build and “${clip(ref.doc.title ?? 'not set')}” in the reference.`],
      [norm(mine.doc.author) === norm(ref.doc.author), `Author is “${mine.doc.author ?? 'not set'}” in the build and “${ref.doc.author ?? 'not set'}” in the reference.`],
      [mine.doc.pdfuaPart === ref.doc.pdfuaPart, 'The PDF/UA identifier in the file’s metadata differs.'],
      [mine.doc.displayDocTitle === ref.doc.displayDocTitle, 'The window bar shows the file name instead of the title (or the reverse).'],
      [mine.doc.marked === ref.doc.marked, 'The file is not marked as tagged (or the reverse).'],
      [mine.doc.tabs.split(':')[0] === ref.doc.tabs.split(':')[0], 'Tab order is not “follow the structure” on the pages (or the reverse).'],
    ]
    dim('document', 'Document settings (language, title, PDF/UA mark)', 10, checks.filter((c) => c[0]).length / checks.length, checks.filter((c) => !c[0]).map((c) => c[1]))
  }

  // ---- bookmarks ----
  {
    const count = (xs: string[]) => xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>())
    const a = count(mine.outlines.map((o) => norm(o.title)))
    const r = count(ref.outlines.map((o) => norm(o.title)))
    let common = 0
    for (const [k, n] of r) common += Math.min(n, a.get(k) ?? 0)
    const f1 = mine.outlines.length + ref.outlines.length ? (2 * common) / (mine.outlines.length + ref.outlines.length) : 1
    const diffs: string[] = []
    const missing = [...r.keys()].filter((k) => !a.has(k))
    for (const t of missing.slice(0, 4)) diffs.push(`The bookmark “${clip(t)}” of the reference is not in the build.`)
    if (missing.length > 4) diffs.push(`…${missing.length - 4} more reference bookmarks are missing.`)
    const extra = [...a.keys()].filter((k) => !r.has(k))
    if (extra.length) diffs.push(`${extra.length} bookmark${extra.length === 1 ? '' : 's'} in the build are not in the reference, for example “${clip(extra[0])}”.`)
    const depth = (s: PdfStats) => Math.max(0, ...s.outlines.map((o) => o.depth))
    if (depth(mine) !== depth(ref)) diffs.push(`Bookmarks are nested ${depth(mine)} level${depth(mine) === 1 ? '' : 's'} deep in the build and ${depth(ref)} in the reference.`)
    if (mine.outlines.length !== ref.outlines.length) diffs.push(`The build has ${mine.outlines.length} bookmarks; the reference has ${ref.outlines.length}.`)
    dim('bookmarks', 'Bookmarks', 20, ref.outlines.length || mine.outlines.length ? 0.7 * f1 + 0.15 * ratio(mine.outlines.length, ref.outlines.length) + 0.15 * (depth(mine) === depth(ref) ? 1 : 0) : null, diffs)
  }

  // ---- headings ----
  {
    const levels = ['H1', 'H2', 'H3', 'H4', 'H5', 'H6']
    let diff = 0
    let total = 0
    const diffs: string[] = []
    for (const l of levels) {
      diff += Math.abs(T(mine, l) - T(ref, l))
      total += T(mine, l) + T(ref, l)
      if (T(mine, l) !== T(ref, l)) diffs.push(`${l}: ${T(mine, l)} in the build, ${T(ref, l)} in the reference.`)
    }
    dim('headings', 'Headings by level', 20, total ? 1 - diff / total : null, diffs)
  }

  // ---- lists ----
  {
    const diffs: string[] = []
    if (mine.lists.lists !== ref.lists.lists) diffs.push(`${mine.lists.lists} lists in the build, ${ref.lists.lists} in the reference.`)
    if (mine.lists.items !== ref.lists.items) diffs.push(`${mine.lists.items} list items in the build, ${ref.lists.items} in the reference.`)
    if (mine.lists.withoutLabel + mine.lists.withoutBody) diffs.push(`${mine.lists.withoutLabel + mine.lists.withoutBody} list item parts have no label or body tag.`)
    dim('lists', 'Lists', 10, ref.lists.items || mine.lists.items ? 0.5 * ratio(mine.lists.lists, ref.lists.lists) + 0.5 * ratio(mine.lists.items, ref.lists.items) : null, diffs)
  }

  // ---- tables ----
  {
    const diffs: string[] = []
    if (mine.tables.tables !== ref.tables.tables) diffs.push(`${mine.tables.tables} tables in the build, ${ref.tables.tables} in the reference.`)
    if (mine.tables.headerCells !== ref.tables.headerCells) diffs.push(`${mine.tables.headerCells} header cells in the build, ${ref.tables.headerCells} in the reference.`)
    dim('tables', 'Tables', 5, ref.tables.tables || mine.tables.tables ? 0.5 * ratio(mine.tables.tables, ref.tables.tables) + 0.5 * ratio(mine.tables.headerCells, ref.tables.headerCells) : null, diffs)
  }

  // ---- figures ----
  {
    const diffs: string[] = []
    const noAlt = mine.figures.filter((f) => !f.alt?.trim()).length
    if (mine.figures.length !== ref.figures.length) diffs.push(`${mine.figures.length} figures in the build, ${ref.figures.length} in the reference.`)
    if (noAlt) diffs.push(`${noAlt} figure${noAlt === 1 ? ' has' : 's have'} no description in the build.`)
    const big = (s: PdfStats) => Math.max(0, ...s.figures.map((f) => f.contentItems))
    if (big(mine) > big(ref) * 1.5) diffs.push(`The most fragmented picture is cut into ${big(mine)} pieces in the build and ${big(ref)} in the reference (a logo drawn as many pieces).`)
    const fragmentation = ref.figures.length || mine.figures.length ? ratio(big(mine), big(ref)) : 1
    dim('figures', 'Figures and their descriptions', 15, ref.figures.length || mine.figures.length ? 0.4 * ratio(mine.figures.length, ref.figures.length) + 0.3 * (mine.figures.length ? 1 - noAlt / mine.figures.length : 1) + 0.3 * fragmentation : null, diffs)
  }

  // ---- links ----
  {
    const diffs: string[] = []
    if (mine.links.uri !== ref.links.uri) diffs.push(`${mine.links.uri} web or e-mail links in the build, ${ref.links.uri} in the reference.`)
    if (mine.links.goto !== ref.links.goto) diffs.push(`${mine.links.goto} links inside the document in the build, ${ref.links.goto} in the reference.`)
    if (mine.links.total && mine.links.inStructTree < mine.links.total) diffs.push(`${mine.links.total - mine.links.inStructTree} links are not part of the tag tree.`)
    dim('links', 'Links', 10, ref.links.total || mine.links.total ? 0.4 * ratio(mine.links.uri, ref.links.uri) + 0.4 * ratio(mine.links.goto, ref.links.goto) + 0.2 * (mine.links.total ? mine.links.inStructTree / mine.links.total : 1) : null, diffs)
  }

  // ---- notes and contents ----
  {
    const diffs: string[] = []
    if (mine.notes.notes !== ref.notes.notes) diffs.push(`${mine.notes.notes} notes in the build, ${ref.notes.notes} in the reference.`)
    if (mine.notes.references !== ref.notes.references) diffs.push(`${mine.notes.references} note references in the build, ${ref.notes.references} in the reference.`)
    if (mine.toc.items !== ref.toc.items) diffs.push(`${mine.toc.items} contents entries in the build, ${ref.toc.items} in the reference.`)
    const any = ref.notes.notes + ref.notes.references + ref.toc.items + mine.notes.notes + mine.notes.references + mine.toc.items
    dim('notes', 'Notes and contents entries', 8, any ? (ratio(mine.notes.notes, ref.notes.notes) + ratio(mine.notes.references, ref.notes.references) + ratio(mine.toc.items, ref.toc.items)) / 3 : null, diffs)
  }

  // ---- nothing painted outside the tags ----
  {
    const diffs: string[] = []
    if (mine.content.unmarkedPaintOps) diffs.push(`${mine.content.unmarkedPaintOps} drawing operations are outside any tag or artifact mark in the build.`)
    dim('untagged', 'Everything on the page is tagged or marked as decoration', 2, mine.content.unmarkedPaintOps ? Math.max(0, 1 - mine.content.unmarkedPaintOps / 100) : 1, diffs)
  }

  dims.push(...readingDims(mine, ref, opts.pages))

  const live = dims.filter((d) => d.score !== null)
  const overall = live.length ? Math.round((live.reduce((s, d) => s + d.score! * d.weight, 0) / live.reduce((s, d) => s + d.weight, 0)) * 10) / 10 : 0
  for (const d of dims) d.diffs = more(d.diffs)
  return { overall, dims }
}
