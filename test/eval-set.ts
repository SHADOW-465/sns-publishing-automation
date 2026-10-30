// The eval set: test/eval-pages.json plus the client's correction screenshots (test/eval-screenshots.csv, one row each).
// Columns: book, shot, page (empty when the screenshot shows none), kind, tag (the tag the thing should end up with), wrong, expected.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export const TAGS = ['Artifact', 'Figure', 'Caption', 'P', 'H2', 'H3', 'TOCI', 'L', 'Link']
export type EvalPage = { page: number | null; why?: string; shot?: string; kind?: string; tag?: string; wrong?: string; expected?: string }
export type EvalBook = { id: string; pages: EvalPage[]; [k: string]: unknown }

/** CSV text → rows; a field in "quotes" may hold commas and "" */
function rows(text: string): string[][] {
  const out: string[][] = [[]]
  let f = ''
  let q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) c === '"' ? (text[i + 1] === '"' ? ((f += '"'), i++) : (q = false)) : (f += c)
    else if (c === '"') q = true
    else if (c === ',') (out[out.length - 1].push(f), (f = ''))
    else if (c === '\n') (out[out.length - 1].push(f), (f = ''), out.push([]))
    else if (c !== '\r') f += c
  }
  return out.filter((r) => r.length > 1)
}

export function parseShots(text: string): (EvalPage & { book: string })[] {
  const seen = new Set<string>()
  return rows(text).slice(1).map(([book, shot, page, kind, tag, wrong, expected]) => {
    if (seen.has(shot)) throw new Error(`${shot} is in the sheet twice`)
    seen.add(shot)
    if (!TAGS.includes(tag)) throw new Error(`${shot}: tag "${tag}" is not one of ${TAGS.join(', ')}`)
    if (page !== '' && !/^\d+$/.test(page)) throw new Error(`${shot}: page "${page}" is not a number`)
    if (!wrong || !expected || !kind) throw new Error(`${shot}: kind, wrong and expected are needed`)
    return { book, shot, page: page === '' ? null : +page, kind, tag, wrong, expected }
  })
}

export function loadEvalSet(): { about: string[]; books: EvalBook[] } {
  const set = JSON.parse(readFileSync(resolve(import.meta.dirname, 'eval-pages.json'), 'utf8')) as { about: string[]; books: EvalBook[] }
  for (const s of parseShots(readFileSync(resolve(import.meta.dirname, 'eval-screenshots.csv'), 'utf8'))) {
    const book = set.books.find((b) => b.id === s.book)
    if (!book) throw new Error(`${s.shot}: no book "${s.book}" in the eval set`)
    const { book: _, ...page } = s
    book.pages.splice(book.pages.filter((p) => p.shot).length, 0, page)
  }
  return set
}
