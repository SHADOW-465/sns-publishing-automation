// Batch 6: a bar chart drawn as vectors is one picture (turned labels, sparse bars, legend) and sits after the text printed above it;
// the italic sub-lines of a contents entry ("A • B • C", wrapped) are a nested TOC of one entry per topic.
// Synthetic books always; the two client books are read only when they are on this machine (SNS_UT_IN), and skipped otherwise.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { PDFDocument, PDFName, PDFArray, PDFDict, StandardFonts, rgb, degrees } from 'pdf-lib'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { text } from '../src/engine/zip.ts'
import { analyzePdf } from '../src/engine/pdfepub/analyze.ts'
import { buildPdfEpub } from '../src/engine/pdfepub/build.ts'
import { rulesFor } from '../src/engine/epub/imprint.ts'
import { clusterDrawings } from '../src/engine/pdf/drawings.ts'
import { analyzeUa, buildUa } from '../src/engine/pdfua/index.ts'
import { readTree } from '../src/engine/pdfua/audit.ts'
import { nodeRaster } from './raster-node.ts'
import { read } from './samples.ts'

const COVER = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'))
const meta = { title: 'Sample', authors: 'A. Writer', publisher: 'Press', eisbn: '9780306406157', language: 'es' }
const CLIENT = process.env.SNS_UT_IN ?? 'C:\\Users\\acer\\AppData\\Local\\Temp\\sns_ut_in'

async function pdfEpub(data: Uint8Array, splitSpreads = true) {
  const book = await analyzePdf(pdfjs, data, nodeRaster, {}, undefined, { splitSpreads })
  const r = await buildPdfEpub(book, { styles: book.styles, meta: { ...book.meta, ...meta, title: book.meta.title || 'Sample' }, rules: rulesFor('es'), cover: { name: 'cover.png', data: COVER } }, nodeRaster)
  const html = [...r.files].filter(([p]) => p.endsWith('.xhtml')).map(([, d]) => text(d)).join('\n')
  return { book, r, html }
}

const PROSE = [
  'Esto demuestra que el conflicto por las constituciones estatales tuvo como objeto',
  'principal la estructuracion de las politicas intraestatales y la relacion entre los',
  'poderes del estado, tal como se muestra con claridad en la grafica de esta pagina,',
  'considerando el periodo como un todo y sin perder de vista a los demas actores.',
]
const STATES = ['Acre', 'Alagoas', 'Amapa', 'Amazonas', 'Bahia', 'Ceara', 'Distrito Federal', 'Espirito Santo', 'Goias', 'Maranhao', 'Mato Grosso', 'Minas Gerais', 'Para', 'Paraiba']

/** Four pages with folios; page 3 has text, then a caption above a sparse bar chart (turned state names, a key) and its source line. */
async function chartBook(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let n = 1; n <= 4; n++) {
    const page = doc.addPage([440, 640])
    page.drawText(String(n), { x: 400, y: 600, size: 9, font })
    if (n !== 3) {
      for (let k = 0; k < 14; k++) page.drawText(`Pagina ${n}, linea ${k}: el texto corrido de este libro continua con palabras comunes del tema.`, { x: 60, y: 540 - k * 14, size: 11, font })
      continue
    }
    PROSE.forEach((t, k) => page.drawText(t, { x: 60, y: 540 - k * 14, size: 11, font }))
    page.drawText('Grafica 1.4. IDA por titulo impugnado', { x: 60, y: 440, size: 11, font })
    page.drawText('en porcentaje de articulos invocados (1989-1999)', { x: 60, y: 426, size: 11, font })
    STATES.forEach((name, k) => {
      const h = 20 + ((k * 37) % 70)
      page.drawRectangle({ x: 100 + k * 19, y: 300, width: 7, height: h, color: rgb(0.3, 0.3, 0.3) })
      page.drawText(name, { x: 100 + k * 19 + 5, y: 296 - font.widthOfTextAtSize(name, 9), size: 9, font, rotate: degrees(90) })
    })
    page.drawRectangle({ x: 100, y: 218, width: 19, height: 11, color: rgb(0.3, 0.3, 0.3) })
    page.drawRectangle({ x: 150, y: 218, width: 19, height: 11, color: rgb(0.7, 0.7, 0.7) })
    page.drawText('Fuente: Supremo Tribunal Federal. Estudio de constitucionalismo del Estado.', { x: 60, y: 160, size: 9, font })
    for (let k = 0; k < 8; k++) page.drawText(`El texto que sigue a la grafica continua aqui con la linea ${k} del parrafo.`, { x: 60, y: 130 - k * 14, size: 11, font })
  }
  return new Uint8Array(await doc.save())
}

test('1: the labels turned under a chart axis bridge sparse bars, so the whole chart, its names and its key are one picture', () => {
  const bars = Array.from({ length: 8 }, (_, k) => ({ x0: 100 + k * 18, x1: 107 + k * 18, y0: 200 - k * 10, y1: 300 })) // 11 pt between bars: apart on their own
  const names = Array.from({ length: 16 }, (_, k) => ({ x0: 98 + k * 9, x1: 108 + k * 9, y0: 298, y1: 340 })) // the names stand 9 pt apart and are 10 wide: they touch
  const key = [{ x0: 100, x1: 119, y0: 345, y1: 356 }]
  const lines = [{ x0: 40, x1: 360, y: 80, size: 11, text: 'A caption sits above the chart and is much longer than any label of it.' }]
  const page = { width: 440, height: 640, lines }
  assert.equal(clusterDrawings({ ...page, drawings: [...bars, ...key] }).length, 0, 'bars alone do not make a chart')
  const [box] = clusterDrawings({ ...page, drawings: [...bars, ...key], sideways: names })
  assert.ok(box, 'one chart')
  assert.ok(box.x1 >= 108 + 15 * 9 && box.y1 >= 356, `box ${JSON.stringify(box)} covers the last bar, the names and the key`)
  assert.ok(box.y0 > 80 + 11, 'it stops under the caption')
})

test('2: a chart is placed after the text printed above it and after its page marker; the picture holds the whole chart', async () => {
  const { book, html } = await pdfEpub(await chartBook(), false)
  const shot = book.pages.flatMap((p) => p.images).filter((i) => i.id.startsWith('vector'))
  assert.equal(shot.length, 1, 'the chart is rasterised once')
  const [i] = shot
  assert.ok(i.x1 > 100 + 13 * 19 + 7 - 1, `the right-hand bar is inside (x1 ${i.x1})`)
  assert.ok(i.y1 > 640 - 218 - 1, `the names under the axis and the key are inside (y ${i.y0}..${i.y1})`)
  assert.ok(i.y1 < 640 - 160 + 4, 'the source line stays outside')
  const prose = html.indexOf('Esto demuestra')
  const marker = html.indexOf('id="page-3"')
  const pic = html.search(/<img[^>]*src="images\/pg-3\.jpg"/)
  assert.ok(prose >= 0 && marker >= 0 && pic >= 0, `${prose} ${marker} ${pic}`)
  assert.ok(marker < prose, 'the page marker opens the page text')
  assert.ok(prose < pic, 'the chart follows the paragraph above it')
  assert.ok(html.indexOf('El texto que sigue') > pic, 'text printed below the chart stays below it')
})

// ---- contents: the sub-lines of an entry ------------------------------------------------------
async function contentsBook(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const italic = await doc.embedFont(StandardFonts.HelveticaOblique)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  const opener = doc.addPage([400, 600])
  opener.drawText('Introduccion', { x: 50, y: 520, size: 22, font: bold })
  ;['The river crosses the plain and the old road follows it to the sea.', 'Nobody walked there in winter, because the ice came down from the hills.', 'In spring the farmers drove their carts to the market in the town.'].forEach((t, i) => opener.drawText(t, { x: 50, y: 480 - i * 20, size: 11, font }))
  opener.drawText('Alpha topic', { x: 50, y: 330, size: 14, font: bold })
  opener.drawText('The first topic is explained here in a few plain words.', { x: 50, y: 300, size: 11, font })
  const toc = doc.addPage([400, 600])
  toc.drawText('Contents', { x: 50, y: 520, size: 22, font: bold })
  toc.drawText('Introduccion', { x: 50, y: 470, size: 11, font })
  toc.drawText('1', { x: 340, y: 470, size: 11, font })
  toc.drawText('Alpha topic \u2022 Beta topic with a long name that wraps', { x: 70, y: 448, size: 10, font: italic })
  toc.drawText('onto the next line \u2022 Gamma', { x: 70, y: 434, size: 10, font: italic })
  toc.drawText('Chapter Two', { x: 50, y: 408, size: 11, font })
  toc.drawText('9', { x: 340, y: 408, size: 11, font })
  return new Uint8Array(await doc.save())
}

type N = { role: string; own: string; kids: N[] }
/** The first TOC of page `p` as the reader of the tags sees it: roles, and the words each element holds itself. */
async function tocTree(pdf: Uint8Array, p: number): Promise<N | undefined> {
  const doc = await pdfjs.getDocument({ data: pdf.slice(), disableFontFace: true } as never).promise
  const page = await doc.getPage(p)
  const tree = await page.getStructTree()
  const tc = await page.getTextContent({ includeMarkedContent: true })
  const words = new Map<string, string>()
  let cur: string | null = null
  for (const it of tc.items as { type?: string; id?: string; str?: string }[]) {
    if (it.type === 'beginMarkedContentProps' || it.type === 'beginMarkedContent') cur = it.id ?? null
    else if (it.type === 'endMarkedContent') cur = null
    else if (cur && typeof it.str === 'string') words.set(cur, (words.get(cur) ?? '') + it.str)
  }
  type S = { role?: string; type?: string; id?: string; children?: S[] }
  // the words of an element: its own marked content and that of its Reference / Link children, not of nested TOCI / TOC
  const own = (n: S): string => (n.type === 'content' ? (words.get(n.id ?? '') ?? '') : (n.children ?? []).filter((c) => c.role !== 'TOC' && c.role !== 'TOCI').map(own).join(''))
  const walk = (n: S): N => ({ role: n.role ?? '', own: own(n).replace(/\s+/g, ' ').trim(), kids: (n.children ?? []).filter((c) => c.type !== 'content').map(walk) })
  const find = (n: N): N | undefined => (n.role === 'TOC' ? n : n.kids.map(find).find(Boolean))
  return find(walk(tree as S))
}

test('3: the sub-lines of a contents entry are a nested TOC of one TOCI per topic; a wrapped topic is one; the bullets are artifacts', async () => {
  const a = await analyzeUa(pdfjs, nodeRaster, { main: await contentsBook(), extras: [], options: {} })
  const r = await buildUa(a, { styles: a.styles, meta: { ...a.meta, isbn: '' }, alt: {}, cropToTrim: false, options: {} })
  const toc = await tocTree(r.pdf, 2)
  assert.ok(toc, 'a TOC on the contents page')
  assert.deepEqual(toc.kids.map((k) => k.role), ['TOCI', 'TOC', 'TOCI'], 'entry, its nested topics, next entry')
  assert.match(toc.kids[0].own, /^Introduccion/)
  assert.match(toc.kids[2].own, /^Chapter Two/)
  assert.deepEqual(toc.kids[1].kids.map((k) => k.role), ['TOCI', 'TOCI', 'TOCI'])
  assert.deepEqual(toc.kids[1].kids.map((k) => k.own.replace(/\s+/g, '')), ['Alphatopic', 'Betatopicwithalongnamethatwrapsontothenextline', 'Gamma'])
  assert.ok(toc.kids.every((k) => !k.own.includes('\u2022')) && toc.kids[1].kids.every((k) => !k.own.includes('\u2022')), 'no bullet inside any entry')
  // the parent keeps its link; each stretch of each topic has its own
  const pdf = await PDFDocument.load(r.pdf, { updateMetadata: false })
  const links = pdf.getPage(1).node.lookupMaybe(PDFName.of('Annots'), PDFArray)?.asArray().filter((x) => pdf.context.lookup(x as never, PDFDict).get(PDFName.of('Subtype'))?.toString() === '/Link') ?? []
  assert.ok(toc.kids[0].kids.some((k) => k.role === 'Reference'), 'the parent entry keeps its link')
  assert.ok(links.length >= 2, `links on the contents page: ${links.length}`)
  assert.equal(readTree(pdf).counts.get('TOCI'), 5, 'two entries, three topics')
})

// ---- the client books, when present -----------------------------------------------------------
const dinamicas = resolve(CLIENT, 'dinamicas', 'dinamicas_press 2.pdf')
test('4: dinamicas — Gráfica 1.4 follows the text above it and the page marker; Gráfica 1.1 is whole', { skip: !existsSync(dinamicas) && 'client sample not present', timeout: 600000 }, async () => {
  const { book, html } = await pdfEpub(read(dinamicas))
  const at = (re: RegExp) => html.search(re)
  const pic37 = at(/<img[^>]*src="images\/pg-37\.jpg"/)
  const marker37 = at(/id="page-37"/)
  const prose37 = at(/Esto demuestra que, en cuanto al fondo/)
  assert.ok(marker37 >= 0 && marker37 < prose37 && prose37 < pic37, `${marker37} < ${prose37} < ${pic37}`)
  const g11 = book.pages.flatMap((p) => p.images).filter((i) => i.id.startsWith('vector')).find((i) => i.x1 - i.x0 > 200 && i.y1 - i.y0 > 200 && i.y0 > 250 && i.y0 < 300)
  assert.ok(g11 && g11.x1 > 340 && g11.y1 > 495, `Gráfica 1.1 covers the right-hand bars and the key: ${JSON.stringify(g11)}`)
})

const sacgeo = resolve(CLIENT, 'Accessible-PDF', 'SacGeo', 'Input', 'text', 'AlNiDi ES pages V05.pdf')
test('5: SacGeo — the topics under “Introducción de Barbara” are one nested entry each, the parent keeps its link', { skip: !existsSync(sacgeo) && 'client sample not present', timeout: 600000 }, async () => {
  const a = await analyzeUa(pdfjs, nodeRaster, { main: read(sacgeo), extras: [], options: {} })
  const alt = Object.fromEntries(a.figures.filter((f) => !f.alt).map((f) => [f.key, 'Proof placeholder description.']))
  const r = await buildUa(a, { styles: a.styles, meta: { ...a.meta, isbn: '' }, alt, cropToTrim: true, options: {} })
  const toc = await tocTree(r.pdf, 7)
  assert.ok(toc)
  const at = toc.kids.findIndex((k) => /^Introducción de Barbara/.test(k.own))
  assert.ok(at >= 0, toc.kids.map((k) => k.own).join(' | '))
  const sub = toc.kids[at + 1]
  assert.equal(sub.role, 'TOC', 'a nested TOC follows the parent entry')
  const topics = sub.kids.map((k) => k.own.replace(/\s+/g, ' '))
  assert.equal(topics.length, 6, topics.join(' | '))
  assert.match(topics[0], /^Activaciones de la cosmología pleyadiana: 1995 a 2012$/)
  assert.match(topics[1], /^Cómo perdimos nuestra\s*multidimensionalidad$/)
  assert.ok(topics.every((t) => !t.includes('•')), 'the bullets are not in any entry')
  assert.match(topics[5], /^Mística transilvana$/)
  assert.ok(toc.kids[at].kids.some((k) => k.role === 'Reference'), 'the parent entry keeps its link')
})
