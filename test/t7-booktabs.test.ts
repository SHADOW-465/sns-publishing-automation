// R4a: booktabs tables (a top rule, a rule under the header, a bottom rule, no column rules) are one Table each, with the header
// row as TH (Scope Column) and one TR per printed row. The column gap scales with the font (about 2 em, not a fixed 24 pt).
// Contents and index pages set between rules stay prose.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PDFDocument, PDFDict, PDFArray, PDFName, PDFRef, StandardFonts } from 'pdf-lib'
import { detectTables } from '../src/engine/pdf/tables.ts'
import { buildStructure, type SNode, type UaRole } from '../src/engine/pdfua/structure.ts'
import { planPages, writeUa } from '../src/engine/pdfua/write.ts'
import type { PdfBook, PLine } from '../src/engine/pdfepub/analyze.ts'

const line = (text: string, x0: number, y: number, size = 10, key = 'B 10', w = size * 0.5): PLine => ({
  runs: [{ text, x0, x1: x0 + text.length * w, font: 'F', size, bold: false, italic: false }],
  x0, x1: x0 + text.length * w, y, base: y + size * 0.8, size, font: 'F', text, marker: false, key, page: 0, col: 40,
}) as PLine
const rule = (p: number, a = 40, b = 360) => ({ a, b, p })
const grid = (t: ReturnType<typeof detectTables>[number]) =>
  Array.from({ length: t.rows.length - 1 }, (_, r) => t.cells.filter((k) => k.r === r).sort((a, b) => a.c - b.c).map((k) => k.lines.map((l) => l.text).join(' ')))

const HEAD = ['Region', 'Population', 'Area']
const BODY = [['North', '1200', '340'], ['South', '860', '120'], ['East', '45', '9'], ['West', '3020', '410']]
const XS = [50, 160, 270]

test('R4a: a booktabs table is one table with the header row and one row per printed line', () => {
  const lines = [HEAD, ...BODY].flatMap((row, r) => row.map((t, c) => line(t, XS[c], 100 + r * 16 + (r ? 6 : 0))))
  const tables = detectTables({ width: 400, height: 560, lines, rules: { h: [rule(94), rule(114), rule(186)], v: [] } })
  assert.equal(tables.length, 1)
  assert.equal(tables[0].head, true, 'the row above the mid rule is the header')
  assert.deepEqual(grid(tables[0]), [HEAD, ...BODY])
})

test('R4a: a cell that wraps stays in its row', () => {
  const rows = [HEAD, ['North', '1200', '340'], ['South-east', '860', '120'], ['East', '45', '9']]
  const lines = rows.flatMap((row, r) => row.map((t, c) => line(t, XS[c], 100 + r * 22 + (r ? 6 : 0))))
  lines.push(line('coast', XS[0], 100 + 2 * 22 + 6 + 11))
  const tables = detectTables({ width: 400, height: 560, lines, rules: { h: [rule(94), rule(114), rule(186)], v: [] } })
  assert.equal(tables.length, 1)
  assert.deepEqual(grid(tables[0]), [HEAD, ['North', '1200', '340'], ['South-east coast', '860', '120'], ['East', '45', '9']])
  // prose cells that wrap side by side: the lines that go on in lower case stay in their row
  const prose = [['Region', 'Rule', 'Term'], ['North', 'Elected by the', 'Four years'], ['', 'whole council', 'and once'], ['', '', 'renewed'], ['South', 'Named by', 'Six years']]
  const plines = prose.flatMap((row, r) => row.flatMap((t, c) => (t ? [line(t, XS[c], 100 + r * 12 + (r ? 6 : 0))] : [])))
  const pt = detectTables({ width: 400, height: 560, lines: plines, rules: { h: [rule(94), rule(114), rule(170)], v: [] } })
  assert.equal(pt.length, 1)
  assert.deepEqual(grid(pt[0]), [['Region', 'Rule', 'Term'], ['North', 'Elected by the whole council', 'Four years and once renewed'], ['South', 'Named by', 'Six years']])
})

test('R4a: the column gap is relative to the font size', () => {
  // 7 pt figures in columns 20 pt apart: more than 2 em, so each is a column (a fixed 24 pt gap merged them)
  const small = [50, 150, 170, 190]
  const rows = [['Year', 'A', 'B', 'C'], ['1990', '12', '34', '56'], ['2000', '21', '43', '65'], ['2010', '11', '22', '33']]
  const lines = rows.flatMap((row, r) => row.map((t, c) => line(t, small[c], 100 + r * 10 + (r ? 4 : 0), 7)))
  const tables = detectTables({ width: 400, height: 560, lines, rules: { h: [rule(96, 40, 220), rule(109, 40, 220), rule(146, 40, 220)], v: [] } })
  assert.equal(tables.length, 1)
  assert.deepEqual(grid(tables[0]), rows)
  // 14 pt right-aligned figures whose left edges drift by 26 pt stay one column (2 em is 28 pt)
  const big = [['Item', 'Count', 'Note'], ['Bowls', '12', 'glazed'], ['Jars', '1450', 'plain'], ['Cups', '3', 'glazed']]
  const at = (r: number, c: number) => (c === 1 ? 230 - big[r][c].length * 7 : [50, 0, 260][c])
  const blines = big.flatMap((row, r) => row.map((t, c) => line(t, at(r, c), 100 + r * 20 + (r ? 6 : 0), 14)))
  const bt = detectTables({ width: 400, height: 560, lines: blines, rules: { h: [rule(94), rule(118), rule(186)], v: [] } })
  assert.equal(bt.length, 1)
  assert.deepEqual(grid(bt[0]), big)
})

// ---- contents and index pages between rules are not tables ---------------------------------------------------------------
const roles = new Map<string, UaRole>([['B 10', 'P'], ['B 9', 'P'], ['B 8', 'P'], ['H 18', 'H1']])
const tablesIn = (lines: PLine[], h: { a: number; b: number; p: number }[]) => {
  const book = { pages: [{ index: 0, width: 400, height: 560, lines, images: [], fills: [], rules: { h, v: [] }, shades: [] }], front: [], lead: 12, step: 14, bodySize: 10, numbers: [1] } as unknown as PdfBook
  const count = (n: SNode): number => (n.tag === 'Table' ? 1 : 0) + n.kids.reduce((s, k) => s + count(k), 0)
  return { detected: detectTables(book.pages[0]).length, tagged: count(buildStructure(book, roles, new Map()).root) }
}

test('R4a: a contents page set between rules is not a table', () => {
  const entries = ['Beginnings', 'The road north', 'Harbours', 'Winter', 'The long war', 'Peace', 'Afterwards', 'Notes']
  const lines = [line('Contents', 40, 50, 18, 'H 18')]
  entries.forEach((t, i) => {
    const y = 90 + i * 14 + (i >= 4 ? 10 : 0)
    lines.push(line(String(i + 1), 44, y, 9, 'B 9'), line(t, 64, y, 9, 'B 9'), line(String(3 + i * 18), 350 - String(3 + i * 18).length * 4.5, y, 9, 'B 9'))
  })
  const r = tablesIn(lines, [rule(84), rule(146), rule(210)])
  assert.deepEqual(r, { detected: 0, tagged: 0 })
})

test('R4a: an index page set between rules is not a table', () => {
  const words = ['Abbey', 'Altar', 'Arch', 'Bell', 'Bridge', 'Canal', 'Chapel', 'Crypt', 'Dome', 'Font', 'Gate', 'Hall']
  const lines = [line('Index', 40, 50, 18, 'H 18')]
  for (const [c, x] of [40, 160, 280].entries())
    words.forEach((w, i) => {
      const y = 90 + i * 11 + (i >= 6 ? 8 : 0)
      const sub = i % 3 === 2
      lines.push(line(`${sub ? 'of ' : ''}${w}${c ? c : ''}, ${10 + i * 7}, ${80 + i}`, x + (sub ? 8 : 0), y, 8, 'B 8', 4))
    })
  const r = tablesIn(lines, [rule(84), rule(154, 40, 360), rule(230)])
  assert.deepEqual(r, { detected: 0, tagged: 0 })
})

// ---- PDF/UA: Table → TR → TH/TD, the header cells scoped to their column -------------------------------------------------
test('R4a: a booktabs table is tagged Table → TR → TH/TD, the header cells with Scope Column', async () => {
  const H = 560
  const lines = [
    line('A paragraph of body text runs above the table and goes on for a good while,', 40, 60),
    line('and it ends here before the table starts on the line below this one.', 40, 74),
    ...[HEAD, ...BODY].flatMap((row, r) => row.map((t, c) => line(t, XS[c], 100 + r * 16 + (r ? 6 : 0)))),
    line('The text goes on below the table with a sentence that is long enough to be prose.', 40, 220),
  ]
  const book = { pages: [{ index: 0, width: 420, height: H, lines, images: [], fills: [], rules: { h: [rule(94), rule(114), rule(186)], v: [] }, shades: [] }], front: [], lead: 12, step: 14, bodySize: 10, numbers: [1] } as unknown as PdfBook
  const st = buildStructure(book, roles, new Map())
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const page = doc.addPage([420, H])
  for (const l of lines) page.drawText(l.text, { x: l.x0, y: H - l.base, size: l.size, font })
  const out = writeUa(await planPages(new Uint8Array(await doc.save())), book, st, { title: 'Tables', author: 'A', lang: 'en', subject: '', keywords: '' }, { cropToTrim: false })
  const pdf = await PDFDocument.load(await out.pdf)
  const ctx = pdf.context
  const dict = (x: unknown) => (x instanceof PDFRef ? ctx.lookup(x) : x) as PDFDict
  const kids = (d: PDFDict): PDFDict[] => {
    const k = d.get(PDFName.of('K'))
    const arr = k instanceof PDFArray ? k.asArray() : k ? [k] : []
    return arr.map(dict).filter((x) => x instanceof PDFDict && x.get(PDFName.of('S')))
  }
  const tag = (d: PDFDict) => (d.get(PDFName.of('S')) as PDFName).decodeText()
  const tables: PDFDict[] = []
  const walk = (d: PDFDict) => (tag(d) === 'Table' ? tables.push(d) : kids(d).forEach(walk))
  kids(dict(pdf.catalog.get(PDFName.of('StructTreeRoot')))).forEach(walk)
  assert.equal(tables.length, 1, 'one Table')
  const trs = kids(tables[0])
  assert.deepEqual(trs.map(tag), ['TR', 'TR', 'TR', 'TR', 'TR'])
  assert.deepEqual(kids(trs[0]).map(tag), ['TH', 'TH', 'TH'])
  for (const tr of trs.slice(1)) assert.deepEqual(kids(tr).map(tag), ['TD', 'TD', 'TD'])
  for (const th of kids(trs[0])) assert.equal((dict(th.get(PDFName.of('A'))).get(PDFName.of('Scope')) as PDFName).decodeText(), 'Column')
})
