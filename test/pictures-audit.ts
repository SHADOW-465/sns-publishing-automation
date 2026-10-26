// Picture audit of one InDesign export: what the export holds as it is, and what is there once the Links folder and the print PDF are used.
//   node --import ./test/setup.ts test/pictures-audit.ts <label> <export.epub|zip> <print.pdf> [out.json] [dumpDir]
// Prints one JSON line (also written to out.json): counts, long sides, time and peak memory. Reads only; writes nothing else.
import { resolve } from 'node:path'
import { writeFileSync, mkdirSync } from 'node:fs'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { unzip } from '../src/engine/zip.ts'
import { analyze, usePdfPictures } from '../src/engine/indesign/build.ts'
import { readPrintPages } from '../src/engine/pdf/pages.ts'
import { exportPictures, isInDesignPlaceholder, readPdfPictures, pdfRenderer } from '../src/engine/indesign/pdfpictures.ts'
import { imageSize } from '../src/engine/epub/image.ts'
import { nodeRaster } from './raster-node.ts'
import { read } from './samples.ts'

const [label, src, pdf, outFile, dumpDir] = process.argv.slice(2)
let peak = 0
const timer = setInterval(() => (peak = Math.max(peak, process.memoryUsage().rss)), 100)
const longSide = (d?: Uint8Array) => {
  try {
    const s = d?.length ? imageSize(d) : { width: 0, height: 0 }
    return Math.max(s.width, s.height)
  } catch {
    return 0
  }
}
const stats = (a: ReturnType<typeof analyze>, grey: (s: string) => boolean) => {
  const srcs = exportPictures(a.ex)
  const sides = srcs.map((s) => longSide(a.ex.images.get(s))).filter((n) => n > 0).sort((x, y) => x - y)
  return {
    total: srcs.length,
    placeholders: srcs.filter((s) => !!a.ex.images.get(s)?.length && grey(s)).length,
    brokenPaths: srcs.filter((s) => !a.ex.images.get(s)?.length).length,
    medianLongSide: sides[sides.length >> 1] ?? 0,
    maxLongSide: sides[sides.length - 1] ?? 0,
  }
}
const t0 = Date.now()
const a = analyze(unzip(read(resolve(src))))
const before = stats(a, (s) => isInDesignPlaceholder(a.ex.images.get(s)))
const fromLinks = a.ex.links.used.size
const pdfBytes = read(resolve(pdf))
const printPages = await readPrintPages(pdfjs as never, pdfBytes)
const pics = await readPdfPictures(pdfjs, pdfBytes, nodeRaster, printPages)
const left = await usePdfPictures(a, pics, [], { printPages, render: pdfRenderer(pdfjs, pdfBytes, nodeRaster) })
clearInterval(timer)
const from = [...a.pictureFrom.values()]
const after = { ...stats(a, (s) => left.includes(s)), fromPdf: from.filter((v) => v === 'pdf').length, fromLinks, drawnFromPage: from.filter((v) => v === 'page').length, left: left.length }
const out = { label, before, after, pdfPictures: pics.filter((p) => p.data.length).length, seconds: Math.round((Date.now() - t0) / 1000), peakRssMB: Math.round(peak / 1048576), notes: a.pictureNotes.map((n) => `${n.how}: ${n.where}`) }
console.log('AUDIT ' + JSON.stringify(out))
if (dumpDir) {
  mkdirSync(resolve(dumpDir), { recursive: true }) // the pictures that were not taken as they stood: for a look
  for (const [src, how] of a.pictureFrom) if (how === 'page') writeFileSync(resolve(dumpDir, src.split('/').pop()!), a.ex.images.get(src)!)
}
if (outFile) writeFileSync(resolve(outFile), JSON.stringify(out, null, 1))
