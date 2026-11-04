// ISBN text as it arrives from a client's workbook or a PDF: dash and space look-alikes (U+2011 non-breaking hyphen, en dash,
// no-break space…) read as the ASCII ones, the printed separators of the print ISBN are kept, and the e-ISBN follows them.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normaliseIsbnChars, transformImprint, rulesFor, formatLike } from '../src/engine/epub/imprint.ts'
import { isbn13Valid, bookUid, epubFileName } from '../src/engine/epub/package.ts'
import { bookDetailsFromWorkbook } from '../src/engine/spec/bookdetails.ts'

const esc = (s: string) => s
const NB = '‑' // non-breaking hyphen
const NBSP = ' '

test('ISBN characters: dash and space look-alikes read as "-" and " "; digits never change', () => {
  assert.equal(normaliseIsbnChars(`978${NB}0${NB}7198${NB}4712${NB}7`), '978-0-7198-4712-7')
  assert.equal(normaliseIsbnChars(`978${NBSP}0–7198–4712‑7`), '978 0-7198-4712-7')
  assert.equal(normaliseIsbnChars('978–0—7198−4712–7'), '978-0-7198-4712-7', 'en dash, em dash and minus all read as "-"')
  assert.equal(normaliseIsbnChars('978­0​7198'), '97807198', 'soft hyphen and zero-width marks are dropped')
})

test('e-ISBN with a non-breaking hyphen: valid, and the copyright page shows it with ASCII hyphens', () => {
  const eisbn = `978${NB}0${NB}7198${NB}4712${NB}7`
  assert.ok(isbn13Valid(eisbn), 'the check digit reads through the look-alike hyphens')
  const r = transformImprint([{ html: 'ISBN 978 0 7198 4711 0', text: 'ISBN 978 0 7198 4711 0', gap: true }], { eisbn, rules: rulesFor('en'), author: 'Jo', year: '2026', esc })
  assert.equal(r.paras[0].html, 'ISBN 978-0-7198-4712-7', 'an e-ISBN with its own separators is shown as given, in ASCII')
  assert.ok(!r.paras[0].html.includes(NB))
})

test('e-ISBN without separators takes the print ISBN\'s style, also when the print line has no-break spaces', () => {
  const r = transformImprint([{ html: 'ISBN 978 0 7198 4711 0', text: `ISBN 978${NBSP}0${NBSP}7198${NBSP}4711${NBSP}0`, gap: true }], { eisbn: '9780719847127', rules: rulesFor('en'), author: 'Jo', year: '2026', esc })
  assert.equal(r.paras[0].html, 'ISBN 978 0 7198 4712 7')
  assert.equal(formatLike('9780719847127', '978 0 7198 4711 0'), '978 0 7198 4712 7')
})

test('Book_Details e-ISBN with no-break space and U+2011 is read clean and checks as a valid ISBN-13', () => {
  const d = bookDetailsFromWorkbook([
    { name: 'metadata', rows: [['EISBN:', `978${NBSP}0${NB}7198${NB}4712${NB}7`]] },
    { name: 'NAV-NCX', rows: [['Chapter Name', 'Level', 'Title'], ['chapter01.xhtml', '1', 'One']] },
  ])!
  assert.equal(d.eisbn, '978 0-7198-4712-7')
  assert.ok(isbn13Valid(d.eisbn))
})

test('the print ISBN keeps its printed separators (Contemporary Ceramics reads "978 0 7198 4711 0", not digits)', () => {
  // the same pattern as the PDF and InDesign imprint readers: the match keeps spaces and hyphens
  const m = normaliseIsbnChars(`ISBN 978${NBSP}0${NBSP}7198${NBSP}4711${NBSP}0`).match(/i\.?\s?s\.?\s?b\.?\s?n[^\d]*([\d][\d -]{9,16}[\dxX])/i)?.[1]?.trim()
  assert.equal(m, '978 0 7198 4711 0')
})

test('e-ISBN: every dash and space look-alike, fullwidth digits and invisible marks read as the digits they stand for', () => {
  const digits = ['978', '0', '7198', '4712', '7']
  // hyphen, figure, en, em and minus signs, wave dash, small and fullwidth hyphen-minus
  for (const d of ['‐', '‒', '–', '—', '−', '〜', '﹣', '－']) assert.ok(isbn13Valid(digits.join(d)), `dash U+${d.codePointAt(0)!.toString(16)}`)
  // no-break, figure, thin, narrow no-break and ideographic spaces
  for (const sp of [' ', ' ', ' ', ' ', '　']) assert.ok(isbn13Valid(digits.join(sp)), `space U+${sp.codePointAt(0)!.toString(16)}`)
  assert.ok(isbn13Valid('９７８' + '0719847127'), 'fullwidth digits')
  assert.ok(isbn13Valid('978​0­7198﻿4712⁠7'), 'soft hyphen, zero-width space, word joiner and BOM are dropped')
  assert.equal(normaliseIsbnChars('９７８‒0 7198—4712−7'), '978-0 7198-4712-7')
  const eisbn = '978‑0 7198—4712−7'
  assert.equal(bookUid({ eisbn, title: 'x' }), 'urn:isbn:9780719847127', 'the book identifier is the plain ISBN')
  assert.equal(epubFileName({ eisbn, title: 'x' }), '9780719847127.epub', 'the download name is the plain ISBN')
  assert.equal(epubFileName({ eisbn: '978‑0‑7198‑4712‑8', title: 'Livro' }), 'NO-ISBN_Livro.epub', 'a wrong check digit is still refused')
})
