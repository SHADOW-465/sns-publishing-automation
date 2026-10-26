// Headless Accessible-PDF run on any input PDF, with the options given as JSON, and the picture / tag numbers of what it wrote.
//   node --import ./test/setup.ts test/run-ua-file.ts input.pdf outDir [optionsJson] [cover.jpg] [extra.pdf,extra2.pdf]
// Environment: UA_PLATES=plates.pdf (a separate plates PDF, the Plates slot), UA_ALT_DOCX=alt.docx (the client's Word file of descriptions), UA_PLACEHOLDER_ALT=1 (describe whatever is still undescribed, to see the other errors).
import { resolve, basename } from 'node:path'
import { writeFileSync, mkdirSync } from 'node:fs'
import { PDFDocument } from 'pdf-lib'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { analyzeUa, buildUa } from '../src/engine/pdfua/index.ts'
import { auditPictures } from '../src/engine/pdfua/audit.ts'
import { nodeRaster } from './raster-node.ts'
import { read } from './samples.ts'
import { gatedWrite } from './gate-run.ts'

const [, , input, outDir = 'out', optJson = '{}', cover, extrasArg] = process.argv
const options = JSON.parse(optJson)
const t = Date.now()
const a = await analyzeUa(pdfjs, nodeRaster, {
  main: read(resolve(input)), extras: (extrasArg ? extrasArg.split(',') : []).map((e) => read(resolve(e))), options,
  cover: cover ? { data: read(resolve(cover)), png: false } : undefined,
  plates: process.env.UA_PLATES ? read(resolve(process.env.UA_PLATES)) : undefined,
  altDocx: process.env.UA_ALT_DOCX ? read(resolve(process.env.UA_ALT_DOCX)) : undefined,
}, (d, n, s) => d % 80 === 0 && console.log(`${s ?? ''} ${d}/${n}`))
console.log('META', JSON.stringify(a.meta), 'FIGURES', a.figures.length, `(${((Date.now() - t) / 1000).toFixed(0)} s)`)
const alt = process.env.UA_PLACEHOLDER_ALT ? Object.fromEntries(a.figures.filter((f) => !f.alt && !f.ornament).map((f) => [f.key, 'Proof placeholder description.'])) : {}
const r = await buildUa(a, { styles: a.styles, meta: { ...a.meta, isbn: '' }, alt, cropToTrim: true, sourceName: basename(input), options })
mkdirSync(resolve(outDir), { recursive: true })
await gatedWrite('pdf', r.pdf, resolve(outDir, r.fileName), r.review, { book: basename(input) })
const audit = auditPictures(await PDFDocument.load(r.pdf, { updateMetadata: false }))
console.log('STATS', JSON.stringify(r.stats))
console.log('AUDIT', JSON.stringify({ pages: audit.pages, picturesInTrim: audit.pictures, inTree: audit.picturesInTree, artifact: audit.picturesArtifact, slugPictures: audit.slugPictures, figureElements: audit.figureElements }))
console.log('TAGS', JSON.stringify(Object.fromEntries([...audit.counts].sort((x, y) => y[1] - x[1]))))
for (const x of r.review.slice(0, 60)) console.log(x.level, x.msg)
console.log(`→ ${resolve(outDir, r.fileName)} (${((Date.now() - t) / 1000).toFixed(0)} s)`)
