import { resolve } from 'node:path'
import { unzip } from '../src/engine/zip.ts'
import { readExport } from '../src/engine/indesign/read.ts'
import { INDD, read } from './samples.ts'
const ex = readExport(unzip(read(resolve(INDD, 'Input/88228-02 Cambia tu mente.zip'))))
const want = new Set(['ParaOverride-21','ParaOverride-46','ParaOverride-53','ParaOverride-33','ParaOverride-36','ParaOverride-40','ParaOverride-34','ParaOverride-37','ParaOverride-41','ParaOverride-44','ParaOverride-2','ParaOverride-60'])
const seen = new Map<string, number>()
ex.blocks.forEach((b, i) => {
  if (b.t !== 'p' || !want.has(b.key)) return
  const n = (seen.get(b.key) ?? 0) + 1; seen.set(b.key, n)
  if (n > 3) return
  const prev = ex.blocks.slice(Math.max(0, i - 1), i).map((x) => x.t === 'p' ? `[${x.key}] ${x.text.slice(0, 40)}` : x.t).join(' | ')
  const inTable = !!b.el.closest('table')
  console.log(b.key, '| cls:', b.classes.join(' '), '| tag:', b.el.localName, '| parent:', b.el.parentElement?.localName, '| table:', inTable, '| decls:', JSON.stringify(ex.css.decls(b.el.localName, b.classes)), '\n   text:', b.text.slice(0, 80), '\n   prev:', prev)
})
console.log([...seen])
