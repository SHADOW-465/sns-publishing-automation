import { PDFDocument, PDFName, PDFArray, PDFDict, PDFRef, PDFNumber, PDFHexString, PDFString, PDFStream, PDFRawStream, type PDFPage, type PDFObject } from 'pdf-lib'
import { tokenize, paints, rewrite, stripMarked, type Op, type Paint, type Owner, type Box } from './content.ts'
import { pageContent, pageResources, streamBytes, latin1, fromLatin1, trimOf } from './pages.ts'
import type { SNode, Structure } from './structure.ts'
import type { PdfBook, PLine } from '../pdfepub/analyze.ts'
import type { ReviewItem } from '../epub/package.ts'

// =============================================================================================
// Accessible PDF writer: re-tags the document from scratch (PDF/UA-1).
// Old tags are removed, every painting operator is marked (tag with MCID, or /Artifact), and a
// new structure tree, ParentTree, bookmarks, XMP (pdfuaid) and viewer settings are written.
// =============================================================================================

export interface UaMeta {
  title: string
  author: string
  lang: string
  subject: string
  keywords: string
}

export interface PagePlan {
  src: string
  ops: Op[]
  paints: (Paint | null)[]
}

/** Parse every page once: its content operators and where each one draws. */
export async function planPages(data: Uint8Array): Promise<{ doc: PDFDocument; pages: PagePlan[] }> {
  const doc = await PDFDocument.load(data, { updateMetadata: false, ignoreEncryption: true })
  const pages = doc.getPages().map((p) => {
    const src = pageContent(doc, p)
    const ops = tokenize(src)
    return { src, ops, paints: paints(ops, pageResources(doc, p)) }
  })
  return { doc, pages }
}

const centreIn = (b: Box, f: Box, pad = 2) => {
  const cx = (b.x0 + b.x1) / 2
  const cy = (b.y0 + b.y1) / 2
  return cx >= f.x0 - pad && cx <= f.x1 + pad && cy >= f.y0 - pad && cy <= f.y1 + pad
}

/** The layout line a text-showing operator belongs to (baseline + horizontal range). */
function lineFor(p: Extract<Paint, { kind: 'text' }>, lines: PLine[], H: number): PLine | undefined {
  const yb = H - p.y
  // lines on this baseline; the horizontally nearest wins (trailing spaces fall just past a
  // line's end, and positions inside a line are only known up to its last Td/Tm)
  let best: PLine | undefined
  let bestD = Infinity
  for (const l of lines) {
    if (Math.abs(l.base - yb) >= Math.max(1.5, p.size * 0.35)) continue
    const dx = p.x < l.x0 ? l.x0 - p.x : p.x > l.x1 ? p.x - l.x1 : 0
    const d = dx + Math.abs(l.base - yb)
    if (d < bestD) (best = l), (bestD = d)
  }
  return bestD < Math.max(40, p.size * 4) ? best : undefined
}

export function writeUa(
  plan: { doc: PDFDocument; pages: PagePlan[] }, book: PdfBook, st: Structure, meta: UaMeta,
  opts: { cropToTrim: boolean; frontPages?: { page: number; label: string }[] },
): { pdf: Promise<Uint8Array>; review: ReviewItem[]; stats: Record<string, number> } {
  const { doc } = plan
  const ctx = doc.context
  const review: ReviewItem[] = []
  const pages = doc.getPages()
  const pageRefs = pages.map((p) => p.ref)
  const mcrs = new Map<SNode, { page: number; mcid: number }[]>()
  const figureOf = new Map<PLine, SNode>()
  for (const f of st.figures) for (const l of f.lines) if (f.node) figureOf.set(l, f.node)
  let unmatchedText = 0
  let taggedOps = 0
  let artifactOps = 0

  // ---- 1. forget the old tagging ----
  for (const k of ['StructTreeRoot', 'MarkInfo', 'Outlines', 'Metadata']) doc.catalog.delete(PDFName.of(k))
  const strippedForms = new Set<string>()
  const stripForms = (res: PDFDict | undefined) => {
    const xo = res?.lookupMaybe(PDFName.of('XObject'), PDFDict)
    if (!xo) return
    for (const [, v] of xo.entries()) {
      if (!(v instanceof PDFRef) || strippedForms.has(v.toString())) continue
      const s = ctx.lookup(v)
      if (!(s instanceof PDFStream) || s.dict.get(PDFName.of('Subtype'))?.toString() !== '/Form') continue
      strippedForms.add(v.toString())
      // marked content inside forms would clash with the page-level tagging: keep only /OC
      const src = latin1(streamBytes(doc, v))
      const res2 = stripMarked(src, tokenize(src))
      const dict = s.dict.clone(ctx)
      for (const k of ['Filter', 'DecodeParms', 'Length', 'StructParents', 'StructParent']) dict.delete(PDFName.of(k))
      ctx.assign(v, ctx.flateStream(fromLatin1(res2), Object.fromEntries(dict.entries().map(([k, val]) => [k.asString().slice(1), val]))))
      stripForms(s.dict.lookupMaybe(PDFName.of('Resources'), PDFDict))
    }
  }

  // ---- 2. mark every painting operator ----
  pages.forEach((page, i) => {
    const pp = plan.pages[i]
    const layout = book.pages[i]
    const H = layout.height
    const figs = st.figures.filter((f) => f.page === i && f.node)
    const trim = trimOf(page)
    const covered = new Set<PLine>()
    const owners: (Owner | undefined)[] = pp.ops.map((_, k) => {
      const p = pp.paints[k]
      if (!p) return undefined
      let node: SNode | undefined
      if (p.kind === 'text') {
        if (p.x >= trim.x1 - 2 || p.x < trim.x0 - 20 || H - p.y < trim.top || H - p.y > trim.bottom) return artifactOps++, null // slug
        const l = lineFor(p, layout.lines, H)
        if (l) covered.add(l)
        node = l ? (figureOf.get(l) ?? st.owner.get(l)) : undefined
        // rotated labels inside a chart belong to the chart
        if (!l) node = figs.find((f) => p.x >= f.box.x0 - 2 && p.x <= f.box.x1 + 2 && p.y >= f.box.y0 - 2 && p.y <= f.box.y1 + 2)?.node
        // running heads / folios sit in the page margins and are meant to be artifacts; so are blank spacers
        const raw = pp.src.slice(pp.ops[k].start, pp.ops[k].end)
        if (!l && !node && H - p.y > H * 0.13 && H - p.y < H * 0.87 && !/^[[(\s)\]\d.-]*T[jJ]$/.test(raw.replace(/\s+/g, ''))) {
          unmatchedText++
          if (globalThis.process?.env?.UA_DEBUG) console.log('UNMATCHED', i + 1, p.x.toFixed(0), (H - p.y).toFixed(0), raw.slice(0, 70))
        }
      } else if (p.kind === 'image' || p.kind === 'path' || p.kind === 'form') {
        node = figs.find((f) => centreIn(p.box, f.box))?.node ?? undefined
        // a picture-only form wrapped in a page-sized box (placed logos): the figure it contains
        if (!node && p.kind === 'form' && !p.text) node = figs.find((f) => centreIn(f.box, p.box, 0))?.node
        if (!node && p.kind === 'form') {
          // text drawn inside a form XObject: owned by the first line the form holds
          const l = layout.lines.find((x) => !covered.has(x) && x.x0 >= p.box.x0 - 1 && x.x1 <= p.box.x1 + 1 && H - x.base >= p.box.y0 - 1 && H - x.base <= p.box.y1 + 1)
          node = l ? (figureOf.get(l) ?? st.owner.get(l)) : undefined
        }
      }
      node ? taggedOps++ : artifactOps++
      return node ? { el: node.id, tag: node.tag } : null
    })
    const { stream, mcids } = rewrite(pp.src, pp.ops, owners)
    const byId = new Map(st.nodes.map((n) => [n.id, n]))
    mcids.forEach((id, mcid) => {
      const n = byId.get(id)!
      mcrs.set(n, [...(mcrs.get(n) ?? []), { page: i, mcid }])
    })
    page.node.set(PDFName.of('Contents'), ctx.register(ctx.flateStream(fromLatin1(stream))))
    page.node.set(PDFName.of('StructParents'), PDFNumber.of(i))
    page.node.set(PDFName.of('Tabs'), PDFName.of('S'))
    stripForms(page.node.Resources())
    if (opts.cropToTrim) {
      const t = page.getTrimBox()
      const m = page.getMediaBox()
      if (t.width < m.width - 1 || t.height < m.height - 1) page.setCropBox(t.x, t.y, t.width, t.height)
    }
  })

  // ---- 3. links: annotations become Link elements next to their text ----
  const annotKids = new Map<SNode, { ref: PDFRef; page: number }[]>()
  const parentTree: [number, PDFObject][] = []
  let annotKey = pages.length
  const linkNodes: { node: SNode; annot: PDFRef; page: number; key: number }[] = []
  pages.forEach((page, i) => {
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
    if (!annots) return
    const keep: PDFObject[] = []
    for (const a of annots.asArray()) {
      const d = a instanceof PDFRef ? ctx.lookup(a, PDFDict) : (a as PDFDict)
      const sub = d.get(PDFName.of('Subtype'))?.toString()
      if (sub === '/PrinterMark' || sub === '/TrapNet') continue // print-only
      keep.push(a)
      d.delete(PDFName.of('StructParent'))
      if (sub !== '/Link' || !(a instanceof PDFRef)) continue
      const r = d.lookupMaybe(PDFName.of('Rect'), PDFArray)?.asArray().map((x) => (x as PDFNumber).asNumber()) ?? [0, 0, 0, 0]
      const H = book.pages[i].height
      const under = book.pages[i].lines.filter((l) => l.x1 > r[0] && l.x0 < r[2] && H - l.base >= Math.min(r[1], r[3]) - 2 && H - l.base <= Math.max(r[1], r[3]) + 2)
      const host = under.map((l) => st.owner.get(l)).find(Boolean)
      const link: SNode = { id: -1, tag: 'Link', kids: [], lines: [], text: under.map((l) => l.text.trim()).join(' ') }
      if (!d.get(PDFName.of('Contents'))) {
        const uri = d.lookupMaybe(PDFName.of('A'), PDFDict)?.get(PDFName.of('URI'))?.toString().replace(/^\(|\)$/g, '')
        d.set(PDFName.of('Contents'), PDFHexString.fromText(link.text || uri || 'Link'))
      }
      d.set(PDFName.of('StructParent'), PDFNumber.of(annotKey))
      ;(host ?? st.root).kids.push(link)
      linkNodes.push({ node: link, annot: a, page: i, key: annotKey++ })
      annotKids.set(link, [{ ref: a, page: i }])
    }
    page.node.set(PDFName.of('Annots'), ctx.obj(keep))
  })

  // ---- 3b. links the production team added by hand: contents entries and web addresses ----
  const addLink = (page: number, rect: Box, host: SNode, action: Record<string, PDFObject>, text: string) => {
    const annot = ctx.register(ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [rect.x0, rect.y0, rect.x1, rect.y1], Border: [0, 0, 0], P: pageRefs[page], Contents: PDFHexString.fromText(text), StructParent: annotKey, ...action }))
    const arr = pages[page].node.lookupMaybe(PDFName.of('Annots'), PDFArray)
    if (arr) arr.push(annot)
    else pages[page].node.set(PDFName.of('Annots'), ctx.obj([annot]))
    const link: SNode = { id: -1, tag: 'Link', kids: [], lines: [], text }
    host.kids.push(link)
    linkNodes.push({ node: link, annot, page, key: annotKey++ })
    annotKids.set(link, [{ ref: annot, page }])
  }
  const boxOf = (ls: PLine[]): Box => {
    const H = book.pages[ls[0].page].height
    return { x0: Math.min(...ls.map((l) => l.x0)), x1: Math.max(...ls.map((l) => l.x1)), y0: H - Math.max(...ls.map((l) => l.base)) - 3, y1: H - Math.min(...ls.map((l) => l.y)) + 1 }
  }
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/^[\divxlc]+[.:)]?\s+/i, '').replace(/[^\p{L}\p{N}]+/gu, '')
  let tocLinks = 0
  for (const e of st.tocEntries) {
    if (!e.lines.length) continue
    const text = e.lines.map((l) => l.text.trim()).join(' ').replace(/\s+/g, ' ')
    const pageNo = Number(text.match(/(\d{1,4})\s*$/)?.[1] ?? NaN)
    const label = norm(text.replace(/\s*(\d{1,4}|[ivxlc]{1,7})\s*$/i, ''))
    const target = st.headings.find((h) => h.lines.length && label.length > 2 && (norm(h.text ?? '') === label || norm(h.text ?? '').startsWith(label))) ?? st.headings.find((h) => h.lines.length && book.numbers[h.lines[0].page] === pageNo)
    const destPage = target ? target.lines[0].page : book.numbers.indexOf(pageNo)
    if (destPage < 0) continue
    const top = target ? book.pages[destPage].height - target.lines[0].y + target.lines[0].size : book.pages[destPage].height
    // one link per page the entry sits on
    const byPage = new Map<number, PLine[]>()
    for (const l of e.lines) byPage.set(l.page, [...(byPage.get(l.page) ?? []), l])
    for (const [pg, ls] of byPage) addLink(pg, boxOf(ls), e, { Dest: ctx.obj([pageRefs[destPage], PDFName.of('XYZ'), ctx.obj(null), PDFNumber.of(top), ctx.obj(null)]) }, text)
    tocLinks++
  }
  const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"“”]*[^\s<>"“”.,;:)\]]/gi
  let urlLinks = 0
  for (const [l, host] of st.owner) {
    for (const m of l.text.matchAll(URL_RE)) {
      // horizontal extent of the address, proportional within the line
      const w = l.x1 - l.x0
      const a = l.x0 + (w * m.index!) / l.text.length
      const b = l.x0 + (w * (m.index! + m[0].length)) / l.text.length
      const H = book.pages[l.page].height
      const uri = m[0].startsWith('www.') ? `https://${m[0]}` : m[0]
      addLink(l.page, { x0: a, x1: b, y0: H - l.base - 3, y1: H - l.y + 1 }, host, { A: ctx.obj({ S: 'URI', URI: PDFString.of(uri) }) }, m[0])
      urlLinks++
    }
  }
  if (tocLinks + urlLinks) review.push({ level: 'info', msg: `Added ${tocLinks} contents link(s) and ${urlLinks} web link(s).` })

  // ---- 4. structure tree ----
  const hasContent = (n: SNode): boolean => (mcrs.get(n)?.length ?? 0) > 0 || annotKids.has(n) || n.kids.some(hasContent)
  let dropped = 0
  const prune = (n: SNode) => {
    n.kids = n.kids.filter((k) => {
      const keep = hasContent(k)
      if (!keep && k.tag === 'Figure') dropped++
      return keep
    })
    n.kids.forEach(prune)
  }
  prune(st.root)
  if (dropped) review.push({ level: 'warn', msg: `${dropped} detected figure(s) had nothing drawn in them and were left out.` })
  const refOf = new Map<SNode, PDFRef>()
  const walk = (n: SNode, f: (n: SNode) => void) => (f(n), n.kids.forEach((k) => walk(k, f)))
  const parentOf = new Map<SNode, SNode>()
  walk(st.root, (n) => {
    refOf.set(n, ctx.nextRef())
    for (const c of n.kids) parentOf.set(c, n)
  })
  const rootRef = ctx.nextRef()
  const firstPage = (n: SNode): number | undefined => mcrs.get(n)?.[0]?.page ?? annotKids.get(n)?.[0]?.page ?? n.kids.map(firstPage).find((p) => p !== undefined)
  const perPage: PDFRef[][] = pages.map(() => [])
  let missingAlt = 0
  walk(st.root, (n) => {
    const pg = firstPage(n)
    const k: PDFObject[] = []
    for (const m of mcrs.get(n) ?? []) {
      k.push(m.page === pg ? PDFNumber.of(m.mcid) : ctx.obj({ Type: 'MCR', Pg: pageRefs[m.page], MCID: m.mcid }))
      perPage[m.page][m.mcid] = refOf.get(n)!
    }
    for (const a of annotKids.get(n) ?? []) k.push(ctx.obj({ Type: 'OBJR', Obj: a.ref, Pg: pageRefs[a.page] }))
    for (const c of n.kids) k.push(refOf.get(c)!)
    const parent = parentOf.get(n)
    const dict: Record<string, PDFObject | string> = { Type: 'StructElem', S: n.tag, P: parent ? refOf.get(parent)! : rootRef, K: ctx.obj(k) }
    if (pg !== undefined) dict.Pg = pageRefs[pg]
    if (n.tag === 'Figure') {
      if (n.alt) dict.Alt = PDFHexString.fromText(n.alt)
      else missingAlt++
    }
    if (n.tag === 'Link' && n.text) dict.Alt = PDFHexString.fromText(n.text)
    ctx.assign(refOf.get(n)!, ctx.obj(dict))
  })
  for (const l of linkNodes) parentTree.push([l.key, refOf.get(l.node)!])
  pages.forEach((_, i) => parentTree.push([i, ctx.obj(Array.from(perPage[i], (r) => r ?? refOf.get(st.root)!))]))
  parentTree.sort((a, b) => a[0] - b[0])
  const nums: PDFObject[] = []
  for (const [k, v] of parentTree) nums.push(PDFNumber.of(k), v)
  ctx.assign(rootRef, ctx.obj({ Type: 'StructTreeRoot', K: refOf.get(st.root)!, ParentTree: ctx.obj({ Nums: ctx.obj(nums) }), ParentTreeNextKey: annotKey }))
  doc.catalog.set(PDFName.of('StructTreeRoot'), rootRef)
  doc.catalog.set(PDFName.of('MarkInfo'), ctx.obj({ Marked: true }))
  if (missingAlt) review.push({ level: 'error', msg: `${missingAlt} figure(s) have no alternative text — PDF/UA requires it.` })
  if (unmatchedText) review.push({ level: 'warn', msg: `${unmatchedText} text fragment(s) could not be placed in the reading order and were marked as decoration (check running heads / page furniture).` })

  // ---- 5. bookmarks from the headings (+ named front pages that have no heading) ----
  const heads = st.headings.filter((h) => refOf.has(h) && h.lines.length)
  const headed = new Set(heads.map((h) => h.lines[0].page))
  const front = (opts.frontPages ?? []).filter((f) => !headed.has(f.page))
  const marks: SNode[] = [
    ...front.map((f) => ({ id: -2, tag: 'H1', kids: [], lines: [{ page: f.page, x0: 0, y: 0, size: 0 } as unknown as PLine], text: f.label })),
    ...heads,
  ].sort((a, b) => a.lines[0].page - b.lines[0].page)
  if (marks.length) {
    type Item = { h: SNode; level: number; ref: PDFRef; kids: Item[]; parent?: Item }
    const top: Item[] = []
    const stack: Item[] = []
    for (const h of marks) {
      const level = Number(h.tag.slice(1))
      const it: Item = { h, level, ref: ctx.nextRef(), kids: [] }
      while (stack.length && stack[stack.length - 1].level >= level) stack.pop()
      const parent = stack[stack.length - 1]
      ;(parent ? parent.kids : top).push(it)
      it.parent = parent
      stack.push(it)
    }
    const outlines = ctx.nextRef()
    const count = (xs: Item[]): number => xs.reduce((n, x) => n + 1 + count(x.kids), 0)
    const emit = (xs: Item[], parentRef: PDFRef) =>
      xs.forEach((x, i) => {
        const l = x.h.lines[0]
        const dict: Record<string, PDFObject> = {
          Title: PDFHexString.fromText((x.h.text ?? '').replace(/\s+/g, ' ').trim()),
          Parent: parentRef,
          Dest: ctx.obj([pageRefs[l.page], PDFName.of('XYZ'), PDFNumber.of(Math.max(0, l.x0 - 10)), PDFNumber.of(book.pages[l.page].height - l.y + l.size), ctx.obj(null)]),
        }
        if (i > 0) dict.Prev = xs[i - 1].ref
        if (i < xs.length - 1) dict.Next = xs[i + 1].ref
        if (x.kids.length) Object.assign(dict, { First: x.kids[0].ref, Last: x.kids[x.kids.length - 1].ref, Count: PDFNumber.of(-count(x.kids)) })
        ctx.assign(x.ref, ctx.obj(dict))
        emit(x.kids, x.ref)
      })
    emit(top, outlines)
    ctx.assign(outlines, ctx.obj({ Type: 'Outlines', First: top[0].ref, Last: top[top.length - 1].ref, Count: PDFNumber.of(count(top)) }))
    doc.catalog.set(PDFName.of('Outlines'), outlines)
    doc.catalog.set(PDFName.of('PageMode'), PDFName.of('UseOutlines'))
  }

  // ---- 6. document metadata ----
  doc.setTitle(meta.title, { showInWindowTitleBar: true })
  if (meta.author) doc.setAuthor(meta.author)
  if (meta.subject) doc.setSubject(meta.subject)
  if (meta.keywords) doc.setKeywords([meta.keywords])
  doc.setLanguage(meta.lang)
  doc.setProducer('Publishing Automation — PDF/UA tagging')
  doc.setModificationDate(new Date())
  const xmp = ctx.stream(xmpPacket(meta), { Type: 'Metadata', Subtype: 'XML' })
  doc.catalog.set(PDFName.of('Metadata'), ctx.register(xmp))

  return {
    pdf: doc.save({ useObjectStreams: false, updateFieldAppearances: false }),
    review,
    stats: { taggedOps, artifactOps, unmatchedText, figures: st.figures.filter((f) => f.node && refOf.has(f.node)).length, headings: heads.length, links: linkNodes.length, missingAlt },
  }
}

const xe = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

export function xmpPacket(meta: UaMeta): string {
  const now = new Date().toISOString()
  return `<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
<rdf:Description rdf:about=""
 xmlns:dc="http://purl.org/dc/elements/1.1/"
 xmlns:pdf="http://ns.adobe.com/pdf/1.3/"
 xmlns:xmp="http://ns.adobe.com/xap/1.0/"
 xmlns:pdfuaid="http://www.aiim.org/pdfua/ns/id/">
<dc:format>application/pdf</dc:format>
<dc:title><rdf:Alt><rdf:li xml:lang="x-default">${xe(meta.title)}</rdf:li></rdf:Alt></dc:title>
${meta.author ? `<dc:creator><rdf:Seq><rdf:li>${xe(meta.author)}</rdf:li></rdf:Seq></dc:creator>` : ''}
${meta.subject ? `<dc:description><rdf:Alt><rdf:li xml:lang="x-default">${xe(meta.subject)}</rdf:li></rdf:Alt></dc:description>` : ''}
<dc:language><rdf:Bag><rdf:li>${xe(meta.lang)}</rdf:li></rdf:Bag></dc:language>
${meta.keywords ? `<pdf:Keywords>${xe(meta.keywords)}</pdf:Keywords>` : ''}
<pdf:Producer>Publishing Automation — PDF/UA tagging</pdf:Producer>
<xmp:ModifyDate>${now}</xmp:ModifyDate>
<xmp:MetadataDate>${now}</xmp:MetadataDate>
<pdfuaid:part>1</pdfuaid:part>
</rdf:Description>
</rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`
}

export type { PDFPage, PDFRawStream }
