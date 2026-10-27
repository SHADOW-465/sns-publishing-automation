// R1: a numbered list runs past 99 — items 100 and on are still items of the same list, in the PDF/UA tree and in the EPUB contents.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildStructure, type UaRole } from '../src/engine/pdfua/structure.ts'
import { readContents } from '../src/engine/pdfepub/contents.ts'
import type { PdfBook, PLine } from '../src/engine/pdfepub/analyze.ts'

const line = (page: number, text: string, x0: number, y: number, size: number, key: string): PLine => ({
  runs: [{ text, x0, x1: x0 + text.length * 5, font: 'F', size, bold: false, italic: false }],
  x0, x1: x0 + text.length * 5, y, base: y + size * 0.8, size, font: 'F', text, marker: false, key, page, col: 40,
}) as PLine
const pagesOf = (pages: PLine[][]) =>
  ({ pages: pages.map((lines, index) => ({ index, width: 400, height: 900, lines, images: [], fills: [], rules: { h: [], v: [] }, shades: [] })), front: [], lead: 14, step: 18, bodySize: 11, numbers: pages.map((_, i) => i + 1) }) as unknown as PdfBook
const roles = new Map<string, UaRole>([['H 24', 'H1'], ['B 11', 'P'], ['N 8', 'Note']])

test('PDF/UA: a numbered list 1–120 is one list of 120 items; a note "101." stays a note', () => {
  const pages: PLine[][] = []
  for (let p = 0; p < 3; p++) {
    const ls: PLine[] = p === 0 ? [line(0, 'Chapter One', 40, 40, 24, 'H 24')] : []
    for (let i = 0; i < 40; i++) { const n = p * 40 + i + 1; ls.push(line(p, `${n}. Item number ${n}`, 40, 80 + i * 18, 11, 'B 11')) }
    if (p === 2) ls.push(line(p, '101. A note at the foot of the page.', 40, 860, 8, 'N 8'))
    pages.push(ls)
  }
  const st = buildStructure(pagesOf(pages), roles, new Map())
  const lists = st.nodes.filter((n) => n.tag === 'L')
  assert.deepEqual(lists.map((l) => l.kids.filter((k) => k.tag === 'LI').length), [120])
  assert.ok(st.nodes.some((n) => n.tag === 'Note' && n.lines.some((l) => l.text.startsWith('101. A note'))))
})

test('EPUB contents: an edited volume numbered past 99 keeps "101." as the chapter title with its byline page', () => {
  const L = (page: number, text: string, x0: number, base: number, x1 = x0 + text.length * 5): PLine =>
    ({ runs: [], x0, x1, y: base - 11.5, base, size: 11.5, font: 'T', text, marker: false, key: 'T|11.5', page, col: 60 } as unknown as PLine)
  const toc: PLine[] = [L(1, 'ÍNDICE', 170, 60)]
  let y = 100
  for (const n of [99, 100, 101]) {
    toc.push(L(1, `${n}. Un capítulo largo y difícil`, 60, y, 300)); y += 14
    toc.push(L(1, `Autor ${n}`, 60, y, 300)); toc.push(L(1, String(n * 2), 350, y, 360)); y += 14
  }
  const c = readContents([{ index: 0, width: 420, lines: [L(0, 'LIBRO', 100, 100)] }, { index: 1, width: 420, lines: toc }], 11.5)
  const e = c!.entries.filter((x) => x.kind === 'entry')
  assert.deepEqual(e.map((x) => [x.text.slice(0, 4), x.page]), [['99. ', 198], ['100.', 200], ['101.', 202]])
})
