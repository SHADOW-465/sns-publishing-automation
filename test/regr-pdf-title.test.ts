// A series page before the title page must not be written as a second "title" (1066 Churches: duplicate manifest id,
// duplicate spine item, two navPoints for title.xhtml, and a page-list link to an anchor the overwrite had dropped).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PDFDocument, StandardFonts, type PDFPage } from 'pdf-lib'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { text } from '../src/engine/zip.ts'
import { analyzePdf } from '../src/engine/pdfepub/analyze.ts'
import { buildPdfEpub } from '../src/engine/pdfepub/build.ts'
import { packageEpub, type Section } from '../src/engine/epub/package.ts'
import { rulesFor } from '../src/engine/epub/imprint.ts'
import { nodeRaster } from './raster-node.ts'
import { setSettings, DEFAULT_SETTINGS } from '../src/engine/settings.ts'

const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))
const W = 400
const H = 600

async function seriesBook(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.TimesRoman)
  const page = () => doc.addPage([W, H])
  const mid = (p: PDFPage, t: string, size: number, top: number) => p.drawText(t, { x: (W - font.widthOfTextAtSize(t, size)) / 2, y: H - top, size, font })
  const series = page()
  mid(series, 'THE PARISH SERIES', 22, 180)
  mid(series, 'Volume One', 16, 220)
  mid(series, 'A short note on these churches', 12, 260)
  const title = page()
  mid(title, 'THE LONG ROAD', 36, 200)
  mid(title, 'Ada Lovelace-Stone', 18, 320)
  const im = page()
  ;['First published 2026', 'Example Press', 'Copyright © Ada Lovelace-Stone 2026', 'All rights reserved. No part of this book may be reproduced without permission.', 'ISBN 978 1 4028 9462 6'].forEach((l, i) => im.drawText(l, { x: 60, y: H - 300 - i * 14, size: 9, font }))
  const toc = page()
  mid(toc, 'Contents', 24, 100)
  toc.drawText('1. The Road', { x: 60, y: H - 170, size: 11, font })
  toc.drawText('5', { x: 320, y: H - 170, size: 11, font })
  const ch = page()
  mid(ch, '1', 28, 80)
  mid(ch, 'The Road', 22, 120)
  let y = 180
  const words = 'the old road ran past the mill and down to the river where the carts waited'.split(' ')
  let line = ''
  const put = () => { ch.drawText(line, { x: 60, y: H - y, size: 11, font }); y += 14; line = '' }
  for (let i = 0; i < 80; i++) {
    const w = words[i % words.length]
    const next = line ? `${line} ${w}` : w
    if (font.widthOfTextAtSize(next, 11) > 280) put()
    line = line ? `${line} ${w}` : w
  }
  if (line) put()
  return new Uint8Array(await doc.save())
}

function assertPackage(files: Map<string, Uint8Array>) {
  const opf = text(files.get('OEBPS/content.opf')!)
  const ids = [...opf.matchAll(/<item\s+id="([^"]+)"/g)].map((m) => m[1])
  assert.equal(ids.filter((id) => id === 'title').length, 1, opf)
  assert.ok(ids.includes('title2'), ids.join(' '))
  const refs = [...opf.matchAll(/idref="([^"]+)"/g)].map((m) => m[1])
  assert.equal(new Set(refs).size, refs.length, refs.join(' '))
  const ncx = text(files.get('OEBPS/toc.ncx')!)
  const points = [...ncx.matchAll(/<navPoint\b[^>]*\bplayOrder="(\d+)"[\s\S]*?<content src="([^"]+)"\/>/g)]
  const srcs = points.map((m) => m[2])
  assert.equal(new Set(srcs).size, srcs.length, srcs.join(' '))
  const orders = points.map((m) => m[1])
  assert.equal(new Set(orders).size, orders.length)
  const xhtml = new Map([...files].filter(([p]) => p.endsWith('.xhtml')).map(([p, d]) => [p.split('/').pop()!, text(d)] as const))
  const anchors = new Map([...xhtml].map(([name, html]) => [name, new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]))]))
  const linked = [...ncx.matchAll(/(?:href|src)="([^"]*#[^"]+)"/g), ...[...xhtml].flatMap(([, html]) => [...html.matchAll(/(?:href|src)="([^"]*#[^"]+)"/g)])]
  for (const m of linked) {
    const ref = m[1]
    const hash = ref.indexOf('#')
    const frag = ref.slice(hash + 1)
    const file = ref.slice(0, hash).split('/').pop()
    const home = file || 'nav.xhtml'
    assert.ok(anchors.get(home)?.has(frag) || anchors.get(file || '')?.has(frag), ref)
  }
}

test('a series page before the title page is title2, and no link names an anchor that was not written', async () => {
  setSettings(DEFAULT_SETTINGS)
  const pdf = await seriesBook()
  const b = await analyzePdf(pdfjs, pdf, nodeRaster)
  assert.ok(b.titlePage !== undefined && b.titlePage > 0, `title page ${b.titlePage} half ${b.halfTitle} front ${b.front}`)
  const input = { styles: b.styles, meta: { ...b.meta, eisbn: '9780306406157', publisher: b.meta.publisher || 'Example Press' }, rules: rulesFor('en'), cover: { name: 'cover.png', data: PNG } }
  const accessible = await buildPdfEpub(b, input, nodeRaster)
  assert.ok(accessible.files.has('OEBPS/title.xhtml') && accessible.files.has('OEBPS/title2.xhtml'), [...accessible.files.keys()].filter((k) => k.includes('title')).join(' '))
  assertPackage(accessible.files)
  const standard = await buildPdfEpub(b, { ...input, meta: { ...input.meta, profile: 'standard' } }, nodeRaster)
  assertPackage(standard.files)
  const stdTitle = text(standard.files.get('OEBPS/title.xhtml')!) + text(standard.files.get('OEBPS/title2.xhtml')!)
  assert.match(stdTitle, /id="Page_\d+"/)
  assert.equal((text(standard.files.get('OEBPS/toc.ncx')!).match(/title\.xhtml#Page_\d+/g) ?? []).every((ref) => stdTitle.includes(ref.split('#')[1])), true)
})

test('packageEpub gives a repeated title section its own id and file and does not link a missing page anchor', () => {
  setSettings(DEFAULT_SETTINGS)
  const meta = { title: 'Churches', subtitle: '', authors: 'Ada Lovelace-Stone', publisher: 'Example Press', language: 'en', eisbn: '9780306406157', printIsbn: '', rights: '', certifiedBy: '', conformsTo: '' }
  const sec = (id: string, file: string, type: Section['type'], body: string): Section => ({ id, file, type, nav: type, title: type, body })
  const sections = [
    sec('title', 'title.xhtml', 'title', '<section><span epub:type="pagebreak" id="page-5" role="doc-pagebreak"/>The book</section>'),
    sec('title', 'title.xhtml', 'title', '<section><span epub:type="pagebreak" id="page-4" role="doc-pagebreak"/>Series</section>'),
    sec('index', 'index.xhtml', 'index', '<section><p><a href="title.xhtml#page-4">4</a> <a href="title.xhtml#page-5">5</a> <a href="title.xhtml#page-9">9</a></p></section>'),
  ]
  const review: { level: 'error' | 'warn' | 'info'; msg: string }[] = []
  const r = packageEpub({ meta, sections, cover: { path: 'images/cover.png', data: PNG }, images: [], usedClasses: new Map(), bodyDecls: {}, review, css: 'p{}' })
  assertPackage(r.files)
  const index = text(r.files.get('OEBPS/index.xhtml')!)
  assert.match(index, /href="title2\.xhtml#page-4"/)
  assert.match(index, /href="title\.xhtml#page-5"/)
  assert.equal(index.includes('#page-9'), false)
  const standard = packageEpub({ meta: { ...meta, profile: 'standard' }, sections, cover: { path: 'images/cover.png', data: PNG }, images: [], usedClasses: new Map(), bodyDecls: {}, review: [], css: 'p{}' })
  const ncx = text(standard.files.get('OEBPS/toc.ncx')!)
  assert.equal(ncx.includes('#Page_9'), false)
  assert.match(ncx, /title2\.xhtml#Page_4/)
  assert.match(text(standard.files.get('OEBPS/title2.xhtml')!), /id="Page_4"/)
})
