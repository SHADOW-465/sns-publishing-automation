// R2.2: lines are grouped into rows first (a baseline within 2 pt of the row's first line), then the rows read top to bottom
// and each row left to right. A pairwise "same row if within 2 pt" comparator is not transitive, so the order came out of the input order.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildStructure, rowOrder, type SNode, type UaRole } from '../src/engine/pdfua/structure.ts'
import type { PdfBook, PLine } from '../src/engine/pdfepub/analyze.ts'

const line = (page: number, text: string, x0: number, base: number, size: number, key: string): PLine => ({
  runs: [{ text, x0, x1: x0 + text.length * 5, font: 'F', size, bold: false, italic: false }],
  x0, x1: x0 + text.length * 5, y: base - size * 0.8, base, size, font: 'F', text, marker: false, key, page, col: 40,
}) as PLine
const roles = new Map<string, UaRole>([['H 24', 'H1'], ['B 11', 'P']])
const inOrder = (n: SNode, out: PLine[] = []): PLine[] => (out.push(...n.lines), n.kids.forEach((k) => inOrder(k, out)), out)

/** seeded shuffle (mulberry32) */
const shuffle = <T>(xs: T[], seed: number): T[] => {
  let s = seed >>> 0
  const rnd = () => ((s = (s + 0x6d2b79f5) >>> 0), (((s ^ (s >>> 15)) * (1 | s)) >>> 0) / 2 ** 32)
  const a = [...xs]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** contents rows whose baselines chain: title +0, number +1.5 (same row), a stray mark +3 (next row, but within 2 pt of the number) */
const lines = (): PLine[] => [
  line(0, 'Contents', 40, 60, 24, 'H 24'),
  ...[0, 1, 2, 3, 4].flatMap((i) => [
    line(0, `Chapter ${['One', 'Two', 'Three', 'Four', 'Five'][i]}`, 200, 120 + i * 30, 11, 'B 11'),
    line(0, `${i * 10 + 3}`, 40, 121.5 + i * 30, 11, 'B 11'),
    line(0, '*', 10, 123 + i * 30, 11, 'B 11'),
  ]),
]

test('R2.2: rowOrder groups lines into rows, then sorts; the same lines in 20 seeded orders give one output', () => {
  const want = rowOrder(lines()).map((l) => `${l.text}@${l.base}`)
  for (let seed = 1; seed <= 20; seed++) assert.deepEqual(rowOrder(shuffle(lines(), seed)).map((l) => `${l.text}@${l.base}`), want, `seed ${seed}`)
  assert.deepEqual(want.slice(1, 4), ['3@121.5', 'Chapter One@120', '*@123'])
})

test('R2.2: a contents page reads the same whatever order its lines come in', () => {
  const read = (ls: PLine[]) => {
    const book = { pages: [{ index: 0, width: 400, height: 900, lines: ls, images: [], fills: [], rules: { h: [], v: [] }, shades: [] }], front: [], lead: 14, step: 18, bodySize: 11, numbers: [1] } as unknown as PdfBook
    return inOrder(buildStructure(book, roles, new Map()).root).map((l) => l.text).join(' | ')
  }
  const want = read(lines())
  for (let seed = 1; seed <= 20; seed++) assert.equal(read(shuffle(lines(), seed)), want, `seed ${seed}`)
})
