// Accessible PDF, the Gladiators list (B9 items 11–14), each on a small book built in memory.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFRef, PDFHexString, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { analyzeUa, buildUa } from '../src/engine/pdfua/index.ts'
import { auditPictures, readTree } from '../src/engine/pdfua/audit.ts'
import { indexNumberSpans } from '../src/engine/pdfua/indexlinks.ts'
import { nodeRaster } from './raster-node.ts'
import { readTags } from './read-tags.ts'

const PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'))
const SENTENCES = [
  'The applicant states the full name and the address of the school in the boxes below.',
  'Every parent or guardian signs where the form asks for it, in black ink, and dates it.',
  'A copy of the birth certificate is sent with the form, never the original document.',
  'The office replies in writing within three weeks of the day the form was received.',
  'Questions about the form are answered by the school secretary on weekday mornings.',
]

type Analysis = Awaited<ReturnType<typeof analyzeUa>>
const finish = (a: Analysis, options = {}) =>
  buildUa(a, { styles: a.styles, meta: { ...a.meta, isbn: '' }, alt: Object.fromEntries(a.figures.filter((f) => !f.ornament).map((f) => [f.key, 'A description written by a person.'])), cropToTrim: false, sourceName: 'probe.pdf', options })

const body = (page: PDFPage, font: PDFFont, top: number, lines = 12, seed = 0): string => {
  let first = ''
  const words = 'the river crosses the plain and the old road follows it down to the sea where the ships wait for the tide'.split(' ')
  for (let i = 0; i < lines; i++) {
    const t = Array.from({ length: 11 }, (_, k) => words[(i * 3 + k + seed) % words.length]).join(' ') + '.'
    if (i === 4) first = t // (a raised number in the top band would be taken for a folio: the call goes on the fifth line)
    page.drawText(t, { x: 60, y: 640 - top - i * 15, size: 11, font })
  }
  return first
}

// ---- 11: U1, a page of text with a form drawn on it is not one Figure ------------------------------------------------------------
test('11 (U1): a form page (rules, boxes, a tint over the page, sentences in it) is not wrapped in a Figure; its text is tagged as text', async () => {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const png = await doc.embedPng(PNG)
  const mk = () => doc.addPage([440, 640])
  for (let i = 0; i < 2; i++) body(mk(), font, 80, 14, i)
  // the form page: a tint over the whole page, boxes and rules, five sentences
  const f = mk()
  f.drawRectangle({ x: 20, y: 20, width: 400, height: 600, color: rgb(0.93, 0.93, 0.96) })
  SENTENCES.forEach((t, i) => {
    f.drawText(t, { x: 40, y: 560 - i * 70, size: 10, font })
    f.drawRectangle({ x: 40, y: 530 - i * 70, width: 360, height: 18, borderColor: rgb(0, 0, 0), borderWidth: 0.5 })
    f.drawLine({ start: { x: 40, y: 520 - i * 70 }, end: { x: 400, y: 520 - i * 70 }, thickness: 0.5 })
  })
  // a real picture with a caption on the next page stays a Figure
  const p = mk()
  body(p, font, 80, 6)
  p.drawImage(png, { x: 100, y: 300, width: 160, height: 120 })
  p.drawText('Figure 1.1 The school yard in 1905', { x: 100, y: 285, size: 9, font })
  const a = await analyzeUa(pdfjs, nodeRaster, { main: new Uint8Array(await doc.save()), extras: [] })
  assert.deepEqual([...new Set(a.figures.map((x) => x.page))], [3], 'the only figure is the picture')
  const r = await finish(a)
  const tagged = (await readTags(r.pdf.slice(), 3, 3)).join('\n')
  assert.match(tagged, /applicant states the full name/)
  assert.doesNotMatch(tagged, /^\S*\s*Figure[^\n]*applicant/m, 'the sentences are not inside a Figure')
  const audit = auditPictures(await PDFDocument.load(r.pdf, { updateMetadata: false }))
  assert.equal(audit.picturesInTree, 1)
  assert.equal(audit.figureElements, 1)
})

// ---- 12 + 13: U2/U3 index links, U4 end notes -------------------------------------------------------------------------------------
/** printed pages 1–3 with note calls, a notes page (4) and an index (5). */
export async function indexBook(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const mk = () => doc.addPage([440, 640])
  for (let i = 0; i < 3; i++) {
    const p = mk()
    const first = body(p, font, 80, 12, i)
    // the call of note i + 1: a raised number just after the end of the first line
    if (i < 2) p.drawText(String(i + 1), { x: 60 + font.widthOfTextAtSize(first, 11) + 1, y: 640 - 80 - 4 * 15 + 5, size: 6.5, font })
  }
  const n = mk()
  n.drawText('Notes', { x: 60, y: 560, size: 20, font })
  ;['Suetonius, Life of the Caesars, book two, chapter four.', 'Strabo, Geography, volume three, page ninety.'].forEach((t, i) => n.drawText(`${i + 1}. ${t}`, { x: 60, y: 520 - i * 18, size: 10, font }))
  const x = mk()
  x.drawText('Index', { x: 60, y: 560, size: 20, font })
  ;['Abdera, 1, 4n.2', 'Corinth, 1, 4n.1, 3', 'Rhodes, 2'].forEach((t, i) => x.drawText(t, { x: 60, y: 520 - i * 15, size: 10, font }))
  return new Uint8Array(await doc.save())
}

/** (page index of the link, page index of its target) for every Link annotation with a /Dest. */
function links(doc: PDFDocument): [number, number][] {
  const pages = doc.getPages().map((p) => p.ref)
  const out: [number, number][] = []
  doc.getPages().forEach((pg, i) => {
    for (const a of pg.node.Annots()?.asArray() ?? []) {
      const d = doc.context.lookup(a, PDFDict)
      if (d.get(PDFName.of('Subtype')) !== PDFName.of('Link')) continue
      const dest = d.lookup(PDFName.of('Dest'))
      if (!(dest instanceof PDFArray)) continue
      const t = dest.get(0)
      if (t instanceof PDFRef) out.push([i, pages.findIndex((r) => r === t)])
    }
  })
  return out
}

test('12 (U2/U3): page numbers in an index link to their pages, and "4n.2" is a second link to note 2 printed on page 4', async () => {
  // the tokens: page link, and a note link covering only "n.2"
  const sp = indexNumberSpans('Abdera, 1, 4n.2')
  assert.deepEqual(sp.map((s) => [s.pageNo, s.note]), [[1, undefined], [4, undefined], [4, 2]])
  assert.equal('Abdera, 1, 4n.2'.slice(sp[2].start, sp[2].end), 'n.2')
  const a = await analyzeUa(pdfjs, nodeRaster, { main: await indexBook(), extras: [], options: { indexLinks: true } })
  const r = await finish(a, { indexLinks: true })
  const found = links(await PDFDocument.load(r.pdf, { updateMetadata: false })).filter(([from]) => from === 4)
  // Abdera: 1 → p1, 4 → p4, n.2 → note 2 (on p4); Corinth: 1 → p1, 4 → p4, n.1 → note 1 (p4), 3 → p3; Rhodes: 2 → p2
  const targets = found.map(([, to]) => to).sort()
  assert.deepEqual(targets, [0, 0, 1, 2, 3, 3, 3, 3], JSON.stringify(found))
  assert.match(r.review.map((x) => x.msg).join('\n'), /Linked 8 index page number\(s\) to their pages, 2 of them to a note/)
  // off by default (a client setting, UA-06): no index links, the notes' own links stay
  const plain = await finish(a, { indexLinks: false })
  assert.equal(links(await PDFDocument.load(plain.pdf, { updateMetadata: false })).filter(([from]) => from === 4).length, 0)
})

test('13 (U4): every end note is L > LI > Lbl + LBody, with its link back kept', async () => {
  const a = await analyzeUa(pdfjs, nodeRaster, { main: await indexBook(), extras: [], options: {} })
  const r = await finish(a)
  const doc = await PDFDocument.load(r.pdf, { updateMetadata: false })
  const { byMcid } = readTree(doc)
  const chains = [...byMcid.values()].map((e) => e.chain.join('>'))
  const notes = chains.filter((c) => /Strabo|Suetonius/.test(c) || /LBody/.test(c))
  assert.ok(chains.some((c) => /L>LI>Lbl/.test(c)), chains.slice(0, 40).join('\n'))
  assert.ok(chains.some((c) => /L>LI>LBody/.test(c)))
  const tagged = (await readTags(r.pdf.slice(), 4, 4)).join('\n')
  assert.match(tagged, /Lbl[^\n]*1\./)
  assert.match(tagged, /LBody[^\n]*Suetonius/)
  assert.ok(!/(^|\n)\s*P[^\n]*Suetonius/.test(tagged), 'no note is left as a paragraph')
  void notes
  // the number links back to the note's call
  const back = links(doc).filter(([from, to]) => from === 3 && to <= 1)
  assert.equal(back.length, 2, 'each note number returns to its call: ' + JSON.stringify(links(doc)))
})

// ---- 14: the plates slot ------------------------------------------------------------------------------------------------------------
test('14: a separate plates PDF is accepted, added after the book, tagged, bookmarked Plate and listed', async () => {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let i = 0; i < 3; i++) body(doc.addPage([440, 640]), font, 80, 14, i)
  const pl = await PDFDocument.create()
  const png = await pl.embedPng(PNG)
  const pfont = await pl.embedFont(StandardFonts.Helvetica)
  for (let i = 0; i < 2; i++) {
    const p = pl.addPage([440, 640])
    p.drawImage(png, { x: 60, y: 250, width: 300, height: 220 })
    p.drawText(`Plate ${i + 1}. A gladiator relief from the museum`, { x: 60, y: 230, size: 9, font: pfont })
  }
  const a = await analyzeUa(pdfjs, nodeRaster, { main: new Uint8Array(await doc.save()), plates: new Uint8Array(await pl.save()), extras: [] })
  assert.equal(a.platePage, 3)
  assert.ok(a.review.some((x) => /^Plates: 2 pages from the plates PDF added after the book \(from page 4\)/.test(x.msg)), JSON.stringify(a.review))
  assert.deepEqual([...new Set(a.figures.map((f) => f.page))], [3, 4], 'the plate pictures are found as figures')
  const r = await finish(a)
  const out = await PDFDocument.load(r.pdf, { updateMetadata: false })
  assert.equal(out.getPageCount(), 5)
  assert.equal(auditPictures(out).picturesInTree, 2, 'both plates are tagged')
  const outline = out.catalog.lookup(PDFName.of('Outlines'), PDFDict)
  const titles: string[] = []
  let it = outline.lookup(PDFName.of('First'), PDFDict) as PDFDict | undefined
  while (it) {
    titles.push((it.lookup(PDFName.of('Title')) as PDFHexString).decodeText())
    it = it.lookupMaybe(PDFName.of('Next'), PDFDict)
  }
  assert.ok(titles.some((t) => /Plate/.test(t)), titles.join(' | '))
  // without plates nothing is added and nothing is said
  const none = await analyzeUa(pdfjs, nodeRaster, { main: new Uint8Array(await doc.save()), extras: [] })
  assert.equal(none.platePage, undefined)
  assert.ok(!none.review.some((x) => /^Plates:/.test(x.msg)))
})
