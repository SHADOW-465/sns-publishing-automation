// Markup and style sheets of the spec workbook (design §4.6). A client's "expected" HTML sample becomes a
// MarkupTemplate; a styles table becomes a styleMap. Both round-trip through the exported workbook.
import type { MarkupRole, MarkupTemplate, StyleRule } from '../settings.ts'
import { ROLES } from '../indesign/read.ts'
import type { Sheet } from './office.ts'

export interface LayerData {
  markup: Partial<Record<MarkupRole, MarkupTemplate>>
  styleMap: Record<string, StyleRule>
  /** where each entry came from ("markup:chapter-title", "style:KT"): the sheet and row or report table row, and the text read */
  sources?: Record<string, { where: string; text: string }>
}

/** Only the entries a person confirmed (keys as in `sources`). */
export function selectLayerData(d: LayerData, keep: Set<string>): LayerData {
  return {
    markup: Object.fromEntries(Object.entries(d.markup).filter(([r]) => keep.has(`markup:${r}`))),
    styleMap: Object.fromEntries(Object.entries(d.styleMap).filter(([k]) => keep.has(k))),
    sources: d.sources,
  }
}

/** The client's own report (the Word file with an expected / tool output / comments table): each row whose first cell
 *  is an expected HTML sample becomes a template, with its table row as the source. */
export function layerDataFromReport(blocks: { text: string; where: string; cells?: string[] }[]): LayerData | undefined {
  const out: LayerData = { markup: {}, styleMap: {}, sources: {} }
  for (const b of blocks) {
    const sample = b.cells?.[0]?.trim()
    if (!sample || !/^</.test(sample)) continue
    const role: MarkupRole | undefined = /epub:type="noteref"/.test(sample) ? 'noteref' : /^<h[1-6][ >]/.test(sample) ? 'chapter-title' : undefined
    const t = role && !out.markup[role] ? parseMarkupSample(role, sample) : undefined
    if (role && t) (out.markup[role] = t), (out.sources![`markup:${role}`] = { where: b.where, text: sample })
  }
  return Object.keys(out.markup).length ? out : undefined
}

export const MARKUP_ROLES: MarkupRole[] = ['chapter-title', 'noteref']
export const MARKUP_HEAD = ['Element (role)', 'Expected HTML sample']
export const STYLES_HEAD = ['Source style', 'Means (role)', 'Output class']

/** One expected sample → tag, class and wrapper. Undefined when the sample has no element for that role. */
export function parseMarkupSample(role: MarkupRole, html: string): MarkupTemplate | undefined {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  if (role === 'noteref') {
    const a = doc.querySelector('a')
    if (!a) return undefined
    const parent = a.parentElement
    return { wrap: parent && parent.localName !== 'body' ? parent.localName : '' }
  }
  const el = doc.querySelector('h1,h2,h3,h4,h5,h6,p')
  if (!el) return undefined
  const cls = el.getAttribute('class')
  return { tag: el.localName, ...(cls ? { class: cls } : {}) }
}

/** A template as the sample a person would write (the Markup sheet). */
export function sampleOf(role: MarkupRole, t: MarkupTemplate): string {
  if (role === 'noteref') {
    const a = '<a epub:type="noteref" href="#fn-01">1</a>'
    return t.wrap ? `<${t.wrap}>${a}</${t.wrap}>` : a
  }
  const tag = t.tag ?? 'h2'
  return `<${tag}${t.class ? ` class="${t.class}"` : ''}>Natur</${tag}>`
}

export function markupSheets(d: LayerData): Sheet[] {
  const mk = MARKUP_ROLES.filter((r) => d.markup[r]).map((r) => [r, sampleOf(r, d.markup[r]!)])
  const st = Object.values(d.styleMap).map((s) => [s.match, s.role, s.class ?? ''])
  return [
    { name: 'Markup', rows: [MARKUP_HEAD, ...(mk.length ? mk : [['chapter-title', ''], ['noteref', '']])], widths: [22, 80] },
    { name: 'Styles', rows: [STYLES_HEAD, ...(st.length ? st : [['', '', '']])], widths: [28, 22, 22], lists: [{ ref: 'B2:B200', values: [...ROLES] }] },
  ]
}

/** The Markup and Styles sheets of a workbook, or undefined when it has neither. */
export function layerDataFromWorkbook(sheets: Sheet[]): LayerData | undefined {
  const out: LayerData = { markup: {}, styleMap: {}, sources: {} }
  const find = (name: string, head: string[]) => sheets.find((s) => s.name.toLowerCase() === name.toLowerCase() && s.rows[0]?.[0]?.trim().toLowerCase() === head[0].toLowerCase())
  find('Markup', MARKUP_HEAD)?.rows.slice(1).forEach((row, i) => {
    const role = (row[0] ?? '').trim() as MarkupRole
    if (!MARKUP_ROLES.includes(role) || !(row[1] ?? '').trim()) return
    const t = parseMarkupSample(role, row[1])
    if (t) (out.markup[role] = t), (out.sources![`markup:${role}`] = { where: `Markup sheet, row ${i + 2}`, text: row[1].trim() })
  })
  find('Styles', STYLES_HEAD)?.rows.slice(1).forEach((row, i) => {
    const [match, role, cls] = [(row[0] ?? '').trim(), (row[1] ?? '').trim(), (row[2] ?? '').trim()]
    if (match && (ROLES as readonly string[]).includes(role)) (out.styleMap[`style:${match}`] = { match, role, ...(cls ? { class: cls } : {}) }), (out.sources![`style:${match}`] = { where: `Styles sheet, row ${i + 2}`, text: `${match} → ${role}${cls ? ` (${cls})` : ''}` })
  })
  return Object.keys(out.markup).length || Object.keys(out.styleMap).length ? out : undefined
}
