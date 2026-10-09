// "Check these first": every decision the tool made on its own, with how sure it was and why. The reviewer
// opens the low-confidence items first; everything the tool is sure of is only counted. Each item says which
// control changes it (a style's meaning, a section's type, a book detail, or a house rule).
import type { StyleInfo } from '../indesign/read.ts'
import type { ReviewItem } from '../epub/package.ts'
import type { SectionType } from '../epub/locale.ts'
import { RULES, type Rule } from '../spec/rules.ts'

export type Confidence = 'low' | 'medium'
export type Area = 'style' | 'section' | 'meta' | 'note'

export interface CheckItem {
  id: string
  area: Area
  confidence: Confidence
  title: string
  /** why the tool is not sure, in plain words */
  why: string
  /** style key / section index / meta field, for the control that fixes it */
  ref?: string | number
  /** the part of the book it concerns: picks the house rules offered next to it */
  topic?: Topic
}

export type Topic = 'heading' | 'table' | 'note' | 'list' | 'figure' | 'contents' | 'paragraph' | 'page'
const GROUP_OF: Record<Topic, string> = { heading: 'Headings', table: 'Tables', note: 'Notes', list: 'Standard EPUB', figure: 'Standard EPUB', contents: 'Contents pages', paragraph: 'Paragraphs and classes', page: 'Pages and language' }

/** The house rules that shape one part of the book (the drop-down beside a review item). */
export const rulesForTopic = (topic: Topic, standard: boolean): Rule[] =>
  RULES.filter((r) => r.key && r.kind !== 'locked' && (r.group === GROUP_OF[topic] || (standard && r.group === 'Standard EPUB' && /^STD-0[1-9]/.test(r.id) && topicOfStd(r.id) === topic)))
const topicOfStd = (id: string): Topic | undefined => ({ 'STD-01': 'heading', 'STD-03': 'figure', 'STD-04': 'list', 'STD-06': 'table', 'STD-07': 'note', 'STD-09': 'figure' } as Record<string, Topic>)[id]

const topicOfStyle = (s: StyleInfo): Topic => (/^h\d|title|section|chapter|part/.test(s.role) ? 'heading' : s.role === 'toc' ? 'contents' : s.role === 'bullet' ? 'list' : 'paragraph')

export interface ReviewInput {
  styles: StyleInfo[]
  /** where each book detail came from (analyze → sources) */
  sources: Partial<Record<string, string>>
  meta: { title: string; authors: string; publisher: string; printIsbn?: string; eisbn: string }
  sections: { type: SectionType | string; nav: string }[]
  /** conversion notes from the build */
  notes: ReviewItem[]
}

export function reviewList(a: ReviewInput): { items: CheckItem[]; sure: number } {
  const items: CheckItem[] = []
  let sure = 0
  for (const s of a.styles) {
    if (!s.count) continue
    if (s.unsure) items.push({ id: `style:${s.key}`, area: 'style', confidence: 'low', title: `Style “${s.key}” (${s.count}×) is read as: ${s.role}`, why: `${s.reason}. Example: “${s.samples[0] ?? ''}”`, ref: s.key, topic: topicOfStyle(s) })
    else sure++
  }
  const detail: [string, string, string][] = [['title', a.meta.title, 'Title'], ['authors', a.meta.authors, 'Author'], ['publisher', a.meta.publisher, 'Publisher']]
  for (const [field, value, label] of detail) {
    const src = a.sources[field] ?? ''
    if (!value.trim()) items.push({ id: `meta:${field}`, area: 'meta', confidence: 'low', title: `${label} not found`, why: 'Nothing in the book says it. Type it under Book details.', ref: field })
    else if (/check/i.test(src)) items.push({ id: `meta:${field}`, area: 'meta', confidence: 'medium', title: `${label}: “${value}”`, why: `Taken from the ${src}.`, ref: field })
    else sure++
  }
  a.sections.forEach((s, i) => {
    if (s.type === 'other') items.push({ id: `section:${i}`, area: 'section', confidence: 'low', title: `“${s.nav || '(no title)'}” is an unknown kind of section`, why: 'The title is not a known front or back matter name. Choose what it is.', ref: i })
    else sure++
  })
  for (const n of a.notes)
    if (n.level !== 'info') items.push({ id: `note:${items.length}`, area: 'note', confidence: n.level === 'error' ? 'low' : 'medium', title: n.msg.replace(/^(.{110}).+$/s, '$1…'), why: n.where ? `In ${n.where}.` : 'Reported while building.' })
  items.sort((x, y) => (x.confidence === y.confidence ? 0 : x.confidence === 'low' ? -1 : 1))
  return { items, sure }
}
