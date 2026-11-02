// The Review page's data: every finding the tool already produces (quality check, conversion notes, EPUBCheck, accessibility,
// "left unsure" decisions) plus the small detectors in qc-detect.ts, sorted under the seven headings a QC checker works through.
// Only items that need action are kept; a heading with none is a pass. Pure and read-only: nothing here touches book text.
import type { Files } from '../zip.ts'
import type { CheckReport } from '../check/epub.ts'
import { extraReview } from '../check/counts.ts'
import type { ReviewItem } from '../epub/package.ts'
import type { ValidatorResult } from '../check/gate.ts'
import type { DecisionNote } from './decisions.ts'
import { detectQc, type QcHeadingKey, type QcItem } from './qc-detect.ts'

export type { QcItem, QcHeadingKey }

export const QC_HEADINGS: { key: QcHeadingKey; title: string; checks: string }[] = [
  { key: 'text', title: 'Text & characters', checks: 'missing or repeated text, hyphens, soft hyphens, small caps' },
  { key: 'formatting', title: 'Formatting', checks: 'italic, bold, bold-italic, layout against the print book' },
  { key: 'structure', title: 'Structure', checks: 'headings, tables, sections, language' },
  { key: 'order', title: 'Reading order', checks: 'the spine, the menu order, page numbers in sequence' },
  { key: 'navigation', title: 'Navigation', checks: 'contents, page list, page IDs, index links, footnote links' },
  { key: 'images', title: 'Images', checks: 'missing pictures, alt text, colour mode, size' },
  { key: 'metadata', title: 'Metadata & validation', checks: 'book details, accessibility metadata, EPUBCheck, accessibility check' },
]

export interface QcSection {
  key: QcHeadingKey
  title: string
  checks: string
  items: QcItem[]
  errors: number
  warnings: number
  /** validators that did not run: they need action too, but are not items in the book */
  notRun: string[]
}

/** Which heading a finding belongs to, and the sub-group it is listed under. First match wins. */
const ROUTES: { re: RegExp; heading: QcHeadingKey; kind: string; rule?: string }[] = [
  { re: /TOC entry|Contents entry|contents entries (?:show|do)|menu entr|navigation entr|table of contents|navigation (?:document|menu)|landmark|page list/i, heading: 'navigation', kind: 'Contents and menu', rule: 'NAV-008' },
  { re: /Sections with a heading that are missing from the navigation/i, heading: 'navigation', kind: 'Contents and menu', rule: 'NAV-001' },
  { re: /\bNAV-\d+|\bPGM-\d+|\bIDX-\d+|\bSEM-005|page marker|page number|printed page|note (?:call|link)|footnote|endnote|index/i, heading: 'navigation', kind: 'Pages, notes and links' },
  { re: /spine|reading order|backwards|DOC-012/i, heading: 'order', kind: 'Order of the parts' },
  { re: /\bIMG-\d+|picture|image|alt\b|alt text|description|cover is only|decorative|caption/i, heading: 'images', kind: 'Pictures' },
  { re: /\bTBL-\d+|table|column widths/i, heading: 'structure', kind: 'Tables' },
  { re: /heading|\bHD-\d+|\bSEM-\d+|language on the page|no landmarks|section|aria|role/i, heading: 'structure', kind: 'Headings and sections' },
  { re: /\bTXT-007|small.?caps|alignment|indent|Page \S+:|print book|\bTYP-\d+|font|CSS|class/i, heading: 'formatting', kind: 'Layout and style' },
  { re: /\bTXT-\d+|words?\b|paragraph|repeated|duplicated|text missing|hyphen|characters/i, heading: 'text', kind: 'Missing or repeated text' },
  { re: /ISBN|title|author|creator|publisher|metadata|dc:|dcterms|identifier|package|manifest|OPF|mimetype|XML|conformance|cover image/i, heading: 'metadata', kind: 'Book details and package' },
]

const GROUP_HEADING: Record<string, QcHeadingKey> = { valid: 'metadata', a11y: 'structure', content: 'text', look: 'formatting', details: 'metadata' }

const ruleOf = (msg: string) => msg.match(/\b([A-Z]{2,4}-\d{3})\b/)?.[1]

export interface QcInput {
  files: Files
  /** content folder inside the package: 'OEBPS/' for our books */
  base?: string
  report: CheckReport
  review?: ReviewItem[]
  /** EPUBCheck: undefined = not asked yet, null = could not run */
  ec?: ValidatorResult | null
  a11y?: (ValidatorResult & { by: string }) | null
  /** decisions still unsure when the file is made */
  left?: DecisionNote[]
}

/** Finds the file, the page marker and the picture an old-style finding is about, from its `where` and its words. */
function locator(files: Files, base: string) {
  const names = new Map<string, string>()
  let pics: Map<string, { file: string; anchor?: string; page?: string }> | undefined
  let pages: Map<string, { file: string; anchor: string }> | undefined
  const scan = () => {
    pics = new Map()
    pages = new Map()
    for (const [p, d] of files) {
      if (!p.endsWith('.xhtml')) continue
      const file = p.startsWith(base) ? p.slice(base.length) : p
      names.set(p.split('/').pop()!, file)
      const html = new TextDecoder().decode(d)
      for (const m of html.matchAll(/\bid="(?:page-|Page_|pg_)([^"]+)"/g)) if (!pages.has(m[1])) pages.set(m[1], { file, anchor: m[0].slice(4, -1) })
      for (const m of html.matchAll(/<img\b[^>]*\bsrc="([^"]+)"/g)) {
        const k = base0(m[1])
        if (pics.has(k)) continue
        const before = [...html.slice(0, m.index ?? 0).matchAll(/\bid="((?:page-|Page_|pg_)([^"]+))"/g)].pop()
        pics.set(k, { file, anchor: before?.[1], page: before?.[2] })
      }
    }
  }
  return (msg: string, where?: string): Pick<QcItem, 'file' | 'anchor' | 'page'> => {
    if (!pics) scan()
    const named = [where, ...(msg.match(/[\w.-]+\.x?html?\b/g) ?? [])].filter(Boolean).map((w) => base0(w!)).find((n) => names.has(n))
    if (named) {
      const page = msg.match(/\bpage (?:marker )?[“"]?([\dIVXLCivxlc]+)\b/i)?.[1]
      const home = page ? pages!.get(page) : undefined
      return home && home.file === names.get(named) ? { file: home.file, anchor: home.anchor, page } : { file: names.get(named) }
    }
    const pic = msg.match(/[\w.-]+\.(?:jpe?g|png|gif|svg|webp)\b/i)?.[0]
    if (pic && pics!.has(pic)) return pics!.get(pic)!
    const page = msg.match(/\b[Pp]age (?:marker )?[“"]?([\dIVXLCivxlc]+)\b/)?.[1]
    const home = page ? pages!.get(page) : undefined
    return home ? { file: home.file, anchor: home.anchor, page } : {}
  }
}
const base0 = (p: string) => p.split('/').pop() ?? p

/** Every item that needs action, under its heading. */
export function buildQc(input: QcInput): QcSection[] {
  const bs = input.base ?? 'OEBPS/'
  const where = locator(input.files, bs)
  const items: QcItem[] = []
  const seen = new Set<string>()
  let n = 0
  const push = (level: 'error' | 'warn', msg: string, source: string, w?: string, groupId?: string) => {
    const clean = msg.replace(/\s+/g, ' ').trim()
    if (seen.has(clean)) return
    seen.add(clean)
    const route = ROUTES.find((r) => r.re.test(clean))
    items.push({
      id: `f${n++}`,
      level,
      heading: route?.heading ?? GROUP_HEADING[groupId ?? ''] ?? 'metadata',
      kind: route?.kind ?? source,
      rule: ruleOf(clean) ?? route?.rule,
      msg: clean,
      source,
      ...where(clean, w),
    })
  }
  for (const g of input.report.groups) for (const f of g.findings) if (f.level !== 'pass') push(f.level, f.msg, g.title, f.where, g.id)
  for (const r of extraReview(input.report, input.review ?? [])) push(r.level === 'error' ? 'error' : 'warn', r.msg, 'Conversion', r.where)
  if (input.ec) for (const m of input.ec.errors) push('error', m, 'EPUBCheck', undefined, 'valid')
  if (input.ec) for (const m of input.ec.warnings) push('warn', m, 'EPUBCheck', undefined, 'valid')
  if (input.a11y) for (const m of input.a11y.errors) push('error', m, input.a11y.by, undefined, 'a11y')
  for (const d of input.left ?? []) {
    const heading: QcHeadingKey = /^Pictures/.test(d.step) ? 'images' : /^Book details/.test(d.step) ? 'metadata' : /^Structure/.test(d.step) ? 'structure' : 'text'
    const msg = `${d.item}${d.where ? ` (${d.where})` : ''}: still unsure, kept as the tool guessed.`
    if (!seen.has(msg)) { seen.add(msg); items.push({ id: `f${n++}`, level: 'warn', heading, kind: 'Left unsure', msg, source: d.step, ...where(d.item, d.where) }) }
  }
  items.push(...detectQc(input.files, bs))

  const notRun: Record<string, string[]> = {}
  if (input.ec === null) (notRun.metadata ??= []).push('EPUBCheck did not run here. Run it before delivery.')
  if (input.a11y === null) (notRun.metadata ??= []).push('The accessibility check did not run here. Run Ace by DAISY before certification.')

  const rank = (i: QcItem) => (i.level === 'error' ? 0 : 1)
  return QC_HEADINGS.map((h) => {
    const mine = items.filter((i) => i.heading === h.key).sort((a, b) => rank(a) - rank(b))
    return { ...h, items: mine, errors: mine.filter((i) => i.level === 'error').length, warnings: mine.filter((i) => i.level === 'warn').length, notRun: notRun[h.key] ?? [] }
  })
}

/** The line a heading leads with: its pass state or the count that needs action. */
export function stateOf(s: QcSection): { tone: 'good' | 'meh' | 'bad'; label: string } {
  const open = s.items.length + s.notRun.length
  if (!open) return { tone: 'good', label: 'Passed' }
  if (s.errors) return { tone: 'bad', label: `${s.errors} to fix${s.warnings ? `, ${s.warnings} to check` : ''}` }
  return { tone: 'meh', label: `${s.warnings || s.notRun.length} to check` }
}
