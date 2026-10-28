// Where the printed lines sit decides "as the printed page": flush right is justified, a title on the middle is centred.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bodyAlignment, columnAlignment, lineAlignment } from '../src/engine/pdfepub/align.ts'
import type { PdfTable } from '../src/engine/pdf/tables.ts'
import type { PLine } from '../src/engine/pdfepub/analyze.ts'

const line = (x0: number, x1: number, col = 0): PLine => ({ x0, x1, col }) as PLine

test('body text is justified when most full lines end on the right edge', () => {
  const page = () => ({ lines: Array.from({ length: 8 }, (_, i) => line(50, i === 7 ? 180 : 400)) })
  assert.equal(bodyAlignment([page(), page(), page()], () => true), 'justify')
})

test('body text stays left when the right edge is ragged, or the sample is too short to trust', () => {
  const ragged = () => ({ lines: Array.from({ length: 8 }, (_, i) => line(50, 250 + (i % 5) * 30)) })
  assert.equal(bodyAlignment([ragged(), ragged(), ragged()], () => true), 'left')
  assert.equal(bodyAlignment([{ lines: Array.from({ length: 8 }, () => line(50, 400)) }], () => true), 'left')
})

test('a heading is centred when it sits on the middle of the text and does not share the left edge', () => {
  const page = () => ({ lines: [line(40, 400), line(40, 400), line(40, 400), line(160, 280)] })
  assert.equal(lineAlignment([page(), page()], (l) => l.x0 === 160), 'center')
  const left = () => ({ lines: [line(40, 400), line(40, 400), line(40, 400), line(40, 220)] })
  assert.equal(lineAlignment([left(), left()], (l) => l.x1 === 220), 'left')
})

test('a heading is right-aligned when it ends on the right edge of the text and starts well inside it', () => {
  const page = () => ({ lines: [line(40, 400), line(40, 400), line(40, 400), line(250, 400)] })
  assert.equal(lineAlignment([page(), page()], (l) => l.x0 === 250), 'right')
})

// a table: one cell per row and column, its line from x0 to x1 with the given text
const table = (cols: number[], rows: [number, number, string][][], head = false) =>
  ({
    cols,
    head,
    cells: rows.flatMap((r, ri) => r.map(([x0, x1, text], c) => ({ r: ri, c, rowspan: 1, colspan: 1, shaded: false, lines: [{ x0, x1, text } as PLine] }))),
  }) as unknown as PdfTable<PLine>

test('table cells: a column of numbers is right-aligned, even when the header and a stray cell start on the left', () => {
  const t = table([0, 100, 200], [
    [[0, 40, 'Name'], [110, 140, 'Total']],
    [[0, 60, 'Clay'], [160, 190, '1,250']],
    [[0, 50, 'Glaze'], [175, 190, '12']],
    [[0, 70, 'Kiln'], [110, 190, '3.5%']],
  ], true)
  assert.deepEqual(columnAlignment(t), ['left', 'right'])
})

test('table cells: text sharing a right edge is right, sharing a middle is centred, the majority decides', () => {
  const t = table([0, 100, 200, 300], [
    [[10, 90, 'one'], [130, 170, 'a'], [210, 260, 'x']],
    [[50, 90, 'two'], [120, 180, 'bb'], [210, 280, 'yy']],
    [[30, 90, 'three'], [140, 160, 'c'], [210, 230, 'z']],
    [[60, 90, 'four'], [110, 190, 'dddd'], [250, 290, 'w']],
  ])
  assert.deepEqual(columnAlignment(t), ['right', 'center', 'left'])
})
