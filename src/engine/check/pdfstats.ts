// What a tagged PDF contains, as plain numbers: document settings, bookmarks, the tag tree (headings, lists, tables,
// figures, notes, contents), links, and how much painted content is outside any marked content. Used by the reference
// diff (refscore-pdf.ts) to compare our accessible PDF with the client's finished file. pdf-lib only, so it runs in the
// browser as well as in Node.
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFRef, PDFNumber, PDFString, PDFHexString, PDFRawStream, PDFStream, PDFBool, decodePDFRawStream, type PDFObject } from 'pdf-lib'

export interface PdfStats {
  pages: number
  doc: { title?: string; author?: string; lang?: string; pdfuaPart?: string; displayDocTitle?: boolean; marked?: boolean; tabs: string; pageMode?: string }
  /** bookmarks in document order */
  outlines: { depth: number; title: string; page: number | null }[]
  /** structure elements by standard type (after the role map) */
  types: Record<string, number>
  figures: { page: number | null; alt: string | undefined; contentItems: number }[]
  links: { total: number; uri: number; goto: number; inStructTree: number; withContents: number; byTargetPage: Record<string, number> }
  lists: { lists: number; items: number; withoutLabel: number; withoutBody: number }
  tables: { tables: number; rows: number; headerCells: number; cells: number }
  /** note elements, and the references that point at them */
  notes: { notes: number; references: number }
  toc: { toc: number; items: number }
  content: { artifactBlocks: number; markedBlocks: number; unmarkedPaintOps: number }
}

const N = PDFName.of
const text = (o: PDFObject | undefined): string | undefined => (o instanceof PDFString || o instanceof PDFHexString ? o.decodeText() : o instanceof PDFName ? o.decodeText() : undefined)
const num = (o: PDFObject | undefined) => (o instanceof PDFNumber ? o.asNumber() : undefined)
const inc = (m: Record<string, number>, k: string, by = 1) => void (m[k] = (m[k] ?? 0) + by)

interface Elem { type: string; mapped: string; parent: number | null; kids: number[]; page: number | null; mcids: number; objr: (string | null)[]; alt?: string; hasAlt: boolean }

export async function pdfStats(data: Uint8Array): Promise<PdfStats> {
  const doc = await PDFDocument.load(data, { updateMetadata: false, ignoreEncryption: true, throwOnInvalidObject: false })
  const ctx = doc.context
  const cat = doc.catalog
  const pages = doc.getPages()
  const pageIdx = new Map(pages.map((p, i) => [p.ref.toString(), i + 1]))

  // ---- document ----
  const info = ctx.lookupMaybe(ctx.trailerInfo.Info, PDFDict)
  const xmpStream = cat.lookupMaybe(N('Metadata'), PDFStream)
  let xmp = ''
  if (xmpStream) {
    try {
      xmp = new TextDecoder().decode(xmpStream instanceof PDFRawStream ? decodePDFRawStream(xmpStream).decode() : xmpStream.getContents())
    } catch { /* unreadable packet */ }
  }
  const tabs: Record<string, number> = {}
  for (const p of pages) inc(tabs, text(p.node.get(N('Tabs'))) ?? 'none')
  const viewer = cat.lookupMaybe(N('ViewerPreferences'), PDFDict)
  const mark = cat.lookupMaybe(N('MarkInfo'), PDFDict)
  const boolOf = (o: PDFObject | undefined) => (o instanceof PDFBool ? o.asBoolean() : undefined)
  const docInfo: PdfStats['doc'] = {
    title: text(info?.get(N('Title'))),
    author: text(info?.get(N('Author'))),
    lang: text(cat.get(N('Lang'))),
    pdfuaPart: xmp.match(/pdfuaid:part[^>]*>([^<]*)</)?.[1]?.trim() ?? xmp.match(/pdfuaid:part="([^"]*)"/)?.[1],
    displayDocTitle: boolOf(viewer?.get(N('DisplayDocTitle'))),
    marked: boolOf(mark?.get(N('Marked'))),
    tabs: Object.entries(tabs).map(([k, v]) => `${k}:${v}`).join(' '),
    pageMode: text(cat.get(N('PageMode'))),
  }

  // ---- destinations ----
  const named = new Map<string, PDFObject>()
  const dests = cat.lookupMaybe(N('Dests'), PDFDict)
  if (dests) for (const [k, v] of dests.entries()) named.set(k.decodeText(), v)
  const readNames = (n: PDFDict) => {
    const a = n.lookupMaybe(N('Names'), PDFArray)
    if (a) for (let i = 0; i < a.size(); i += 2) named.set(text(a.lookup(i)) ?? '', a.get(i + 1))
    const k = n.lookupMaybe(N('Kids'), PDFArray)
    if (k) for (let i = 0; i < k.size(); i++) readNames(k.lookup(i, PDFDict))
  }
  const names = cat.lookupMaybe(N('Names'), PDFDict)?.lookupMaybe(N('Dests'), PDFDict)
  if (names) readNames(names)
  const destPage = (dest: PDFObject | undefined): number | null => {
    let d: PDFObject | undefined = dest instanceof PDFRef ? ctx.lookup(dest) : dest
    if (d instanceof PDFString || d instanceof PDFHexString || d instanceof PDFName) {
      const v = named.get(text(d) ?? '')
      d = v instanceof PDFRef ? ctx.lookup(v) : v
    }
    if (d instanceof PDFDict) d = d.get(N('D'))
    if (d instanceof PDFArray) {
      const r = d.get(0)
      return r instanceof PDFRef ? (pageIdx.get(r.toString()) ?? null) : typeof num(r) === 'number' ? num(r)! + 1 : null
    }
    return null
  }

  // ---- bookmarks ----
  const outlines: PdfStats['outlines'] = []
  const walkOutline = (first: PDFObject | undefined, depth: number) => {
    const seen = new Set<string>()
    let cur = first
    while (cur instanceof PDFRef && !seen.has(cur.toString())) {
      seen.add(cur.toString())
      const d = ctx.lookup(cur, PDFDict)
      const action = d.lookupMaybe(N('A'), PDFDict)
      outlines.push({ depth, title: (text(d.get(N('Title'))) ?? '').trim(), page: d.has(N('Dest')) ? destPage(d.get(N('Dest'))) : destPage(action?.get(N('D'))) })
      walkOutline(d.get(N('First')), depth + 1)
      cur = d.get(N('Next'))
    }
  }
  walkOutline(cat.lookupMaybe(N('Outlines'), PDFDict)?.get(N('First')), 0)

  // ---- structure tree ----
  const root = cat.lookupMaybe(N('StructTreeRoot'), PDFDict)
  const roleMap: Record<string, string> = {}
  const rm = root?.lookupMaybe(N('RoleMap'), PDFDict)
  if (rm) for (const [k, v] of rm.entries()) roleMap[k.decodeText()] = text(v) ?? ''
  const elems: Elem[] = []
  const byRef = new Map<string, number>()
  const kidList = (k: PDFObject | undefined): PDFObject[] => (k === undefined ? [] : k instanceof PDFArray ? k.asArray() : [k])
  const walk = (node: PDFObject, parent: number | null, inheritedPage: number | null) => {
    const o = node instanceof PDFRef ? ctx.lookup(node) : node
    if (o instanceof PDFNumber) {
      if (parent !== null) elems[parent].mcids++
      return
    }
    if (!(o instanceof PDFDict)) return
    const t = text(o.get(N('Type')))
    if (t === 'MCR') {
      if (parent !== null) elems[parent].mcids++
      return
    }
    if (t === 'OBJR') {
      const ob = o.get(N('Obj'))
      if (parent !== null) elems[parent].objr.push(ob instanceof PDFRef ? ob.toString() : null)
      return
    }
    const type = text(o.get(N('S')))
    if (!type) return
    const pg = o.get(N('Pg'))
    const page = pg instanceof PDFRef ? (pageIdx.get(pg.toString()) ?? inheritedPage) : inheritedPage
    const id = elems.length
    elems.push({ type, mapped: roleMap[type] ?? type, parent, kids: [], page, mcids: 0, objr: [], hasAlt: o.has(N('Alt')), alt: text(o.get(N('Alt'))) })
    if (parent !== null) elems[parent].kids.push(id)
    if (node instanceof PDFRef) byRef.set(node.toString(), id)
    for (const k of kidList(o.get(N('K')))) walk(k, id, page)
  }
  if (root) for (const k of kidList(root.get(N('K')))) walk(k, null, null)
  const types: Record<string, number> = {}
  for (const e of elems) inc(types, e.mapped)
  const items = (e: Elem): number => e.mcids + e.kids.reduce((s, i) => s + items(elems[i]), 0)
  const kidsOf = (e: Elem) => e.kids.map((i) => elems[i])
  const firstPage = (e: Elem): number | null => e.page ?? kidsOf(e).map(firstPage).find((p) => p !== null) ?? null

  const figures = elems.filter((e) => e.mapped === 'Figure').map((e) => ({ page: firstPage(e), alt: e.alt, contentItems: items(e) }))
  const ls = elems.filter((e) => e.mapped === 'L')
  const lis = elems.filter((e) => e.mapped === 'LI')
  const tds = elems.filter((e) => e.mapped === 'TD')
  const ths = elems.filter((e) => e.mapped === 'TH')

  // ---- links ----
  const inTree = new Set(elems.flatMap((e) => e.objr).filter((x): x is string => !!x))
  const links: PdfStats['links'] = { total: 0, uri: 0, goto: 0, inStructTree: 0, withContents: 0, byTargetPage: {} }
  for (const p of pages) {
    const an = p.node.lookupMaybe(N('Annots'), PDFArray)
    if (!an) continue
    for (let j = 0; j < an.size(); j++) {
      const ref = an.get(j)
      const a = an.lookup(j)
      if (!(a instanceof PDFDict) || text(a.get(N('Subtype'))) !== 'Link') continue
      links.total++
      const act = a.lookupMaybe(N('A'), PDFDict)
      const kind = text(act?.get(N('S')))
      if (kind === 'URI') links.uri++
      else if (a.has(N('Dest')) || kind === 'GoTo') {
        links.goto++
        const to = a.has(N('Dest')) ? destPage(a.get(N('Dest'))) : destPage(act?.get(N('D')))
        if (to !== null) inc(links.byTargetPage, String(to))
      }
      if (ref instanceof PDFRef && inTree.has(ref.toString())) links.inStructTree++
      if (text(a.get(N('Contents')))) links.withContents++
    }
  }

  // ---- painted content outside marked content ----
  const content = { artifactBlocks: 0, markedBlocks: 0, unmarkedPaintOps: 0 }
  const PAINT = new Set(['S', 's', 'f', 'F', 'f*', 'B', 'B*', 'b', 'b*', 'sh', 'Do', 'Tj', 'TJ', "'", '"'])
  for (const p of pages) {
    const c = p.node.lookup(N('Contents'))
    const streams = c instanceof PDFArray ? c.asArray().map((r) => ctx.lookup(r)) : c ? [c] : []
    const chunks: string[] = []
    for (const s of streams) {
      try {
        const b = s instanceof PDFRawStream ? decodePDFRawStream(s).decode() : (s as PDFStream).getContents()
        chunks.push(new TextDecoder('latin1').decode(b))
      } catch { /* a stream pdf-lib cannot decode */ }
    }
    // names, strings and dictionaries removed, so only operators are left
    const src = chunks.join('\n').replace(/\((?:\\.|[^\\()])*\)/g, '()').replace(/<[0-9A-Fa-f\s]*>/g, '').replace(/%[^\r\n]*/g, '')
    const depthStack: boolean[] = []
    for (const m of src.matchAll(/\/(\w+)\s*(?:<<[^>]*>>|\/\w+)?\s*(BDC|BMC)|\bEMC\b|(?<![\w/])([A-Za-z'"*]+)(?![\w])/g)) {
      if (m[2]) {
        depthStack.push(true)
        if (m[1] === 'Artifact') content.artifactBlocks++
        else content.markedBlocks++
      } else if (m[0] === 'EMC') depthStack.pop()
      else if (m[3] && PAINT.has(m[3]) && !depthStack.length) content.unmarkedPaintOps++
    }
  }

  return {
    pages: pages.length,
    doc: docInfo,
    outlines,
    types,
    figures,
    links,
    lists: { lists: ls.length, items: lis.length, withoutLabel: lis.filter((l) => !kidsOf(l).some((k) => k.mapped === 'Lbl')).length, withoutBody: lis.filter((l) => !kidsOf(l).some((k) => k.mapped === 'LBody')).length },
    tables: { tables: types.Table ?? 0, rows: types.TR ?? 0, headerCells: ths.length, cells: tds.length + ths.length },
    notes: { notes: types.Note ?? 0, references: types.Reference ?? 0 },
    toc: { toc: types.TOC ?? 0, items: types.TOCI ?? 0 },
    content,
  }
}
