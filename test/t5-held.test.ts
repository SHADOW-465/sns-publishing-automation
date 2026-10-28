// R2.3: held nodes (a picture under the contents, an edition line on the title page) are released by the next page at the latest,
// and a stray line on a page with nothing else tagged joins the nearest tagged line instead of the end of the tree.
// The check is the ua-audit one: no struct node more than 1 page from where it is printed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildStructure, type SNode, type UaRole } from '../src/engine/pdfua/structure.ts'
import { farFromPrint } from '../src/engine/pdfua/audit.ts'
import type { PdfBook, PLine } from '../src/engine/pdfepub/analyze.ts'

const line = (page: number, text: string, y: number, size: number, key: string, x0 = 40): PLine => ({
  runs: [{ text, x0, x1: x0 + text.length * 6, font: 'F', size, bold: false, italic: false }],
  x0, x1: x0 + text.length * 6, y, base: y + size * 0.8, size, font: 'F', text, marker: false, key, page, col: 40,
}) as PLine
const bookOf = (...pages: PLine[][]) =>
  ({ pages: pages.map((lines, index) => ({ index, width: 400, height: 560, lines, images: [], fills: [], rules: { h: [], v: [] }, shades: [] })), front: [], lead: 14, step: 18, bodySize: 11, numbers: pages.map((_, i) => i + 1) }) as unknown as PdfBook
const roles = new Map<string, UaRole>([['H 18', 'H1'], ['B 11', 'P'], ['S 7', 'Inline']])
// an indented first line starts a paragraph of its own on every page
const body = (page: number) => [line(page, `A paragraph on page ${page} starts here and goes on`, 100, 11, 'B 11', 58), line(page, 'for a good long while before it ends.', 114, 11, 'B 11')]
const rows = (page: number) => [1, 2, 3].map((i) => line(page, `Chapter ${page * 3 + i} ${page * 20 + i * 5}`, 60 + i * 20, 11, 'B 11'))

/** the printed page of every tagged node, in reading order */
const pagesInOrder = (n: SNode, out: number[] = []): number[] => {
  const p = n.lines[0]?.page ?? n.figure?.page
  if (p !== undefined) out.push(p)
  n.kids.forEach((k) => pagesInOrder(k, out))
  return out
}
const far = (book: PdfBook, figs = new Map()) => {
  const seq = pagesInOrder(buildStructure(book, roles, figs).root)
  return farFromPrint(seq).map((i) => `node on page ${seq[i]} read at ${seq.join(',')}`)
}

test('farFromPrint: a run of nodes more than 1 page from both neighbours is flagged; jumps over blank pages are not', () => {
  assert.deepEqual(farFromPrint([0, 0, 1, 4, 4, 5]), [])
  assert.deepEqual(farFromPrint([0, 1, 2, 7, 7, 3, 4]), [3, 4])
  assert.deepEqual(farFromPrint([0, 1, 2, 3, 0]), [4])
})

test('R2.3: a picture under a contents that runs on is released by the next page, not when the contents ends', () => {
  const ornament = { page: 0, box: { x0: 180, x1: 220, y0: 300, y1: 340 }, lines: [], caption: '', vector: false }
  const book = bookOf([line(0, 'Contents', 20, 18, 'H 18'), ...rows(0)], rows(1), rows(2), rows(3), body(4))
  assert.deepEqual(far(book, new Map([[0, [ornament as never]]])), [])
})

test('R2.3: an edition line on the title page is released by the next page, not at the next page with a heading', () => {
  const book = bookOf([line(0, 'Second edition', 200, 11, 'B 11')], body(1), body(2), body(3), [line(4, 'Chapter One', 20, 18, 'H 18'), ...body(4)])
  assert.deepEqual(far(book), [])
})

test('R2.3: a stray line on a page with nothing else tagged joins the nearest tagged line, not the end of the tree', () => {
  const book = bookOf(body(0), body(1), [line(2, '*', 300, 7, 'S 7')], body(3), body(4), body(5))
  assert.deepEqual(far(book), [])
})
