import { resolve } from 'node:path'
import { unzip, text } from '../src/engine/zip.ts'
import { INDD, read } from './samples.ts'
const ref = unzip(read(resolve(INDD, 'Output/Cambia tu mente.epub')))
const all = [...ref].filter(([p]) => p.endsWith('.xhtml')).map(([p, d]) => [p, text(d)] as const)
const tally = new Map<string, Map<string, number>>()
for (const [p, h] of all) for (const m of h.matchAll(/<p class="([^"]+)"[^>]*>([\s\S]*?)<\/p>/g)) {
  const t = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
  for (const [k, re] of [['preg', /^(Pregunta|Respuesta)\s*:/], ['num', /^\d{1,2}\s*:\s/], ['si', /^(Sí|No) = \d/], ['suma', /^(Suma tus puntuaciones|Después de la interacción|Antes de la interacción)/], ['web', /^(Página web|Instagram|Facebook|YouTube):/]] as const) {
    if (!re.test(t)) continue
    const c = tally.get(k) ?? new Map(); tally.set(k, c); c.set(m[1], (c.get(m[1]) ?? 0) + 1)
  }
}
for (const [k, c] of tally) console.log(k, [...c])
for (const cls of ['extract', 'extract1', 'num1', 'table-txt', 'table-txt1', 'web']) {
  const ex: string[] = []
  for (const [p, h] of all) for (const m of h.matchAll(new RegExp(`<p class="${cls}"[^>]*>([\s\S]*?)</p>`, 'g'))) ex.push(m[1].replace(/<[^>]+>/g, '').slice(0, 50))
  console.log(cls, ex.length, ex.slice(0, 6), ex.slice(-3))
}
