// Reads a tagged PDF back the way assistive technology does (pdf.js structure tree + marked
// content) and prints the text of each structure element in reading order.
//   node test/read-tags.ts file.pdf [firstPage] [lastPage]
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { readFileSync } from 'node:fs'

export async function readTags(data: Uint8Array, from = 1, to = 3) {
  const doc = await pdfjs.getDocument({ data, disableFontFace: true } as never).promise
  const out: string[] = []
  for (let p = from; p <= Math.min(to, doc.numPages); p++) {
    const page = await doc.getPage(p)
    const tree = await page.getStructTree()
    const tc = await page.getTextContent({ includeMarkedContent: true })
    const text = new Map<string, string>()
    let cur: string | null = null
    for (const it of tc.items as any[]) {
      if (it.type === 'beginMarkedContentProps' || it.type === 'beginMarkedContent') cur = it.id ?? null
      else if (it.type === 'endMarkedContent') cur = null
      else if (cur && typeof it.str === 'string') text.set(cur, (text.get(cur) ?? '') + it.str + (it.hasEOL ? ' ' : ''))
    }
    const walk = (n: any, depth: number) => {
      if (n.type === 'content') return text.get(n.id) ?? ''
      const t = (n.children ?? []).map((c: any) => walk(c, depth + 1)).join('')
      if (n.role && n.role !== 'Root' && !['Document', 'Sect', 'L', 'LI', 'TOC'].includes(n.role))
        out.push(`p${p} ${'  '.repeat(Math.max(0, depth - 2))}${n.role}${n.alt ? ` [alt: ${n.alt.slice(0, 50)}]` : ''}: ${t.replace(/\s+/g, ' ').trim().slice(0, 110)}`)
      return t
    }
    if (tree) walk(tree, 0)
  }
  return out
}

if (process.argv[1]?.endsWith('read-tags.ts')) {
  const lines = await readTags(new Uint8Array(readFileSync(process.argv[2])), Number(process.argv[3] ?? 1), Number(process.argv[4] ?? 3))
  console.log(lines.join('\n'))
}
