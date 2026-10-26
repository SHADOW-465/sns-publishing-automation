import { COMPANY, CREDIT, FILEISH, NAME, NOT_A_NAME, nameCase, norm } from '../indesign/front.ts'
import { sectionTypeOf } from '../epub/locale.ts'
import { plausibleAuthor } from '../epub/names.ts'

// =============================================================================================
// Print PDF → EPUB: title, subtitle and author from the title page, the half-title and the cataloguing lines of the imprint.
// The title is the biggest type on the title page; the author is a person line that the imprint confirms ("The right of X to be
// identified", "Copyright © X", "Family, Given, 1950–") or that looks like a name. A printing line is never the author.
// =============================================================================================

export interface FrontLine {
  text: string
  size: number
  y: number
}
export interface FrontPage {
  index: number
  lines: FrontLine[]
}
export interface FrontRead {
  title: string
  subtitle: string
  author: string
  /** PDF page index of the full title page / of the half-title, when the PDF has them */
  titlePage?: number
  halfTitle?: number
}

const YEAR = String.raw`(?:1[5-9]|20)\d{2}`
const clean = (s: string) => s.replace(/\s+/g, ' ').replace(/[\s,;:.]+$/, '').trim()

/** Names the imprint gives for the author, most reliable first. */
export function imprintAuthors(lines: string[]): string[] {
  const out: string[] = []
  const add = (s: string | undefined) => {
    const t = clean((s ?? '').replace(/^(?:by|text by|written by)\s+/i, '').replace(new RegExp(`\\s*\\b${YEAR}\\b.*$`), ''))
    if (t && plausibleAuthor(t) && !COMPANY.test(t) && !NOT_A_NAME.test(t) && !out.includes(t)) out.push(t)
  }
  const text = lines.map((l) => l.trim())
  for (const t of text) add(t.match(/\bthe right of (.+?) to be identified/i)?.[1])
  for (const t of text) add(t.match(/^(?:copyright\s*)?(?:©|\(c\)|c(?=\s+\p{Lu}))\s*(?:(?:19|20)\d{2}\s*(?:by\s+)?)?(.+)$/iu)?.[1])
  // cataloguing record: "Poulton-Smith, Anthony, 1950–" → "Anthony Poulton-Smith"
  for (const t of text) {
    const m = t.match(/^(\p{Lu}[\p{L}'’-]+(?: \p{Lu}[\p{L}'’-]+)*),\s+(\p{Lu}[\p{L}.'’ -]*?),?\s+(?:b\.\s*|\()?(?:1[5-9]|20)\d{2}\s*[-–)]/u)
    if (m) add(`${m[2]} ${m[1]}`)
  }
  for (const t of text) add(t.match(/^(?:text|words|written) by (.+)$/i)?.[1])
  return out
}

/** "Anthony Poulton-Smith", "A. Autor and B. Autora": every part is a name. Returns the names joined with ", ", or '' */
function personLine(raw: string, lang: string): string {
  const t = clean(raw.replace(/^(?:by|von|par|por|di)\s+/i, ''))
  if (!t || !plausibleAuthor(t) || COMPANY.test(t) || CREDIT.test(t) || NOT_A_NAME.test(t) || FILEISH.test(t) || sectionTypeOf(t)) return ''
  const parts = t.split(/\s*(?:,|&|\band\b|\by\b|\bund\b|\bet\b)\s*/i).map((p) => nameCase(p.trim(), lang)).filter(Boolean)
  return parts.length && parts.length <= 4 && parts.every((p) => p.split(/\s+/).length <= 5 && NAME.test(p)) ? parts.join(', ') : ''
}

export function readFront(
  pages: FrontPage[], imprint: string[], fromFile: { title: string; author: string }, titleCase: (s: string) => string, lang = 'en',
): FrontRead {
  const evidence = imprintAuthors(imprint)
  const known = (t: string) => evidence.some((e) => norm(e) === norm(t) || (norm(t).length > 4 && norm(e).includes(norm(t))))
  const text = pages.filter((p) => p.lines.some((l) => l.text.trim()))

  const read = (p: FrontPage) => {
    const ls = p.lines.filter((l) => l.text.trim()).sort((a, b) => a.y - b.y)
    const max = Math.max(...ls.map((l) => l.size))
    const titleLines = ls.filter((l) => l.size >= max * 0.8)
    const rest = ls.filter((l) => !titleLines.includes(l))
    // the author: a line the imprint confirms, else the first line that reads as a person
    const confirmed = rest.find((l) => !!personLine(l.text, lang) && known(personLine(l.text, lang).split(', ')[0]))
    const person = confirmed ?? rest.find((l) => !!personLine(l.text, lang))
    return { p, ls, titleLines, rest, author: person ? personLine(person.text, lang) : '', authorLine: person, confirmed: !!confirmed }
  }
  const reads = text.map(read)
  // the title page is the page that names the author; failing that, the fullest page
  const best = [...reads].sort((a, b) => Number(b.confirmed) - Number(a.confirmed) || Number(!!b.author) - Number(!!a.author) || b.ls.length - a.ls.length)[0]
  const titlePage = best && (best.author || reads.length > 1) ? best : undefined
  // a half-title is an earlier page that holds nothing but (part of) the title
  const inTitle = (r: ReturnType<typeof read>, of: ReturnType<typeof read>) => {
    const whole = norm(of.ls.map((l) => l.text).join(''))
    return r.ls.length > 0 && r.ls.every((l) => whole.includes(norm(l.text)))
  }
  const half = titlePage
    ? reads.filter((r) => r !== titlePage && r.p.index < titlePage.p.index && inTitle(r, titlePage)).sort((a, b) => b.p.index - a.p.index)[0]
    : reads[0]
  const main = titlePage ?? half
  const joined = (r?: ReturnType<typeof read>) => (r ? r.titleLines.map((l) => l.text.trim()).join(' ') : '')

  let title = titleCase(joined(main))
  if (!title && fromFile.title && !FILEISH.test(fromFile.title)) title = titleCase(fromFile.title)
  let author = titlePage?.author ?? ''
  // the author never stays in the title ("A Dark History of Birmingham Anthony Poulton-Smith")
  if (author) {
    const a = author.split(', ')[0]
    const at = title.toLowerCase().lastIndexOf(a.toLowerCase())
    if (at > 0 && title.length - at <= a.length + 3) title = clean(title.slice(0, at))
  }
  if (!author) author = evidence[0] ?? ''
  if (!author) author = personLine(fromFile.author, lang)
  if (author && !plausibleAuthor(author)) author = ''

  // subtitle: what the title page prints between the title and the author (or after the title, with no author line)
  let subtitle = ''
  const src = titlePage ?? half
  if (src && src !== half) {
    const sub = src.rest.filter((l) => l !== src.authorLine && !personLine(l.text, lang) && !COMPANY.test(l.text) && !CREDIT.test(l.text) && !FILEISH.test(l.text) && !/©|\bisbn\b|copyright/i.test(l.text)
      && (!src.authorLine || l.y < src.authorLine.y))
    subtitle = titleCase(sub.map((l) => l.text.trim()).join(' '))
  } else if (half) {
    subtitle = titleCase(half.rest.filter((l) => !COMPANY.test(l.text) && !personLine(l.text, lang)).map((l) => l.text.trim()).join(' '))
  }
  return { title, subtitle, author, titlePage: titlePage?.p.index, halfTitle: half?.p.index }
}
