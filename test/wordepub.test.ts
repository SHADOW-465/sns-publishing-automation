import { test } from 'node:test'
import assert from 'node:assert/strict'
import { zipSync, strToU8 } from 'fflate'
import { text } from '../src/engine/zip.ts'
import { readWordBook } from '../src/engine/wordepub/read.ts'
import { buildWordEpub } from '../src/engine/wordepub/build.ts'
import type { BookMeta } from '../src/engine/epub/package.ts'

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

/** 100×80 PNG header. Big enough that the decorative rule does not claim it. */
const png = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x64, 0x00, 0x00, 0x00, 0x50,
  0x08, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
])

function docx(parts: Record<string, string | Uint8Array>): Uint8Array {
  const files: Record<string, Uint8Array> = {}
  for (const [name, data] of Object.entries(parts)) files[name] = typeof data === 'string' ? strToU8(data) : data
  return zipSync(files)
}

const p = (inner: string, pPr = '') => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${inner}</w:p>`
const run = (t: string, extra = '') => `<w:r>${extra}<w:t xml:space="preserve">${t}</w:t></w:r>`
const style = (id: string) => `<w:pStyle w:val="${id}"/>`
const pageBreak = `<w:r><w:br w:type="page"/></w:r>`
const pageField = `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>9</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>`
const dateTime = `<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> DATE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>1/9/26</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r><w:fldSimple w:instr=" TIME "><w:r><w:t>15:00</w:t></w:r></w:fldSimple>`

const numbering = `<?xml version="1.0"?>
<w:numbering xmlns:w="${W}">
  <w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>
  <w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum>
  <w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>
  <w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>
</w:numbering>`

const styles = `<?xml version="1.0"?>
<w:styles xmlns:w="${W}">
  <w:docDefaults><w:rPrDefault><w:rPr><w:lang w:val="es-ES"/></w:rPr></w:rPrDefault></w:docDefaults>
  <w:style w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style>
  <w:style w:styleId="TOC1"><w:name w:val="toc 1"/></w:style>
  <w:style w:styleId="NoIndent"><w:name w:val="No Indent"/></w:style>
</w:styles>`

const core = `<?xml version="1.0"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <dc:title>Cambia tu mente</dc:title>
  <dc:creator>Autor de prueba</dc:creator>
</cp:coreProperties>`

const listItem = (numId: string, label: string) => p(run(label), `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${numId}"/></w:numPr>`)

const body = `<?xml version="1.0"?>
<w:document xmlns:w="${W}" xmlns:r="${R}"><w:body>
  ${p(run('El primer capítulo'), style('TOC1'))}
  ${p(run('El segundo capítulo'), style('TOC1'))}
  ${p(run('El primer capítulo'), style('Heading1'))}
  ${p(`${run('En el capítulo 1 ')}${pageBreak}${pageField}${run('explicaré el método.')}`)}
  ${p(run('y después sigue el texto'), style('NoIndent'))}
  ${p(`${run('Hoy es ')}${dateTime}${run(' y sigue')}`)}
  ${p(run('texto sin cierre'))}
  ${p(run('la frase continúa aquí con el que los las del por una con se'))}
  ${p(run('Nota suelta'), style('Heading1'))}
  ${listItem('1', 'viñeta uno')}
  ${listItem('1', 'viñeta dos')}
  ${listItem('2', 'primero')}
  ${listItem('2', 'segundo')}
  <w:tbl>
    <w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc>${p(run('Nombre', '<w:rPr><w:b/></w:rPr>'))}</w:tc><w:tc>${p(run('Valor', '<w:rPr><w:b/></w:rPr>'))}</w:tc></w:tr>
    <w:tr><w:tc>${p(run('Alpha'))}</w:tc><w:tc>${p(run('1'))}</w:tc></w:tr>
  </w:tbl>
  ${p(run('El segundo capítulo'), style('Heading1'))}
  ${p(run('El texto del segundo capítulo que los lectores leen.'))}
  ${p(`<w:r><w:drawing><a:blip r:embed="rId5" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${R}"/></w:drawing></w:r>`)}
</w:body></w:document>`

const rels = `<?xml version="1.0"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/foto.png"/>
</Relationships>`

function manuscript(): Uint8Array {
  return docx({
    'word/document.xml': body,
    'word/styles.xml': styles,
    'word/numbering.xml': numbering,
    'word/_rels/document.xml.rels': rels,
    'word/media/foto.png': png,
    'docProps/core.xml': core,
  })
}

const meta: BookMeta = {
  title: 'Cambia tu mente',
  subtitle: '',
  authors: 'Autor de prueba',
  publisher: 'Editorial de prueba',
  language: 'es-ES',
  eisbn: '9780306406157',
  printIsbn: '',
  rights: '',
  certifiedBy: 'Alguien',
  conformsTo: 'EPUB-A11Y-11_WCAG-21-AA',
}

test('Word chapters follow the contents list, and a heading that is not in it stays inside the chapter', () => {
  const book = readWordBook(manuscript())
  assert.equal(book.title, 'Cambia tu mente')
  assert.equal(book.authors, 'Autor de prueba')
  assert.equal(book.language, 'es-ES')
  assert.deepEqual(book.toc, ['el primer capitulo', 'el segundo capitulo'])
  const headings = book.blocks.filter((b) => b.role === 'heading').map((b) => (b.role === 'heading' ? b.text : ''))
  assert.deepEqual(headings, ['El primer capítulo', 'Nota suelta', 'El segundo capítulo'])

  const built = buildWordEpub(book, {
    meta,
    cover: { name: 'cover.png', data: png },
    ai: { 'images/foto.png': { alt: 'Una fotografia del campo', approved: false } },
  })
  const chapters = built.sections.filter((s) => s.type === 'chapter')
  assert.equal(chapters.length, 2)
  assert.deepEqual(chapters.map((s) => s.nav), ['El primer capítulo', 'El segundo capítulo'])
  const first = text(built.files.get('OEBPS/' + chapters[0].file)!)
  assert.match(first, /<h1[^>]*role="heading"[^>]*aria-level="1"[^>]*>El primer capítulo<\/h1>/)
  assert.match(first, /<h2[^>]*role="heading"[^>]*aria-level="2"[^>]*>Nota suelta<\/h2>/)
  assert.match(first, /En el capítulo 1 <span[^>]*aria-label="página 9"[^>]*id="page-9"[^>]*\/>explicaré el método\./)
  assert.equal(first.split('En el capítulo 1').length, 2, 'the page break does not close the paragraph')
  const para = first.slice(first.indexOf('<p>'), first.indexOf('</p>'))
  assert.match(para, /id="page-9"/)
  assert.match(para, /explicaré el método\./)
  assert.match(para, /y después sigue el texto/)
  assert.doesNotMatch(first, /1\/9\/26/)
  assert.doesNotMatch(first, /15:00/)
  assert.match(first, /Hoy es y sigue/)
  assert.match(first, /texto sin cierre la frase continúa aquí/)
  assert.match(first, /<ul>\s*<li>viñeta uno<\/li>\s*<li>viñeta dos<\/li>/)
  assert.match(first, /<ol>\s*<li>primero<\/li>\s*<li>segundo<\/li>/)
  assert.match(first, /<thead>[\s\S]*<th[^>]*>[\s\S]*Nombre[\s\S]*<\/th>[\s\S]*<th[^>]*>[\s\S]*Valor[\s\S]*<\/th>/)
  assert.match(first, /<td>Alpha<\/td>/)

  const nav = text(built.files.get('OEBPS/nav.xhtml')!)
  const ncx = text(built.files.get('OEBPS/toc.ncx')!)
  assert.match(nav, /El primer capítulo/)
  assert.match(nav, /El segundo capítulo/)
  assert.doesNotMatch(nav, /Nota suelta/)
  assert.match(ncx, /El primer capítulo/)
  assert.match(ncx, /El segundo capítulo/)
  assert.doesNotMatch(ncx, /Nota suelta/)

  const picture = built.pictures.find((p) => p.path === 'images/foto.png')
  assert.ok(picture)
  assert.equal(picture!.source, 'ai')
  assert.equal(picture!.approved, false)
  assert.deepEqual(built.source.pendingAi, ['images/foto.png'])
  const opf = text(built.files.get('OEBPS/content.opf')!)
  assert.doesNotMatch(opf, /Alguien/)
  assert.doesNotMatch(opf, /EPUB-A11Y/)
  assert.ok(built.review.some((r) => r.level === 'error' && /approval/.test(r.msg)))
  const second = text(built.files.get('OEBPS/' + chapters[1].file)!)
  assert.match(second, /src="images\/foto\.png"/)
  assert.match(second, /alt="Una fotografia del campo"/)
})

test('Word heading detection uses style names and outline levels, not one language’s Heading 1', () => {
  const de = `<?xml version="1.0"?>
<w:document xmlns:w="${W}"><w:body>
  ${p(run('Luftfahrt'), style('berschrift1'))}
  ${p(run('Ein Unterkapitel'), '<w:outlineLvl w:val="1"/>')}
  ${p(run('Der Text und die und das ist nicht mit von.'))}
  ${p(run('Architektur'), style('berschrift1'))}
</w:body></w:document>`
  const stylesDe = `<?xml version="1.0"?><w:styles xmlns:w="${W}"><w:docDefaults><w:rPrDefault><w:rPr><w:lang w:val="de-DE"/></w:rPr></w:rPrDefault></w:docDefaults></w:styles>`
  const book = readWordBook(docx({ 'word/document.xml': de, 'word/styles.xml': stylesDe }))
  assert.equal(book.language, 'de-DE')
  assert.equal(book.toc.length, 0)
  const built = buildWordEpub(book, {
    meta: { ...meta, title: book.title, authors: 'Jemand', language: book.language, certifiedBy: '', conformsTo: '' },
    cover: { name: 'cover.png', data: png },
  })
  const chapters = built.sections.filter((s) => s.type === 'chapter')
  assert.deepEqual(chapters.map((s) => s.nav), ['Luftfahrt', 'Architektur'])
  const first = text(built.files.get('OEBPS/' + chapters[0].file)!)
  assert.match(first, /<h2[^>]*aria-level="2"[^>]*>Ein Unterkapitel<\/h2>/)
  assert.doesNotMatch(first, /<h1[^>]*>Ein Unterkapitel<\/h1>/)
})

test('Word, Cambia shape: parts and chapters get their own files, the contents page links to them, typed bullets become a list, a captioned table has a header; EPUBCheck clean', async () => {
  const { epubcheck } = await import('./epubcheck.ts')
  const stylesX = `<?xml version="1.0"?>
<w:styles xmlns:w="${W}">
  <w:docDefaults><w:rPrDefault><w:rPr><w:lang w:val="es-ES"/></w:rPr></w:rPrDefault></w:docDefaults>
  <w:style w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>
  <w:style w:styleId="Heading2"><w:name w:val="heading 2"/></w:style>
  <w:style w:styleId="TOC1"><w:name w:val="toc 1"/></w:style>
  <w:style w:styleId="TOC2"><w:name w:val="toc 2"/></w:style>
</w:styles>`
  const br = '<w:r><w:br/></w:r>'
  const shade = (t: string) => `<w:tc><w:tcPr><w:shd w:val="clear" w:fill="D9D9D9"/></w:tcPr>${p(run(t))}</w:tc>`
  const docXml = `<?xml version="1.0"?>
<w:document xmlns:w="${W}"><w:body>
  ${p(run('Índice'), style('Heading1'))}
  ${p(run('Introducción 13'), style('TOC1'))}
  ${p(run('PRIMERA PARTE'), style('TOC2'))}
  ${p(run('Identifica tu programación subconsciente 25'), style('TOC2'))}
  ${p(run('Capítulo 1. ¿Qué es la mente'), style('TOC1'))}
  ${p(run('subconsciente? ........ 27'), style('TOC1'))}
  ${p(run('Capítulo 2. Hábitos del falso yo 40'), style('TOC1'))}
  ${p(run('Introducción'), style('Heading1'))}
  ${p(`${run('¿Conocías los siguientes datos?')}${br}${run('• El 84 por ciento sufre estrés.')}${br}${run('• El 47 por ciento sufre ansiedad.')}${br}${run('• El 44 por ciento sufre tristeza.')}`)}
  ${p(run('PRIMERA PARTE Identifica tu programación subconsciente'), style('Heading1'))}
  ${p(run('Capítulo 1. ¿Qué es la mente subconsciente?'), style('Heading2'))}
  ${p(run('Texto del primer capítulo que los lectores leen con calma.'))}
  ${p(run('Lista de control/puntuación', '<w:rPr><w:b/></w:rPr>'))}
  <w:tbl>
    <w:tr>${shade('Sí')}${shade('No')}${shade('Pregunta')}</w:tr>
    <w:tr><w:tc>${p(run(''))}</w:tc><w:tc>${p(run(''))}</w:tc><w:tc>${p(run('¿Me siento vacío?'))}</w:tc></w:tr>
  </w:tbl>
  ${p(run('Capítulo 2. Hábitos del falso yo'), style('Heading2'))}
  ${p(run('Texto del segundo capítulo que los lectores leen con calma.'))}
</w:body></w:document>`
  const book = readWordBook(docx({ 'word/document.xml': docXml, 'word/styles.xml': stylesX, 'docProps/core.xml': core }))
  assert.deepEqual(book.tocEntries.map((e) => e.text), ['Introducción', 'PRIMERA PARTE Identifica tu programación subconsciente', 'Capítulo 1. ¿Qué es la mente subconsciente?', 'Capítulo 2. Hábitos del falso yo'], 'a wrapped entry is one entry, without leaders or page number')
  const built = buildWordEpub(book, { meta: { ...meta, certifiedBy: '', conformsTo: '' }, cover: { name: 'cover.png', data: png } })
  assert.deepEqual(built.sections.map((s) => s.file), ['toc.xhtml', 'intro.xhtml', 'part.xhtml', 'chapter01.xhtml', 'chapter02.xhtml'])
  const toc = text(built.files.get('OEBPS/toc.xhtml')!)
  assert.match(toc, /<p class="toc_1"><a href="intro\.xhtml">Introducción<\/a><\/p>/)
  assert.match(toc, /<p class="toc_2"><a href="part\.xhtml">PRIMERA PARTE Identifica/)
  assert.match(toc, /<p class="toc_1a"><a href="chapter01\.xhtml">Capítulo 1\./)
  assert.doesNotMatch(toc, /\.{3}|>\d+</, 'no dot leaders or page numbers in the links')
  const intro = text(built.files.get('OEBPS/intro.xhtml')!)
  assert.match(intro, /<p>¿Conocías los siguientes datos\? ?<\/p>\s*<ul>\s*<li>El 84 por ciento sufre estrés\.<\/li>\s*<li>El 47[^<]*<\/li>\s*<li>El 44[^<]*<\/li>/)
  assert.doesNotMatch(intro, /•/)
  const ch1 = text(built.files.get('OEBPS/chapter01.xhtml')!)
  assert.match(ch1, /<caption>Lista de control\/puntuación<\/caption>\s*<thead>\s*<tr><th scope="col">Sí<\/th>/)
  const ec = epubcheck(built.epub)
  if (ec) assert.deepEqual(ec.errors, [], ec.output)
})
