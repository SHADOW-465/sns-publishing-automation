// Regressions found on the Fire Mission Vietnam sample (REGR-1 to REGR-5).
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { zipSync, strToU8 } from 'fflate'
import { text } from '../src/engine/zip.ts'
import { readWordBook } from '../src/engine/wordepub/read.ts'
import { buildWordEpub } from '../src/engine/wordepub/build.ts'
import { setSettings, DEFAULT_SETTINGS } from '../src/engine/settings.ts'
import type { BookMeta } from '../src/engine/epub/package.ts'
import { continuesIndexLine, linkIndexLocators } from '../src/engine/pdfua/indexlinks.ts'
import { isBoldFont, isItalicFont } from '../src/engine/pdf/layout.ts'

test('REGR-1: only a line of numbers, commas and dashes continues the previous index line', () => {
  assert.equal(continuesIndexLine('42, 44, 77'), true)
  assert.equal(continuesIndexLine('174–8'), true)
  assert.equal(continuesIndexLine('12 - 14'), true)
  assert.equal(continuesIndexLine('101st Field Battery 21, 24'), false, 'a new entry that starts with a digit')
  assert.equal(continuesIndexLine('1st Australian Task Force (1ATF) 42'), false)
  assert.equal(continuesIndexLine('12 passim'), false)
  assert.equal(continuesIndexLine(''), false)
})

test('REGR-2: an abbreviated index range is written out in full and only its first number is a link', () => {
  assert.equal(linkIndexLocators('Australia, return to 174–8, 180'), 'Australia, return to <a href="#pg:174">174</a>–178, <a href="#pg:180">180</a>')
  assert.equal(linkIndexLocators('Rome, 266-69'), 'Rome, <a href="#pg:266">266</a>-269')
  assert.equal(linkIndexLocators('Edge, 199-02'), 'Edge, <a href="#pg:199">199</a>-202')
  assert.equal(linkIndexLocators('Full, 192–195'), 'Full, <a href="#pg:192">192</a>–195', 'a range already in full is left as printed')
})

test('REGR-3: bold and italic font names are recognised whatever their case', () => {
  for (const f of ['ZUHANU+AGaramondPro-Italic', 'AGaramondPro-ITALIC', 'Minion-Oblique', 'MinionPro-It', 'Arial,Italic']) assert.equal(isItalicFont(f), true, f)
  for (const f of ['AGaramondPro-Regular', 'Italian-Text', 'Summit', 'FuturaPT-Book']) assert.equal(isItalicFont(f), false, f)
  for (const f of ['AGaramondPro-Bold', 'AGARAMONDPRO-BOLD', 'FuturaPT-Demi', 'Arial-BoldMT', 'Myriad-SEMIBOLD']) assert.equal(isBoldFont(f), true, f)
  for (const f of ['AGaramondPro-Regular', 'FuturaPT-Book', 'FuturaPT-Medium']) assert.equal(isBoldFont(f), false, f)
})

test('REGR-3: a page number set in italic or bold in the index is still a link', () => {
  assert.equal(linkIndexLocators('Australia, 174–8, <em>174</em>'), 'Australia, <a href="#pg:174">174</a>–178, <em><a href="#pg:174">174</a></em>')
  assert.equal(linkIndexLocators('Arbuthnot 45–7, <em>47–9</em>, <strong>94</strong>'), 'Arbuthnot <a href="#pg:45">45</a>–47, <em><a href="#pg:47">47</a>–49</em>, <strong><a href="#pg:94">94</a></strong>')
  assert.equal(linkIndexLocators('aircraft <em>see by name</em>'), 'aircraft <em>see by name</em>')
})

// ---- REGR-4: Word pages and index ------------------------------------------------------------------------
const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const COVER = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))
const meta: BookMeta = { title: 'Prueba', subtitle: '', authors: 'Autora', publisher: 'Editorial', language: 'en', eisbn: '9780306406157', printIsbn: '', rights: '', certifiedBy: '', conformsTo: '' }
const styles = `<?xml version="1.0"?><w:styles xmlns:w="${W}"><w:style w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:outlineLvl w:val="0"/></w:pPr></w:style></w:styles>`
const p = (inner: string, pPr = '') => `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${inner}</w:p>`
const run = (t: string) => `<w:r><w:t xml:space="preserve">${t}</w:t></w:r>`
const h1 = (t: string) => p(run(t), '<w:pStyle w:val="Heading1"/>')
/** the paragraph that ends a section; its sectPr says how that section starts: on a new page, unless it is `continuous` */
const sect = (own = '') => p('', `<w:sectPr>${own}<w:pgSz w:w="8680" w:h="13270"/></w:sectPr>`)
const doc = (body: string, last = '') => zipSync({ 'word/document.xml': strToU8(`<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>${body}<w:sectPr>${last}<w:pgSz w:w="8680" w:h="13270"/></w:sectPr></w:body></w:document>`), 'word/styles.xml': strToU8(styles) })
const htmlOf = (b: ReturnType<typeof buildWordEpub>) => [...b.files].filter(([f]) => f.endsWith('.xhtml')).map(([, d]) => text(d)).join('\n')
const sentence = 'the quick brown fox jumps over the lazy dog near the river bank today'
const second = 'public policy in the valley starts inside this table cell and continues onward'
afterEach(() => setSettings(DEFAULT_SETTINGS))

test('REGR-4: PG-02 on, a Word file with no page breaks takes its page ids from the print PDF; off, it gets none', () => {
  const body = h1('Chapter one') + p(run(sentence + ' and then the chapter goes on with ordinary words.')) + p(run(second + ' and the rest of the printed page follows here'))
  const pages = [{ n: '40', text: `${sentence} extra words that belong to the printed page` }, { n: '42', text: `${second} and the rest of the printed page follows here` }]
  const on = htmlOf(buildWordEpub(readWordBook(doc(body)), { meta, cover: { name: 'cover.png', data: COVER }, printPages: pages }))
  assert.match(on, /id="page-40"/)
  assert.match(on, /id="page-42"/)
  setSettings({ ...DEFAULT_SETTINGS, wordPagesFromPdf: false })
  const off = htmlOf(buildWordEpub(readWordBook(doc(body)), { meta, cover: { name: 'cover.png', data: COVER }, printPages: pages }))
  assert.doesNotMatch(off, /id="page-/)
  setSettings(DEFAULT_SETTINGS)
  const broken = h1('Chapter one') + p(run(sentence + ' ends here.') + '<w:r><w:br w:type="page"/></w:r>') + p(run(second))
  const own = htmlOf(buildWordEpub(readWordBook(doc(broken)), { meta, cover: { name: 'cover.png', data: COVER }, printPages: pages }))
  assert.doesNotMatch(own, /id="page-(40|42)"/, 'a manuscript with its own page breaks keeps them, the PDF is not used')
  assert.match(own, /id="page-1"/)
})

test('REGR-4: a next-page section break is a page break for the page ids; a continuous one is not', () => {
  const body = h1('Chapter one') + p(run('First page text.')) + sect()
    + p(run('Second page text.')) + sect()
    + p(run('Third page text.')) + sect()
    + p(run('Still the third page.')) + sect('<w:type w:val="continuous"/>')
    + p(run('Page nine text.'))
  const book = readWordBook(doc(body, '<w:pgNumType w:start="9"/>'))
  const marks = book.blocks.flatMap((b) => ('inlines' in b ? b.inlines : [])).filter((i) => i.t === 'page').map((i) => i.text)
  assert.deepEqual(marks, ['1', '2', '9'], 'three next-page breaks and one continuous break; the last section starts at page 9')
  const html = htmlOf(buildWordEpub(book, { meta, cover: { name: 'cover.png', data: COVER } }))
  assert.match(html, /id="page-1"[^>]*\/>Second page text/)
  assert.match(html, /id="page-2"[^>]*\/>Third page text/)
  assert.match(html, /id="page-9"[^>]*\/>Page nine text/)
  assert.doesNotMatch(html, /\/>Still the third page/)
})

test('REGR-4: page numbers matched in the print PDF win over the ones counted from section breaks', () => {
  const body = h1('Chapter one') + p(run(sentence + ' and then the chapter goes on with ordinary words.')) + sect()
    + p(run(second + ' and the rest of the printed page follows here')) + sect() + p(run('Closing words of the book.'))
  const pages = [{ n: '40', text: `${sentence} extra words that belong to the printed page` }, { n: '42', text: `${second} and the rest of the printed page follows here` }]
  const html = htmlOf(buildWordEpub(readWordBook(doc(body)), { meta, cover: { name: 'cover.png', data: COVER }, printPages: pages }))
  assert.match(html, /id="page-40"/)
  assert.match(html, /id="page-42"/)
  assert.doesNotMatch(html, /id="page-(1|2)"/, 'the counted numbers are replaced, not added')
  const none = htmlOf(buildWordEpub(readWordBook(doc(body)), { meta, cover: { name: 'cover.png', data: COVER }, printPages: [{ n: '7', text: 'text that is nowhere in the manuscript at all, so no page matches' }] }))
  assert.match(none, /id="page-1"/, 'a PDF that matches nothing leaves the counted numbers')
})
