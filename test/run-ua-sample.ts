// Command-line run of the Accessible PDF workflow on the Automation samples.
//   node --import ./test/setup.ts test/run-ua-sample.ts medium|simple [outDir]
import { resolve } from 'node:path'
import { writeFileSync, mkdirSync } from 'node:fs'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { analyzeUa, buildUa } from '../src/engine/pdfua/index.ts'
import { nodeRaster } from './raster-node.ts'
import { AUTOMATION, read } from './samples.ts'

const which = process.argv[2] ?? 'medium'
const out = resolve(process.argv[3] ?? 'out')
const D = resolve(AUTOMATION, 'Accessible-PDF-Automation')
const inputs = which === 'simple'
  ? { main: read(resolve(D, 'Simple/Input/Gladiators in the Greek World.pdf')), extras: [read(resolve(D, 'Simple/Input/Gladiators in the Greek World_Plates.pdf'))], cover: { data: read(resolve(D, 'Simple/Input/cover.jpg')), png: false }, altDocx: read(resolve(D, 'Simple/Input/Gladiators in the Greek World alt text.docx')) }
  : { main: read(resolve(D, 'Medium/Input/DD_Evers-Woelk_2124-6.pdf')), extras: [], altDocx: read(resolve(D, 'Medium/Input/AltTexte MEW.docx')) }
const t = Date.now()
const a = await analyzeUa(pdfjs, nodeRaster, inputs, (d, n) => d % 50 === 0 && console.log(`read ${d}/${n}`))
console.log('META', a.meta)
for (const s of a.styles) console.log(String(s.count).padStart(6), s.key.padEnd(28), s.role.padEnd(9), '|', s.samples[0]?.slice(0, 50))
console.log('FIGURES', a.figures.length)
for (const f of a.figures) console.log(' ', f.key, f.vector ? 'vector' : 'image', '|', f.caption.slice(0, 40), '| alt:', f.alt.slice(0, 50))
for (const r of a.review) console.log(r.level, r.msg)
const r = await buildUa(a, { styles: a.styles, meta: { ...a.meta, isbn: which === 'simple' ? '9781036130527' : '' }, alt: Object.fromEntries(a.figures.map((f) => [f.key, f.alt || (which === 'simple' ? 'Pen & Sword History logo' : '')])), cropToTrim: true, sourceName: which === 'simple' ? 'Gladiators in the Greek World.pdf' : 'DD_Evers-Woelk_2124-6.pdf' })
mkdirSync(out, { recursive: true })
writeFileSync(resolve(out, r.fileName), r.pdf)
console.log('STATS', r.stats)
for (const x of r.review) console.log(x.level, x.msg)
console.log(`→ ${resolve(out, r.fileName)} (${((Date.now() - t) / 1000).toFixed(0)} s)`)
