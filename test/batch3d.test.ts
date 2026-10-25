// Batch 3D: the client's Book_Details workbook as a book-layer setting (FIL-001, SEM-001, NAV-001/002, PKG-001..005).
// Synthetic workbook and synthetic sections only. No client file is read.
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { writeXlsx } from '../src/engine/spec/office.ts'
import { readRequirements } from '../src/engine/spec/requirements.ts'
import { applyBookDetails, bookDetailsFromWorkbook, parseTypeCell, type BookDetails } from '../src/engine/spec/bookdetails.ts'
import { emptyLayer, resolve } from '../src/engine/spec/layers.ts'
import { openSpec, applyBookDetailsToSpec } from '../src/engine/spec/session.ts'
import { MemoryStore, setStore } from '../src/engine/spec/store.ts'
import { packageEpub, type Section } from '../src/engine/epub/package.ts'
import { bookDetailsGuards } from '../src/engine/check/guards.ts'
import { setSettings, DEFAULT_SETTINGS, settings } from '../src/engine/settings.ts'
import { text } from '../src/engine/zip.ts'
import { PNG } from './fixtures/indesign-export.ts'

afterEach(() => setSettings(DEFAULT_SETTINGS))

const HEAD = ['Chapter Name', 'Navigation Level', 'Title', 'Start Page', 'End Page', 'epub:type (Accesible EPUB Only)']
const t = (e: string, r = '') => `epub:type="${e}"${r ? ` role="${r}"` : ''}`
/** a workbook built the way the client's is: a "metadata" sheet of key/value pairs and a "NAV-NCX" sheet of one row per file */
const workbook = (rows: string[][], meta: string[][] = [['Title:', 'Das Feld'], ['Author:', 'Ana Autorin'], ['Publisher:', 'Verlag Test'], ['Page Count:', '40'], ['EISBN:', '978-0-306-40615-7']]) =>
  writeXlsx([{ name: 'metadata', rows: meta }, { name: 'NAV-NCX', rows: [HEAD, ...rows, ['', '', '', '', '', '']] }])
const ROWS = [
  ['cover.xhtml', '1', 'Cover', '', '', t('cover')],
  ['halftitle.xhtml', '1', 'Schmutztitel', '1', '1', t('halftitle')],
  ['fm01.xhtml', '', '', '2', '2', t('frontmatter')],
  ['toc.xhtml', '1', 'Inhalt', '5', '5', t('frontmatter', 'doc-toc')],
  ['fm03.xhtml', '1', 'Vom Acker zum Park', '7', '10', t('chapter', 'doc-chapter')],
  ['chapter01.xhtml', '1', 'Natur: Acker, Grün', '11', '30', t('chapter', 'doc-chapter')],
  ['chapter02.xhtml', '1', 'Sport: Rennbahn', '31', '48', t('chapter', 'doc-chapter')],
  ['notes.xhtml', '1', 'Anmerkungen', '49', '49', t('note', 'note')],
  ['credits.xhtml', '1', 'Bildnachweis', '50', '50', t('credits', 'doc-credits')],
  ['copy.xhtml', '1', 'Urheberrecht', '52', '52', t('copyright-page')],
  ['', '1', 'Dank', '51', '51', `epub:type=“dedication” role=“doc-dedication”`], // no file name, curly quotes
]
const details = (rows = ROWS, name = 'Book_Details_test.xlsx') => readRequirements(name, workbook(rows)).bookDetails!

const page = (n: number) => `<span aria-label="page ${n}" epub:type="pagebreak" id="page-${n}" role="doc-pagebreak" title="page ${n}"/>`
const sec = (file: string, type: Section['type'], nav: string, first: number | undefined, epubType: string, role = '', extra = ''): Section => ({
  file, id: file.replace('.xhtml', ''), type, nav, title: nav || 'x',
  body: `<section aria-label="${nav}" epub:type="${epubType}"${role ? ` role="${role}"` : ''}>\n${first ? page(first) : ''}<h2 id="h-${file}">${nav}</h2><p>text ${extra}</p>\n</section>`,
})
/** the sections of a small book as the builder names them (bm-style names, its own types), in reading order */
const built = (): Section[] => [
  sec('halftitle.xhtml', 'halftitle', 'Schmutztitel', 1, 'halftitlepage'),
  sec('fm1.xhtml', 'other', '', 2, 'frontmatter'),
  sec('toc.xhtml', 'toc', 'Inhalt', 5, 'frontmatter', 'doc-toc', '<a href="chapter01.xhtml#h-chapter01.xhtml">eins</a> <a href="chapter02.xhtml">zwei</a>'),
  sec('chapter01.xhtml', 'chapter', 'Vom Acker zum Park', 7, 'chapter', 'doc-chapter'),
  sec('chapter02.xhtml', 'chapter', 'Natur: Acker, Grün', 11, 'chapter', 'doc-chapter', '<a href="chapter03.xhtml">weiter</a>'),
  sec('chapter03.xhtml', 'chapter', 'Sport: Rennbahn', 31, 'chapter', 'doc-chapter'),
  sec('notes.xhtml', 'notes', 'Anmerkungen', 49, 'endnotes', 'doc-endnotes'),
  sec('list.xhtml', 'list', 'Bildnachweis', undefined, 'frontmatter'),
  sec('ack.xhtml', 'acknowledgments', 'Dank', 51, 'acknowledgments', 'doc-acknowledgments'),
  sec('copyright.xhtml', 'copyright', 'Impressum', undefined, 'copyright-page'),
]

test('FIL-001: the loader reads the client workbook: rows, types, roles, curly quotes, a row without a file name, and the metadata sheet', () => {
  const d = details()
  assert.equal(d.source, 'Book_Details_test.xlsx')
  assert.deepEqual([d.title, d.author, d.publisher, d.pageCount, d.eisbn], ['Das Feld', 'Ana Autorin', 'Verlag Test', 40, '978-0-306-40615-7'])
  assert.equal(d.files.length, ROWS.length, 'blank trailing rows are dropped')
  const toc = d.files.find((f) => f.file === 'toc.xhtml')!
  assert.deepEqual([toc.epubType, toc.role, toc.start, toc.end, toc.level], ['frontmatter', 'doc-toc', 5, 5, '1'])
  const dank = d.files.find((f) => f.title === 'Dank')!
  assert.deepEqual([dank.file, dank.epubType, dank.role], ['', 'dedication', 'doc-dedication'])
  assert.equal(d.files.find((f) => f.file === 'fm01.xhtml')!.level, '', 'no level = not in the menu')
  assert.deepEqual(parseTypeCell('epub:type=“note” role=“note”'), { epubType: 'note', role: 'note' })
  // an ordinary requirements workbook is not mistaken for a Book_Details file
  assert.equal(bookDetailsFromWorkbook([{ name: 'Rules', rows: [['Rule', 'Value']] }]), undefined)
})

test('FIL-001, SEM-001: files take the client’s names, epub:type and role; links follow the new names', () => {
  const r = applyBookDetails(built(), details(), 'plan')
  const by = (old: string) => r.sections[built().findIndex((s) => s.file === old)]
  assert.deepEqual(r.renamed.map(([a, b]) => `${a}>${b}`), ['fm1.xhtml>fm01.xhtml', 'chapter01.xhtml>fm03.xhtml', 'chapter02.xhtml>chapter01.xhtml', 'chapter03.xhtml>chapter02.xhtml', 'list.xhtml>credits.xhtml', 'copyright.xhtml>copy.xhtml'])
  assert.match(by('chapter01.xhtml').body, /^<section aria-label="Vom Acker zum Park" epub:type="chapter" role="doc-chapter">/)
  assert.match(by('halftitle.xhtml').body, /epub:type="halftitle">/, 'halftitlepage → the row’s halftitle, no role')
  assert.match(by('fm1.xhtml').body, /epub:type="frontmatter">/)
  assert.match(by('notes.xhtml').body, /epub:type="note" role="note">/, 'the sheet’s own words, even where the engine would say endnotes')
  assert.match(by('list.xhtml').body, /epub:type="credits" role="doc-credits">/)
  assert.equal(by('chapter01.xhtml').id, 'fm03')
  // the contents page linked chapter01 (now fm03), chapter02 (now chapter01): both follow, with their fragment
  const toc = by('toc.xhtml').body
  assert.match(toc, /href="fm03\.xhtml#h-chapter01\.xhtml"/)
  assert.match(toc, /href="chapter01\.xhtml"/)
  assert.match(by('chapter02.xhtml').body, /href="chapter02\.xhtml"/)
})

test('FIL-001: a row that describes nothing is reported, and so is a part the workbook does not list', () => {
  const rows = [...ROWS.filter((x) => x[0] !== 'chapter02.xhtml'), ['chapter09.xhtml', '1', 'Zukunft', '188', '201', t('chapter', 'doc-chapter')], ['liter.xhtml', '1', 'Literatur', '203', '204', t('backmatter')]]
  const r = applyBookDetails(built(), details(rows), 'plan')
  assert.deepEqual(r.unmatched.map((f) => f.file).sort(), ['chapter09.xhtml', 'liter.xhtml'])
  // chapter03 ("Sport") has no row of its own now: it is not in the plan and keeps its name
  assert.deepEqual(r.unplanned.map((s) => s.file), ['chapter03.xhtml'])
  const { review } = pack(details(rows))
  assert.ok(review.some((x) => x.level === 'warn' && x.msg.startsWith('FIL-001: 1 part of the book is not in Book_Details and keeps the build’s name: chapter03.xhtml')))
})

test('FIL-001: a wanted name another file already keeps is refused, never written twice', () => {
  const rows = [['halftitle.xhtml', '1', 'Schmutztitel', '1', '1', t('halftitle')], ['chapter03.xhtml', '1', 'Vom Acker zum Park', '7', '10', t('chapter', 'doc-chapter')]]
  const r = applyBookDetails(built(), details(rows), 'plan')
  assert.equal(r.clashes.length, 1)
  assert.equal(r.clashes[0].with, 'chapter03.xhtml')
  const names = r.sections.map((s) => s.file)
  assert.equal(new Set(names).size, names.length, 'no two files share a name')
})

test('FIL-01: the menu takes the row’s title and level, or stays as built', () => {
  const plan = applyBookDetails(built(), details(), 'plan').sections
  assert.equal(plan.find((s) => s.file === 'copy.xhtml')!.nav, 'Urheberrecht', 'title from the sheet')
  assert.equal(plan.find((s) => s.file === 'fm01.xhtml')!.nav, '', 'no level: no menu entry')
  const keep = applyBookDetails(built(), details(), 'keep').sections
  assert.equal(keep.find((s) => s.file === 'copy.xhtml')!.nav, 'Impressum')
  assert.equal(DEFAULT_SETTINGS.bookDetailsNav, 'plan', 'default: as the client’s sheet says')
})

test('book layer: Book_Details is a book-layer setting; the client layer has none, the book layer wins, and the import is logged', async () => {
  setStore(new MemoryStore())
  const client = emptyLayer('client', 'Verlag Test')
  const book = emptyLayer('book', '9780306406157')
  assert.equal(resolve([client, book]).settings.bookDetails, undefined)
  book.bookDetails = details()
  const r = resolve([client, book])
  assert.equal(r.settings.bookDetails?.files.length, ROWS.length)
  assert.equal(r.from['bookDetails'].level, 'book')
  let spec = await openSpec({ client: 'Verlag Test', series: '', book: '9780306406157' }, DEFAULT_SETTINGS)
  spec = await applyBookDetailsToSpec(spec, 'book', details(), 'Ana')
  assert.equal(spec.resolved.settings.bookDetails?.eisbn, '978-0-306-40615-7')
  const log = await (await import('../src/engine/spec/store.ts')).store().listDecisions({ book: '9780306406157' })
  assert.match(log[0].detail, /Book_Details with 11 file row\(s\).*Book_Details_test\.xlsx/)
  assert.equal(log[0].actor, 'Ana')
})

const meta = { title: 'Das Feld', subtitle: '', authors: 'Ana Autorin', publisher: 'Verlag Test', language: 'de', eisbn: '978-0-306-40615-7', printIsbn: '', rights: '', certifiedBy: 'x', conformsTo: 'x' }
const pack = (d?: BookDetails, m = meta, review: import('../src/engine/epub/package.ts').ReviewItem[] = []) => {
  setSettings({ bookDetails: d })
  const r = packageEpub({ meta: m, sections: built(), cover: { path: 'images/cover.png', data: PNG }, images: [], usedClasses: new Map(), bodyDecls: {}, review, css: 'p{}' })
  return { ...r, review }
}

test('packageEpub: names, types, menu and spine follow the plan, and the review says what was done', () => {
  const prior = { level: 'error' as const, msg: 'Picture x.png needs a description (alt text), or mark it as decorative.', where: 'fm1.xhtml' }
  const { files, review, sections } = pack(details(), meta, [prior])
  assert.equal(prior.where, 'fm01.xhtml', 'a note taken before the rename follows the file')
  assert.ok(files.has('OEBPS/fm03.xhtml') && !files.has('OEBPS/chapter03.xhtml') && files.has('OEBPS/chapter02.xhtml'))
  assert.deepEqual(sections.map((s) => s.file).slice(0, 3), ['halftitle.xhtml', 'fm01.xhtml', 'toc.xhtml'])
  const opf = text(files.get('OEBPS/content.opf')!)
  assert.match(opf, /<itemref idref="fm03"\/>/)
  assert.match(opf, /<item id="fm03" href="fm03\.xhtml"/)
  assert.match(text(files.get('OEBPS/nav.xhtml')!), /<a href="copy\.xhtml">Urheberrecht<\/a>/)
  assert.ok(review.some((x) => x.level === 'info' && x.msg.startsWith('FIL-001: 6 files named as in Book_Details')))
  assert.deepEqual(review.filter((x) => x !== prior && (x.msg.startsWith('SEM-001') || x.level === 'error')), [], 'what the build wrote agrees with the workbook')
  // no workbook, no change
  const none = pack(undefined)
  assert.ok(none.files.has('OEBPS/chapter03.xhtml') && !none.review.some((x) => /Book_Details/.test(x.msg)))
})

test('FIL-001 guard: a row whose file is not in the book is reported; a missing chapter is an error, other parts a warning', () => {
  const rows = [...ROWS, ['chapter09.xhtml', '1', 'Zukunft', '188', '201', t('chapter', 'doc-chapter')], ['liter.xhtml', '1', 'Literatur', '203', '204', t('backmatter')]]
  const { review } = pack(details(rows))
  const fil = review.filter((x) => x.msg.startsWith('FIL-001: Book_Details row'))
  assert.equal(fil.length, 2, 'each row once')
  assert.equal(fil.find((x) => /chapter09/.test(x.msg))!.level, 'error')
  assert.equal(fil.find((x) => /liter/.test(x.msg))!.level, 'warn')
  assert.match(fil[0].msg, /matched nothing: the e-book has no file with that name/)
})

test('SEM-001 guard: a file whose epub:type or role differs from its row is an error naming both', () => {
  const { files } = pack(details())
  const d = details()
  assert.deepEqual(bookDetailsGuards(files, d).filter((x) => x.msg.startsWith('SEM-001')), [])
  const html = text(files.get('OEBPS/chapter01.xhtml')!).replace('role="doc-chapter"', 'role="doc-part"')
  files.set('OEBPS/chapter01.xhtml', new TextEncoder().encode(html))
  const bad = bookDetailsGuards(files, d).filter((x) => x.msg.startsWith('SEM-001'))
  assert.equal(bad.length, 1)
  assert.equal(bad[0].level, 'error')
  assert.match(bad[0].msg, /chapter01\.xhtml should be epub:type="chapter" role="doc-chapter".*but is epub:type="chapter" role="doc-part"/)
})

test('PKG-001/003/004/005 guard: package details that differ from the workbook are reported', () => {
  const d = details()
  const same = pack(d).review.filter((x) => /^PKG-00[1-5]/.test(x.msg))
  assert.deepEqual(same, [])
  // a different e-ISBN, publisher, title and author in the book (all valid per se)
  const other = pack(d, { ...meta, eisbn: '978-0-306-40615-7'.replace(/7$/, '7'), publisher: 'Anderer Verlag', title: 'Ein anderes Buch', authors: 'Bea Beispiel' }).review
  assert.ok(other.some((x) => x.level === 'warn' && x.msg.startsWith('PKG-005: the publisher in the package is “Anderer Verlag”')))
  assert.ok(other.some((x) => x.level === 'warn' && x.msg.startsWith('PKG-003:')))
  assert.ok(other.some((x) => x.level === 'warn' && x.msg.startsWith('PKG-004:')))
  const wrongIsbn = pack(d, { ...meta, eisbn: '9780306406164' }).review // a valid ISBN-13, but not the workbook’s
  assert.ok(wrongIsbn.some((x) => x.level === 'error' && x.msg.startsWith('PKG-001: the e-book ISBN in the package is 9780306406164, but Book_Details gives 978-0-306-40615-7')))
  // a workbook with a typo in its own e-ISBN (wrong check digit) is the faulty side: a warning that says so
  const typo = { ...d, eisbn: '978-0-306-40615-3' }
  const typoReview = pack(typo).review
  assert.ok(typoReview.some((x) => x.level === 'warn' && /^PKG-001: Book_Details gives the e-ISBN 978-0-306-40615-3, which is not a valid ISBN-13/.test(x.msg)))
})

test('the workbook fills what the book lacks, never overrides what the page gave', () => {
  const { files } = pack(details(), { ...meta, publisher: '', eisbn: '' })
  const opf = text(files.get('OEBPS/content.opf')!)
  assert.match(opf, /<dc:identifier id="pub-id">urn:isbn:9780306406157</)
  assert.match(opf, /<dc:publisher>Verlag Test<\/dc:publisher>/)
  assert.equal(settings().bookDetails?.title, 'Das Feld')
})
