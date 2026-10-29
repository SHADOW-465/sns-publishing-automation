// Page flags (OPUS_DESIGN2 §b.3): which pages the model looks at. Deterministic: each is read off the layout JSON
// (pdf/evidence.ts) and what the engine says about its own reading, and names its reason (for REVIEW_NOTES).
import { figureLabel, type SNode, type Structure, type UaRole } from '../pdfua/structure.ts'
import { orderConfidence, textColumns, withEngine, type EvidenceBlock, type Ordered, type PageEvidence } from './evidence.ts'

export type PageFlag = 'multi-column' | 'figure-pieces' | 'caption-candidate' | 'style-mixed' | 'order-risk' | 'low-confidence' | 'checker'
export interface FlagHit {
  flag: PageFlag
  reason: string
}
/** What the page does not show: why the engine's order may be wrong (it row-sorted the page, released held lines, placed a
 *  stray), and the checks (Matterhorn, axe, reading order) that failed on the page in the previous round. */
export interface PageSignals {
  risk?: string[]
  checks?: string[]
}

export const LOW_CONFIDENCE = 0.85

const words = (b: EvidenceBlock) => (b.text ?? '').trim().split(/\s+/).filter(Boolean).length
/** the gap between two boxes, 0 when they meet */
export const gap = (a: EvidenceBlock, b: EvidenceBlock) => Math.max(0, b.bbox[0] - a.bbox[2], a.bbox[0] - b.bbox[2], b.bbox[1] - a.bbox[3], a.bbox[1] - b.bbox[3])
const clip = (s = '', n = 40) => (s.length > n ? `${s.slice(0, n)}…` : s)

export function pageFlags(ev: PageEvidence, s: PageSignals = {}): FlagHit[] {
  const out: FlagHit[] = []
  const add = (flag: PageFlag, reason: string) => out.push({ flag, reason })
  const text = ev.blocks.filter((b) => b.kind === 'text')
  const figs = ev.blocks.filter((b) => b.kind === 'figure')
  const em = text[0]?.bodySize ?? 10
  // a block the engine read with no role is one it left out of the order (an artifact); with no engine reading, all count
  const read = (b: EvidenceBlock) => !ev.engineOrder || b.role !== undefined

  // multi-column: columns of running text (textColumns), or two blocks of 2+ lines whose boxes overlap (their lines interleave)
  const cols = textColumns(ev)
  if (cols.length) add('multi-column', `${cols.length + 1} columns of text, the others from x ${cols.join(', ')}`)
  const tall = text.filter((b) => (b.lines ?? 1) >= 2)
  const over = tall.flatMap((a, i) => tall.slice(i + 1).filter((b) => Math.min(a.bbox[2], b.bbox[2]) - Math.max(a.bbox[0], b.bbox[0]) > em && Math.min(a.bbox[3], b.bbox[3]) - Math.max(a.bbox[1], b.bbox[1]) > em).map((b) => [a, b]))[0]
  if (over) add('multi-column', `${over[0].id} and ${over[1].id} overlap: their lines interleave`)

  // figure-pieces: two pictures within 1.5 em of each other may be pieces of one
  // ponytail: the "image inside another figure's caption group" signal waits for caption links (T12)
  for (let i = 0; i < figs.length; i++)
    for (const b of figs.slice(i + 1)) if (gap(figs[i], b) <= em * 1.5) add('figure-pieces', `${figs[i].id} and ${b.id} are ${Math.round(gap(figs[i], b))} pt apart`)

  // caption-candidate: an italic or smaller-than-body block within 3 em of a figure, not inside it, that is not a Caption;
  // a figure label ("Figura 7.2. …") tagged P
  const inside = (b: EvidenceBlock, f: EvidenceBlock) => (b.bbox[0] + b.bbox[2]) / 2 > f.bbox[0] && (b.bbox[0] + b.bbox[2]) / 2 < f.bbox[2] && (b.bbox[1] + b.bbox[3]) / 2 > f.bbox[1] && (b.bbox[1] + b.bbox[3]) / 2 < f.bbox[3]
  for (const b of text) {
    if (!read(b) || b.role === 'Caption') continue
    const f = figs.find((f) => gap(b, f) <= em * 3 && !inside(b, f))
    if (f && (b.italic || b.size! < b.bodySize! * 0.92)) add('caption-candidate', `${b.id} “${clip(b.text)}” is ${b.italic ? 'italic' : 'small'} by ${f.id}, tagged ${b.role ?? 'nothing yet'}`)
    else if (b.role === 'P' && figureLabel(b.text ?? '')) add('caption-candidate', `${b.id} “${clip(b.text)}” is a figure label tagged P`)
  }

  // style-mixed: one style in two roles on the page, or a block whose role is not its style's (the engine's rules for single
  // blocks: T10's signals, kickers, notes headings, contents entries); a heading-role block over 25 words; a body-role block of
  // 1-8 words in bold or bigger type
  const roles = new Map<string, Set<string>>()
  for (const b of text) if (b.role) roles.set(b.style!, (roles.get(b.style!) ?? new Set()).add(b.role))
  for (const [style, rs] of roles) if (rs.size >= 2) add('style-mixed', `style ${style} is ${[...rs].join(' and ')}`)
  const kind = (r: string) => r.replace(/^H\d$/, 'H')
  for (const b of text) {
    if (b.role && b.styleRole && kind(b.role) !== kind(b.styleRole)) add('style-mixed', `${b.id} “${clip(b.text)}” is ${b.role}; its style ${b.style} is ${b.styleRole}`)
    if (/^H\d$/.test(b.role ?? '') && words(b) > 25) add('style-mixed', `${b.id} is a ${b.role} of ${words(b)} words`)
    if (b.role === 'P' && words(b) >= 1 && words(b) <= 8 && (b.bold || b.size! >= b.bodySize! * 1.15)) add('style-mixed', `${b.id} “${clip(b.text)}” is a P in ${b.bold ? 'bold' : 'bigger type'}`)
  }

  for (const r of s.risk ?? []) add('order-risk', r)
  const conf = ev.engineConfidence ?? orderConfidence(ev)
  if (conf < LOW_CONFIDENCE) add('low-confidence', `page order confidence ${conf.toFixed(2)}`)
  for (const c of s.checks ?? []) add('checker', c)
  return out
}

/** The role a flag compares: headings, captions, figures and contents entries as they are; all other text (P, LI, TD, Inline …) is P. */
const roleOf = (tag: string) => (/^(H\d|Caption|Figure|TOCI)$/.test(tag) ? tag : 'P')

/** The flags of every page of a PDF/UA build: the book's evidence with the structure's reading and roles laid on it. `roles` are
 *  the roles of the styles buildStructure was given; `checks` the failed checks of the previous round, by 0-based page. */
export function uaPageFlags(evidence: PageEvidence[], st: Structure, roles: Map<string, UaRole>, checks: Map<number, string[]> = new Map()): { evidence: PageEvidence; flags: FlagHit[] }[] {
  const order = evidence.map((): Ordered[] => [])
  // a line takes the role of the block element it sits in: the P or TOCI around its Link or Span, the LI around its LBody
  const walk = (n: SNode, block: string) => {
    const tag = /^(Link|Reference|Span|Lbl|LBody)$/.test(n.tag) ? block : n.tag
    for (const l of n.lines) order[l.page]?.push({ x0: l.x0, x1: l.x1, y: l.y, size: l.size, text: l.text, role: roleOf(tag), styleRole: roleOf(roles.get(l.key) ?? 'P') })
    const f = n.figure
    if (f && order[f.page]) order[f.page].push({ x0: f.box.x0, x1: f.box.x1, y0: evidence[f.page].h - f.box.y1, y1: evidence[f.page].h - f.box.y0, role: 'Figure' })
    for (const k of n.kids) walk(k, tag)
  }
  walk(st.root, 'P')
  return evidence.map((e, i) => {
    const v = withEngine(e, order[i])
    return { evidence: v, flags: pageFlags(v, { risk: st.risk.get(i), checks: checks.get(i) }) }
  })
}
