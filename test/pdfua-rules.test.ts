// Generic PDF/UA rules, on small synthetic books: title heading, chapter level, lists, end notes, frames and clips, narrow columns.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { columnStarts, type PdfBook, type PLine } from '../src/engine/pdfepub/analyze.ts'
import { columnGutters } from '../src/engine/pdf/layout.ts'
import { buildStructure, type SNode, type UaRole } from '../src/engine/pdfua/structure.ts'
import { endnotePairs } from '../src/engine/pdfua/notes.ts'
import { isFrameOrRule, detectFigures } from '../src/engine/pdfua/figures.ts'
import { tokenize, rewrite } from '../src/engine/pdfua/content.ts'

const line = (page: number, text: string, x0: number, x1: number, y: number, size: number, key: string, extra: Partial<PLine> = {}): PLine => ({
  runs: [{ text, x0, x1, font: 'F', size, bold: false, italic: false }],
  x0, x1, y, base: y + size * 0.8, size, font: 'F', text, marker: false, key, page, col: 40, ...extra,
})
const bookOf = (pages: PLine[][], front: number[] = []) =>
  ({
    pages: pages.map((lines, index) => ({ index, width: 400, height: 560, lines, images: [], fills: [], rules: { h: [], v: [] }, shades: [] })),
    front, lead: 14, step: 18, bodySize: 11, numbers: pages.map((_, i) => i + 1),
  }) as unknown as PdfBook
const roles = new Map<string, UaRole>([['H 30', 'H1'], ['H 24', 'H1'], ['H 18', 'H2'], ['B 11', 'P'], ['S 6', 'Inline']])
const tags = (n: SNode): string[] => [n.tag, ...n.kids.flatMap(tags)]
const find = (root: SNode, tag: string): SNode[] => (root.tag === tag ? [root] : []).concat(root.kids.flatMap((k) => find(k, tag)))
const heads = (root: SNode) => tags(root).filter((t) => /^H\d$/.test(t))

function titled() {
  return bookOf(
    [
      [line(0, 'The Big Book', 120, 280, 200, 24, 'H 24')], // half title
      [line(1, 'The Big Book', 100, 300, 180, 30, 'H 30'), line(1, 'A. Author', 150, 250, 300, 11, 'B 11')],
      [line(2, 'Chapter One', 40, 200, 60, 24, 'H 24'), line(2, 'Some text for the first chapter of the book.', 40, 340, 120, 11, 'B 11'), line(2, 'A subhead', 40, 140, 200, 18, 'H 18')],
    ],
    [0, 1],
  )
}

test('one H1 for the book title: the half title repeats it as text', () => {
  const st = buildStructure(titled(), roles, new Map())
  assert.equal(heads(st.root).filter((t) => t === 'H1').length, 1)
  assert.equal(st.headings[0].text, 'The Big Book')
  assert.equal(st.headings[0].lines[0].page, 1) // the title page, not the half title
})

test('chapters take H2 and subheads H3 under the title H1, and a client can keep chapters at H1', () => {
  assert.deepEqual(heads(buildStructure(titled(), roles, new Map()).root), ['H1', 'H2', 'H3'])
  assert.deepEqual(heads(buildStructure(titled(), roles, new Map(), { chapterLevel: 1 }).root), ['H1', 'H1', 'H2'])
})

test('a list marker is split into Lbl, the text is LBody, and a lone bullet never joins a paragraph', () => {
  const body = (y: number, t: string) => line(0, t, 40, 340, y, 11, 'B 11')
  const marker = (y: number) => line(0, '•', 40, 46, y, 11, 'B 11')
  const item = (y: number, t: string) => line(0, t, 56, 300, y, 11, 'B 11')
  const split = line(0, '• Third item as one text piece', 40, 300, 160, 11, 'B 11', { lead: { text: '•', x1: 46, next: 56 } })
  const book = bookOf([[body(60, 'An intro line before the list.'), marker(100), item(100, 'First item'), marker(130), item(130, 'Second item'), split]])
  const st = buildStructure(book, roles, new Map())
  const lists = find(st.root, 'L')
  assert.equal(lists.length, 1)
  const lis = lists[0].kids
  assert.equal(lis.length, 3)
  for (const li of lis) assert.deepEqual(li.kids.map((k) => k.tag), ['Lbl', 'LBody'])
  assert.deepEqual(lis.map((li) => li.kids[0].text), ['•', '•', '•'])
  assert.equal(lis[2].kids[1].lines[0].text, 'Third item as one text piece')
  assert.ok(!st.nodes.some((n) => n.tag === 'P' && n.lines.some((l) => l.text.trim() === '•')))
})

test('end notes anywhere: small numbers are matched to the numbered entries, and numbering that restarts pairs run by run', () => {
  const para = (p: number, y: number) => line(p, 'Text of the chapter with a call here and more.', 40, 340, y, 11, 'B 11')
  const call = (p: number, y: number, n: number) => line(p, String(n), 300, 306, y - 4, 6, 'S 6')
  const entry = (p: number, y: number, n: number, t: string) => line(p, `${n}. ${t}`, 40, 300, y, 9, 'B 9')
  const book = bookOf([
    [para(0, 60), call(0, 60, 1), para(0, 90), call(0, 90, 2)],
    [para(1, 60), call(1, 60, 1)],
    [line(2, 'Notes', 40, 100, 50, 18, 'H 18'), entry(2, 90, 1, 'First note'), entry(2, 110, 2, 'Second note'), entry(2, 140, 1, 'Restarted note')],
  ])
  const st = buildStructure(book, new Map([...roles, ['B 9', 'P'] as [string, UaRole]]), new Map())
  const pairs = endnotePairs(st, book)
  assert.equal(pairs.length, 3)
  assert.deepEqual(pairs.map((p) => [p.ref.page, p.entry.n, p.entry.line.text.replace(/^\d+\. /, '')]), [[0, 1, 'First note'], [0, 2, 'Second note'], [1, 1, 'Restarted note']])
})

test('frames, hairlines and page-edge borders around a picture are furniture; drawn art stays', () => {
  const page = { width: 400, height: 560 }
  const fig = { x0: 100, y0: 200, x1: 300, y1: 400 }
  assert.ok(isFrameOrRule({ x0: 98, y0: 198, x1: 302, y1: 402 }, fig, false, page), 'frame around the picture')
  assert.ok(isFrameOrRule({ x0: 120, y0: 300, x1: 280, y1: 300.5 }, fig, false, page), 'rule over an image')
  assert.ok(isFrameOrRule({ x0: 6, y0: 6, x1: 394, y1: 554 }, fig, true, page), 'page-edge frame')
  assert.ok(!isFrameOrRule({ x0: 150, y0: 250, x1: 220, y1: 330 }, fig, true, page), 'a shape inside a drawn figure')
  assert.ok(!isFrameOrRule({ x0: 120, y0: 300, x1: 280, y1: 300.5 }, fig, true, page), 'a thin line is chart art in a drawn figure')
})

test('a clipping path outside any sequence is wrapped as an artifact, so no path operator is unmarked', () => {
  const src = 'q 0 0 300 300 re W n 10 10 50 50 re f Q q 5 5 90 90 re W n Q BT /F1 9 Tf (x) Tj ET'
  const ops = tokenize(src)
  const { stream } = rewrite(src, ops, ops.map((o) => (o.op === 'Tj' ? { el: 3, tag: 'P' } : o.op === 'f' ? { el: 4, tag: 'Figure' } : undefined)))
  let depth = 0
  const outside: string[] = []
  for (const o of tokenize(stream)) {
    if (o.op === 'BDC' || o.op === 'BMC') depth++
    else if (o.op === 'EMC') depth--
    else if (!depth && ['re', 'W', 'n', 'f', 'Tj'].includes(o.op)) outside.push(o.op)
  }
  assert.deepEqual(outside, [])
})

test('narrow columns: a 3-column index keeps its starts, indents do not become columns, gutters under one em split lines', () => {
  const idx: PLine[] = []
  for (let i = 0; i < 12; i++) for (const x of [40, 90, 140]) idx.push(line(0, 'Entry, 12', x, x + 40, 60 + i * 12, 9, 'B 9'))
  assert.deepEqual(columnStarts(idx), [40, 90, 140])
  const prose: PLine[] = []
  for (let i = 0; i < 12; i++) prose.push(line(0, 'A long line of prose text running the whole width', i % 2 ? 40 : 75, 340, 60 + i * 12, 9, 'B 9'))
  assert.deepEqual(columnStarts(prose), [40])
  const rows = Array.from({ length: 12 }, () => [{ x: 40, x1: 85, size: 9 }, { x: 90, x1: 130, size: 9 }, { x: 136, x1: 180, size: 9 }]) // gaps of 5 and 6 pt
  assert.equal(columnGutters(rows).length, 2)
  const words = Array.from({ length: 12 }, (_, k) => [{ x: 40, x1: 85 + k * 3, size: 9 }, { x: 90 + k * 3, x1: 300, size: 9 }]) // gaps drift line by line: word spaces
  assert.equal(columnGutters(words).length, 0)
})

test('a vector logo (many small paths forming a mark) is an artifact unless the client asks for a figure', () => {
  const page = { index: 0, width: 400, height: 560, lines: [], images: [] }
  const paints = Array.from({ length: 12 }, (_, i) => ({ kind: 'path' as const, box: { x0: 40 + (i % 4) * 8, y0: 60 + Math.floor(i / 4) * 8, x1: 46 + (i % 4) * 8, y1: 66 + Math.floor(i / 4) * 8 } }))
  assert.equal(detectFigures(page, paints, 11).length, 0)
  const figs = detectFigures(page, paints, 11, { logos: 'figure' })
  assert.equal(figs.length, 1)
  assert.ok(figs[0].logo && figs[0].vector)
})
