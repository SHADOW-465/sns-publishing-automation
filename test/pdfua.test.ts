// Regression test: tag both Accessible-PDF samples and read the result back the way assistive
// technology does. Skipped without the samples. (PAC stays the final, manual check.)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { PDFDocument } from 'pdf-lib'
import { analyzeUa, buildUa } from '../src/engine/pdfua/index.ts'
import { nodeRaster } from './raster-node.ts'
import { readTags } from './read-tags.ts'
import { AUTOMATION, has, read } from './samples.ts'

const D = resolve(AUTOMATION, 'Accessible-PDF-Automation')
const count = (tags: string[], role: string) => tags.filter((t) => new RegExp(`^p\\d+ +${role}\\b`).test(t)).length

test('Medium: German report with vector charts and footnotes', { skip: !has(D) && 'samples missing', timeout: 600_000 }, async () => {
  const a = await analyzeUa(pdfjs, nodeRaster, { main: read(resolve(D, 'Medium/Input/DD_Evers-Woelk_2124-6.pdf')), extras: [], altDocx: read(resolve(D, 'Medium/Input/AltTexte MEW.docx')) })
  // metadata as in the hand-made output
  assert.equal(a.meta.title, 'Vorwort zur 3. Aufl. »Neue elektronische Medien zwischen Suchtforschung, Künstlicher Intelligenz und digitaler Governance«')
  assert.equal(a.meta.author, 'Michaela Evers-Wölk / Michael Opielka')
  assert.equal(a.meta.lang, 'de')
  assert.equal(a.figures.length, 13)
  assert.ok(a.figures.every((f) => f.alt && f.thumb), 'every chart has alt text from the Word file and a preview')
  const r = await buildUa(a, { styles: a.styles, meta: a.meta, alt: Object.fromEntries(a.figures.map((f) => [f.key, f.alt])), cropToTrim: true, sourceName: 'DD_Evers-Woelk_2124-6.pdf' })
  assert.equal(r.fileName, 'DD_Evers-Woelk_2124-6.pdf')
  assert.deepEqual(r.review.filter((x) => x.level === 'error'), [])
  assert.equal(r.stats.unmatchedText, 0)
  const tags = await readTags(r.pdf, 1, 999)
  assert.deepEqual([1, 2, 3, 4].map((n) => count(tags, `H${n}`)), [13, 28, 36, 39])
  assert.equal(count(tags, 'Note'), 16) // the reference has 16 footnotes
  assert.equal(count(tags, 'Figure'), 13)
  assert.ok(count(tags, 'LBody') > 100, 'bullet lists are tagged as lists')
  assert.ok(count(tags, 'TOCI') >= 50)
})

test('Simple: book + cover image + plates PDF', { skip: !has(D) && 'samples missing', timeout: 600_000 }, async () => {
  const S = resolve(D, 'Simple/Input')
  const a = await analyzeUa(pdfjs, nodeRaster, {
    main: read(resolve(S, 'Gladiators in the Greek World.pdf')),
    extras: [read(resolve(S, 'Gladiators in the Greek World_Plates.pdf'))],
    cover: { data: read(resolve(S, 'cover.jpg')), png: false },
    altDocx: read(resolve(S, 'Gladiators in the Greek World alt text.docx')),
  })
  assert.equal(a.meta.title, 'Gladiators in the Greek World: How A Roman Blood Sport Took Ancient Greece By Storm')
  assert.equal(a.meta.author, 'Alexandra Sills')
  assert.equal(a.meta.lang, 'en')
  assert.equal(a.figures.length, 29)
  // everything but the publisher logo has alt text from the Word file
  assert.deepEqual(a.figures.filter((f) => !f.alt).map((f) => f.page), [3])
  const alt = Object.fromEntries(a.figures.map((f) => [f.key, f.alt || 'Pen & Sword History logo']))
  const r = await buildUa(a, { styles: a.styles, meta: { ...a.meta, isbn: '9781036130527' }, alt, cropToTrim: true, sourceName: 'Gladiators in the Greek World.pdf' })
  assert.equal(r.fileName, 'Gladiators in the Greek World_9781036130527.pdf') // as in the sample output
  assert.deepEqual(r.review.filter((x) => x.level === 'error'), [])
  assert.equal(r.stats.unmatchedText, 0)
  assert.equal((await PDFDocument.load(r.pdf)).getPageCount(), 361) // cover + 352 + 8 plates

  const tags = await readTags(r.pdf, 1, 361)
  assert.equal(count(tags, 'Figure'), 29)
  // title page: one heading, subtitle and author as text; slug notes ("[Page v]") dropped
  const p4 = tags.filter((t) => t.startsWith('p4 '))
  assert.equal(count(p4, 'H\\d'), 1)
  assert.ok(p4.includes('p4   P: How A Roman Blood Sport Took Ancient Greece By Storm') && p4.includes('p4   P: Alexandra Sills'))
  assert.ok(!p4.some((t) => /\[Page|: v$/.test(t)))
  // contents: roman page numbers end entries, "Chapter 1" joins its title, every entry links
  const toc = tags.filter((t) => t.startsWith('p6 ') && /TOCI:/.test(t)).map((t) => t.split('TOCI: ')[1])
  assert.deepEqual(toc.slice(0, 6), ['Foreword vi', 'Author’s Note viii', 'Glossary ix', 'Images xv', 'Prologue: Anything Rome Can Do, Greeks Can Do Better 1', 'Chapter 1 CSI: Arena 12'])
  assert.equal(count(tags.filter((t) => t.startsWith('p6 ')), 'Link'), toc.length)
  // chapter label joins the chapter heading
  assert.ok(tags.includes('p29   H1: Chapter 1 Arena'))
  // prose with a line-initial dash is not a list
  assert.equal(tags.filter((t) => /^p(2[0-8]) /.test(t) && /LBody/.test(t)).length, 0)
  // bibliography with hanging indents: one paragraph per entry
  assert.ok(tags.includes('p314   P: Vickers, M. (1972) ‘The Hippodrome at Thessaloniki’, The Journal of Roman Studies 62, 25-32'))
})
