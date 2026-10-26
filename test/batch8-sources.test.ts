// Batch 8, part 2: where a picture comes from. Leftover placeholders are looked for by page and drawn from the print PDF
// when no picture file fits; originals in a Links folder come first; the export may be a folder, a zip or an .epub.
// Synthetic only: no client file is read.
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import * as jpegJs from 'jpeg-js'
import UPNG from 'upng-js'
import { unzip, zipEpub, bytes, type Files } from '../src/engine/zip.ts'
import { zipSync } from 'fflate'
import { analyze, build, usePdfPictures } from '../src/engine/indesign/build.ts'
import { exportPictures, missingPictures, pairPictures, pdfRenderer, readPdfPictures, type PdfPicture } from '../src/engine/indesign/pdfpictures.ts'
import { adoptLinks, linkFiles } from '../src/engine/indesign/links.ts'
import { packFolder, zipFiles } from '../src/engine/indesign/package.ts'
import { imageFacts } from '../src/engine/epub/image-spec.ts'
import { imageSize } from '../src/engine/epub/image.ts'
import { setSettings, DEFAULT_SETTINGS } from '../src/engine/settings.ts'
import type { PrintPage } from '../src/engine/pdf/pages.ts'
import { synthExport, synthBook, SYNTH_CSS } from './synth.ts'
import { nodeRaster } from './raster-node.ts'

afterEach(() => setSettings(DEFAULT_SETTINGS))

/** A JPEG header (SOI + SOF0) for w x h, padded to `bytes`: enough for the size check, no decoding needed. */
function stub(w: number, h: number, size: number): Uint8Array {
  const b = new Uint8Array(size)
  b.set([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x03])
  return b
}
const grey = (w: number, h: number) => stub(w, h, Math.round(w * h * 0.015)) // InDesign's grey placeholder
const real = (w: number, h: number) => stub(w, h, w * h) // a real picture: well over 0.07 byte per pixel

/** A decodable picture: noise, so it does not compress to nothing. */
function noise(w: number, h: number): { data: Uint8Array; rgba: Uint8Array } {
  const rgba = new Uint8Array(w * h * 4)
  for (let i = 0; i < rgba.length; i += 4) (rgba[i] = (i * 7) & 255), (rgba[i + 1] = (i * 13) & 255), (rgba[i + 2] = (i * 29) & 255), (rgba[i + 3] = 255)
  return { data: new Uint8Array(jpegJs.encode({ data: rgba, width: w, height: h }, 90).data), rgba }
}

const COVER = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))
const pb = (n: number | string) => `<span epub:type="pagebreak" id="page${n}" role="doc-pagebreak" aria-label="${n}" title="${n}"/>`
const para = '<p class="Cuerpo">Some words of the book go on and on here. </p>'

/** An export with one picture per printed page 10, 20, 30…, each preceded by its page marker. */
function pagedBook(srcs: string[], images: Record<string, Uint8Array> = {}) {
  const body = synthBook(2, (n) => (n === 1 ? srcs.map((s, k) => `${pb((k + 1) * 10)}\n${para}\n<img src="${s}" alt=""/>`).join('\n') : para))
  return synthExport(body, SYNTH_CSS, 'en-GB', images)
}

const printPage = (n: string, pdfPage: number, text = ''): PrintPage => ({ n, text, blank: false, lines: [], pdfPage })
const box = (w: number, h: number) => ({ x0: 10, y0: 10, x1: 10 + w, y1: 10 + h })

// ---- 1: pictures order could not place are found by their page ------------------------------------
test('a placeholder that order cannot place is found by its printed page, and noted', () => {
  const a = analyze(pagedBook(['images/a.jpg', 'images/b.jpg'], { 'images/a.jpg': grey(1500, 1000), 'images/b.jpg': grey(1000, 1000) }))
  const [pa, pbb] = exportPictures(a.ex)
  // the PDF lists the pictures in another order than the export does: one pair is found by order, the other only by page
  const second = { page: '20', data: real(900, 900), pdfPage: 2, rect: box(300, 300) }
  const first = { page: '10', data: real(1500, 1000), pdfPage: 1, rect: box(300, 200) }
  const r = pairPictures(a.ex, [second, first], { printPages: [printPage('10', 1), printPage('20', 2)] })
  assert.equal(r.paired.get(pa), first.data)
  assert.equal(r.paired.get(pbb), second.data)
  assert.equal(r.late.size, 1, 'one of the two was placed by its page, so it is worth a look')
  assert.deepEqual(r.unmatched, [])
})

test('a vector chart on the picture’s page has no picture file: its box is drawn, and a picture on no page stays listed', () => {
  const a = analyze(pagedBook(['images/a.jpg', 'images/b.jpg'], { 'images/a.jpg': grey(1200, 900), 'images/b.jpg': grey(1200, 900) }))
  const [pa, pbb] = exportPictures(a.ex)
  const chart: PdfPicture = { page: '10', data: new Uint8Array(0), vector: true, pdfPage: 1, rect: box(300, 225) }
  const r = pairPictures(a.ex, [chart], { printPages: [printPage('10', 1), printPage('20', 2)] })
  assert.deepEqual(r.render.map((j) => [j.src, j.pdfPage]), [[pa, 1]])
  assert.deepEqual(r.unmatched, [pbb])
})

test('a picture of another shape on its page is not taken for it', () => {
  const a = analyze(pagedBook(['images/a.jpg'], { 'images/a.jpg': grey(1500, 1000) }))
  const wrongShape: PdfPicture = { page: '10', data: real(300, 900), pdfPage: 1, rect: box(100, 300) }
  const r = pairPictures(a.ex, [wrongShape], { printPages: [printPage('10', 1), printPage('20', 2)] })
  assert.equal(r.paired.size, 0)
  assert.equal(r.render.length, 0)
  assert.equal(r.unmatched.length, 1)
})

test('a file named after its page (p_50_…) is not paired with a picture of the same shape printed far from page 50', () => {
  const a = analyze(pagedBook(['images/p_50_photo.jpg'], { 'images/p_50_photo.jpg': grey(1500, 1000) }))
  const pages = ['10', '20', '30', '40', '50'].map((n, k) => printPage(n, k + 1))
  const far: PdfPicture = { page: '10', data: real(1500, 1000), pdfPage: 1, rect: box(300, 200) }
  const near: PdfPicture = { page: '40', data: real(1500, 1000), pdfPage: 4, rect: box(300, 200) }
  assert.equal(pairPictures(a.ex, [far], { printPages: pages }).paired.size, 0, 'a lookalike on page 10 is a wrong picture, not a match')
  assert.equal(pairPictures(a.ex, [far], { printPages: pages }).unmatched.length, 1)
  assert.equal(pairPictures(a.ex, [far, near], { printPages: pages }).paired.get(exportPictures(a.ex)[0]), near.data, 'a page within two of 50 is')
})

// ---- 2: the whole path, with a real PDF ------------------------------------------------------------
/** Page 1 draws a chart as vectors (a 3 x 3 grid of boxes, 300 x 225 pt); page 2 has only text. */
async function chartPdf() {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const p1 = doc.addPage([420, 600])
  p1.drawText('Printed page ten', { x: 40, y: 560, size: 10, font })
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++) p1.drawRectangle({ x: 60 + c * 100, y: 200 + r * 75, width: 98, height: 73, color: rgb(0.2 + c * 0.25, 0.3 + r * 0.25, 0.6) })
  doc.addPage([420, 600]).drawText('Printed page twenty', { x: 40, y: 560, size: 10, font })
  return new Uint8Array(await doc.save())
}

test('a chart drawn as vectors is drawn from the PDF page at 300 dpi, long side capped; what is not found is a review note with file and page', async () => {
  const pdf = await chartPdf()
  const a = analyze(pagedBook(['images/chart.jpg', 'images/gone.jpg'], { 'images/chart.jpg': grey(1200, 900), 'images/gone.jpg': grey(1000, 1000) }))
  const pages = [printPage('10', 1, 'Printed page ten'), printPage('20', 2, 'Printed page twenty')]
  const pics = await readPdfPictures(pdfjs, pdf, nodeRaster, pages)
  assert.ok(pics.some((p) => p.vector && p.pdfPage === 1), 'the chart is a region of page 1')
  const left = await usePdfPictures(a, pics, [], { printPages: pages, render: pdfRenderer(pdfjs, pdf, nodeRaster) })

  const chart = a.ex.images.get(exportPictures(a.ex)[0])!
  const { width, height } = imageSize(chart)
  assert.ok(width / height > 1.2 && width / height < 1.45, `the chart keeps its shape (${width}x${height})`)
  assert.ok(Math.max(width, height) <= 1900 && Math.max(width, height) >= 800, 'drawn at 300 dpi (300 pt = 1250 px), not above the cap')
  assert.equal(imageFacts(chart).mode, 'rgb')
  assert.equal(a.pictureFrom.get(exportPictures(a.ex)[0]), 'page')

  assert.deepEqual(left.map((s) => s.split('/').pop()), ['gone.jpg'])
  const gone = a.pictureNotes.find((n) => n.how === 'left')!
  assert.equal(gone.step, 'Pictures')
  assert.match(gone.where!, /picture file gone\.jpg, printed page 20/)
  assert.ok(a.review.some((x) => x.level === 'error' && /gone\.jpg/.test(x.msg) && x.where === 'picture file gone.jpg, printed page 20'))
  assert.ok(a.pictureNotes.some((n) => n.how === 'guess' && /chart\.jpg/.test(n.where!) && /printed page 10/.test(n.where!)), 'the drawn page is a note to check')
})

test('without a print PDF a grey placeholder is still listed, never placed silently', async () => {
  const a = analyze(pagedBook(['images/a.jpg'], { 'images/a.jpg': grey(1200, 900) }))
  const left = await usePdfPictures(a, [])
  assert.equal(left.length, 1)
  assert.equal(a.pictureNotes[0].how, 'left')
  assert.match(a.pictureNotes[0].where!, /picture file a\.jpg, printed page 10/)
})

// ---- 3: originals in a Links folder ----------------------------------------------------------------
test('Links: found at any depth and case, by base name, whatever the extension; downscaled to RGB JPEG', () => {
  const big = noise(2300, 120)
  const png = new Uint8Array(UPNG.encode([noise(40, 30).rgba.buffer as ArrayBuffer], 40, 30, 0))
  const files: Files = new Map()
  const images = new Map<string, Uint8Array>([
    ['OEBPS/images/pic1.jpg', grey(1000, 700)],
    ['OEBPS/images/ha_giang_6.jpg', grey(1000, 700)],
    ['OEBPS/images/pic3.jpg', grey(1000, 700)],
    ['OEBPS/images/pic4.jpg', grey(1000, 700)],
  ])
  files.set('Pkg/DEEP/LINKS/Sub/PIC1.JPEG', big.data)
  files.set('Pkg/links/Ha Giang 6.PNG', png)
  files.set('Pkg/Links/pic3.tif', Uint8Array.from([0x49, 0x49, 0x2a, 0x00, 1, 2, 3, 4])) // a TIFF: not readable here
  files.set('Pkg/Links/._pic4.jpg', big.data) // a Mac resource fork, not a picture
  files.set('Pkg/Other/pic4.jpg', big.data) // not in a Links folder
  assert.deepEqual([...linkFiles(files).keys()].sort(), ['hagiang6', 'pic1', 'pic3'])
  const res = adoptLinks(files, images)
  assert.deepEqual([...res.used.keys()].sort(), ['OEBPS/images/ha_giang_6.jpg', 'OEBPS/images/pic1.jpg'])
  assert.deepEqual([...res.unreadable.keys()], ['OEBPS/images/pic3.jpg'])
  const one = images.get('OEBPS/images/pic1.jpg')!
  const f = imageFacts(one)
  assert.equal(f.ext, 'jpg')
  assert.equal(f.mode, 'rgb')
  assert.ok(f.width <= 1900 && f.width > 1800, `2300 px wide becomes 1900 (${f.width})`)
  const two = imageFacts(images.get('OEBPS/images/ha_giang_6.jpg')!)
  assert.equal(two.ext, 'jpg', 'an opaque PNG becomes a JPEG')
  assert.equal(imageSize(images.get('OEBPS/images/pic4.jpg')!).width, 1000, 'pic4 was left as it was')
})

test('Links come before the PDF: a linked picture is not a placeholder and is not replaced by a larger PDF picture; an unreadable link falls back to the PDF with a note', () => {
  const link = noise(1200, 800).data
  const files = pagedBook(['images/a.jpg', 'images/b.jpg'], { 'images/a.jpg': grey(1200, 800), 'images/b.jpg': grey(1200, 800) })
  files.set('Links/A.JPG', link)
  files.set('Links/b.tif', Uint8Array.from([0x49, 0x49, 0x2a, 0x00]))
  const a = analyze(files)
  const [pa, pbb] = exportPictures(a.ex)
  assert.deepEqual(missingPictures(a.ex), [pbb], 'the linked original is a real picture, whatever its size per pixel')
  assert.equal(a.pictureFrom.get(pa), 'links')
  assert.ok(a.review.some((x) => x.level === 'info' && /1 picture\(s\) taken from the Links folder/.test(x.msg)))
  assert.ok(a.review.some((x) => x.level === 'warn' && /b\.jpg/.test(x.msg) && /TIFF/.test(x.msg)))
  const own = a.ex.images.get(pa)
  const bigger = { page: '10', data: real(1900, 1267), pdfPage: 1, rect: box(300, 200) }
  const bPic = { page: '20', data: real(1200, 800), pdfPage: 2, rect: box(300, 200) }
  const r = pairPictures(a.ex, [bigger, bPic], { keep: new Set(a.ex.links.used.keys()) })
  assert.equal(r.paired.has(pa), false, 'the original stays')
  assert.equal(a.ex.images.get(pa), own)
  assert.equal(r.paired.get(pbb), bPic.data, 'the unreadable TIFF’s picture comes from the PDF')
})

// ---- 4: the export as a folder, a zip or an .epub --------------------------------------------------
test('a folder, a zip of it (inside a Mac folder, with junk) and the .epub build the same XHTML and OPF', () => {
  const src = pagedBook(['images/a.jpg'], { 'images/a.jpg': real(800, 600) })
  const meta = (x: ReturnType<typeof analyze>) => ({ ...x.meta, title: 'Sample', authors: 'A. Writer', publisher: 'Press', eisbn: '9780306406157', language: 'en-GB' })
  const built = (files: Files) => {
    const a = analyze(files)
    return build(a, { styles: a.styles, images: a.images, meta: meta(a), cover: { name: 'cover.png', data: COVER } })
  }
  const asEpub = unzip(zipEpub(src))
  // a folder as a browser reads it: paths from the folder's parent, system files among them
  const entries = [...src].map(([path, data]) => ({ path: `MyBook/${path}`, data }))
  entries.push({ path: 'MyBook/.DS_Store', data: bytes('x') }, { path: 'MyBook/OEBPS/Thumbs.db', data: bytes('x') }, { path: '__MACOSX/MyBook/._mimetype', data: bytes('x') }, { path: 'MyBook/META-INF/', data: new Uint8Array(0) })
  const folder = packFolder(entries)
  assert.deepEqual([...folder.keys()].sort(), [...src.keys()].sort(), 'relative paths kept, the folder’s own name and the system files dropped')
  const folderZip = unzip(zipFiles(folder)) // what the slot holds
  // a zip made on a Mac keeps the export inside a folder
  const macZip = unzip(zipSync(Object.fromEntries([...src].map(([k, v]) => [`MyBook/${k}`, v]))))
  const epub = built(asEpub)
  for (const other of [built(folderZip), built(macZip), built(packFolder(entries.filter((e) => !e.path.startsWith('__'))))]) {
    const names = (r: ReturnType<typeof built>) => [...r.files.keys()].filter((p) => /\.(xhtml|opf)$/.test(p)).sort()
    assert.deepEqual(names(other), names(epub))
    for (const p of names(epub).filter((n) => !n.endsWith('.opf'))) assert.deepEqual(other.files.get(p), epub.files.get(p), p)
    // the package differs only by its time stamp
    const opf = (r: ReturnType<typeof built>) => new TextDecoder().decode(r.files.get(names(r).find((n) => n.endsWith('.opf'))!)!).replace(/<meta property="dcterms:modified">[^<]*</, '<meta property="dcterms:modified">T<')
    assert.equal(opf(other), opf(epub))
  }
})

test('a package that holds the .epub beside its Links folder is read, and the Links are used', () => {
  const src = pagedBook(['images/a.jpg'], { 'images/a.jpg': grey(1200, 800) })
  const pack = new Map<string, Uint8Array>([['Package/Export.epub', zipEpub(src)], ['Package/Links/a.png', new Uint8Array(UPNG.encode([noise(60, 40).rgba.buffer as ArrayBuffer], 60, 40, 0))]])
  const a = analyze(unzip(zipFiles(pack)))
  assert.equal(exportPictures(a.ex).length, 1)
  assert.equal(a.pictureFrom.get(exportPictures(a.ex)[0]), 'links')
})
