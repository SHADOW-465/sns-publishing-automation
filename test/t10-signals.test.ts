// T10 (OPUS_DESIGN2): per-block role signals. Italic, a smaller size and a figure label turn a block of a body style
// next to a figure (within 3 em) into its Caption; a heading-style block over 25 words is a paragraph. A caption_style
// directive (UaOptions.captionStyle) says which signal marks the captions of a book. Synthetic pages only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildStructure, type SNode, type UaOptions, type UaRole } from '../src/engine/pdfua/structure.ts'
import type { PdfBook, PLine } from '../src/engine/pdfepub/analyze.ts'

const line = (text: string, x0: number, x1: number, y: number, size: number, key: string, font = 'NewBaskervilleStd-Roman'): PLine => ({
  runs: [{ text, x0, x1, font, size, bold: false, italic: /italic/i.test(font) }],
  x0, x1, y, base: y + size * 0.8, size, font, text, marker: false, key, page: 0, col: 40,
})
const bookOf = (lines: PLine[]) =>
  ({ pages: [{ index: 0, width: 400, height: 560, lines, images: [], fills: [], rules: { h: [], v: [] }, shades: [] }], front: [], lead: 14, step: 18, bodySize: 11, bodyKey: 'B 11', numbers: [1] }) as unknown as PdfBook
// a style key is face and size, not slant: an italic caption in the body face has the body's key, and the body's role
const roles = new Map<string, UaRole>([['H 18', 'H2'], ['B 11', 'P'], ['S 9', 'P']])
const IT = 'NewBaskervilleStd-Italic'
// a picture from y 80 to 260 (top down) on a 400 x 560 page
const pic = () => ({ page: 0, box: { x0: 100, x1: 300, y0: 300, y1: 480 }, lines: [], caption: '', vector: false })
const BODY = 'The river crosses the plain and the old road follows it down to the sea.'
const body = (y: number) => line(BODY, 40, 360, y, 11, 'B 11')
const flat = (n: SNode): SNode[] => [n, ...n.kids.flatMap(flat)]
const run = (lines: PLine[], options: UaOptions = {}) => {
  const st = buildStructure(bookOf(lines), roles, new Map([[0, [pic() as never]]]), options)
  const kids = st.root.kids
  const fig = kids.findIndex((k) => k.tag === 'Figure')
  return { st, kids, fig, tagOf: (text: string) => flat(st.root).find((n) => n.tag !== 'Document' && n.lines.some((l) => l.text === text))?.tag }
}

test('image20: an italic “Figura 7.2” caption in the body face is the Caption next to its figure, with its second line', () => {
  const r = run([
    body(30),
    line('Figura 7.2. Octavas en un piano: las teclas blancas', 120, 280, 268, 11, 'B 11', IT),
    line('y negras de dos octavas, del do al do', 130, 270, 282, 11, 'B 11', IT),
    line('(Adaptado de un dibujo de Gerry Clow)', 130, 270, 296, 11, 'B 11', IT),
    line('La respuesta vibratoria de las cuerdas sigue la misma ley de las octavas.', 40, 360, 330, 11, 'B 11'),
  ])
  assert.equal(r.kids[r.fig + 1]?.tag, 'Caption', 'the Caption sits right after its Figure')
  assert.deepEqual(r.kids[r.fig + 1].lines.map((l) => l.text), ['Figura 7.2. Octavas en un piano: las teclas blancas', 'y negras de dos octavas, del do al do', '(Adaptado de un dibujo de Gerry Clow)'])
  assert.equal(r.st.figures[0].caption, 'Figura 7.2. Octavas en un piano: las teclas blancas y negras de dos octavas, del do al do (Adaptado de un dibujo de Gerry Clow)')
  assert.equal(r.tagOf('La respuesta vibratoria de las cuerdas sigue la misma ley de las octavas.'), 'P', 'the body text after it stays a paragraph')
})

test('italic signal: an italic line within 3 em of a figure is its Caption; one further away is text', () => {
  const near = run([body(30), line('Octaves on a piano keyboard', 120, 280, 268, 11, 'B 11', IT)])
  assert.equal(near.kids[near.fig + 1]?.tag, 'Caption')
  assert.equal(near.st.figures[0].caption, 'Octaves on a piano keyboard')
  const far = run([body(30), line('Octaves on a piano keyboard', 120, 280, 300, 11, 'B 11', IT)])
  assert.equal(far.tagOf('Octaves on a piano keyboard'), 'P')
  assert.equal(far.st.figures[0].caption, '')
})

test('size signal: a line set smaller than the body next to a figure is its Caption; a body-size upright line is not', () => {
  const small = run([body(30), line('Octaves on a piano keyboard', 120, 280, 266, 9, 'S 9')])
  assert.equal(small.kids[small.fig + 1]?.tag, 'Caption')
  const plain = run([body(30), line('Octaves on a piano keyboard', 120, 280, 268, 11, 'B 11')])
  assert.equal(plain.tagOf('Octaves on a piano keyboard'), 'P')
  assert.equal(plain.st.figures[0].caption, '')
})

test('label signal: a “Figure 3.1” line in the body style next to a figure is its Caption, the paragraph under it is not', () => {
  const r = run([body(30), line('Figure 3.1 Octaves on a piano', 120, 280, 268, 11, 'B 11'), line(BODY, 40, 360, 284, 11, 'B 11')])
  assert.equal(r.kids[r.fig + 1]?.tag, 'Caption')
  assert.deepEqual(r.kids[r.fig + 1].lines.map((l) => l.text), ['Figure 3.1 Octaves on a piano'])
})

test('caption_style directive: only the signal the instruction names marks a caption', () => {
  const lines = () => [body(30), line('Octaves on a piano keyboard', 120, 280, 266, 9, 'S 9')]
  assert.equal(run(lines(), { captionStyle: { signal: 'italic', near: 'figure' } }).tagOf('Octaves on a piano keyboard'), 'P', 'captions are the italic lines: a small upright line is text')
  assert.equal(run(lines(), { captionStyle: { signal: 'smaller', near: 'figure' } }).tagOf('Octaves on a piano keyboard'), 'Caption')
  const it = () => [body(30), line('Octaves on a piano keyboard', 120, 280, 268, 11, 'B 11', IT)]
  assert.equal(run(it(), { captionStyle: { signal: 'label', near: 'figure' } }).tagOf('Octaves on a piano keyboard'), 'P', 'captions are the labelled lines')
  assert.equal(run(it(), { captionStyle: { signal: 'italic', near: 'figure' } }).tagOf('Octaves on a piano keyboard'), 'Caption')
})

test('heading signal: a heading-style block over 25 words is a paragraph; a short one stays a heading', () => {
  const long = 'This is a long display paragraph set in the heading face across the top of the page, and it runs on and on'
  const tail = 'well past what any heading of this book would ever say in its title line.'
  const r = run([line(long, 40, 360, 300, 18, 'H 18'), line(tail, 40, 360, 322, 18, 'H 18'), line('A short heading', 40, 200, 380, 18, 'H 18'), body(410)])
  assert.equal(r.tagOf(long), 'P')
  assert.equal(r.tagOf(tail), 'P')
  assert.match(r.tagOf('A short heading') ?? '', /^H\d$/)
  assert.deepEqual(r.st.headings.map((h) => h.text), ['A short heading'])
})
