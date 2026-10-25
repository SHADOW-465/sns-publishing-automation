import { readFileSync, writeFileSync } from 'node:fs'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { nodeRaster } from './raster-node.ts'
import { analyzePdf } from '../src/engine/pdfepub/analyze.ts'
import { buildPdfEpub } from '../src/engine/pdfepub/build.ts'
import { rulesFor } from '../src/engine/epub/imprint.ts'
const COVER = readFileSync(process.argv[3])
const book = await analyzePdf(pdfjs, new Uint8Array(readFileSync(process.argv[2])), nodeRaster)
console.log('analyzed', book.pages.length)
try {
  const r = await buildPdfEpub(book, { styles: book.styles, meta: { ...book.meta, title: book.meta.title || 'T', authors: 'A', publisher: 'P', eisbn: '9780306406157', language: book.meta.language || 'es' }, rules: rulesFor('es'), cover: { name: 'cover.jpg', data: COVER } }, nodeRaster)
  writeFileSync(process.argv[4], r.epub); console.log('ok', r.sections.length)
} catch (e) { console.log((e as Error).stack) }
