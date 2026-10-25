// Batch 3A, SacGeo accessible PDF: every picture and ornament is tagged (PFG-001), running heads and folios are
// artifacts (PAR-001), the caption is its own element after its figure (PFG-003), and a contents list holds no figure (PRO-008).
// Synthetic books only: nothing here comes from a client file.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFString, StandardFonts, rgb, pushGraphicsState, popGraphicsState, concatTransformationMatrix, drawObject } from 'pdf-lib'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { analyzeUa, buildUa } from '../src/engine/pdfua/index.ts'
import { auditPictures, readTree, tagOrder } from '../src/engine/pdfua/audit.ts'
import { runningHeadGuard } from '../src/engine/pdfua/write.ts'
import { headingGuards, structureGuards } from '../src/engine/pdfua/guards.ts'
import { buildStructure, inferUaStyles, uaOptionsFrom, type SNode, type UaRole } from '../src/engine/pdfua/structure.ts'
import { pageContent } from '../src/engine/pdfua/pages.ts'
import type { PdfBook, PLine } from '../src/engine/pdfepub/analyze.ts'
import { openSpec } from '../src/engine/spec/session.ts'
import { MemoryStore, setStore } from '../src/engine/spec/store.ts'
import { nodeRaster } from './raster-node.ts'
import { readTags } from './read-tags.ts'

const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'))
const BODY = ['The river crosses the plain and the old road follows it to the sea.', 'Nobody walked there in winter, because the ice came down from the hills.', 'In spring the farmers drove their carts to the market in the town.', 'The market closed at dusk and the square was quiet until the morning.']

/** Six pages, 440 x 640 with the trim inset by 20: a picture with a caption, an image mask, a picture inside a form, a vector ornament, running heads, and a printer's slug. */
async function book(pages = 6): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const png = await doc.embedPng(PNG)
  const ctx = doc.context
  const mask = ctx.register(ctx.stream(new Uint8Array(8).fill(0x55), { Type: 'XObject', Subtype: 'Image', Width: 8, Height: 8, ImageMask: true, BitsPerComponent: 1 }))
  const form = ctx.register(ctx.stream('q 40 0 0 40 0 0 cm /Img Do Q', { Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 40, 40], Resources: { XObject: { Img: png.ref } } }))
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([440, 640])
    page.setTrimBox(20, 20, 400, 600)
    // running heads: one per side with its own page number, one exact line at the foot whose number is part of the words
    page.drawText(i % 2 === 0 ? `${i + 1}  Introduccion` : `Historia del libro  ${i + 1}`, { x: 60, y: 590, size: 9, font })
    page.drawText(i % 2 === 0 ? 'xii Prologo' : 'Prologo xiii', { x: 250, y: 578, size: 9, font })
    page.drawText('Vorwort zur 3. Aufl. Medien', { x: 60, y: 30, size: 9, font })
    BODY.forEach((t, k) => page.drawText(`${t} (${i + 1}.${k})`, { x: 60, y: 540 - k * 20, size: 11, font }))
    // the printer's slug lies outside the trim: colour bars, a file line and a small mark
    for (let k = 0; k < 12; k++) page.drawRectangle({ x: 30 + k * 14, y: 4, width: 12, height: 10, color: rgb(0, 0, 0) })
    page.drawText('job.indd 1 4/5/26', { x: 30, y: 8, size: 6, font })
    page.drawImage(png, { x: 30, y: 626, width: 14, height: 10 })
    if (i === 0) {
      page.drawImage(png, { x: 100, y: 300, width: 120, height: 90 })
      page.drawText('Figure 1.1 A coastal map of the field', { x: 100, y: 285, size: 9, font })
    }
    if (i === 1) {
      page.pushOperators(pushGraphicsState(), concatTransformationMatrix(30, 0, 0, 30, 200, 420), drawObject(page.node.newXObject('Mk', mask)), popGraphicsState())
      page.pushOperators(pushGraphicsState(), concatTransformationMatrix(1, 0, 0, 1, 100, 360), drawObject(page.node.newXObject('Fm1', form)), popGraphicsState())
    }
    if (i === 2) for (let k = 0; k < 10; k++) page.drawCircle({ x: 280 + (k % 5) * 8, y: 300 + Math.floor(k / 5) * 8, size: 3, color: rgb(0.2, 0.2, 0.2) })
  }
  return new Uint8Array(await doc.save())
}

type Opts = Parameters<typeof analyzeUa>[2]['options']
async function run(options: Opts, tweak?: (a: Awaited<ReturnType<typeof analyzeUa>>) => void) {
  const a = await analyzeUa(pdfjs, nodeRaster, { main: await book(), extras: [], options })
  tweak?.(a)
  // a description for every picture the client would have to describe; ornaments get none, so the ornaments setting decides what they are
  const alt = Object.fromEntries(a.figures.filter((f) => !f.ornament).map((f) => [f.key, 'A description written by a person.']))
  const r = await buildUa(a, { styles: a.styles, meta: { ...a.meta, isbn: '' }, alt, cropToTrim: false, sourceName: 'probe.pdf', options })
  return { a, r, doc: await PDFDocument.load(r.pdf, { updateMetadata: false }) }
}

test('PFG-001: an image mask, a picture inside a form and a vector ornament are figures; the printer’s slug is not', async () => {
  const { a, r, doc } = await run({ ornaments: 'figure' })
  // 3 painted pictures inside the trim (the page picture, the mask, the picture inside the form); the small slug image on each of the six pages is outside it
  assert.equal(r.stats.pictures, 3)
  assert.equal(r.stats.untaggedPictures, 0)
  assert.ok(r.stats.slugOps >= 6 * 13, `slug paints are artifacts, got ${r.stats.slugOps}`)
  const audit = auditPictures(doc)
  assert.equal(audit.pictures, 3)
  assert.equal(audit.picturesInTree, 3)
  assert.equal(audit.picturesArtifact, 0)
  assert.equal(audit.slugPictures, 6)
  // one Figure per picture and one for the vector ornament, none for the slug bars (before: one per page, with ~12 Path children)
  assert.equal(audit.figureElements, 4)
  assert.equal(a.figures.length, 4)
  assert.deepEqual(r.review.filter((x) => /^(PFG-001|PAR-001)/.test(x.msg)), [])
  // an ornament is a figure like any other: it needs a description from the alt layers, and the build says so while it has none (PFG-002)
  assert.match(r.review.find((x) => x.level === 'error' && /alternative text/.test(x.msg))?.msg ?? '', /^2 figure\(s\) have no alternative text/) // the mask and the picture in the form; the vector mark is a logo and was described
})

test('PFG-001: with ornaments as decoration they are artifacts on purpose, and the guard flags a picture lost by accident', async () => {
  const { a, r, doc } = await run({ ornaments: 'artifact' })
  const audit = auditPictures(doc)
  assert.equal(audit.figureElements, 2, 'the captioned picture and the vector mark (a logo: that is the logos setting) stay figures')
  assert.equal(audit.picturesInTree, 1)
  assert.equal(audit.picturesArtifact, 2)
  assert.equal(r.stats.untaggedPictures, 0, 'decoration chosen by the setting is not a lost picture')
  // the same pictures with no figure found for them: the guard names the rule and the pages
  const lost = await buildUa({ ...a, detected: new Map() }, { styles: a.styles, meta: { ...a.meta, isbn: '' }, alt: {}, cropToTrim: false, options: { ornaments: 'artifact' } })
  const msg = lost.review.find((x) => x.msg.startsWith('PFG-001:'))
  assert.ok(msg, JSON.stringify(lost.review))
  assert.equal(msg!.level, 'error')
  assert.match(msg!.msg, /^PFG-001: 4 painted picture\(s\) are neither in the structure tree nor marked decorative, on pages 1, 2, 3\./) // the picture, the mask, the picture in the form, the vector ornament
})

test('PAR-001: running heads and folios are pagination artifacts, not tags, and the guard fires on one left in', async () => {
  const { a, r, doc } = await run({})
  const tagged = (await readTags(r.pdf, 1, 6)).join('\n')
  assert.doesNotMatch(tagged, /Introduccion|Historia del libro|Vorwort|Prologo/)
  assert.match(tagged, /river crosses the plain/, 'the body text is still read')
  const src = pageContent(doc, doc.getPage(1))
  assert.match(src, /\/Artifact <<\/Type \/Pagination \/Subtype \/Header>> BDC/)
  assert.match(src, /\/Artifact <<\/Type \/Pagination \/Subtype \/Footer>> BDC/)
  assert.deepEqual(r.review.filter((x) => x.msg.startsWith('PAR-001')), [])
  assert.ok(a.book.pages.every((p) => (p.furniture?.length ?? 0) >= 2), 'the layout lists the furniture it took out')
  // the setting that keeps them: they are read as text, and the guard stands down
  const kept = await run({ runningHeads: 'keep' })
  assert.match((await readTags(kept.r.pdf, 1, 6)).join('\n'), /Introduccion/)
  assert.deepEqual(kept.r.review.filter((x) => x.msg.startsWith('PAR-001')), [])
  // the guard itself, on a tree that still holds a repeated head
  const ln = (page: number, text: string) => ({ page, text, size: 9, y: 30, x0: 60, x1: 200, base: 38 }) as unknown as PLine
  const pageOf = (i: number) => ({ index: i, height: 640 })
  const fake = { pages: [0, 1, 2, 3].map(pageOf), bodySize: 11 } as unknown as Pick<PdfBook, 'pages' | 'bodySize'>
  const P = { tag: 'P' } as SNode
  const owner = new Map<PLine, SNode>([0, 1, 2, 3].map((i) => [ln(i, `${i + 4}  Introduccion`), P]))
  const bad = runningHeadGuard({ owner }, fake)
  assert.equal(bad.length, 1)
  assert.match(bad[0].msg, /^PAR-001: the running head or folio “# introduccion” is still in the reading order on 4 pages/)
  assert.deepEqual(runningHeadGuard({ owner }, fake, 'keep'), [])
  assert.deepEqual(runningHeadGuard({ owner: new Map([...owner].map(([l]) => [l, { tag: 'H2' } as SNode])) }, fake), [], 'a heading is not furniture')
})

test('PFG-003: the caption is a Caption element right after its Figure, or inside it when the client asks', async () => {
  const after = await run({})
  const order = tagOrder(after.doc)
  const f = order.indexOf('Figure')
  assert.equal(order[f + 1], 'Caption', order.join(' '))
  assert.equal(order.filter((t) => t === 'Caption').length, 1)
  const inside = await run({ captionIn: 'inside' })
  const chains = [...readTree(inside.doc).byMcid.values()].map((e) => e.chain.join('>'))
  assert.ok(chains.some((c) => /Figure>Caption$/.test(c)), chains.join('\n'))
  assert.ok(!chains.some((c) => /Figure$/.test(c) && false))
})

// ---- layout-level cases, no PDF needed ----------------------------------------------------------
const line = (page: number, text: string, x0: number, x1: number, y: number, size: number, key: string): PLine => ({
  runs: [{ text, x0, x1, font: 'F', size, bold: false, italic: false }],
  x0, x1, y, base: y + size * 0.8, size, font: 'F', text, marker: false, key, page, col: 40,
})
const bookOf = (lines: PLine[]) =>
  ({ pages: [{ index: 0, width: 400, height: 560, lines, images: [], fills: [], rules: { h: [], v: [] }, shades: [] }], front: [], lead: 14, step: 18, bodySize: 11, numbers: [1] }) as unknown as PdfBook
const roles = new Map<string, UaRole>([['H 18', 'H2'], ['B 11', 'P'], ['C 9', 'P']])
const tagsOf = (n: SNode): string[] => [n.tag, ...n.kids.flatMap(tagsOf)]

test('PRO-008: a picture on a contents page follows the list; the list holds only entries', () => {
  const lines = [line(0, 'Contents', 40, 120, 40, 18, 'H 18'), line(0, 'Chapter One 1', 40, 360, 100, 11, 'B 11'), line(0, 'Chapter Two 14', 40, 360, 120, 11, 'B 11'), line(0, 'Chapter Three 29', 40, 360, 140, 11, 'B 11')]
  const ornament = { page: 0, box: { x0: 180, x1: 220, y0: 300, y1: 340 }, lines: [], caption: '', vector: false }
  const st = buildStructure(bookOf(lines), roles, new Map([[0, [ornament as never]]]))
  const toc = st.nodes.find((n) => n.tag === 'TOC')!
  assert.deepEqual(toc.kids.map((k) => k.tag), ['TOCI', 'TOCI', 'TOCI'])
  assert.ok(!tagsOf(toc).includes('Figure'), 'no Figure inside the TOC')
  const sect = st.nodes.find((n) => n.tag === 'Sect')!
  assert.deepEqual(sect.kids.map((k) => k.tag), ['H1', 'TOC', 'Figure'])
})

test('PFG-003: “Figura 7.2” under a picture is its caption; an unlabelled small picture is an ornament', () => {
  const lines = [line(0, 'Figura 7.2. Octavas en un piano', 100, 300, 270, 9, 'C 9'), line(0, 'Some body text goes here and it is long enough.', 40, 360, 40, 11, 'B 11')]
  const pic = { page: 0, box: { x0: 100, x1: 300, y0: 300, y1: 480 }, lines: [], caption: '', vector: false }
  const dot = { page: 0, box: { x0: 190, x1: 214, y0: 100, y1: 124 }, lines: [], caption: '', vector: false }
  const st = buildStructure(bookOf(lines), roles, new Map([[0, [pic as never, dot as never]]]))
  const kinds = st.root.kids.map((k) => k.tag)
  assert.deepEqual(kinds.filter((t) => t !== 'P'), ['Figure', 'Caption', 'Figure'])
  assert.equal(kinds[kinds.indexOf('Figure') + 1], 'Caption')
  assert.deepEqual(st.figures.map((f) => !!f.ornament), [false, true])
})

test('SacGeo’s client layer asks for ornaments as figures and linked index numbers; everyone else gets decoration', async () => {
  setStore(new MemoryStore())
  const sac = await openSpec({ client: 'Inner Traditions en Español', series: '', book: 'b', kind: 'accessible-pdf' })
  const o = uaOptionsFrom(sac.resolved.settings)
  assert.equal(o.ornaments, 'figure')
  assert.equal(o.indexLinks, true)
  assert.equal(o.captionIn, 'after')
  assert.equal(o.runningHeads, 'artifact')
  assert.equal(o.headingLevels, 'consistent')
  const other = await openSpec({ client: 'Somebody Else', series: '', book: 'b', kind: 'accessible-pdf' })
  assert.equal(uaOptionsFrom(other.resolved.settings).ornaments, 'artifact')
})

// ---- headings (PHD-002, PHD-005, PHD-008) -----------------------------------------------------
const pagesOf = (...pages: PLine[][]) =>
  ({ pages: pages.map((lines, index) => ({ index, width: 400, height: 560, lines, images: [], fills: [], rules: { h: [], v: [] }, shades: [] })), front: [], lead: 14, step: 18, bodySize: 11, numbers: pages.map((_, i) => i + 1) }) as unknown as PdfBook
const hroles = new Map<string, UaRole>([['H 24', 'H1'], ['H 18', 'H3'], ['K 13', 'H3'], ['B 11', 'P']])
const pg = (page: number, text: string, y: number, size: number, key: string) => line(page, text, 40, 40 + text.length * 6, y, size, key)

test('PHD-002: a kicker above a chapter title has the title’s level and sits in the title’s section', () => {
  const book = pagesOf(
    [pg(0, 'Chapter One', 60, 24, 'H 24'), pg(0, 'A subhead', 200, 18, 'H 18'), pg(0, 'Body text of the first chapter goes here and goes on.', 260, 11, 'B 11')],
    [pg(1, 'INTRODUCCIÓN DE GERRY', 60, 13, 'K 13'), pg(1, 'La misión del sanador', 92, 24, 'H 24'), pg(1, 'Comencé a enseñar con Barbara en 1996, en Creta.', 200, 11, 'B 11')],
  )
  const st = buildStructure(book, hroles, new Map())
  const sects = st.root.kids.filter((k) => k.tag === 'Sect')
  assert.equal(sects.length, 2)
  assert.deepEqual(sects[1].kids.slice(0, 2).map((k) => `${k.tag} ${k.text}`), ['H1 INTRODUCCIÓN DE GERRY', 'H1 La misión del sanador'])
  assert.ok(!sects[0].kids.some((k) => /INTRODUCCIÓN/.test(k.text ?? '')), 'the kicker is not left at the end of the section before')
})

test('PHD-008: the same print style keeps one level when the client asks for it; by default a level is never skipped', () => {
  const book = () => pagesOf([pg(0, 'Chapter One', 60, 24, 'H 24'), pg(0, 'A section under it', 120, 18, 'H 18'), pg(0, 'Body text of the first chapter goes here and goes on.', 160, 11, 'B 11')])
  const tags = (o: Parameters<typeof buildStructure>[3]) => buildStructure(book(), hroles, new Map(), o).headings.map((h) => h.tag)
  assert.deepEqual(tags({}), ['H1', 'H2'])
  assert.deepEqual(tags({ headingLevels: 'consistent' }), ['H1', 'H3'])
})

test('PHD-005: a line that continues the paragraph above (lower case, right under it) is text, not a heading', () => {
  const book = pagesOf([
    pg(0, 'Para obtener más información sobre ella, visita su', 100, 11, 'B 11'),
    pg(0, 'sitio electrónico: www.empoweringthespirit.com.', 114, 11, 'H 18'),
    pg(0, 'A real heading', 200, 18, 'H 18'),
  ])
  const st = buildStructure(book, hroles, new Map())
  assert.deepEqual(st.headings.map((h) => h.text), ['A real heading'])
  assert.match(st.root.kids.find((k) => k.tag === 'P')!.lines.map((l) => l.text).join(' '), /visita su sitio electrónico/)
})

test('PHD-002 / PHD-005 / PHD-008 guards name their rule and stay quiet on a clean tree', () => {
  const clean = pagesOf(
    [pg(0, 'Chapter One', 60, 24, 'H 24'), pg(0, 'A subhead', 200, 18, 'H 18'), pg(0, 'Body text of the first chapter goes here and goes on.', 260, 11, 'B 11')],
    [pg(1, 'INTRODUCCIÓN DE GERRY', 60, 13, 'K 13'), pg(1, 'La misión del sanador', 92, 24, 'H 24'), pg(1, 'Comencé a enseñar con Barbara en 1996, en Creta.', 200, 11, 'B 11')],
  )
  const ok = buildStructure(clean, hroles, new Map())
  assert.deepEqual(headingGuards(ok, clean, { headingLevels: 'consistent' }), [])
  // the same tree with the kicker left at its own level, a heading that is a wrapped line, and one style with two tags
  const kicker = ok.headings.find((h) => /INTRO/.test(h.text ?? ''))!
  kicker.tag = 'H3'
  assert.match(headingGuards(ok, clean)[0].msg, /^PHD-002: the heading “INTRODUCCIÓN DE GERRY” \(H3\) stands right above “La misión del sanador” \(H1\)/)
  const wrapped = pagesOf([pg(0, 'Para obtener más información sobre ella, visita su', 100, 11, 'B 11'), pg(0, 'sitio electrónico: www.empoweringthespirit.com.', 114, 11, 'H 18')])
  const st = buildStructure(wrapped, hroles, new Map())
  const body = st.owner.get(wrapped.pages[0].lines[1])!
  const fake = { headings: [{ ...body, tag: 'H3', lines: [wrapped.pages[0].lines[1]], text: 'sitio electrónico: www.empoweringthespirit.com.' }], owner: new Map([[wrapped.pages[0].lines[0], body]]) }
  assert.match(headingGuards(fake as never, wrapped)[0].msg, /^PHD-005: “sitio electrónico/)
  const twice = buildStructure(pagesOf([pg(0, 'Chapter One', 60, 24, 'H 24'), pg(0, 'Section A', 120, 18, 'H 18'), pg(0, 'Body text of the first chapter goes here and goes on.', 160, 11, 'B 11')]), hroles, new Map())
  twice.headings[1].tag = 'H2'
  const third = { ...twice.headings[1], tag: 'H3', text: 'Section B' }
  assert.match(headingGuards({ headings: [...twice.headings, third], owner: new Map() } as never, wrapped, { headingLevels: 'consistent' })[0].msg, /^PHD-008: headings set in H 18 \(for example “Section A”\) carry different tags: H2, H3\./)
  assert.deepEqual(headingGuards({ headings: [...twice.headings, third], owner: new Map() } as never, wrapped, { headingLevels: 'contiguous' }).filter((x) => x.msg.startsWith('PHD-008')), [])
})

// ---- links stacked on one picture (PNT-004) ----------------------------------------------------
test('PNT-004: link rectangles stacked on one picture keep only the topmost; the guard names the rule on a file that has them', async () => {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const png = await doc.embedPng(PNG)
  const page = doc.addPage([400, 600])
  BODY.forEach((t, k) => page.drawText(t, { x: 50, y: 540 - k * 20, size: 11, font }))
  page.drawImage(png, { x: 50, y: 300, width: 90, height: 130 })
  page.drawImage(png, { x: 160, y: 300, width: 90, height: 130 })
  page.drawText('Visit www.example.org today for more.', { x: 50, y: 250, size: 11, font })
  const link = (rect: number[], uri: string) => doc.context.register(doc.context.obj({ Type: 'Annot', Subtype: 'Link', Rect: rect, Border: [0, 0, 0], A: { S: 'URI', URI: PDFString.of(uri) } }))
  // three layouts of the same two covers, as a hidden stack: only the last of each pair is on top; and the book's own link for the printed web address
  page.node.set(PDFName.of('Annots'), doc.context.obj([
    link([50, 300, 140, 430], 'https://example.org/a1'), link([160, 300, 250, 430], 'https://example.org/b1'),
    link([52, 302, 142, 432], 'https://example.org/a2'), link([158, 298, 248, 428], 'https://example.org/b2'),
    link([48, 300, 138, 430], 'https://example.org/a3'), link([162, 300, 252, 430], 'https://example.org/b3'),
    link([86, 248, 190, 262], 'https://www.example.org'),
  ]))
  const bytes = new Uint8Array(await doc.save())
  const a = await analyzeUa(pdfjs, nodeRaster, { main: bytes, extras: [], options: {} })
  const alt = Object.fromEntries(a.figures.map((f) => [f.key, 'A description written by a person.']))
  const r = await buildUa(a, { styles: a.styles, meta: { ...a.meta, isbn: '' }, alt, cropToTrim: false, options: {} })
  const out = await PDFDocument.load(r.pdf, { updateMetadata: false })
  const annots = out.getPage(0).node.lookupMaybe(PDFName.of('Annots'), PDFArray)!.asArray()
  const uris = annots.map((x) => (out.context.lookup(x as never, PDFDict).lookup(PDFName.of('A'), PDFDict).lookup(PDFName.of('URI'), PDFString) as PDFString).decodeText())
  assert.deepEqual(uris.sort(), ['https://example.org/a3', 'https://example.org/b3', 'https://www.example.org'], 'two covers and the printed address, once each (no second link for the address)')
  assert.ok(r.review.some((x) => /^PNT-004: removed 4 link rectangle/.test(x.msg)), JSON.stringify(r.review))
  assert.deepEqual(r.review.filter((x) => x.level === 'error' && /^PNT-004/.test(x.msg)), [])
  assert.equal(readTree(out).counts.get('Reference'), 3)
  // the same page with every rectangle kept: the output check names the rule
  const all = await buildUa(a, { styles: a.styles, meta: { ...a.meta, isbn: '' }, alt, cropToTrim: false, options: { stackedLinks: 'all' } })
  assert.match(all.review.find((x) => x.level === 'error' && x.msg.startsWith('PNT-004'))?.msg ?? '', /^PNT-004: page 1 has link rectangles stacked on one another/)
})

// ---- list of illustrations, chapter names in the notes -------------------------------------------
test('PLS-002: a list of illustrations is a list, one item per figure number, caption and page together', () => {
  const row = (n: string, cap: string, page: string, y: number) => [pg(0, n, y, 11, 'B 11'), { ...pg(0, cap, y, 11, 'B 11'), x0: 80, x1: 300 }, { ...pg(0, page, y + 1, 11, 'B 11'), x0: 340, x1: 360 }]
  const book = pagesOf([pg(0, 'Listado de ilustraciones', 60, 24, 'H 24'), ...row('1.1', 'Forma hexagonal y cristalina.', '29', 120), ...row('1.2', 'Carta del espectro.', '32', 140), ...row('1. 5', 'Sistema pleyadiano y humano de chakras.', '38', 160), ...row('I.1', 'Esta imagen muestra.', '9', 180)])
  const st = buildStructure(book, hroles, new Map())
  const list = st.nodes.find((n) => n.tag === 'L')!
  assert.deepEqual(list.kids.map((k) => k.tag), ['LI', 'LI', 'LI', 'LI'])
  for (const li of list.kids) assert.deepEqual(li.kids.map((k) => k.tag), ['Lbl', 'LBody'])
  assert.deepEqual(list.kids.map((li) => li.illus?.label), ['1.1', '1.2', '1.5', 'I.1'])
  assert.deepEqual(list.kids[0].kids[1].lines.map((l) => l.text), ['Forma hexagonal y cristalina.', '29'])
  assert.equal(list.kids[2].illus?.pageLine?.text, '38')
  assert.ok(!st.nodes.some((n) => n.tag === 'P' && n.lines.some((l) => /Forma hexagonal/.test(l.text))), 'no run of P')
})

test('PHD-006: a chapter name in capitals inside the notes is a heading, not the tail of the note before it', () => {
  const noteRoles = new Map<string, UaRole>([...hroles, ['N 12', 'P']])
  const book = pagesOf([
    pg(0, 'Notas', 60, 24, 'H 24'),
    pg(0, 'INTRODUCCIÓN DE BARBARA. HISTORIA DE LAS TRANSMISIONES', 120, 12, 'N 12'),
    pg(0, 'PLEYADIANAS', 136, 12, 'N 12'),
    pg(0, '1. Estas canalizaciones ocurrieron en Lakeville, Connecticut.', 150, 11, 'B 11'),
    pg(0, '2. Richard Rudgley, The Lost Civilizations of the Stone Age, 100.', 170, 11, 'B 11'),
    pg(0, 'UNO. LA PRIMERA DIMENSIÓN', 210, 12, 'N 12'),
    pg(0, '1. William J. Broad, New York Times, 4 de abril de 2000.', 240, 11, 'B 11'),
  ])
  const st = buildStructure(book, noteRoles, new Map())
  assert.deepEqual(st.headings.map((h) => `${h.tag} ${h.text}`), ['H1 Notas', 'H2 INTRODUCCIÓN DE BARBARA. HISTORIA DE LAS TRANSMISIONES PLEYADIANAS', 'H2 UNO. LA PRIMERA DIMENSIÓN'])
  assert.deepEqual(headingGuards({ ...st, nodes: st.nodes }, book).filter((x) => x.msg.startsWith('PHD-006')), [])
  // a tree that still holds the name inside a list item: the guard names the rule
  const li = st.nodes.find((n) => n.tag === 'LBody')!
  const swallowed = { ...li, tag: 'LBody', lines: [book.pages[0].lines[5]] }
  assert.match(headingGuards({ headings: [], owner: new Map(), nodes: [swallowed] } as never, book)[0].msg, /^PHD-006: “UNO\. LA PRIMERA DIMENSIÓN” on page 1 is inside a list item/)
})

test('PNT-001: a footnote number beside its text is part of that note, and chart ticks are not notes', () => {
  const body = line(0, 'Der Begriff e-Sport bezeichnet den sportlichen Wettkampf zwischen Menschen im', 106, 400, 500, 11, 'N 11')
  const num = line(0, '2', 40, 52, 500, 11, 'N 11')
  const wrap = line(0, 'Rahmen von Computerspielen.', 106, 250, 514, 11, 'N 11')
  const st = buildStructure(pagesOf([body, num, wrap]), new Map([['N 11', 'Note']]), new Map())
  const notes = st.nodes.filter((n) => n.tag === 'Note')
  assert.equal(notes.length, 1)
  assert.deepEqual(notes[0].lines.map((l) => l.text), [num.text, body.text, wrap.text])
  assert.deepEqual(structureGuards(st).filter((x) => x.msg.startsWith('PNT-001')), [])
  const split = { nodes: [{ tag: 'Note', lines: [body], kids: [] }, { tag: 'Note', lines: [num, wrap], kids: [] }] } as never
  assert.match(structureGuards(split)[0].msg, /^PNT-001: the footnote number “2”/)
  const ticks = [0, 100, 200].map((n, i) => line(0, `${n} `, 200 + i * 30, 224 + i * 30, 520, 10, 'Axis 10'))
  const axisBook = { ...pagesOf(ticks), bodyKey: 'B 11', bodySize: 13, styles: [{ key: 'Axis 10', role: 'body', samples: ['0 ', '100 ', '200 '], count: 8 }] } as unknown as PdfBook
  assert.notEqual(inferUaStyles(axisBook).find((s) => s.key === 'Axis 10')?.role, 'Note')
})

test('PLK-004: in the finished file each entry of the list of illustrations links to its figure, and its page number to its page', async () => {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const png = await doc.embedPng(PNG)
  const opener = doc.addPage([400, 600])
  opener.drawText('Chapter One', { x: 50, y: 520, size: 22, font: bold })
  BODY.forEach((t, i) => opener.drawText(t, { x: 50, y: 480 - i * 20, size: 11, font }))
  const first = doc.addPage([400, 600])
  first.drawText('Listado de ilustraciones', { x: 50, y: 520, size: 22, font: bold })
  const rows: [string, string, string][] = [['1.1', 'First picture of the field', '3'], ['1.2', 'Second picture of the field', '4'], ['2.1', 'A picture of another chapter', '5']]
  // column by column, as a layout program writes a table of tabbed columns: the pieces of one row are then not adjacent in the stream
  rows.forEach(([n], k) => first.drawText(n, { x: 50, y: 470 - k * 22, size: 11, font }))
  rows.forEach(([, cap], k) => first.drawText(cap, { x: 90, y: 470 - k * 22, size: 11, font }))
  rows.forEach(([, , p], k) => first.drawText(p, { x: 330, y: 470 - k * 22, size: 11, font }))
  rows.forEach(([n, cap], k) => {
    const page = doc.addPage([400, 600])
    BODY.forEach((t, i) => page.drawText(t, { x: 50, y: 540 - i * 20, size: 11, font }))
    page.drawImage(png, { x: 50, y: 300, width: 100, height: 100 })
    page.drawText(`Figura ${n}. ${cap}`, { x: 50, y: 285, size: 9, font })
  })
  const a = await analyzeUa(pdfjs, nodeRaster, { main: new Uint8Array(await doc.save()), extras: [], options: {} })
  const alt = Object.fromEntries(a.figures.map((f) => [f.key, 'A description written by a person.']))
  const r = await buildUa(a, { styles: a.styles, meta: { ...a.meta, isbn: '' }, alt, cropToTrim: false, options: {} })
  const out = await PDFDocument.load(r.pdf, { updateMetadata: false })
  const order = tagOrder(out)
  assert.deepEqual(order.slice(order.indexOf('L')).filter((t) => t !== 'Reference' && t !== 'Link').slice(0, 10), ['L', 'LI', 'Lbl', 'LBody', 'LI', 'Lbl', 'LBody', 'LI', 'Lbl', 'LBody'])
  const dests = out.getPage(1).node.lookupMaybe(PDFName.of('Annots'), PDFArray)!.asArray().map((x) => {
    const d = out.context.lookup(x as never, PDFDict).lookup(PDFName.of('Dest'), PDFArray)
    return out.getPages().findIndex((p) => p.ref === d.get(0))
  })
  // three figure links (to pages 3, 4, 5) and three page-number links (to the same pages)
  assert.deepEqual(dests.sort(), [2, 2, 3, 3, 4, 4])
  assert.ok(r.review.some((x) => /Linked 3 list-of-illustrations entries/.test(x.msg)), JSON.stringify(r.review))
  assert.deepEqual(r.review.filter((x) => x.msg.startsWith('PLK-004')), [])
})

test('PHD-007: the labels of a chart belong to its Figure, even where a label runs past the edge of the drawing', () => {
  const label = (text: string, x0: number, y: number) => line(0, text, x0, x0 + text.length * 6, y, 9, 'H 18')
  const book = pagesOf([label('Evolución de la industria', 120, 150), label('Evolución de la civilización', 160, 190), label('Evolución celular', 130, 230), pg(0, 'Body text that comes after the chart and goes on.', 400, 11, 'B 11')])
  const chart = { page: 0, box: { x0: 100, x1: 280, y0: 300, y1: 440 }, lines: [], caption: '', vector: false } // PDF space: y 300..440 is 120..260 from the top
  const st = buildStructure(book, hroles, new Map([[0, [chart as never]]]))
  assert.deepEqual(st.headings, [], 'no H6 for a chart label')
  assert.equal(st.figures[0].lines.length, 3)
})

// ---- a contents run of bulleted topics is one TOCI per topic (PTC-002) --------------------------
test('PTC-002: a contents line that ends in the word “la” is not a page number, so the topic continues on the next line', () => {
  const book = pagesOf([
    pg(0, 'Indice', 40, 18, 'H 18'),
    pg(0, 'CUATRO', 70, 11, 'B 11'),
    { ...pg(0, 'La cuarta dimension: El mundo de los mitos', 88, 11, 'B 11'), x1: 300 },
    { ...pg(0, '64', 88, 11, 'B 11'), x0: 340, x1: 360 },
    { ...pg(0, 'El mundo astral • El dosel de luz de la', 110, 10, 'C 9'), x0: 80, x1: 360 },
    { ...pg(0, 'cuarta dimension • La ciencia de la cuarta dimension', 124, 10, 'C 9'), x0: 80, x1: 360 },
  ])
  const st = buildStructure(book, new Map<string, UaRole>([['H 18', 'H1'], ['B 11', 'P'], ['C 9', 'P']]), new Map())
  const topics = st.tocEntries.map((e) => e.text)
  assert.ok(topics.some((t) => t === 'El dosel de luz de la cuarta dimension'), topics.join(' | '))
  assert.ok(!topics.some((t) => t === 'El dosel de luz de la'), topics.join(' | '))
  assert.deepEqual(structureGuards(st).filter((x) => x.msg.startsWith('PTC-002')), [])
})

test('PTC-002: a page number beside its contents title is kept, and the wrapped topic stays one entry', async () => {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique)
  const page = doc.addPage([400, 600])
  // the title row sits inside the top band, where a lone number would be read as a folio
  page.drawText('Indice', { x: 40, y: 560, size: 16, font })
  page.drawText('La cuarta dimension: El mundo de los mitos', { x: 40, y: 530, size: 11, font })
  page.drawText('64', { x: 340, y: 530, size: 11, font })
  page.drawText('El mundo astral • El dosel de luz de la', { x: 60, y: 514, size: 10, font: italic })
  page.drawText('cuarta dimension • La ciencia de la cuarta dimension', { x: 60, y: 500, size: 10, font: italic })
  const a = await analyzeUa(pdfjs, nodeRaster, { main: new Uint8Array(await doc.save()), extras: [], options: {} })
  const built = await buildUa(a, { styles: a.styles, meta: { ...a.meta, isbn: '' }, alt: {}, cropToTrim: false, options: {} })
  const tags = (await readTags(built.pdf, 1, 1)).filter((x) => /TOCI/.test(x))
  assert.ok(tags.some((t) => /dosel de luz de la cuarta dimension/.test(t)), tags.join('\n'))
  assert.ok(tags.some((t) => /mitos\s+64/.test(t)), tags.join('\n'))
  assert.deepEqual(built.review.filter((x) => x.msg.startsWith('PAR-001')), [])
})

test('PTC-002: “A • B • C” under a contents entry is one TOCI per topic, each with its own words, bullets as artifacts', async () => {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const opener = doc.addPage([400, 600])
  opener.drawText('Chapter One', { x: 50, y: 520, size: 22, font: bold })
  BODY.forEach((t, i) => opener.drawText(t, { x: 50, y: 480 - i * 20, size: 11, font }))
  opener.drawText('Alpha topic', { x: 50, y: 330, size: 14, font: bold })
  opener.drawText('The first topic is explained here in a few plain words.', { x: 50, y: 300, size: 11, font })
  const toc = doc.addPage([400, 600])
  toc.drawText('Contents', { x: 50, y: 520, size: 22, font: bold })
  const entries: [string, string][] = [['Introduction', '1'], ['Chapter One', '2']]
  entries.forEach(([t], k) => toc.drawText(t, { x: 50, y: 470 - k * 22, size: 11, font }))
  entries.forEach(([, n], k) => toc.drawText(n, { x: 340, y: 470 - k * 22, size: 11, font }))
  toc.drawText('Alpha topic • Beta topic with more words • Gamma', { x: 70, y: 420, size: 10, font })
  const a = await analyzeUa(pdfjs, nodeRaster, { main: new Uint8Array(await doc.save()), extras: [], options: {} })
  const alt = Object.fromEntries(a.figures.map((f) => [f.key, 'x']))
  const r = await buildUa(a, { styles: a.styles, meta: { ...a.meta, isbn: '' }, alt, cropToTrim: false, options: {} })
  const tags = (await readTags(r.pdf.slice(), 2, 2)).filter((x) => /TOCI/.test(x))
  const topics = tags.map((x) => x.replace(/^p2\s+TOCI: /, ''))
  assert.deepEqual(topics.slice(-3), ['Alpha topic', 'Beta topic with more words', 'Gamma'], tags.join('\n'))
  const out = await PDFDocument.load(r.pdf, { updateMetadata: false })
  assert.equal(readTree(out).counts.get('TOCI'), 5, 'two entries and three topics')
  // each bullet is its own artifact operator; the topics are not tagged with it
  const src = pageContent(out, out.getPage(1))
  assert.equal((src.match(/\/Artifact BMC\s+\[\(\\225\)\] TJ|\/Artifact BMC\s+\[<95>\] TJ/g) ?? []).length, 2, src.slice(-900))
  assert.deepEqual(r.review.filter((x) => /^PTC-002/.test(x.msg)), [])
  // the topic that names a heading is linked to it
  assert.ok(r.review.some((x) => /contents link/.test(x.msg)))
})

test('PFG-003 / PRO-008 / PTC-002 / PLS-002 guards name their rule', () => {
  const l = (text: string) => ({ text, page: 0 }) as unknown as PLine
  const node = (tag: string, kids: SNode[] = [], text?: string, lines: PLine[] = []) => ({ id: 0, tag, kids, lines, text }) as SNode
  const fig = node('Figure')
  const cap = node('P', [], 'Figura 7.2. Octavas en un piano')
  const entry = node('TOCI', [], 'Activaciones • Cómo perdimos')
  const toc = node('TOC', [entry, fig])
  const num = node('P', [], undefined, [l('1.5')])
  const msgs = structureGuards({ nodes: [node('Sect', [fig, cap]), toc, entry, num] }).map((x) => x.msg)
  assert.match(msgs.find((m) => m.startsWith('PFG-003'))!, /^PFG-003: “Figura 7\.2\. Octavas en un piano” follows a Figure as a P/)
  assert.match(msgs.find((m) => m.startsWith('PRO-008'))!, /^PRO-008: a Figure sits inside a contents list/)
  assert.match(msgs.find((m) => m.startsWith('PTC-002'))!, /^PTC-002: the contents entry “Activaciones • Cómo perdimos”/)
  assert.match(msgs.find((m) => m.startsWith('PLS-002'))!, /^PLS-002: “1\.5” is a figure number standing alone/)
  assert.deepEqual(structureGuards({ nodes: [node('Sect', [fig, node('Caption', [], 'Figura 7.2. Octavas en un piano')]), node('TOC', [node('TOCI', [], 'Introducción 1')]), node('TOCI', [], 'Introducción 1')] }), [])
})
