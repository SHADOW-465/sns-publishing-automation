// =============================================================================================
// The client's Book_Details workbook (sheet "metadata": title, author, publisher, e-ISBN; sheet "NAV-NCX": one row per
// content file with its name, navigation level, title, pages, epub:type and role). It is a BOOK-layer setting read by
// the spec loader (requirements.ts); nothing here names a book. The build applies it in packageEpub:
//   FIL-001  the file of each row gets the name the client gave it
//   SEM-001  and the epub:type / role of that row
//   NAV-001/002  the menu entry takes the row's title (level blank = no entry), when the rule FIL-01 says "plan"
// A row is matched to the section of the book it describes by (in this order of weight) its title, the page it starts
// on, and the kind of section its epub:type names. A row that matches nothing is reported, never guessed.
// =============================================================================================
import type { Sheet } from './office.ts'
import type { Section } from '../epub/package.ts'
import type { SectionType } from '../epub/locale.ts'

export interface BookDetailsFile {
  /** the spreadsheet row, for messages */
  row: number
  /** "chapter01.xhtml"; empty when the sheet gives no name (the section keeps its own) */
  file: string
  /** "1" = in the menu; empty = not in the menu */
  level: string
  title: string
  start?: number
  end?: number
  /** from the cell `epub:type="chapter" role="doc-chapter"` */
  epubType: string
  role: string
}
export interface BookDetails {
  /** the workbook's file name */
  source: string
  title: string
  author: string
  publisher: string
  pageCount?: number
  eisbn: string
  files: BookDetailsFile[]
}

const fold = (s: string) => s.toLocaleLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const num = (s: string | undefined) => (s && /^\d+$/.test(s.trim()) ? Number(s.trim()) : undefined)

/** `epub:type="frontmatter" role="doc-toc"` (straight or curly quotes) → both values */
export function parseTypeCell(cell: string): { epubType: string; role: string } {
  const pick = (name: string) => cell.match(new RegExp(`${name}\\s*=\\s*["“”'‘’]([^"“”'‘’]*)["“”'‘’]`, 'i'))?.[1].trim() ?? ''
  return { epubType: pick('epub:type'), role: pick('role') }
}

/** The Book_Details sheets of a workbook, or undefined when it has no NAV-NCX table (a header whose first cell is "Chapter Name"). */
export function bookDetailsFromWorkbook(sheets: Sheet[], source = ''): BookDetails | undefined {
  const nav = sheets.find((s) => /^chapter name$/i.test((s.rows[0]?.[0] ?? '').trim()))
  if (!nav) return undefined
  const head = nav.rows[0].map((h) => fold(h ?? ''))
  const col = (re: RegExp) => head.findIndex((h) => re.test(h))
  const [cFile, cLevel, cTitle, cStart, cEnd, cType] = [/^chapter name/, /^navigation level/, /^title/, /^start page/, /^end page/, /^epub type/].map(col)
  const cell = (r: string[], c: number) => (c >= 0 ? (r[c] ?? '').trim() : '')
  const files: BookDetailsFile[] = []
  nav.rows.slice(1).forEach((r, i) => {
    if (!r || ![cFile, cTitle, cStart, cType].some((c) => cell(r, c))) return
    files.push({ row: i + 2, file: cell(r, cFile), level: cell(r, cLevel), title: cell(r, cTitle), start: num(cell(r, cStart)), end: num(cell(r, cEnd)), ...parseTypeCell(cell(r, cType)) })
  })
  const meta = new Map<string, string>()
  for (const s of sheets) if (s !== nav && /^metadata$/i.test(s.name)) for (const r of s.rows) if (r?.[0]) meta.set(fold(r[0]), (r[1] ?? '').trim())
  const m = (...keys: string[]) => keys.map((k) => meta.get(k)).find(Boolean) ?? ''
  return { source, title: m('title'), author: m('author'), publisher: m('publisher'), pageCount: num(m('page count')), eisbn: m('eisbn', 'e isbn', 'isbn'), files }
}

/** The section kinds an epub:type (with its role) can describe. Empty = the type says nothing about the kind; title and page decide. */
function kindsOf(f: BookDetailsFile): SectionType[] {
  const front: SectionType[] = ['other', 'epigraph', 'list', 'foreword', 'preface', 'introduction', 'dedication']
  if (f.role === 'doc-toc' || f.epubType === 'toc') return ['toc', 'list']
  switch (f.epubType) {
    case 'halftitle': case 'halftitlepage': return ['halftitle']
    case 'title': case 'titlepage': return ['title']
    case 'frontmatter': return front
    case 'chapter': return ['chapter', 'introduction', 'preface', 'foreword', 'prologue', 'conclusion', 'epilogue', 'afterword']
    case 'note': case 'endnotes': case 'footnotes': return ['notes']
    case 'backmatter': return ['bibliography', 'appendix', 'glossary', 'index', 'list', 'afterword', 'epilogue', 'other']
    case 'credits': return ['other', 'list', 'acknowledgments', 'contributors']
    case 'dedication': case 'acknowledgments': return ['dedication', 'acknowledgments', 'epigraph']
    case 'contributors': return ['about', 'contributors']
    case 'copyright-page': return ['copyright']
    case 'index': return ['index']
    case 'glossary': return ['glossary']
    case 'bibliography': return ['bibliography']
    case 'appendix': return ['appendix']
    default: return []
  }
}

const firstPage = (s: Section) => s.body.match(/id="page-([^"]+)"/)?.[1]

/** How well a row describes a section: title 4 (equal) or 2 (one contains the other), start page 3, kind 1. 0 = no evidence. */
function score(f: BookDetailsFile, s: Section): number {
  let n = 0
  const t = fold(f.title)
  for (const name of [s.nav, s.title]) {
    const x = fold(name ?? '')
    if (!t || !x) continue
    if (t === x) { n += 4; break }
    if (Math.min(t.length, x.length) >= 4 && (t.includes(x) || x.includes(t))) { n = Math.max(n, 2) }
  }
  if (f.start !== undefined && firstPage(s) === String(f.start)) n += 3
  if (kindsOf(f).includes(s.type)) n += 1
  return n
}

export interface PlanResult {
  sections: Section[]
  /** old file → new file */
  renamed: [string, string][]
  /** rows that describe no section of the book */
  unmatched: BookDetailsFile[]
  /** sections no row describes: they keep their own names */
  unplanned: Section[]
  /** rows whose wanted name is already another file's: not renamed */
  clashes: { row: BookDetailsFile; with: string }[]
}

const retag = (body: string, f: BookDetailsFile) =>
  f.epubType || f.role
    ? body.replace(/^(\s*)<section\b([^>]*)>/, (_m, lead: string, attrs: string) => {
        const rest = attrs.replace(/\s+(?:epub:type|role)="[^"]*"/g, '')
        const type = f.epubType || attrs.match(/epub:type="([^"]*)"/)?.[1] || ''
        return `${lead}<section${rest}${type ? ` epub:type="${type}"` : ''}${f.role ? ` role="${f.role}"` : ''}>`
      })
    : body

/**
 * The plan applied to the sections of a built book: file names, epub:type and role (SEM-001), and the menu title (when `nav` is "plan").
 * Links to a renamed file are rewritten in every section. The sections keep their order.
 */
export function applyBookDetails(sections: Section[], d: BookDetails, nav: 'plan' | 'keep' = 'plan'): PlanResult {
  // the cover row describes cover.xhtml, which is not one of the sections
  const rows = d.files.filter((f) => f.epubType !== 'cover' && !/^cover\.xhtml$/i.test(f.file))
  const pairs: { r: number; s: number; score: number; gap: number }[] = []
  rows.forEach((f, r) => sections.forEach((s, i) => {
    const sc = score(f, s)
    if (sc > 0) pairs.push({ r, s: i, score: sc, gap: Math.abs(r / rows.length - i / sections.length) })
  }))
  pairs.sort((a, b) => b.score - a.score || a.gap - b.gap)
  const rowOf = new Map<number, number>() // section index → row index
  const taken = new Set<number>()
  for (const p of pairs) if (p.score >= 2 && !taken.has(p.r) && !rowOf.has(p.s)) (taken.add(p.r), rowOf.set(p.s, p.r))
  // the kind alone proves little: a chapter is one of many. It decides only when one row and one section are left of that kind
  const weak = pairs.filter((p) => p.score < 2 && !taken.has(p.r) && !rowOf.has(p.s) && !kindsOf(rows[p.r]).includes('chapter'))
  for (const p of weak)
    if (weak.filter((q) => q.r === p.r).length === 1 && weak.filter((q) => q.s === p.s).length === 1) (taken.add(p.r), rowOf.set(p.s, p.r))

  const renamed: [string, string][] = []
  const clashes: PlanResult['clashes'] = []
  const target = new Map<string, string>()
  // a wanted name is refused when a section the plan does not describe already keeps it, or two rows want it
  const wanted = new Map<number, BookDetailsFile>()
  for (const [i, r] of rowOf) if (rows[r].file) wanted.set(i, rows[r])
  const kept = new Set(sections.filter((_, i) => !wanted.has(i)).map((s) => s.file))
  const count = new Map<string, number>()
  for (const f of wanted.values()) count.set(f.file, (count.get(f.file) ?? 0) + 1)
  const out = sections.map((s, i) => {
    const f = rowOf.has(i) ? rows[rowOf.get(i)!] : undefined
    if (!f) return s
    let file = s.file
    if (f.file && f.file !== s.file) {
      if (kept.has(f.file) || count.get(f.file)! > 1) clashes.push({ row: f, with: f.file })
      else file = f.file
    }
    if (file !== s.file) (renamed.push([s.file, file]), target.set(s.file, file))
    // ponytail: a refused row keeps the section's old name, which a later row could also want; the guard (FIL-001) then finds the name missing
    return { ...s, file, id: file === s.file ? s.id : file.replace(/\.xhtml$/i, ''), nav: nav === 'plan' ? (f.level ? f.title || s.nav : '') : s.nav, body: retag(s.body, f) }
  })
  // a renamed file is linked by its new name everywhere ("chapter02.xhtml#chap2" → "chapter01.xhtml#chap2")
  const relink = (t: string) => t.replace(/(href=")([^"#]*?)(\.xhtml)(#[^"]*)?"/g, (m, a: string, stem: string, ext: string, frag = '') => (target.has(stem + ext) ? `${a}${target.get(stem + ext)!}${frag}"` : m))
  const final = target.size ? out.map((s) => ({ ...s, body: relink(s.body), parent: s.parent && target.has(s.parent) ? target.get(s.parent) : s.parent })) : out
  return {
    sections: final,
    renamed,
    unmatched: rows.filter((_, r) => !taken.has(r)),
    unplanned: sections.filter((_, i) => !rowOf.has(i)),
    clashes,
  }
}
