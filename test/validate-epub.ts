// Independent validation of any finished EPUB: W3C EPUBCheck, then the tool's own check.
//   node --import ./test/setup.ts test/validate-epub.ts book.epub
import { resolve } from 'node:path'
import { checkEpubBytes } from '../src/engine/check/epub.ts'
import { epubcheck } from './epubcheck.ts'
import { printReport } from './check-epub.ts'
import { read } from './samples.ts'

const file = resolve(process.argv[2] ?? '')
const ec = epubcheck(file)
console.log(ec ? `EPUBCheck: ${ec.errors.length} error(s), ${ec.warnings.length} warning(s)` : 'EPUBCheck is not installed (tools/).')
for (const e of ec?.errors.slice(0, 20) ?? []) console.log('  ' + e)
printReport(checkEpubBytes(read(file)))
