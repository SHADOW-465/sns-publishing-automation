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

test('a stray guessed heading (a bold running head in a PDF-converted file) does not stop the typed contents', () => {
  const h = (text: string) => ({ ...(b(text) as object), role: 'heading', level: 1 }) as WordBlock
  const blocks = [b('ÍNDICE'), b('Introducción . . . . . . 9'), b('El federalismo coercitivo'), b('John Kincaid51'), b('Federalismo en Brasil'), b('Eneida Salgado85'), b('Recentralización en México'), b('Ana Pérez120'),
    b('INTRODUCCIÓN'), b(filler), b('EL FEDERALISMO COERCITIVO'), b('John Kincaid'), b(filler), h('52 JOHN KINCAID'), b(filler), b('FEDERALISMO EN BRASIL'), b(filler), b('RECENTRALIZACIÓN EN MÉXICO'), b(filler)]
  const heads = headingsFromTypedContents(blocks).filter((x) => x.role === 'heading').map((x) => (x as { text: string }).text)
  assert.deepEqual(heads, ['INTRODUCCIÓN', 'EL FEDERALISMO COERCITIVO', 'FEDERALISMO EN BRASIL', 'RECENTRALIZACIÓN EN MÉXICO'])
})

test('numbered entries and titles read as list items still name the chapters', () => {
  const li = (text: string) => ({ ...(b(text) as object), role: 'list' }) as WordBlock
  const blocks = [b('ÍNDICE'), b('Introducción . . . . . . 9'), li('Constituciones estatales:'), b('control federal en Brasil'), b('Cláudio Couto 23'), li('El federalismo coercitivo'), b('John Kincaid 51'),
    b('INTRODUCCIÓN'), b(filler), li('CONSTITUCIONES ESTATALES:'), b('CONTROL FEDERAL EN BRASIL'), b('Cláudio Couto'), b(filler), li('EL FEDERALISMO COERCITIVO'), b('John Kincaid'), b(filler)]
  const heads = headingsFromTypedContents(blocks).filter((x) => x.role === 'heading').map((x) => (x as { text: string }).text)
  assert.deepEqual(heads, ['INTRODUCCIÓN', 'CONSTITUCIONES ESTATALES: CONTROL FEDERAL EN BRASIL', 'EL FEDERALISMO COERCITIVO'])
})
