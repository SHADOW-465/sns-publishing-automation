// R2.1: the contents ends at the first heading that is not a contents entry, or on the first page past the contents pages.
// Contents as H1, then chapters as H2 set in two columns: the chapters are headings and their columns read left then right.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildStructure, type SNode, type UaRole } from '../src/engine/pdfua/structure.ts'
import type { PdfBook, PLine } from '../src/engine/pdfepub/analyze.ts'

const line = (page: number, text: string, x0: number, y: number, size: number, key: string, x1 = x0 + text.length * 5): PLine => ({
  runs: [{ text, x0, x1, font: 'F', size, bold: false, italic: false }],
  x0, x1, y, base: y + size * 0.8, size, font: 'F', text, marker: false, key, page, col: 40,
}) as PLine
const pagesOf = (pages: PLine[][]) =>
  ({ pages: pages.map((lines, index) => ({ index, width: 400, height: 900, lines, images: [], fills: [], rules: { h: [], v: [] }, shades: [] })), front: [], lead: 14, step: 18, bodySize: 11, numbers: pages.map((_, i) => i + 1) }) as unknown as PdfBook
const roles = new Map<string, UaRole>([['H 24', 'H1'], ['H 16', 'H2'], ['B 11', 'P']])
const W = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'] // body lines do not end in a number
const inOrder = (n: SNode, out: PLine[] = []): PLine[] => (out.push(...n.lines), n.kids.forEach((k) => inOrder(k, out)), out)
const tocs = (n: SNode, out: SNode[] = []): SNode[] => (n.tag === 'TOC' && out.push(n), n.kids.forEach((k) => tocs(k, out)), out)

/** Contents (H1) with two rows, then two chapters (H2) in two columns of 8 lines each */
function book(): PdfBook {
  const contents = [
    line(0, 'Contents', 40, 40, 24, 'H 24'),
    line(0, 'Chapter One', 40, 100, 11, 'B 11'), line(0, '2', 350, 100, 11, 'B 11'),
    line(0, 'Chapter Two', 40, 120, 11, 'B 11'), line(0, '3', 350, 120, 11, 'B 11'),
  ]
  const chapter = (p: number, title: string) => {
    const ls = [line(p, title, 40, 40, 16, 'H 16')]
    for (let i = 0; i < 8; i++) {
      ls.push(line(p, `left ${title} ${W[i]}`, 40, 100 + i * 14, 11, 'B 11', 190))
      ls.push(line(p, `right ${title} ${W[i]}`, 220, 100 + i * 14, 11, 'B 11', 370))
    }
    return ls
  }
  return pagesOf([contents, chapter(1, 'Chapter One'), chapter(2, 'Chapter Two')])
}

test('R2.1: Contents H1 then two-column H2 chapters: the chapters are headings, each column reads in order, the contents holds only its rows', () => {
  const st = buildStructure(book(), roles, new Map())
  assert.deepEqual(st.headings.map((h) => `${h.tag} ${h.text}`), ['H1 Contents', 'H2 Chapter One', 'H2 Chapter Two'])
  assert.deepEqual(st.tocEntries.map((e) => e.lines.map((l) => l.text).join(' ')), ['Chapter One 2', 'Chapter Two 3'])
  assert.deepEqual(tocs(st.root).flatMap((t) => inOrder(t)).filter((l) => l.page > 0), [], 'no chapter line is inside the contents')
  for (const p of [1, 2]) {
    const title = p === 1 ? 'Chapter One' : 'Chapter Two'
    const read = inOrder(st.root).filter((l) => l.page === p).map((l) => l.text)
    const want = [title, ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `left ${title} ${W[i]}`), ...[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `right ${title} ${W[i]}`)]
    assert.deepEqual(read, want)
  }
})

test('R2.1: a contents that runs onto a second page of rows is still one contents', () => {
  const b = book()
  const more: PLine[] = [line(1, 'Chapter Three', 40, 60, 11, 'B 11'), line(1, '9', 350, 60, 11, 'B 11'), line(1, 'Chapter Four', 40, 80, 11, 'B 11'), line(1, '12', 350, 80, 11, 'B 11')]
  b.pages.splice(1, 0, { ...b.pages[0], index: 1, lines: more })
  b.pages.forEach((p, i) => (p.index = i, p.lines.forEach((l) => (l.page = i))))
  const st = buildStructure(b, roles, new Map())
  assert.deepEqual(st.tocEntries.map((e) => e.lines.map((l) => l.text).join(' ')), ['Chapter One 2', 'Chapter Two 3', 'Chapter Three 9', 'Chapter Four 12'])
  assert.deepEqual(st.headings.map((h) => h.text), ['Contents', 'Chapter One', 'Chapter Two'])
})

test('R2.1: a chapter heading under the contents on its own page ends the contents; a heading-styled contents row stays an entry', () => {
  const b = pagesOf([[
    line(0, 'Contents', 40, 40, 24, 'H 24'),
    line(0, 'Chapter One', 40, 100, 16, 'H 16'), line(0, '2', 350, 104.4, 11, 'B 11'), // on the title's baseline
    line(0, 'Chapter Two', 40, 300, 16, 'H 16'),
    line(0, 'The first words of the chapter.', 40, 340, 11, 'B 11'),
  ]])
  const st = buildStructure(b, roles, new Map())
  assert.deepEqual(st.tocEntries.map((e) => e.lines.map((l) => l.text).join(' ')), ['Chapter One 2'])
  assert.deepEqual(st.headings.map((h) => `${h.tag} ${h.text}`), ['H1 Contents', 'H2 Chapter Two'])
})
