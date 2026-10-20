import { resolve } from 'node:path'
import { unzip, text } from '../src/engine/zip.ts'
import { readExport } from '../src/engine/indesign/read.ts'
import { INDD, read } from './samples.ts'
const ex = readExport(unzip(read(resolve(INDD, 'Input/88228-02 Cambia tu mente.zip'))))
const ref = unzip(read(resolve(INDD, 'Output/Cambia tu mente.epub')))
const norm = (s: string) => s.replace(/\s+/g, ' ').trim()
const refCls = new Map<string, string[]>()
for (const [p, d] of ref) if (p.endsWith('.xhtml')) for (const m of text(d).matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/g)) {
  const c = m[1].match(/class="([^"]+)"/)?.[1] ?? '-'
  const t = norm(m[2].replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&nbsp;|&#160;/g, ' '))
  refCls.set(t, [...(refCls.get(t) ?? []), c])
}
const out = new Map<string, Map<string, string[]>>()
for (const b of ex.blocks) {
  if (b.t !== 'p' || !/^ParaOverride/.test(b.key)) continue
  const c = refCls.get(norm(b.text))?.[0] ?? '?'
  const m = out.get(b.key) ?? new Map(); out.set(b.key, m)
  m.set(c, [...(m.get(c) ?? []), b.text.slice(0, 40)])
}
for (const [k, m] of [...out].sort()) console.log(k, JSON.stringify(ex.css.decls('p', [k])), '\n  ', [...m].map(([c, ts]) => `${c} x${ts.length}: ${ts.slice(0, 3).join(' / ')}`).join('\n   '))
