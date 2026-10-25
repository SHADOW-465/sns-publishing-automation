// Picture / tag audit of a PDF: painted pictures in the trim vs the structure tree, tag counts.
//   node --import ./test/setup.ts test/ua-audit.ts file.pdf [pageList]
import { readFileSync } from 'node:fs'
import { PDFDocument } from 'pdf-lib'
import { auditPictures, auditPage, readTree } from '../src/engine/pdfua/audit.ts'
import { trimOf, trimBoxOf, insideBox } from '../src/engine/pdfua/pages.ts'

const [, , file, pageList] = process.argv
const doc = await PDFDocument.load(new Uint8Array(readFileSync(file)), { updateMetadata: false, ignoreEncryption: true })
const a = auditPictures(doc)
console.log(JSON.stringify({ pages: a.pages, picturesInTrim: a.pictures, inTree: a.picturesInTree, artifact: a.picturesArtifact, slugPictures: a.slugPictures, figureElements: a.figureElements }))
console.log('TAGS', JSON.stringify(Object.fromEntries([...a.counts].sort((x, y) => y[1] - x[1]))))
console.log('ARTIFACT PICTURES (page, box):', a.artifactPictures.slice(0, 40).map((x) => `${x.page}:${[x.box.x0, x.box.y0, x.box.x1, x.box.y1].map(Math.round)}`).join(' '))
if (pageList) {
  const { byMcid } = readTree(doc)
  for (const n of pageList.split(',').map(Number)) {
    const pg = doc.getPage(n - 1)
    const t = trimOf(pg)
    console.log(`--- page ${n} trim`, t)
    for (const r of auditPage(doc, n - 1)) {
      const el = r.mcid !== undefined ? byMcid.get(`${n - 1}:${r.mcid}`) : undefined
      console.log(' ', r.kind.padEnd(5), r.box ? [r.box.x0, r.box.y0, r.box.x1, r.box.y1].map(Math.round).join(',') : '-', '|', r.tag || '(none)', el ? el.chain.join('>') : '')
    }
  }
}

// JSON for the proof pictures: node ... test/ua-audit.ts file.pdf pages out.json  (boxes of every picture and Figure path, per page)
if (process.argv[4]) {
  const { writeFileSync } = await import('node:fs')
  const out: Record<string, { kind: string; box: number[]; tag: string; chain: string; inTrim: boolean }[]> = {}
  const { byMcid } = readTree(doc)
  for (const n of pageList!.split(',').map(Number)) {
    out[n] = auditPage(doc, n - 1).filter((r) => r.box && (r.kind === 'image' || (r.kind === 'path' && r.tag === 'Figure'))).map((r) => ({ kind: r.kind, box: [r.box!.x0, r.box!.y0, r.box!.x1, r.box!.y1], tag: r.tag || '(none)', inTrim: insideBox(r.box!, trimBoxOf(doc.getPage(n - 1))), chain: r.mcid !== undefined ? (byMcid.get(`${n - 1}:${r.mcid}`)?.chain.join('>') ?? '') : '' }))
  }
  writeFileSync(process.argv[4], JSON.stringify(out))
}
