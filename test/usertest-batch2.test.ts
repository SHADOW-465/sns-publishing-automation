// Fixes from the 12-book user test (batch 2), on synthetic inputs only.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sectionTypeOf } from '../src/engine/epub/locale.ts'
import { fusedTocPage, tocEntryText } from '../src/engine/indesign/read.ts'
import { tocPageOf } from '../src/engine/indesign/inline.ts'
import { parseXml } from '../src/engine/xml.ts'
import { packageEpub, type ReviewItem, type Section } from '../src/engine/epub/package.ts'
import { unzip, text } from '../src/engine/zip.ts'
import { PNG } from './fixtures/indesign-export.ts'

const para = (inner: string) => parseXml(`<p xmlns="http://www.w3.org/1999/xhtml" class="Basic-Paragraph">${inner}</p>`).documentElement

test('a contents line whose page number is glued to the title ("Normandy</a>12", "Successors1</a>4") gives title and page apart', () => {
  const a = para('&#9;<a href="x#a">Chapter 1</a>&#9;<a href="">Normandy</a>12')
  assert.deepEqual(fusedTocPage(a), { page: '12', cut: 2 })
  assert.equal(tocEntryText(a), 'Chapter 1 Normandy')
  assert.equal(tocPageOf(a), '12')
  const b = para('&#9;Chapter<a href=""> 2</a>&#9;<a href="">King William I And His Successors1</a>4')
  assert.equal(tocEntryText(b), 'Chapter 2 King William I And His Successors')
  assert.equal(tocPageOf(b), '14')
  // a line with a proper tab before its number is left to the usual rule; a title ending in a number with no tab layout too
  assert.equal(fusedTocPage(para('<a href="">Normandy</a>&#9;12')), undefined)
  assert.equal(fusedTocPage(para('<a href="">Apollo</a>13')), undefined)
})

test('section names: a stray symbol before a heading, plural conclusions, "Author", "Sobre los autores"', () => {
  assert.equal(sectionTypeOf('=Epilogue'), 'epilogue')
  assert.equal(sectionTypeOf('CONCLUSIONES'), 'conclusion')
  assert.equal(sectionTypeOf('Conclusions'), 'conclusion')
  assert.equal(sectionTypeOf('Author'), 'about')
  assert.equal(sectionTypeOf('SOBRE LOS AUTORES'), 'about')
  assert.equal(sectionTypeOf('Authority and power'), undefined)
})

const meta = { title: '', subtitle: '', authors: 'A', publisher: 'P', language: 'es', eisbn: '978-0-306-40615-7', printIsbn: '', rights: '', certifiedBy: '', conformsTo: '' }
const sec = (file: string, type: Section['type'], nav: string, body: string): Section => ({ file, id: file.replace('.xhtml', ''), type, nav, title: nav, body: `<section>${body}</section>` })
const build = (sections: Section[]) => {
  const review: ReviewItem[] = []
  const r = packageEpub({ meta, sections, cover: { path: 'images/cover.png', data: PNG }, images: [], usedClasses: new Map(), bodyDecls: {}, review, css: 'p{}' })
  return { ...r, review }
}

test('an untitled book takes its title from the cataloguing record ("Título: … / coordinadores"), as a warning, not the first section name', () => {
  const r = build([
    sec('copyright.xhtml', 'copyright', 'Créditos', '<p>Nombres: Ugalde, Vicente.</p><p>Título: Dinámicas contemporáneas en Brasil y México / Vicente Ugalde, coordinador.</p>'),
    sec('chapter01.xhtml', 'chapter', 'Uno', '<h1>Uno</h1><p>Texto.</p>'),
  ])
  assert.match(text(unzip(r.epub).get('OEBPS/content.opf')!), /<dc:title[^>]*>Dinámicas contemporáneas en Brasil y México<\/dc:title>/)
  assert.ok(!r.review.some((x) => x.level === 'error' && /no title/.test(x.msg)))
})

test('RSC-020: a web address typed with spaces is trimmed and its spaces encoded', () => {
  const r = build([sec('chapter01.xhtml', 'chapter', 'Uno', '<h1>Uno</h1><p><a href="http://www.facebook.com/Mr Luyen homestay ">x</a></p>')])
  const body = text(unzip(r.epub).get('OEBPS/chapter01.xhtml')!)
  assert.match(body, /href="http:\/\/www\.facebook\.com\/Mr%20Luyen%20homestay"/)
})
