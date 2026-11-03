import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { resolve, basename } from 'node:path'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { classifyStyleName } from '../src/engine/structure/dict.ts'
import { unzip } from '../src/engine/zip.ts'
import { analyze, build } from '../src/engine/indesign/build.ts'
import { openSpec, applySpec, applyBookDetailsToSpec } from '../src/engine/spec/session.ts'
import { readRequirements } from '../src/engine/spec/requirements.ts'
import { setSettings, DEFAULT_SETTINGS } from '../src/engine/settings.ts'
import { PNG } from './fixtures/indesign-export.ts'

afterEach(() => setSettings(DEFAULT_SETTINGS))

test('REQ 1: Multilingual chapter and part style name recognition (de, fr, es, pt, it, nl, pl, ru, etc.)', () => {
  // German (de)
  assert.equal(classifyStyleName('Kapitel')?.role, 'chapter-title')
  assert.equal(classifyStyleName('Kapitel 1')?.role, 'chapter-title')
  assert.equal(classifyStyleName('Kapitelüberschrift')?.role, 'chapter-title')
  assert.equal(classifyStyleName('Kapitelzahl')?.role, 'chapter-label')
  assert.equal(classifyStyleName('Kapitelnummer')?.role, 'chapter-label')
  assert.equal(classifyStyleName('Kapitel_Nr')?.role, 'chapter-label')
  assert.equal(classifyStyleName('Teil 1')?.role, 'part-title')
  assert.equal(classifyStyleName('Teilzahl')?.role, 'part-label')

  // French (fr)
  assert.equal(classifyStyleName('Chapitre')?.role, 'chapter-title')
  assert.equal(classifyStyleName('Chapitre 1')?.role, 'chapter-title')
  assert.equal(classifyStyleName('Titre-Chapitre')?.role, 'chapter-title')
  assert.equal(classifyStyleName('Numero-Chapitre')?.role, 'chapter-label')
  assert.equal(classifyStyleName('Partie 1')?.role, 'part-title')

  // Spanish (es)
  assert.equal(classifyStyleName('Capítulo')?.role, 'chapter-title')
  assert.equal(classifyStyleName('Capitulo 1')?.role, 'chapter-title')
  assert.equal(classifyStyleName('Titulo-Capitulo')?.role, 'chapter-title')
  assert.equal(classifyStyleName('Numero-Capitulo')?.role, 'chapter-label')
  assert.equal(classifyStyleName('Parte 1')?.role, 'part-title')

  // Portuguese (pt)
  assert.equal(classifyStyleName('CAPITULO')?.role, 'chapter-title')
  assert.equal(classifyStyleName('Capítulo 1')?.role, 'chapter-title')
  assert.equal(classifyStyleName('Titulo-Capitulo')?.role, 'chapter-title')
  assert.equal(classifyStyleName('Parte 1')?.role, 'part-title')

  // Italian (it)
  assert.equal(classifyStyleName('Capitolo')?.role, 'chapter-title')
  assert.equal(classifyStyleName('Capitolo 1')?.role, 'chapter-title')
  assert.equal(classifyStyleName('Titolo-Capitolo')?.role, 'chapter-title')
  assert.equal(classifyStyleName('Numero-Capitolo')?.role, 'chapter-label')
  assert.equal(classifyStyleName('Parte 1')?.role, 'part-title')

  // Dutch (nl)
  assert.equal(classifyStyleName('Hoofdstuk')?.role, 'chapter-title')
  assert.equal(classifyStyleName('Hoofdstuk 1')?.role, 'chapter-title')
  assert.equal(classifyStyleName('Deel 1')?.role, 'part-title')

  // Polish (pl)
  assert.equal(classifyStyleName('Rozdział')?.role, 'chapter-title')
  assert.equal(classifyStyleName('Rozdzial 1')?.role, 'chapter-title')
  assert.equal(classifyStyleName('Część 1')?.role, 'part-title')
  assert.equal(classifyStyleName('Czesc 1')?.role, 'part-title')

  // Russian (ru)
  assert.equal(classifyStyleName('Глава')?.role, 'chapter-title')
  assert.equal(classifyStyleName('Глава 1')?.role, 'chapter-title')
  assert.equal(classifyStyleName('Часть 1')?.role, 'part-title')

  // Czech, Hungarian, Finnish, Norwegian, Turkish, Vietnamese, CJK, Hangul
  assert.equal(classifyStyleName('Kapitola 1')?.role, 'chapter-title')
  assert.equal(classifyStyleName('Fejezet 1')?.role, 'chapter-title')
  assert.equal(classifyStyleName('Luku 1')?.role, 'chapter-title')
  assert.equal(classifyStyleName('Kapittel 1')?.role, 'chapter-title')
  assert.equal(classifyStyleName('Bölüm 1')?.role, 'chapter-title')
  assert.equal(classifyStyleName('Bolum 1')?.role, 'chapter-title')
  assert.equal(classifyStyleName('Chương 1')?.role, 'chapter-title')
  assert.equal(classifyStyleName('Chuong 1')?.role, 'chapter-title')
  assert.equal(classifyStyleName('第1章')?.role, 'chapter-title')
  assert.equal(classifyStyleName('1章')?.role, 'chapter-title')
  assert.equal(classifyStyleName('장1')?.role, 'chapter-title')
  assert.equal(classifyStyleName('제1장')?.role, 'chapter-title')

  // Short tokens & CT/CN/ChapterTitle forms
  assert.equal(classifyStyleName('CT')?.role, 'chapter-title')
  assert.equal(classifyStyleName('CT_01')?.role, 'chapter-title')
  assert.equal(classifyStyleName('CN')?.role, 'chapter-label')
  assert.equal(classifyStyleName('CN_01')?.role, 'chapter-label')
  assert.equal(classifyStyleName('ChapterTitle')?.role, 'chapter-title')
  assert.equal(classifyStyleName('Chapter-Title')?.role, 'chapter-title')
  assert.equal(classifyStyleName('ChapterNumber')?.role, 'chapter-label')
  assert.equal(classifyStyleName('Chapter-Number')?.role, 'chapter-label')
  assert.equal(classifyStyleName('ch 1')?.role, 'chapter-title')
  assert.equal(classifyStyleName('ch_01')?.role, 'chapter-title')
  assert.equal(classifyStyleName('chap 1')?.role, 'chapter-title')
  assert.equal(classifyStyleName('cap 1')?.role, 'chapter-title')
  assert.equal(classifyStyleName('PT')?.role, 'part-title')
  assert.equal(classifyStyleName('PN')?.role, 'part-label')
})

test('REQ 1: Negative tests - subheadings never match chapter; short tokens match whole only', () => {
  // Subheading prefixes & forms
  assert.equal(classifyStyleName('SUB-CAPITULO')?.role, 'h2')
  assert.equal(classifyStyleName('Subcapitulo')?.role, 'h2')
  assert.equal(classifyStyleName('Sub-Capitulo 2')?.role, 'h3')
  assert.equal(classifyStyleName('Subchapter')?.role, 'h2')
  assert.equal(classifyStyleName('Sub-Chapter')?.role, 'h2')
  assert.equal(classifyStyleName('Subchap')?.role, 'h2')
  assert.equal(classifyStyleName('subch')?.role, 'h2')
  assert.equal(classifyStyleName('Sous-chapitre')?.role, 'h2')
  assert.equal(classifyStyleName('souschapitre')?.role, 'h2')
  assert.equal(classifyStyleName('Unterkapitel')?.role, 'h2')
  assert.equal(classifyStyleName('unter-kapitel')?.role, 'h2')
  assert.equal(classifyStyleName('Sottocapitolo')?.role, 'h2')
  assert.equal(classifyStyleName('sotto-capitolo')?.role, 'h2')
  assert.equal(classifyStyleName('Section 1')?.role, 'h2')
  assert.equal(classifyStyleName('Seccao 1')?.role, 'h2')
  assert.equal(classifyStyleName('Secção 2')?.role, 'h3')
  assert.equal(classifyStyleName('Seção 1')?.role, 'h2')
  assert.equal(classifyStyleName('Abschnitt')?.role, 'h2')
  assert.equal(classifyStyleName('Sezione 1')?.role, 'h2')
  assert.equal(classifyStyleName('Sekcja 1')?.role, 'h2')
  assert.equal(classifyStyleName('Zwischentitel')?.role, 'h3')
  assert.equal(classifyStyleName('zt')?.role, 'h3')

  // Short tokens must NOT match partial words
  assert.notEqual(classifyStyleName('church')?.role, 'chapter-title')
  assert.notEqual(classifyStyleName('church')?.role, 'chapter-label')
  assert.notEqual(classifyStyleName('caption')?.role, 'chapter-title')
  assert.notEqual(classifyStyleName('capital')?.role, 'chapter-title')
  assert.notEqual(classifyStyleName('action')?.role, 'chapter-title')
  assert.notEqual(classifyStyleName('actor')?.role, 'chapter-title')
  assert.notEqual(classifyStyleName('character')?.role, 'chapter-title')
  assert.notEqual(classifyStyleName('chat')?.role, 'chapter-title')
  assert.notEqual(classifyStyleName('capa')?.role, 'chapter-title')
  assert.notEqual(classifyStyleName('participante')?.role, 'part-title')
  assert.notEqual(classifyStyleName('particular')?.role, 'part-title')
})

const CHAPSPLIT_DIR = process.env.CHAPSPLIT_DIR || 'C:/Users/acer/AppData/Local/Temp/chapsplit'
const hasClientDir = existsSync(CHAPSPLIT_DIR)
const clientFiles = hasClientDir ? readdirSync(CHAPSPLIT_DIR) : []
const clientEpub = clientFiles.find((f) => f.endsWith('.epub'))
const clientPdf = clientFiles.find((f) => f.endsWith('.pdf'))
const clientCover = clientFiles.find((f) => f.endsWith('.jpg') || f.endsWith('.png'))
const clientSheet = clientFiles.find((f) => f.endsWith('.xlsx'))
const canRunClientTest = hasClientDir && !!clientEpub

const EXPECTED_STEMS = [
  'cover',
  'fm01',
  'copy',
  'title',
  'toc',
  'intro',
  'chapter01',
  'chapter02',
  'chapter03',
  'chapter04',
  'chapter05',
  'chapter06',
  'chapter07',
  'chapter08',
  'bib',
]

test('Regression: InDesign chapter split on client book WITHOUT sheet', { skip: !canRunClientTest && 'client files missing' }, async () => {
  const epubPath = resolve(CHAPSPLIT_DIR, clientEpub!)
  const coverPath = clientCover ? resolve(CHAPSPLIT_DIR, clientCover) : undefined
  const cover = coverPath ? { name: basename(coverPath), data: new Uint8Array(readFileSync(coverPath)) } : undefined

  const a = analyze(unzip(new Uint8Array(readFileSync(epubPath))))
  const r = build(a, { styles: a.styles, images: a.images, meta: { ...a.meta }, cover })
  const stems = ['cover', ...r.sections.map((s) => s.file.replace(/\.xhtml$/i, ''))]

  assert.deepEqual(stems, EXPECTED_STEMS, 'file manifest matches expected list without sheet')

  // No bm files
  const bmFiles = r.sections.filter((s) => s.file.startsWith('bm'))
  assert.equal(bmFiles.length, 0, 'no bm<n>.xhtml files must be created')

  // 1.x subsections inside their chapter
  const ch1 = r.sections.find((s) => s.file === 'chapter01.xhtml')
  assert.ok(ch1, 'chapter01.xhtml exists')
  assert.match(ch1.body, /1\.[1-6]\s+/, '1.x subsections must remain inside chapter 1')

  const ch2 = r.sections.find((s) => s.file === 'chapter02.xhtml')
  assert.ok(ch2, 'chapter02.xhtml exists')
  assert.match(ch2.body, /2\.[1-4]\s+/, '2.x subsections must remain inside chapter 2')
})

test('Regression: InDesign chapter split on client book WITH Book_Details sheet', { skip: (!canRunClientTest || !clientSheet) && 'client files or sheet missing' }, async () => {
  const epubPath = resolve(CHAPSPLIT_DIR, clientEpub!)
  const coverPath = clientCover ? resolve(CHAPSPLIT_DIR, clientCover) : undefined
  const cover = coverPath ? { name: basename(coverPath), data: new Uint8Array(readFileSync(coverPath)) } : undefined
  const sheetPath = resolve(CHAPSPLIT_DIR, clientSheet!)

  const a = analyze(unzip(new Uint8Array(readFileSync(epubPath))))
  let spec = await openSpec({ client: a.meta.publisher, series: '', book: a.meta.title }, DEFAULT_SETTINGS)
  const bd = readRequirements(basename(sheetPath), new Uint8Array(readFileSync(sheetPath))).bookDetails!
  spec = await applyBookDetailsToSpec(spec, 'book', bd, 'headless')
  applySpec(spec)

  const r = build(a, { styles: a.styles, images: a.images, meta: { ...a.meta }, cover })
  const stems = ['cover', ...r.sections.map((s) => s.file.replace(/\.xhtml$/i, ''))]

  assert.deepEqual(stems, EXPECTED_STEMS, 'file manifest matches expected list with Book_Details')

  // No bm files
  const bmFiles = r.sections.filter((s) => s.file.startsWith('bm'))
  assert.equal(bmFiles.length, 0, 'no bm<n>.xhtml files must be created')

  // 1.x subsections inside their chapter
  const ch1 = r.sections.find((s) => s.file === 'chapter01.xhtml')
  assert.ok(ch1, 'chapter01.xhtml exists')
  assert.match(ch1.body, /1\.[1-6]\s+/, '1.x subsections must remain inside chapter 1')
})


test('REQ 4: Safety net: no chapters but >3 unrecognised bm sections generates level error review item', () => {
  const meta = {
    title: 'Test Book',
    subtitle: '',
    authors: 'Test Author',
    publisher: 'Test Publisher',
    language: 'en',
    eisbn: '978-0-306-40615-7',
    printIsbn: '',
    rights: 'Copyright 2026',
    certifiedBy: '',
    conformsTo: '',
  }

  // Create synthetic analysis where blocks are section-title with no known section type (unknown generic bm)
  const syntheticDoc = `<?xml version="1.0" encoding="utf-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><link rel="stylesheet" href="style.css"/></head>
<body>
  <p class="unnamed-bm">Introduction</p><p class="body">Intro text</p>
  <p class="unnamed-bm">Section One</p><p class="body">Text 1</p>
  <p class="unnamed-bm">Section Two</p><p class="body">Text 2</p>
  <p class="unnamed-bm">Section Three</p><p class="body">Text 3</p>
  <p class="unnamed-bm">Section Four</p><p class="body">Text 4</p>
</body></html>`

  const files = new Map<string, Uint8Array>()
  files.set('META-INF/container.xml', new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`))
  files.set('OEBPS/content.opf', new TextEncoder().encode(`<?xml version="1.0"?><package version="3.0" unique-identifier="pub-id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Test Book</dc:title><dc:language>en</dc:language></metadata><manifest><item id="t1" href="text1.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="t1"/></spine></package>`))
  files.set('OEBPS/style.css', new TextEncoder().encode(`.unnamed-bm { font-size: 1.5em; text-align: center; } .body { font-size: 1em; }`))
  files.set('OEBPS/text1.xhtml', new TextEncoder().encode(syntheticDoc))

  const a = analyze(files)
  // Force unnamed-bm role to section-title so it opens generic other sections without chapters
  const styles = a.styles.map((s) => (s.key === 'unnamed-bm' ? { ...s, role: 'section-title' as const } : s))
  const r = build(a, { styles, images: [], meta, cover: { name: 'cover.png', data: PNG } })

  const errors = r.review.filter((x) => x.level === 'error' && x.msg.includes('No chapters found'))
  assert.equal(errors.length, 1, 'level error review item pushed when no chapters and >3 bm sections exist')
})
