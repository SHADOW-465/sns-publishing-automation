// The author is a person named on the title page (or in the file's metadata).
// A publisher, a copyright holder and people thanked in the acknowledgements are not the author.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectMeta } from '../src/engine/indesign/front.ts'
import { analyze, build } from '../src/engine/indesign/build.ts'
import { text } from '../src/engine/zip.ts'
import { synthExport } from './synth.ts'
import type { Block, Export, Role } from '../src/engine/indesign/read.ts'

const p = (text: string, key = 'body'): Extract<Block, { t: 'p' }> => ({ t: 'p', el: null as unknown as Element, key, classes: [key], text, page: '' })
const pb = (n: string): Block => ({ t: 'pb', n })
const roleOf = (b: Extract<Block, { t: 'p' }>): Role => (b.key === 'h1' ? 'chapter-title' : b.key === 'imp' ? 'imprint' : 'p')

function book(blocks: Block[], creators: string[] = [], lang = 'de-DE'): Export {
  return {
    opfPath: 'OEBPS/content.opf', lang, opfTitle: 'Tempelhofer_Feld_Inhalt', opfCreators: creators,
    css: null as unknown as Export['css'], blocks, footnotes: new Map(), endnotes: new Set(), images: new Map(),
  }
}

const chapter = [pb('9'), p('Luftfahrt', 'h1'), p(`${'Der Text des Kapitels ist lang genug. '.repeat(30)}`)]

test('title page person, not the publisher or the names in the acknowledgements', () => {
  const fm = detectMeta(book([
    p('Das Tempelhofer Feld'),
    pb('2'),
    p('Das Tempelhofer Feld'),
    p('350 Hektar deutsche Geschichte'),
    p('BeBra Verlag'),
    p('Bjoern Weigel'),
    pb('3'),
    p('© 2026 BeBra Verlag GmbH', 'imp'),
    p('ISBN 978-3-8148-0356-2', 'imp'),
    p('Lektorat Traudl Kupfer', 'imp'),
    p('Foto Alfred Gross', 'imp'),
    pb('4'),
    p('Danksagung'),
    p('Goscha Nowak'),
    ...chapter,
  ]), roleOf)
  assert.equal(fm.author, 'Bjoern Weigel')
  assert.equal(fm.source.author, 'title page')
  assert.equal(fm.publisher, 'BeBra Verlag')
})

test('several authors stay in order and a publisher line does not join them', () => {
  const fm = detectMeta(book([
    p('Cartografías del poder'),
    pb('2'),
    p('Cartografías del poder'),
    p('Gustavo Urbina Cortés'),
    p('Isaac Cisneros Yescas'),
    p('Editorial Anagrama'),
    pb('3'),
    p('© 2024 Gustavo Urbina Cortés', 'imp'),
    ...chapter,
  ], [], 'es-MX'), roleOf)
  assert.equal(fm.author, 'Gustavo Urbina Cortés, Isaac Cisneros Yescas')
  assert.equal(fm.source.author, 'title page')
})

test('metadata author is used when the title page names only the publisher', () => {
  const fm = detectMeta(book([
    p('Some Book'),
    pb('2'),
    p('Some Book'),
    p('Example Press'),
    ...chapter,
  ], ['RJ Spina', 'book_final.indd']), roleOf)
  assert.equal(fm.author, 'RJ Spina')
  assert.equal(fm.source.author, 'book metadata')
})

test('a copyright-only name is kept and marked for a look', () => {
  const fm = detectMeta(book([
    p('Some Book'),
    pb('2'),
    p('Some Book'),
    p('A short subtitle'),
    pb('3'),
    p('© 2020 Elena Chávez', 'imp'),
    p('ISBN 978-3-16-148410-0', 'imp'),
    ...chapter,
  ], [], 'es-MX'), roleOf)
  assert.equal(fm.author, 'Elena Chávez')
  assert.match(fm.source.author, /copyright line — check/)
})

test('a typed title for an untitled part is written into the contents', () => {
  const css = `p.text { font-size: 1em; font-family: "Minion Pro", serif; } h1.h1 { font-size: 2em; font-family: "Veneer", sans-serif; } p.impressum { font-size: 0.7em; }`
  const body = [
    '<p class="text">A loose opening line.</p>',
    '<span epub:type="pagebreak" id="page1" role="doc-pagebreak" aria-label="1" title="1"/>',
    '<h1 class="h1">Alpha</h1>',
    `<p class="text">${'Alpha is the chapter. '.repeat(40)}</p>`,
    '<p class="impressum">© 2020 Example Press</p>',
    '<p class="impressum">ISBN 978-3-16-148410-0</p>',
  ].join('\n')
  const a = analyze(synthExport(body, css, 'en-GB'))
  const cover = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))
  const open = a.meta ? build(a, {
    styles: a.styles, images: [],
    meta: { ...a.meta, title: 'Sample Book', authors: 'A. Writer', publisher: 'Example Press', eisbn: '9780306406157', language: 'en-GB' },
    cover: { name: 'cover.png', data: cover },
    sectionNav: { 0: 'Opening note' },
  }) : undefined
  assert.ok(open)
  assert.equal(open.sections[0].nav, 'Opening note')
  assert.match(text(open.files.get('OEBPS/nav.xhtml')!), /Opening note/)
})
