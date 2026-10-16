// Structure diff of a built EPUB against a hand-finished reference (design §5 stage 6).
// Returns one line per difference; an empty list means the build matches the reference.
import { text, type Files } from '../src/engine/zip.ts'

const opf = (f: Files) => text([...f].find(([p]) => p.endsWith('.opf'))![1])
const page = (f: Files, name: string) => [...f].find(([p]) => p.endsWith(`/${name}`) || p === name)?.[1]
const spine = (f: Files) => [...opf(f).matchAll(/<itemref [^>]*idref="([^"]+)"/g)].map((m) => m[1])
const navLabels = (f: Files) => [...text(page(f, 'nav.xhtml') ?? new Uint8Array()).matchAll(/<a [^>]*>([^<]*)<\/a>/g)].map((m) => m[1])
const headings = (f: Files) =>
  [...f].filter(([p]) => /chapter\d+\.xhtml$/.test(p)).map(([p, d]) => `${p.split('/').pop()}: ${text(d).match(/<(h[1-6])((?: [^>]*)?)>/)?.[0].replace(/ (id|aria-[a-z]+)="[^"]*"/g, '') ?? 'none'}`)
const noteref = (f: Files) => [...new Set([...f].flatMap(([p, d]) => (p.endsWith('.xhtml') ? [...text(d).matchAll(/(<sup>)?<a [^>]*epub:type="noteref"/g)].map((m) => (m[1] ? 'sup' : 'bare')) : [])))].sort().join(',')
const guide = (f: Files) => [...opf(f).matchAll(/<reference type="([^"]+)"/g)].map((m) => m[1]).sort().join(',')
const coverTitle = (f: Files) => text(page(f, 'cover.xhtml') ?? new Uint8Array()).match(/<title>([^<]*)<\/title>/)?.[1]

export function refdiff(built: Files, ref: Files): string[] {
  const out: string[] = []
  const cmp = (what: string, a: unknown, b: unknown) => JSON.stringify(a) !== JSON.stringify(b) && out.push(`${what}: built ${JSON.stringify(a)}, reference ${JSON.stringify(b)}`)
  cmp('spine length', spine(built).length, spine(ref).length)
  cmp('menu labels', navLabels(built), navLabels(ref))
  cmp('chapter headings', headings(built), headings(ref))
  cmp('note reference markup', noteref(built), noteref(ref))
  cmp('guide references', guide(built), guide(ref))
  cmp('cover title', coverTitle(built), coverTitle(ref))
  return out
}
