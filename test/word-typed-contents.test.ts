// A Word file with no heading styles (converted from PDF): the typed contents list names the chapters.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { headingsFromTypedContents } from '../src/engine/wordepub/typedtoc.ts'
import type { WordBlock } from '../src/engine/wordepub/read.ts'

const b = (text: string): WordBlock => ({ role: 'body', level: 0, ordered: false, runOn: false, text, inlines: [{ t: 'text', text }] })
const filler = 'Texto del capítulo con suficientes palabras para ser un párrafo de cuerpo normal y corriente.'

test('typed contents entries become level-1 headings, wrapped title lines joined, authors kept as text', () => {
  const blocks = [b('ÍNDICE'), b('Introducción . . . . . . 9'), b('Constituciones estatales:'), b('control federal en Brasil'), b('Cláudio Couto23'), b('El federalismo coercitivo'), b('John Kincaid51'),
    b('Introducción'), b(filler), b('Constituciones estatales:'), b('control federal en Brasil'), b('Cláudio Couto'), b(filler), b('Introducción'), b(filler), b('El federalismo coercitivo'), b('John Kincaid'), b(filler)]
  const out = headingsFromTypedContents(blocks)
  const heads = out.filter((x) => x.role === 'heading').map((x) => (x as { text: string }).text)
  assert.deepEqual(heads, ['Introducción', 'Constituciones estatales: control federal en Brasil', 'El federalismo coercitivo'])
  assert.equal(out[0].role, 'tocmark')
  assert.ok(out.some((x) => x.role === 'body' && (x as { text: string }).text === 'Cláudio Couto'))
})

test('a book with heading styles is left alone', () => {
  const blocks: WordBlock[] = [{ ...(b('Uno') as object), role: 'heading', level: 1 } as WordBlock, b('ÍNDICE'), b('Uno 3'), b('Dos 5')]
  assert.equal(headingsFromTypedContents(blocks), blocks)
})
