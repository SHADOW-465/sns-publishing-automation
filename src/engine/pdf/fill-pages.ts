import type { PrintPage } from './pages.ts'

// Restores page markers the InDesign export left out (the production team added these by hand
// from the print PDF). The marker goes exactly where the printed page starts — mid-word when
// the page starts mid-word — found by matching the first words of that PDF page.

export interface Doc {
  file: string
  body: string
}

const norm1 = (c: string) => c.toLocaleLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]/gu, '')
const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

/** normalised text of an HTML string + map from normalised char → html offset */
function index(html: string): { text: string; at: number[] } {
  let text = ''
  const at: number[] = []
  for (let i = 0; i < html.length; ) {
    if (html[i] === '<') {
      const close = html.indexOf('>', i)
      if (close < 0) break
      i = close + 1
      continue
    }
    let ch = html[i]
    let len = 1
    if (ch === '&') {
      const m = html.slice(i).match(/^&(#x?[0-9a-f]+|\w+);/i)
      if (m) {
        ch = m[1][0] === '#' ? String.fromCodePoint(parseInt(m[1].slice(m[1][1] === 'x' ? 2 : 1), m[1][1] === 'x' ? 16 : 10)) : ENT[m[1]] ?? ' '
        len = m[0].length
      }
    }
    for (const c of norm1(ch)) {
      text += c
      at.push(i)
    }
    i += len
  }
  return { text, at }
}

const markerRe = (n: string) => new RegExp(`<span[^>]*id="page-${n}"[^>]*/>`)

export function fillMissingPages(
  docs: Doc[], pages: PrintPage[], span: (n: string) => string,
): { added: string[]; missing: string[]; removed: string[] } {
  // the house style has no markers for blank printed pages
  const removed: string[] = []
  for (const p of pages.filter((x) => x.blank)) {
    for (const d of docs) {
      const before = d.body
      d.body = d.body.replace(markerRe(p.n), '')
      if (before !== d.body) removed.push(p.n)
    }
  }
  const present = () => new Set(docs.flatMap((d) => [...d.body.matchAll(/id="page-(\d+)"/g)].map((m) => Number(m[1]))))
  const have = present()
  if (!have.size) return { added: [], missing: [], removed }
  const lo = Math.min(...have)
  const hi = Math.max(...have)
  const added: string[] = []
  const missing: string[] = []
  const find = (n: number) => {
    for (let d = 0; d < docs.length; d++) {
      const m = docs[d].body.match(markerRe(String(n)))
      if (m) return { d, end: m.index! + m[0].length }
    }
    return undefined
  }
  for (let n = lo + 1; n < hi; n++) {
    if (have.has(n)) continue
    const pp = pages.find((p) => p.n === String(n))
    if (pp?.blank) continue
    let back = n - 1
    while (back > lo && !find(back)) back--
    const prev = find(back)
    if (!pp || !prev) {
      missing.push(String(n))
      continue
    }
    const needle = [...pp.text].map(norm1).join('').slice(0, 40)
    let done = false
    if (!needle) {
      // blank page: its marker sits right after the previous page's marker
      const d = docs[prev.d]
      d.body = d.body.slice(0, prev.end) + span(String(n)) + d.body.slice(prev.end)
      done = true
    } else {
      // search from the previous marker up to the next existing marker
      for (let d = prev.d; d < docs.length && !done; d++) {
        const from = d === prev.d ? prev.end : 0
        const next = docs[d].body.slice(from).search(/<span[^>]*id="page-\d+"/)
        const chunk = docs[d].body.slice(from, next < 0 ? undefined : from + next)
        const ix = index(chunk)
        const hit = ix.text.indexOf(needle.slice(0, Math.min(needle.length, 30)))
        if (hit >= 0) {
          const pos = from + ix.at[hit]
          docs[d].body = docs[d].body.slice(0, pos) + span(String(n)) + docs[d].body.slice(pos)
          done = true
        }
        if (next >= 0) break
      }
    }
    if (done) {
      added.push(String(n))
      have.add(n)
    } else missing.push(String(n))
  }
  return { added, missing, removed }
}
