import { PDFDocument, PDFName, PDFArray, PDFDict, PDFRef, PDFNumber } from 'pdf-lib'
import { tokenize, paints, type Box } from './content.ts'
import { pageContent, pageResources, trimBoxOf, insideBox } from './pages.ts'
import { leaves } from './figures.ts'

// Reads a written (or any) PDF back: what is painted on each page, and whether it sits in the structure tree or is an artifact.
// Used by the proof scripts and the tests; the writer runs the same sums on its plan before it saves (PFG-001, PAR-001).

export interface PaintRow {
  page: number
  kind: 'image' | 'form' | 'path' | 'text' | 'shading'
  box: Box | null
  /** outermost marked-content tag: 'Artifact', a structure tag, or '' when nothing marks it */
  tag: string
  mcid?: number
}

/** Every painting operator of the page with the outermost tag it sits in. Boxes are in PDF user space (y up). */
export function auditPage(doc: PDFDocument, pageIndex: number): PaintRow[] {
  const page = doc.getPage(pageIndex)
  const ops = tokenize(pageContent(doc, page))
  const geo = paints(ops, pageResources(doc, page))
  const rows: PaintRow[] = []
  const stack: { tag: string; mcid?: number }[] = []
  ops.forEach((o, k) => {
    if (o.op === 'BDC' || o.op === 'BMC') {
      const tag = (o.args[0] ?? '').replace(/^\//, '')
      const mcid = o.op === 'BDC' ? Number(o.args[1]?.match(/\/MCID\s+(\d+)/)?.[1] ?? NaN) : NaN
      stack.push({ tag, mcid: Number.isNaN(mcid) ? undefined : mcid })
    } else if (o.op === 'EMC') stack.pop()
    else if (geo[k]) {
      const p = geo[k]!
      const top = stack.find((s) => s.tag !== 'OC') ?? { tag: '' }
      rows.push({ page: pageIndex, kind: p.kind, box: 'box' in p ? p.box : null, tag: top.tag, mcid: top.mcid })
      // pictures drawn inside a form XObject sit in whatever the form sits in
      if (p.kind === 'form') for (const q of leaves(p.inner ?? [])) if (q.kind === 'image') rows.push({ page: pageIndex, kind: 'image', box: q.box, tag: top.tag, mcid: top.mcid })
    }
  })
  return rows
}

export interface TreeElement { tag: string; chain: string[]; alt?: string }

/** Structure element of every marked-content sequence: key `${page}:${mcid}`. Also the tag counts of the whole tree. */
export function readTree(doc: PDFDocument): { byMcid: Map<string, TreeElement>; counts: Map<string, number> } {
  const byMcid = new Map<string, TreeElement>()
  const counts = new Map<string, number>()
  const ctx = doc.context
  const pageIdx = new Map(doc.getPages().map((p, i) => [p.ref.toString(), i]))
  const root = doc.catalog.lookupMaybe(PDFName.of('StructTreeRoot'), PDFDict)
  if (!root) return { byMcid, counts }
  const text = (d: PDFDict, k: string) => {
    const v = d.get(PDFName.of(k))
    return v && 'decodeText' in v ? (v as unknown as { decodeText(): string }).decodeText() : undefined
  }
  const walk = (node: unknown, chain: string[], pg: number | undefined, alt?: string) => {
    const obj = node instanceof PDFRef ? ctx.lookup(node) : node
    if (obj instanceof PDFNumber) {
      if (pg !== undefined) byMcid.set(`${pg}:${obj.asNumber()}`, { tag: chain[chain.length - 1], chain, alt })
      return
    }
    if (obj instanceof PDFArray) return obj.asArray().forEach((x) => walk(x, chain, pg, alt))
    if (!(obj instanceof PDFDict)) return
    const type = obj.get(PDFName.of('Type'))?.toString()
    const own = obj.get(PDFName.of('Pg'))
    const here = own instanceof PDFRef ? pageIdx.get(own.toString()) ?? pg : pg
    if (type === '/MCR') {
      const m = obj.get(PDFName.of('MCID'))
      if (m instanceof PDFNumber && here !== undefined) byMcid.set(`${here}:${m.asNumber()}`, { tag: chain[chain.length - 1], chain, alt })
      return
    }
    if (type === '/OBJR') return
    const tag = obj.get(PDFName.of('S'))?.toString().slice(1)
    const next = tag ? [...chain, tag] : chain
    if (tag) counts.set(tag, (counts.get(tag) ?? 0) + 1)
    const kids = obj.get(PDFName.of('K'))
    if (kids !== undefined) walk(kids, next, here, tag === 'Figure' ? text(obj, 'Alt') : alt)
  }
  walk(root.get(PDFName.of('K')), [], undefined)
  return { byMcid, counts }
}

export interface Audit {
  pages: number
  /** pictures (image XObjects, inline images, forms with no text) painted inside the trim */
  pictures: number
  picturesInTree: number
  picturesArtifact: number
  figureElements: number
  slugPictures: number
  /** the pages with a picture that is an artifact inside the trim: [page (1-based), box] */
  artifactPictures: { page: number; box: Box }[]
  counts: Map<string, number>
}

/** Picture tally of a finished PDF: how many painted pictures sit in the tree, and how many are artifacts. */
export function auditPictures(doc: PDFDocument): Audit {
  const { counts } = readTree(doc)
  const a: Audit = { pages: doc.getPageCount(), pictures: 0, picturesInTree: 0, picturesArtifact: 0, figureElements: counts.get('Figure') ?? 0, slugPictures: 0, artifactPictures: [], counts }
  doc.getPages().forEach((pg, i) => {
    const trim = trimBoxOf(pg)
    for (const r of auditPage(doc, i)) {
      if (!r.box || r.kind !== 'image') continue
      if (!insideBox(r.box, trim)) {
        a.slugPictures++
        continue
      }
      a.pictures++
      if (r.tag === 'Artifact' || r.tag === '') {
        a.picturesArtifact++
        a.artifactPictures.push({ page: i + 1, box: r.box })
      } else a.picturesInTree++
    }
  })
  return a
}

export { PDFDocument }

/** Every structure tag in reading order (depth first), for tests that look at what follows what. */
export function tagOrder(doc: PDFDocument): string[] {
  const out: string[] = []
  const ctx = doc.context
  const walk = (node: unknown) => {
    const obj = node instanceof PDFRef ? ctx.lookup(node) : node
    if (obj instanceof PDFArray) return obj.asArray().forEach(walk)
    if (!(obj instanceof PDFDict)) return
    const tag = obj.get(PDFName.of('S'))?.toString().slice(1)
    if (tag) out.push(tag)
    const kids = obj.get(PDFName.of('K'))
    if (kids !== undefined) walk(kids)
  }
  const root = doc.catalog.lookupMaybe(PDFName.of('StructTreeRoot'), PDFDict)
  if (root) walk(root.get(PDFName.of('K')))
  return out
}
