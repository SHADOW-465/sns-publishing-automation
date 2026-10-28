// Reading order and role F1 in the accessible-PDF reference diff: the tag tree's text, page by page, against the reference's.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { PDFDocument, PDFName, StandardFonts } from 'pdf-lib'
import { pdfStats } from '../src/engine/check/pdfstats.ts'
import { comparePdfs } from '../src/engine/check/refscore-pdf.ts'
import { formatScore, scoreEpub } from '../src/engine/check/refscore.ts'
import type { Files } from '../src/engine/zip.ts'

/** a one-page tagged PDF: the lines are painted in `paint` order, and the tag tree reads them in `tags` order as [role, line] */
async function tagged(paint: string[], tags: [string, number][]) {
  const doc = await PDFDocument.create()
  const page = doc.addPage([400, 400])
  const font = await doc.embedFont(StandardFonts.Helvetica)
  page.node.setFontDictionary(PDFName.of('F1'), font.ref)
  const ctx = doc.context
  // the running head is an artifact: never part of the reading order
  // a line no tag claims is wrapped in an artifact inside its marked content, as in the Gladiators reference
  const body = paint.map((s, i) => {
    const t = `BT /F1 12 Tf 20 ${350 - 20 * i} Td (${s}) Tj ET`
    return `/P <</MCID ${i}>> BDC ${tags.some(([, m]) => m === i) ? t : `/Artifact BMC ${t} EMC`} EMC`
  }).join('\n')
  page.node.set(PDFName.of('Contents'), ctx.register(ctx.stream(`/Artifact BMC BT /F1 9 Tf 20 380 Td (Running head) Tj ET EMC\n${body}`)))
  page.node.set(PDFName.of('StructParents'), ctx.obj(0))
  const root = ctx.nextRef()
  const docEl = ctx.nextRef()
  const kids = tags.map(([role, mcid]) => ctx.register(ctx.obj({ Type: 'StructElem', S: role, P: docEl, Pg: page.ref, K: mcid })))
  ctx.assign(docEl, ctx.obj({ Type: 'StructElem', S: 'Document', P: root, K: kids }))
  // an MCID no tag claims has a null ParentTree entry (the reference leaves such text untagged)
  const byMcid = paint.map((_, i) => kids[tags.findIndex(([, m]) => m === i)] ?? ctx.obj(null))
  ctx.assign(root, ctx.obj({ Type: 'StructTreeRoot', K: docEl, ParentTree: ctx.obj({ Nums: [0, byMcid] }) }))
  doc.catalog.set(PDFName.of('StructTreeRoot'), root)
  return doc.save()
}

const LINES = ['Chapter One', 'the first line of text', 'Figure 1 A caption', 'the second line of text']

test('pdfStats reads the text in tag-tree order, without artifacts, when given pdfjs', async () => {
  const s = await pdfStats(await tagged(LINES, [['H1', 0], ['P', 3], ['P', 1], ['Caption', 2]]), pdfjs)
  assert.deepEqual(s.order?.pages[1], 'chapter one the second line of text the first line of text figure 1 a caption'.split(' '))
  assert.deepEqual(s.order?.roles, [{ role: 'H1', page: 1, text: 'chapter one' }, { role: 'Caption', page: 1, text: 'figure 1 a caption' }])
})

test('reading order: the reference scored against itself is 100, a scrambled page is below 100', async () => {
  const ref = await pdfStats(await tagged(LINES, [['H1', 0], ['P', 1], ['Caption', 2], ['P', 3]]), pdfjs)
  const self = comparePdfs(ref, ref).dims
  assert.equal(self.find((d) => d.id === 'order')?.score, 100)
  assert.equal(self.find((d) => d.id === 'roles')?.score, 100)

  const mine = await pdfStats(await tagged(LINES, [['H1', 0], ['P', 3], ['P', 1], ['P', 2]]), pdfjs)
  const dims = comparePdfs(mine, ref).dims
  const order = dims.find((d) => d.id === 'order')!
  assert.ok(order.score! < 100, `scrambled page scores ${order.score}`)
  assert.equal(order.weight, 20)
  assert.ok(order.diffs.some((x) => /page 1\b/i.test(x)), order.diffs.join('\n'))
  const roles = dims.find((d) => d.id === 'roles')!
  assert.ok(roles.score! < 100, 'a caption tagged P lowers the role F1')
  assert.ok(roles.diffs.some((x) => /^Caption: F1 0\b/.test(x)), roles.diffs.join('\n'))
})

test('reference text with no tag is left out of reading order, on both sides, and reported', async () => {
  // the reference tags only the heading (Gladiators p94); the build tags every line in the same order
  const ref = await pdfStats(await tagged(LINES, [['H1', 0]]), pdfjs)
  assert.deepEqual(ref.order?.untagged[1], 'the first line of text figure 1 a caption the second line of text'.split(' '))
  const mine = await pdfStats(await tagged(LINES, [['H1', 0], ['P', 1], ['Caption', 2], ['P', 3]]), pdfjs)
  const order = comparePdfs(mine, ref).dims.find((d) => d.id === 'order')!
  assert.equal(order.score, 100, order.diffs.join('\n'))
  assert.ok(order.diffs.some((x) => /65 chars \(\d+(\.\d)?%\) of untagged reference text/.test(x)), order.diffs.join('\n'))
  // the heading the reference does tag still counts: a build without it loses
  const bad = await pdfStats(await tagged(LINES, [['P', 1], ['Caption', 2], ['P', 3]]), pdfjs)
  assert.ok(comparePdfs(bad, ref).dims.find((d) => d.id === 'order')!.score! < 100)
})

test('reading order and roles can be scored on chosen pages only (the eval set)', async () => {
  const ref = await pdfStats(await tagged(LINES, [['H1', 0], ['P', 1], ['Caption', 2], ['P', 3]]), pdfjs)
  const mine = await pdfStats(await tagged(LINES, [['H1', 0], ['P', 3], ['P', 1], ['P', 2]]), pdfjs)
  assert.equal(comparePdfs(mine, ref, { pages: [2] }).dims.find((d) => d.id === 'order')?.score, null)
  assert.ok(comparePdfs(mine, ref, { pages: [1] }).dims.find((d) => d.id === 'order')!.score! < 100)
})

test('without pdfjs the order dimensions are left out (the score is unchanged)', async () => {
  const s = await pdfStats(await tagged(LINES, [['P', 0], ['P', 1], ['P', 2], ['P', 3]]))
  assert.equal(s.order, undefined)
  assert.deepEqual(comparePdfs(s, s).dims.map((d) => d.id).filter((id) => id === 'order' || id === 'roles'), [])
})

test('the eval set lists the Day 0 books and every 24 Oct screenshot', () => {
  const e = JSON.parse(readFileSync('test/eval-pages.json', 'utf8')) as { books: { id: string; pages: { page: number | null; shot?: string }[] }[] }
  const ids = e.books.map((b) => b.id)
  for (const id of ['gladiators', 'evers', 'cambia', 'ceramics', 'sacgeo', 'synthetic']) assert.ok(ids.includes(id), id)
  const shots = e.books.flatMap((b) => b.pages.map((p) => p.shot)).filter(Boolean)
  assert.deepEqual([...new Set(shots)].length, 30)
  const glad = e.books.find((b) => b.id === 'gladiators')!
  assert.ok(glad.pages.length >= 20 && glad.pages.every((p) => Number.isInteger(p.page)))
})

// T6c: the reference is not the judge. Where it disagrees with the build on figures, the score says so apart from the dimensions.
test('a drop cap the reference tags as Figure is a reference disagreement, and so is the figure count', async () => {
  const lines = ['T', 'he first line of text']
  const ref = await pdfStats(await tagged(lines, [['Figure', 0], ['P', 1]]), pdfjs)
  const mine = await pdfStats(await tagged(lines, [['P', 0], ['P', 1]]), pdfjs)
  const s = comparePdfs(mine, ref)
  assert.ok(s.disagreements?.some((x) => /drop cap/i.test(x) && /page 1\b/.test(x)), String(s.disagreements))
  assert.ok(s.disagreements?.some((x) => /0 figures in the build, 1 in the reference/.test(x)), String(s.disagreements))
  assert.ok(!s.dims.find((d) => d.id === 'figures')!.diffs.some((x) => /figures in the build/.test(x)), 'the count is not a figures diff')
  assert.match(formatScore('x', s), /Reference disagreements \(report only/)
  assert.equal(comparePdfs(ref, ref).disagreements?.length ?? 0, 0)
})

test('EPUB: a different picture count is a reference disagreement, not a pictures diff', () => {
  const epub = (imgs: number): Files => new Map([
    ['OEBPS/content.opf', new TextEncoder().encode('<package xmlns="http://www.idpf.org/2007/opf"><manifest><item id="c" href="c.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c"/></spine></package>')],
    ['OEBPS/c.xhtml', new TextEncoder().encode(`<html xmlns="http://www.w3.org/1999/xhtml"><body><p>Text.</p>${'<img src="a.jpg" alt="image"/>'.repeat(imgs)}</body></html>`)],
  ])
  const s = scoreEpub(epub(2), epub(1))
  assert.ok(s.disagreements?.includes('The build has 2 pictures; the reference has 1.'), String(s.disagreements))
  assert.ok(!s.dims.find((d) => d.id === 'pictures')!.diffs.some((x) => /pictures; the reference/.test(x)))
  assert.equal(scoreEpub(epub(1), epub(1)).disagreements?.length ?? 0, 0)
})
