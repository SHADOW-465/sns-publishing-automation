// Batch 5: regressions after the batch-4 commit.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { zipSync, strToU8 } from 'fflate'
import { mergeOpeners } from '../src/engine/structure/labels.ts'
import { readWordBook } from '../src/engine/wordepub/read.ts'
import { buildWordEpub } from '../src/engine/wordepub/build.ts'
import { text } from '../src/engine/zip.ts'

type S = { type: string; number?: string; numberAsTitle?: string; title: string[]; blocks: { kind: string; html: string }[] }
const pb = (n: number) => ({ kind: 'raw', html: `<span epub:type="pagebreak" id="page-${n}"/>` })
const tt = (s: S) => s.title.join(' ')

test('1: a part label and the heading under it stay one part when the chapter label after them already opens a chapter', () => {
  const secs: S[] = [
    { type: 'part', title: ['ACT ONE'], blocks: [pb(28)] },
    { type: 'other', title: ['Your Writing World'], blocks: [] },
    { type: 'chapter', number: 'CHAPTER 1', title: ['A ROADMAP'], blocks: [pb(29)] },
    { type: 'part', title: ['ACT TWO'], blocks: [pb(100)] },
    { type: 'other', title: ['Dealing with your Demons'], blocks: [] },
    { type: 'chapter', number: 'CHAPTER 5', title: ['AWAY MOVES'], blocks: [pb(101)] },
  ]
  assert.deepEqual(mergeOpeners(secs, tt).map((s) => [s.type, s.number ?? '', tt(s)]), [
    ['part', '', 'ACT ONE Your Writing World'],
    ['chapter', 'CHAPTER 1', 'A ROADMAP'],
    ['part', '', 'ACT TWO Dealing with your Demons'],
    ['chapter', 'CHAPTER 5', 'AWAY MOVES'],
  ])
})

test('1b: a titled section after a part label that is followed by body text is not folded into the part', () => {
  const secs: S[] = [
    { type: 'part', title: ['ACT ONE'], blocks: [pb(28)] },
    { type: 'other', title: ['Notes'], blocks: [] },
    { type: 'other', title: ['More'], blocks: [{ kind: 'p', html: 'word '.repeat(300) }] },
  ]
  assert.equal(mergeOpeners(secs, tt).filter((s) => s.type === 'part').map(tt)[0], 'ACT ONE')
})

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const STYLES = `<?xml version="1.0"?><w:styles xmlns:w="${W}"><w:style w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style></w:styles>`
const wordBook = (paras: string, rels: string) => readWordBook(zipSync({
  'word/document.xml': strToU8(`<?xml version="1.0"?><w:document xmlns:w="${W}" xmlns:r="${R}"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Bibliography</w:t></w:r></w:p>${paras}</w:body></w:document>`),
  'word/styles.xml': strToU8(STYLES),
  'word/_rels/document.xml.rels': strToU8(`<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}</Relationships>`),
}))
const rel = (id: string, target: string) => `<Relationship Id="${id}" Type="${R}/hyperlink" Target="${target}" TargetMode="External"/>`

test('2: a link cut by a page break at a hyphen takes the rest of the address from the paragraph that runs on', () => {
  const book = wordBook(`
    <w:p><w:r><w:t xml:space="preserve">Michel, D. (2018). Atractiva. Síntesis. </w:t></w:r><w:hyperlink r:id="rId1"><w:r><w:t>https://example.mx/2018/09/atractiva-plataforma-ti-</w:t></w:r></w:hyperlink></w:p>
    <w:p><w:r><w:t>zayuca-cceh/</w:t></w:r></w:p>
    <w:p><w:r><w:t>Next entry of the list.</w:t></w:r></w:p>
    <w:p><w:r><w:t xml:space="preserve">See </w:t></w:r><w:hyperlink r:id="rId2"><w:r><w:t>https://example.mx/a/</w:t></w:r></w:hyperlink></w:p>
    <w:p><w:r><w:t>sequel of the text, which is prose.</w:t></w:r></w:p>`,
  rel('rId1', 'https://example.mx/2018/09/atractiva-plataforma-ti-') + rel('rId2', 'https://example.mx/a/'))
  const links = book.blocks.flatMap((b) => (b.role === 'body' ? b.inlines : [])).filter((i) => i.t === 'text' && i.href)
  assert.equal(links[0].href, 'https://example.mx/2018/09/atractiva-plataforma-tizayuca-cceh/')
  assert.equal(links[0].t === 'text' && links[0].text, 'https://example.mx/2018/09/atractiva-plataforma-tizayuca-cceh/')
  assert.ok(!book.blocks.some((b) => b.role === 'body' && /zayuca-cceh\/$/.test(b.text) && !b.text.includes('http')), 'the tail is no longer loose text')
  // prose that runs on after a link ending in a slash is not part of the address
  assert.equal(links[1].href, 'https://example.mx/a/')
})

const COVER = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'))
const META = { title: 'Prueba', subtitle: '', authors: 'Autora', publisher: 'Editorial', language: 'es', eisbn: '9780306406157', printIsbn: '', rights: '', certifiedBy: '', conformsTo: '' }
const para = (t: string) => `<w:p><w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`
const filler = 'Texto del capítulo con suficientes palabras para ser un párrafo de cuerpo normal y corriente.'

test('3: text before the contents is the title and copyright page, and the typed contents page lists the sections', () => {
  // no heading styles; the contents is typed. The title and the cataloguing record come before it.
  const xml = `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>${[
    'DINÁMICAS CONTEMPORÁNEAS', 'Coordinadores', 'Nombres: Ugalde, Vicente, coordinador.', 'Título: Dinámicas / coordinadores.', 'D.R. © El Colegio, A.C.', 'ISBN 978-607-564-784-5',
    'ÍNDICE', 'Introducción . . . . . . 9', 'Constituciones estatales:', 'control federal en Brasil', 'Cláudio Couto 23', 'El federalismo coercitivo', 'John Kincaid 51',
    'INTRODUCCIÓN', filler, 'CONSTITUCIONES ESTATALES:', 'CONTROL FEDERAL EN BRASIL', 'Cláudio Couto', filler, 'EL FEDERALISMO COERCITIVO', 'John Kincaid', filler,
  ].map(para).join('')}</w:body></w:document>`
  const book = readWordBook(zipSync({ 'word/document.xml': strToU8(xml), 'word/styles.xml': strToU8(STYLES) }))
  const built = buildWordEpub(book, { meta: META, cover: { name: 'cover.png', data: COVER } })
  const types = built.sections.map((x) => x.type)
  assert.deepEqual(types.slice(0, 4), ['title', 'copyright', 'toc', 'introduction'])
  assert.ok(!types.includes('other'), 'nothing before the contents is back matter')
  const file = (stem: string) => text(built.files.get(`OEBPS/${built.sections.find((x) => x.type === stem)!.file}`)!)
  const title = file('title')
  assert.match(title, /epub:type="titlepage"/)
  assert.match(title, /DINÁMICAS CONTEMPORÁNEAS/)
  assert.doesNotMatch(title, /Nombres:/)
  assert.match(file('copyright'), /Nombres:[\s\S]*ISBN/)
  const toc = file('toc')
  assert.doesNotMatch(toc, /<li><\/li>/, 'no empty list items left from the blanked typed lines')
  assert.match(toc, /<a href="chapter01\.xhtml">CONSTITUCIONES ESTATALES: CONTROL FEDERAL EN BRASIL<\/a>/)
})

test('3b: a manuscript that opens straight on a heading gets no invented front page', () => {
  const xml = `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body><w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Capítulo uno</w:t></w:r></w:p>${para(filler)}</w:body></w:document>`
  const book = readWordBook(zipSync({ 'word/document.xml': strToU8(xml), 'word/styles.xml': strToU8(STYLES) }))
  const types = buildWordEpub(book, { meta: META, cover: { name: 'cover.png', data: COVER } }).sections.map((x) => x.type)
  assert.ok(!types.includes('title') && !types.includes('copyright'))
})
