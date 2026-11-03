// Nov 3 client corrections on the Portuguese InDesign book: publisher from Book_Details (PKG-005), menu levels from the
// sheet's Level column (NAV-001), pt-PT over the pt-BR document default, subheading levels below the chapter title, and the
// chapter subtitle printed on the same contents line. Synthetic data first; the client book only when it is on this machine.
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { resolve, basename } from 'node:path'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { writeXlsx } from '../src/engine/spec/office.ts'
import { readRequirements } from '../src/engine/spec/requirements.ts'
import { navLevelOf } from '../src/engine/spec/bookdetails.ts'
import { packageEpub, type Section } from '../src/engine/epub/package.ts'
import { bookDetailsGuards } from '../src/engine/check/guards.ts'
import { setSettings, DEFAULT_SETTINGS } from '../src/engine/settings.ts'
import { pickLanguage } from '../src/engine/lang.ts'
import { classifyStyleName } from '../src/engine/structure/dict.ts'
import { text, unzip } from '../src/engine/zip.ts'
import { analyze, build } from '../src/engine/indesign/build.ts'
import { openSpec, applySpec, applyBookDetailsToSpec } from '../src/engine/spec/session.ts'
import { PNG } from './fixtures/indesign-export.ts'

afterEach(() => setSettings(DEFAULT_SETTINGS))

// the client's NAV-NCX header says just "Level"
const HEAD = ['Chapter Name', 'Level', 'Title', 'Start Page', 'End Page', 'epub:type (Accesible EPUB Only)']
const t = (e: string, r = '') => `epub:type="${e}"${r ? ` role="${r}"` : ''}`
const ROWS = [
  ['cover.xhtml', '1', 'Capa', '', '', t('cover')],
  ['toc.xhtml', '1', 'Índice', '5', '5', t('frontmatter', 'doc-toc')],
  ['intro.xhtml', '1', 'Introdução', '7', '10', t('introduction', 'doc-introduction')],
  ['chapter01.xhtml', '2', 'Um: o começo', '11', '20', t('chapter', 'doc-chapter')],
  ['chapter02.xhtml', '1', 'Dois: o meio', '21', '30', t('chapter', 'doc-chapter')],
  ['chapter03.xhtml', '1', 'Três: o fim', '31', '40', t('chapter', 'doc-chapter')],
  ['chapter04.xhtml', '1', 'Quatro', '41', '48', t('chapter', 'doc-chapter')],
]
const details = (rows = ROWS) =>
  readRequirements('Book_Details_t.xlsx', writeXlsx([
    { name: 'metadata', rows: [['Title:', 'Livro'], ['Author:', 'Ana'], ['Publisher:', 'Guerra e Paz'], ['EISBN:', '978-0-306-40615-7']] },
    { name: 'NAV-NCX', rows: [HEAD, ...rows] },
  ])).bookDetails!
const page = (n: number) => `<span aria-label="page ${n}" epub:type="pagebreak" id="page-${n}" role="doc-pagebreak" title="page ${n}"/>`
const sec = (file: string, type: Section['type'], nav: string, epubType: string, first: number): Section => ({
  file, id: file.replace('.xhtml', ''), type, nav, title: nav,
  body: `<section aria-label="${nav}" epub:type="${epubType}">\n${page(first)}<h2 id="h-${file}">${nav}</h2><p>texto</p>\n</section>`,
})
const built = (): Section[] => [
  sec('toc.xhtml', 'toc', 'Índice', 'frontmatter', 5),
  sec('intro.xhtml', 'introduction', 'Introdução', 'introduction', 7),
  sec('chapter01.xhtml', 'chapter', 'Um', 'chapter', 11),
  sec('chapter02.xhtml', 'chapter', 'Dois', 'chapter', 21),
  sec('chapter03.xhtml', 'chapter', 'Três', 'chapter', 31),
  sec('chapter04.xhtml', 'chapter', 'Quatro', 'chapter', 41),
]
const meta = { title: 'Livro', subtitle: '', authors: 'Ana', publisher: 'Guerra e Paz', language: 'pt-PT', eisbn: '978-0-306-40615-7', printIsbn: '', rights: '', certifiedBy: 'x', conformsTo: 'x' }

test('NAV-001: the "Level" column is read; blank = no entry, a number = that depth, anything else = level 1', () => {
  const d = details()
  assert.deepEqual(d.files.map((f) => f.level), ['1', '1', '1', '2', '1', '1', '1'])
  assert.deepEqual(['', '1', '2', ' 3 ', '9', 'x'].map(navLevelOf), [0, 1, 2, 3, 6, 1])
})

test('NAV-001: the menu nests a level-2 row under the level-1 row before it, and the odd chapter level is flagged', () => {
  const d = details()
  setSettings({ bookDetails: d })
  const review: import('../src/engine/epub/package.ts').ReviewItem[] = []
  const { files } = packageEpub({ meta, sections: built(), cover: { path: 'images/cover.png', data: PNG }, images: [], usedClasses: new Map(), bodyDecls: {}, review, css: 'p{}' })
  const nav = text(files.get('OEBPS/nav.xhtml')!).replace(/\s+/g, ' ')
  assert.match(nav, /<a href="intro\.xhtml">Introdução<\/a> <ol[^>]*> <li><a href="chapter01\.xhtml">Um: o começo<\/a><\/li> <\/ol><\/li>/, 'chapter01 sits under Introdução, as the sheet says')
  assert.match(nav, /<\/ol><\/li> <li><a href="chapter02\.xhtml">Dois: o meio<\/a><\/li>/, 'the next level-1 row is back at the top')
  const ncx = text(files.get('OEBPS/toc.ncx')!)
  assert.ok(ncx.includes('chapter01.xhtml'))
  const g = bookDetailsGuards(files, d).filter((x) => x.msg.startsWith('NAV-001'))
  assert.equal(g.length, 1, 'one warning: the single chapter row at another level')
  assert.match(g[0].msg, /row 5 gives chapter01\.xhtml .* level 2, but the other 3 chapter rows are level 1/)
  // all chapters at one level: nothing to ask
  const even = details(ROWS.map((r) => (r[0] === 'chapter01.xhtml' ? [r[0], '1', ...r.slice(2)] : r)))
  setSettings({ bookDetails: even })
  const p2 = packageEpub({ meta, sections: built(), cover: { path: 'images/cover.png', data: PNG }, images: [], usedClasses: new Map(), bodyDecls: {}, review: [], css: 'p{}' })
  assert.equal(bookDetailsGuards(p2.files, even).filter((x) => x.msg.startsWith('NAV-001')).length, 0)
})

test('language: of the declared tags for the language the text is in, the one the paragraphs use wins (pt-PT over a pt-BR default)', () => {
  const pt = 'O sistema partidário português e a sua evolução ao longo das décadas, com os partidos que não se mantêm.'
  assert.equal(pickLanguage(['pt-BR', 'pt-PT'], pt, new Map([['pt-BR', 12], ['pt-PT', 596]])), 'pt-PT')
  assert.equal(pickLanguage(['pt-BR', 'pt-PT'], pt, new Map([['pt-BR', 50], ['pt-PT', 3]])), 'pt-BR')
  assert.equal(pickLanguage(['pt-BR', 'pt-PT'], pt), 'pt-BR', 'no usage counted: the first declared tag, as before')
  assert.equal(pickLanguage(['en-GB', 'pt-PT'], pt, new Map([['en-GB', 900]])), 'pt-PT', 'a tag for another language never wins on count')
})

test('heading levels: each number in a subheading style name is its own level', () => {
  assert.equal(classifyStyleName('SUB-CAPITULO')?.role, 'h2')
  assert.equal(classifyStyleName('Subtitulo2')?.role, 'h3')
  assert.equal(classifyStyleName('Subtitulo3')?.role, 'h4', 'not the same level as Subtitulo2')
  assert.equal(classifyStyleName('Subtitulo4')?.role, 'h5')
  assert.equal(classifyStyleName('Subhead 3')?.role, 'h4')
  assert.equal(classifyStyleName('Sub-Capitulo 2')?.role, 'h3')
  assert.equal(classifyStyleName('Sub'), undefined, 'a bare prefix names no level')
  assert.equal(classifyStyleName('Sub Head')?.role, 'h2')
})

const DIR = process.env.CHAPSPLIT_DIR || 'C:/Users/acer/AppData/Local/Temp/chapsplit'
const files = existsSync(DIR) ? readdirSync(DIR) : []
const epub = files.find((f) => f.endsWith('.epub'))
const sheet = files.find((f) => f.endsWith('.xlsx'))
const cover = files.find((f) => f.endsWith('.jpg') || f.endsWith('.png'))
const load = () => {
  const a = analyze(unzip(new Uint8Array(readFileSync(resolve(DIR, epub!)))))
  return { a, cover: cover ? { name: basename(cover), data: new Uint8Array(readFileSync(resolve(DIR, cover))) } : undefined }
}
const heads = (body: string) => [...body.matchAll(/<(h[1-6])\b[^>]*class="([^"]+)"/g)].map((m) => `${m[1]}.${m[2].split(' ')[0]}`)

test('client book, no sheet: pt-PT, subheadings below the chapter title, the subtitle on the contents line goes into the menu', { skip: !epub && 'client files missing' }, () => {
  const { a, cover: c } = load()
  assert.equal(a.meta.language, 'pt-PT')
  const r = build(a, { styles: a.styles, images: a.images, meta: { ...a.meta }, cover: c })
  const ch1 = r.sections.find((s) => s.file === 'chapter01.xhtml')!
  const h = new Set(heads(ch1.body))
  assert.ok(h.has('h2.CAPITULO') && h.has('h3.SUB-CAPITULO') && !h.has('h2.SUB-CAPITULO'), [...h].join(' '))
  // (a section's own heading can be set in a subheading style, as the contents page's “Índice” is: it heads its file, h2)
  for (const s of r.sections) for (const x of heads(s.body).slice(1)) if (/SUB-CAPITULO|Subtitulo/.test(x)) assert.notEqual(x.slice(0, 2), 'h2', `${s.file}: ${x}`)
  assert.equal(ch1.nav, '1. Estudo dos sistemas partidários: definição e abordagens')
  assert.equal(r.sections.find((s) => s.file === 'chapter08.xhtml')!.nav, '8. Uma (re)leitura sartoriana do sistema partidário português', 'a chapter without a subtitle keeps its title')
})

test('client book with Book_Details: the publisher and the menu levels are the sheet’s', { skip: (!epub || !sheet) && 'client files or sheet missing' }, async () => {
  const { a, cover: c } = load()
  let spec = await openSpec({ client: a.meta.publisher, series: '', book: a.meta.title }, DEFAULT_SETTINGS)
  spec = await applyBookDetailsToSpec(spec, 'book', readRequirements(sheet!, new Uint8Array(readFileSync(resolve(DIR, sheet!)))).bookDetails!, 'headless')
  applySpec(spec)
  const r = build(a, { styles: a.styles, images: a.images, meta: { ...a.meta }, cover: c })
  const opf = text(r.files.get('OEBPS/content.opf')!)
  assert.match(opf, /<dc:publisher>Guerra e Paz<\/dc:publisher>/)
  assert.match(opf, /<dc:language>pt-PT<\/dc:language>/)
  assert.ok(r.review.some((x) => x.msg.startsWith('PKG-005: the publisher is “Guerra e Paz”')))
  const nav = text(r.files.get('OEBPS/nav.xhtml')!).replace(/\s+/g, ' ')
  assert.match(nav, /<a href="intro\.xhtml">[^<]+<\/a> <ol[^>]*> <li><a href="chapter01\.xhtml">/)
  // a person who typed another publisher under Book details keeps it
  const r2 = build(a, { styles: a.styles, images: a.images, meta: { ...a.meta, publisher: 'Editora X' }, cover: c })
  assert.match(text(r2.files.get('OEBPS/content.opf')!), /<dc:publisher>Editora X<\/dc:publisher>/)
})
