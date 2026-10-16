// Markup and style sheets of the spec workbook (design §4.6). A client's "expected" HTML sample becomes a
// MarkupTemplate; a styles table becomes a styleMap. Both round-trip through the exported workbook.
import type { MarkupRole, MarkupTemplate, StyleRule } from '../settings.ts'
import { ROLES } from '../indesign/read.ts'
import type { Sheet } from './office.ts'

export interface LayerData {
  markup: Partial<Record<MarkupRole, MarkupTemplate>>
  styleMap: Record<string, StyleRule>
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
  const out: LayerData = { markup: {}, styleMap: {} }
  const find = (name: string, head: string[]) => sheets.find((s) => s.name.toLowerCase() === name.toLowerCase() && s.rows[0]?.[0]?.trim().toLowerCase() === head[0].toLowerCase())
  for (const row of find('Markup', MARKUP_HEAD)?.rows.slice(1) ?? []) {
    const role = (row[0] ?? '').trim() as MarkupRole
    if (!MARKUP_ROLES.includes(role) || !(row[1] ?? '').trim()) continue
    const t = parseMarkupSample(role, row[1])
    if (t) out.markup[role] = t
  }
  for (const row of find('Styles', STYLES_HEAD)?.rows.slice(1) ?? []) {
    const [match, role, cls] = [(row[0] ?? '').trim(), (row[1] ?? '').trim(), (row[2] ?? '').trim()]
    if (match && (ROLES as readonly string[]).includes(role)) out.styleMap[`style:${match}`] = { match, role, ...(cls ? { class: cls } : {}) }
  }
  return Object.keys(out.markup).length || Object.keys(out.styleMap).length ? out : undefined
}
