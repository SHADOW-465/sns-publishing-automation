// Debug view of an InDesign export as the engine reads it: blocks, page markers, inferred roles.
//   node --import ./test/setup.ts test/dump-front.ts <export.zip|.epub> [maxBlocks]
import { resolve } from 'node:path'
import { unzip } from '../src/engine/zip.ts'
import { readExport, inferProfile } from '../src/engine/indesign/read.ts'
import { read } from './samples.ts'

const ex = readExport(unzip(read(resolve(process.argv[2]))))
const role = new Map(inferProfile(ex).map((s) => [s.key, s.role]))
for (const b of ex.blocks.slice(0, Number(process.argv[3] ?? 80))) {
  if (b.t === 'pb') console.log(`--- page ${b.n}`)
  else if (b.t === 'p') console.log(`${(role.get(b.key) ?? '').padEnd(14)} ${b.key.padEnd(24)} ${b.text.slice(0, 90)}`)
  else console.log(b.t, b.t === 'img' ? b.src : '')
}
