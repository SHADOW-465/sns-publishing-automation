import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readContents, matchHeadings } from '../src/engine/pdfepub/contents.ts'
import type { PLine } from '../src/engine/pdfepub/analyze.ts'

// An edited volume (dinamicas PDF): "ÍNDICE" in the text face and size, numbered chapter titles that wrap,
// each followed by a byline whose last row carries the page number; the chapter opens with its title in
// capitals of the body font, then the byline.
let y = 0
const L = (page: number, text: string, x0: number, base: number, x1 = x0 + text.length * 5, size = 11.5): PLine =>
  ({ runs: [], x0, x1, y: base - size, base, size, font: 'AdobeTextPro', text, marker: false, key: 'AdobeTextPro|11.5', page, col: 60 } as unknown as PLine)

function book() {
  const W = 420
  const toc: PLine[] = [L(1, 'ÍNDICE', 170, 60)]
  y = 100
  const row = (t: string, page?: number) => {
    toc.push(L(1, t, 60, y, 300))
    if (page !== undefined) toc.push(L(1, String(page), 350, y, 360))
    y += 14
  }
  row('Introducción', 9)
  row('1. Constituciones estatales y federalismo:'); row('control federal en Brasil'); row('Ana Pérez', 23)
  row('2. El crecimiento del federalismo'); row('coercitivo en Estados Unidos'); row('Luis Gómez', 51)
  row('3. Relaciones intergubernamentales'); row('y teoría constitucional'); row('Joaquín García,'); row('y Daniel Zorrilla', 85)
  const body = (page: number, lines: string[]) => ({ index: page, width: W, height: 600, lines: lines.map((t, i) => L(page, t, 60, 100 + i * 15)) })
  const pages = [
    { index: 0, width: W, height: 600, lines: [L(0, 'DINÁMICAS', 100, 100)] },
    { index: 1, width: W, height: 600, lines: toc },
    body(2, ['INTRODUCCIÓN', 'El texto de la introducción sigue aquí.']),
    body(3, ['1. CONSTITUCIONES ESTATALES Y FEDERALISMO:', 'CONTROL FEDERAL EN BRASIL', 'Ana Pérez', 'Texto del capítulo.']),
    body(4, ['2. EL CRECIMIENTO DEL FEDERALISMO', 'COERCITIVO EN ESTADOS UNIDOS', 'Luis Gómez', 'Texto.']),
    body(5, ['3. RELACIONES INTERGUBERNAMENTALES', 'Y TEORÍA CONSTITUCIONAL', 'Joaquín García,', 'y Daniel Zorrilla', 'Texto.']),
  ]
  return { pages, numbers: [1, 7, 9, 23, 51, 85] }
}

test('edited volume: contents in the text face, title rows + byline row with the page number', () => {
  const { pages } = book()
  const c = readContents(pages, 11.5)
  assert.ok(c, 'contents found although ÍNDICE is set in the body size')
  const e = c!.entries.filter((x) => x.kind === 'entry')
  assert.deepEqual(e.map((x) => [x.text.slice(0, 20), x.page]), [
    ['Introducción', 9], ['1. Constituciones es', 23], ['2. El crecimiento de', 51], ['3. Relaciones interg', 85],
  ])
})

test('edited volume: the chapter titles in body-font capitals at the top of the page are matched, byline left out', () => {
  const { pages, numbers } = book()
  const c = readContents(pages, 11.5)!
  const m = matchHeadings(c, pages, numbers, () => true)
  assert.equal(m.length, 4)
  const third = m.find((x) => x.entry.page === 85)!
  assert.deepEqual(third.lines.map((l) => l.text), ['3. RELACIONES INTERGUBERNAMENTALES', 'Y TEORÍA CONSTITUCIONAL'])
})
