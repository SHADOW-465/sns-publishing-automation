// Prints, per style of a book, the role the scorer chose and every signal that voted. For tuning the weights.
//   node --import ./test/setup.ts test/detect-styles.ts <export.zip|.epub>
import { resolve } from 'node:path'
import { unzip } from '../src/engine/zip.ts'
import { analyze } from '../src/engine/indesign/build.ts'
import { read } from './samples.ts'
const a = analyze(unzip(read(resolve(process.argv[2]))))
for (const s of a.styles.filter((x) => x.count)) {
  console.log(`${s.key} (${s.count}x) -> ${s.role} ${s.confidence} ${s.action}`)
  for (const e of s.evidence ?? []) console.log(`    ${e.signal.padEnd(10)} ${e.role.padEnd(14)} ${e.weight}  ${e.note}`)
}
