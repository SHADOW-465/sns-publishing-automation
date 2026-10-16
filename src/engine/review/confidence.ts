// "Check these first": every decision the tool made on its own, with how sure it was and why. The reviewer
// opens the low-confidence items first; everything the tool is sure of is only counted. Each item says which
// control changes it (a style's meaning, a section's type, a book detail, or a house rule).
import type { StyleInfo } from '../indesign/read.ts'
import type { ReviewItem } from '../epub/package.ts'
import { noteProblems, kindName, type NoteFinding } from '../structure/notes.ts'
import type { PicturePlacement } from '../indesign/placement.ts'
import type { SectionType } from '../epub/locale.ts'
import { RULES, type Rule } from '../spec/rules.ts'

export type Confidence = 'low' | 'medium'
export type Area = 'style' | 'section' | 'meta' | 'note' | 'picture'

export interface CheckItem {
  id: string
  area: Area
  confidence: Confidence
  title: string
  /** 0-1: how sure the tool is. Under 0.6 the item blocks export until a person decides (design §3.2) */
  score: number
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
  sections: { type: SectionType | string; nav: string; /** first words of the section, to recognise an untitled one */ preview?: string }[]
  /** conversion notes from the build */
  notes: ReviewItem[]
  /** the note kinds found and whether every reference has its note (analyze → notes) */
  noteFindings?: NoteFinding[]
  /** where each picture went and which signal placed it (build → pictures) */
  pictures?: PicturePlacement[]
}

const level = (score: number): Confidence => (score < 0.6 ? 'low' : 'medium')

/** One list of everything the tool decided and was not sure of, least sure first: styles, sections, book details,
 *  notes, pictures. Book-level cross-check failures are not in the list: they are the banner above it. */
export function reviewList(a: ReviewInput): { items: CheckItem[]; sure: number; auto: number; banner: string[] } {
  const items: CheckItem[] = []
  const banner: string[] = []
  let sure = 0
  let auto = 0
  const push = (it: Omit<CheckItem, 'confidence'>) => items.push({ ...it, confidence: level(it.score) })
  for (const s of a.styles) {
    if (!s.count) continue
    // 0.85 and up is silent; under it the style is listed; under 0.6 it blocks (design §3.2)
    const score = s.confidence ?? (s.unsure ? 0.45 : 1)
    if (s.unsure || (s.action ? s.action !== 'silent' : false)) push({ id: `style:${s.key}`, area: 'style', score, title: `Style “${s.key}” (${s.count}×) is read as: ${s.role}`, why: `${s.reason}. Example: “${s.samples[0] ?? ''}”`, ref: s.key, topic: topicOfStyle(s) })
    else sure++
  }
  const detail: [string, string, string][] = [['title', a.meta.title, 'Title'], ['authors', a.meta.authors, 'Author'], ['publisher', a.meta.publisher, 'Publisher']]
  for (const [field, value, label] of detail) {
    const src = a.sources[field] ?? ''
    if (!value.trim()) push({ id: `meta:${field}`, area: 'meta', score: 0.3, title: `${label} not found`, why: 'Nothing in the book says it. Type it under Book details.', ref: field })
    else if (/check/i.test(src)) push({ id: `meta:${field}`, area: 'meta', score: 0.7, title: `${label}: “${value}”`, why: `Taken from the ${src}.`, ref: field })
    else sure++
  }
  a.sections.forEach((s, i) => {
    if (s.type === 'other') push({ id: `section:${i}`, area: 'section', score: 0.4, title: `“${s.nav || '(no title)'}” is an unknown kind of section`, why: `The title is not a known front or back matter name. ${s.preview ? `It starts: “${s.preview}”. ` : ''}Choose what it is.`, ref: i })
    else if (!s.nav.trim()) push({ id: `nav:${i}`, area: 'section', score: 0.4, title: 'A part has no title', why: 'It will be missing from the contents. Type a title in the structure list.', ref: i })
    else sure++
  })
  for (const f of a.noteFindings ?? []) {
    const problems = noteProblems(f)
    for (const p of problems) push({ id: p.id, area: 'note', score: p.confidence, title: p.title, why: p.why, topic: 'note' })
    if (!problems.length && f.action !== 'silent') push({ id: `notes:${f.kind}`, area: 'note', score: f.confidence, title: `${kindName(f.kind)}: ${f.notes} note${f.notes === 1 ? '' : 's'}`, why: f.evidence.join('; '), topic: 'note' })
    else if (!problems.length) sure++
  }
  for (const p of a.pictures ?? []) {
    if (p.action === 'silent') {
      sure++
      continue
    }
    const where = p.candidates.length ? ` Closest printed pages: ${p.candidates.join(', ')}.` : ''
    push({ id: `picture:${p.src}`, area: 'picture', score: p.confidence, title: `Picture ${p.name.replace('images/', '')}${p.page ? `: printed page ${p.page}` : ''} (placed by ${p.signal === 'none' ? 'nothing' : p.signal})`, why: `${p.note.charAt(0).toUpperCase()}${p.note.slice(1)}.${where}`, ref: p.src, topic: 'figure' })
  }
  for (const n of a.notes) {
    if (n.kind === 'cross-check') {
      banner.push(n.msg)
      continue
    }
    if (n.level === 'info') {
      auto++
      continue
    }
    // placement and note problems have their own entries above when the build reported them
    if (a.pictures && /is still on the notes page/.test(n.msg)) continue
    push({ id: `note:${items.length}`, area: /ISBN|publisher|author|title/i.test(n.msg) && !/picture|section|style/i.test(n.msg) ? 'meta' : 'note', score: n.level === 'error' ? 0.4 : 0.7, title: n.msg.replace(/^(.{110}).+$/s, '$1…'), why: n.where ? `In ${n.where}.` : 'Reported while building.' })
  }
  items.sort((x, y) => x.score - y.score)
  return { items, sure, auto, banner }
}
