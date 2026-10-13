// Unit tests for the general rules (no sample files needed): page numbering, name and title
// casing, text extraction, and the quality check catching the faults seen in real deliveries.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fillNumbers } from '../src/engine/pdf/numbers.ts'
import { nameCase, titleCaseFor, FILEISH } from '../src/engine/indesign/front.ts'
import { textOf } from '../src/engine/xml.ts'
import { checkEpub, wordsOf } from '../src/engine/check/epub.ts'
import { bytes, type Files } from '../src/engine/zip.ts'

test('page numbers: a stray number on a contents page does not shift the whole front matter', () => {
  // PDF pages 0–9 have no folio except a "16" at the top of the contents (index 9); the text starts at page 11
  const folios = [undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, 16, undefined, 12, 13, 14, 15, 16, 17]
  assert.deepEqual(fillNumbers(folios).slice(0, 12), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  // arabic numbering starting at 1 after unnumbered front pages: those get roman numerals
  assert.deepEqual(fillNumbers([undefined, undefined, undefined, 2, 3, 4]), ['i', 'ii', 1, 2, 3, 4])
})

test('names and titles from capitals', () => {
  assert.equal(nameCase('ELENA CHÁVEZ'), 'Elena Chávez')
  assert.equal(nameCase('ANA MARÍA DE LA FUENTE'), 'Ana María de la Fuente')
  assert.equal(nameCase('RJ SPINA'), 'RJ Spina')
  assert.equal(nameCase('J. R. R. TOLKIEN'), 'J. R. R. Tolkien')
  assert.equal(titleCaseFor('LA CARA OCULTA DE SHEINBAUM', 'es'), 'La cara oculta de sheinbaum')
  assert.equal(titleCaseFor('THE HIDDEN FACE OF THE CITY', 'en'), 'The Hidden Face of the City')
  assert.ok(FILEISH.test('La cara oculta de la presidenta_Grijalbo'))
  assert.ok(!FILEISH.test('Cambia tu mente'))
})

test('text extraction: line breaks are spaces, soft hyphens vanish', () => {
  const p = new DOMParser().parseFromString('<p xmlns="http://www.w3.org/1999/xhtml">LA CARA OCULTA<br/>DE SHEINBAUM go­bierno</p>', 'application/xhtml+xml').documentElement
  assert.equal(textOf(p), 'LA CARA OCULTA DE SHEINBAUM gobierno')
  assert.deepEqual(wordsOf('go­bierno, 2026 ¿Qué?'), ['gobierno', 'qué'])
})

/** a minimal EPUB with the faults found in the first Vercel test delivery */
function faulty(): Files {
  const x = (body: string) => `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="es" xml:lang="es"><head><title>t</title></head><body>${body}</body></html>`
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 10, 0, 0, 0, 10])
  return new Map([
    ['mimetype', bytes('application/epub+zip')],
    ['META-INF/container.xml', bytes('<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')],
    ['OEBPS/content.opf', bytes(`<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:isbn:9786073880244</dc:identifier><dc:title>La cara oculta de la presidenta_Grijalbo</dc:title><dc:language>es-ES</dc:language><dc:creator>LA CARA OCULTADE SHEINBAUM</dc:creator><dc:publisher></dc:publisher><meta property="dcterms:modified">2026-09-24T12:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="cv" href="images/cover.jpg" media-type="image/jpeg" properties="cover-image"/></manifest><spine><itemref idref="c1"/></spine></package>`)],
    ['OEBPS/nav.xhtml', bytes(x('<nav epub:type="toc"><ol><li><a href="c1.xhtml">2.</a></li></ol></nav><nav epub:type="landmarks"><ol><li><a epub:type="toc" href="nav.xhtml">Índice</a></li></ol></nav>'))],
    ['OEBPS/c1.xhtml', bytes(x('<section epub:type="chapter"><h2>Uno</h2><p>Texto del capítulo con suficientes palabras.</p><p><img src="images/cover.jpg" alt=""/></p></section>'))],
    ['OEBPS/images/cover.jpg', png],
  ])
}

test('quality check catches the faults of the first test delivery', () => {
  const r = checkEpub(faulty(), { words: wordsOf('Uno Texto del capítulo con suficientes palabras y una frase perdida en la conversión') })
  const all = r.groups.flatMap((g) => g.findings.map((f) => `${f.level} ${f.msg}`)).join('\n')
  assert.match(all, /error Empty <dc:publisher>/)
  assert.match(all, /error .*really a PNG image but is declared as image\/jpeg/)
  assert.match(all, /warn .*PNG image with the wrong file extension/)
  assert.match(all, /error Link "nav.xhtml" points to a file that is not in the reading order/)
  assert.match(all, /error Title “La cara oculta de la presidenta_Grijalbo” looks like a file name/)
  assert.match(all, /warn Author “LA CARA OCULTADE SHEINBAUM” is in capitals/)
  assert.match(all, /warn Navigation entries with only a number \(2\.\)/)
  assert.match(all, /error Picture images\/cover.jpg has no description/)
  assert.match(all, /source words .* not in the e-book|source word\(s\) not found/)
  assert.ok(r.errors >= 5)
})

/** An accessible book that looks finished but has the faults the checker used to call "passed". */
function hollow(): Files {
  const x = (body: string) => `<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="de" xml:lang="de"><head><title>t</title></head><body>${body}</body></html>`
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 10, 0, 0, 0, 10])
  const meta = [
    '<meta property="schema:accessMode">textual</meta>',
    '<meta property="schema:accessibilityFeature">alternativeText</meta>',
    '<meta property="schema:accessibilityHazard">none</meta>',
    '<meta property="schema:accessibilitySummary">Text</meta>',
    '<meta property="schema:accessModeSufficient">textual</meta>',
    '<meta property="dcterms:conformsTo">EPUB Accessibility 1.1</meta>',
  ].join('')
  const opf = `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:isbn:9780306406157</dc:identifier><dc:source>urn:isbn:</dc:source><dc:title>Das Tempelhofer Feld</dc:title><dc:language>de-DE</dc:language><dc:creator>Bjoern Weigel</dc:creator><dc:publisher>BeBra Verlag</dc:publisher><meta property="dcterms:modified">2026-10-13T12:00:00Z</meta>${meta}</metadata><manifest><item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="cv" href="images/cover.png" media-type="image/png" properties="cover-image"/><item id="a" href="images/a.png" media-type="image/png"/><item id="b" href="images/b.png" media-type="image/png"/><item id="c" href="images/c.png" media-type="image/png"/><item id="d" href="images/d.png" media-type="image/png"/><item id="lost" href="images/lost.png" media-type="image/png"/></manifest><spine><itemref idref="c1"/></spine></package>`
  return new Map([
    ['mimetype', bytes('application/epub+zip')],
    ['META-INF/container.xml', bytes('<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')],
    ['OEBPS/content.opf', bytes(opf)],
    ['OEBPS/nav.xhtml', bytes(x('<nav epub:type="toc"><ol><li><a href="c1.xhtml">Inhalt</a></li><li><a href="c1.xhtml">Impressum</a></li></ol></nav>'))],
    ['OEBPS/c1.xhtml', bytes(x('<p>Ein Absatz ohne Überschrift und mit genug Wörtern für den Text.</p><p><img src="images/a.png" alt="Bild"/><img src="images/b.png" alt="Beschreibung von KI generiert"/><img src="images/c.png" alt="[Fehler: kein Alternativtext]"/><img src="images/d.png"/></p>'))],
    ['OEBPS/images/cover.png', png],
    ['OEBPS/images/a.png', png],
    ['OEBPS/images/b.png', png],
    ['OEBPS/images/c.png', png],
    ['OEBPS/images/d.png', png],
    ['OEBPS/images/lost.png', png],
  ])
}

test('quality check fails when headings, contents, ISBN or picture text are missing', () => {
  const r = checkEpub(hollow(), { printIsbn: '978-3-8148-0356-2' })
  const all = r.groups.flatMap((g) => g.findings.map((f) => `${f.level} ${f.msg}`)).join('\n')
  assert.match(all, /error The book has no headings at all/)
  assert.match(all, /error The table of contents does not list the chapters/)
  assert.match(all, /error E-book ISBN\s+is not a valid ISBN-13/)
  assert.match(all, /error Picture description "Bild" is not a real description/)
  assert.match(all, /error Picture description "Beschreibung von KI generiert" is not a real description/)
  assert.match(all, /error Picture description "\[Fehler: kein Alternativtext\]" is not a real description/)
  assert.match(all, /error Picture images\/d\.png has no alt attribute/)
  assert.match(all, /error Image lost\.png is in the package but never placed in the book/)
  assert.match(all, /error Printed ISBN 978-3-8148-0356-2 is not recorded in the e-book/)
  assert.doesNotMatch(all, /headings, picture descriptions, navigation/)
  assert.ok(r.errors >= 9)
})

test('house settings: own print-only phrases and reader labels', async () => {
  const { setSettings, isHousePrintOnly, DEFAULT_SETTINGS } = await import('../src/engine/settings.ts')
  const { labelsFor } = await import('../src/engine/epub/locale.ts')
  setSettings({ printOnly: ['papel ecológico'], labels: { es: { copyright: 'Página de créditos' } } })
  assert.ok(isHousePrintOnly('Impreso en PAPEL ECOLÓGICO certificado'))
  assert.ok(!isHousePrintOnly('Primera edición: 2026'))
  assert.equal(labelsFor('es-ES').copyright, 'Página de créditos')
  assert.equal(labelsFor('es-ES').cover, 'Cubierta') // untouched labels keep the default
  setSettings(DEFAULT_SETTINGS)
  assert.equal(labelsFor('es-ES').copyright, 'Créditos')
})
