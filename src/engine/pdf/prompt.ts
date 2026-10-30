// The page-model prompt, generated and not hand-written (OPUS_DESIGN2 §c.4, T27): a fixed frame (role, schema, hard rules), the prompt line of
// each rule card that applies to this page's flags (numbered with its ID), and a few worked examples chosen by flag. promptVersion is the
// hash of all of it, so editing a card changes the prompt, and the cache key (page-cache.ts), only for the pages the card applies to.
import { createHash } from 'node:crypto'
import { RULEBOOK, type RulebookEntry } from '../spec/rulebook-ids.ts'
import type { EvidenceBlock, PageEvidence } from './evidence.ts'
import type { PageFlag } from './flags.ts'
import { PAGE_MODEL_SYSTEM, pageAnswerSchema, type PageAnswer } from './page-model.ts'

export type PromptCard = Pick<RulebookEntry, 'id' | 'applies_when' | 'prompt_text'>
export interface PromptExample {
  flag: PageFlag
  layout: PageEvidence
  answer: PageAnswer
}

/** the most worked examples one prompt carries (§c.4: 2-3 per page type) */
export const MAX_EXAMPLES = 3
const FLAGS: PageFlag[] = ['caption-candidate', 'figure-pieces', 'multi-column', 'style-mixed', 'order-risk', 'low-confidence', 'checker']

const T = (id: string, bbox: [number, number, number, number], o: Partial<EvidenceBlock> = {}): EvidenceBlock => ({ id, kind: 'text', bbox, style: 'Serif 10', italic: false, bold: false, size: 10, bodySize: 10, lines: 1, ...o })
const F = (id: string, bbox: [number, number, number, number], pieces: string[] = []): EvidenceBlock => ({ id, kind: 'figure', bbox, pieces, caption: null })
const page = (blocks: EvidenceBlock[], engineOrder: string[], o: Partial<PageEvidence> = {}): PageEvidence => ({ page: 12, printed: '12', w: 432, h: 648, columns: [[36, 396]], blocks, engineOrder, ...o })
const answer = (ops: PageAnswer['ops'], why: string, rule: string): PageAnswer => ({ page: 12, ops, confidence: 0.9, reasons: [{ op: 0, why, rule }] })

/**
 * One worked example per flag: a small layout and the answer that is right for it. The layout is text, not a crop of the page image.
 * ponytail: examples live here; cards carry their logged corrections as text only, move these to the cards when the sheet has crops.
 */
export const EXAMPLES: readonly PromptExample[] = [
  {
    flag: 'caption-candidate',
    layout: page([T('p12.b01', [36, 60, 396, 100], { lines: 3, text: 'The octave is the first interval the ear learns to name.', role: 'P' }), F('p12.f01', [100, 110, 330, 300]), T('p12.b02', [100, 306, 330, 318], { italic: true, text: 'Figura 7.2. Octavas en un piano', role: 'P' })], ['p12.b01', 'p12.f01', 'p12.b02']),
    answer: answer([{ op: 'role', id: 'p12.b02', role: 'Caption' }, { op: 'caption', figure: 'p12.f01', caption: 'p12.b02' }], 'italic line right under the picture, and it starts with a figure label', 'PFG-003'),
  },
  {
    flag: 'figure-pieces',
    layout: page([F('p12.f01', [60, 80, 200, 220], ['p12.i01']), F('p12.f02', [204, 80, 340, 220], ['p12.i02'])], ['p12.f01', 'p12.f02']),
    answer: answer([{ op: 'figure', pieces: ['p12.i01', 'p12.i02'] }], 'two pictures a few points apart are the left and right halves of one picture', 'PRO-006'),
  },
  {
    flag: 'multi-column',
    layout: page([T('p12.b01', [36, 60, 204, 200], { lines: 12, text: 'Left column, first paragraph.', role: 'P' }), T('p12.b02', [228, 60, 396, 200], { lines: 12, text: 'Right column, first paragraph.', role: 'P' }), T('p12.b03', [36, 210, 204, 350], { lines: 12, text: 'Left column, second paragraph.', role: 'P' })], ['p12.b01', 'p12.b02', 'p12.b03'], { columns: [[36, 204], [228, 396]] }),
    answer: answer([{ op: 'order', ids: ['p12.b01', 'p12.b03', 'p12.b02'] }], 'the left column is read to its end before the right column starts', 'PRO-001'),
  },
  {
    flag: 'style-mixed',
    layout: page([T('p12.b01', [36, 60, 396, 90], { size: 14, bold: true, lines: 2, text: 'Visit www.example.org/tools for the full list of tools and the instructions for each of them in turn', role: 'H3', styleRole: 'H3' })], ['p12.b01']),
    answer: answer([{ op: 'role', id: 'p12.b01', role: 'P' }], 'a line of body copy with a web address is not a heading', 'PHD-005'),
  },
]

const sha = (s: string) => createHash('sha256').update(s).digest('hex')
/** the version of a prompt: 12 hex digits of its hash (part of every cache key, §b.6) */
export const promptVersion = (system: string) => sha(system).slice(0, 12)

const FRAME = [
  PAGE_MODEL_SYSTEM,
  'Keep every block exactly once: nothing is lost, doubled or reworded. Never write, change or remove text; do not change text.',
  'In "reasons", give the rule ID of the rule you followed when one of the rules below fits.',
  `The answer follows this JSON schema:\n${JSON.stringify(pageAnswerSchema())}`,
].join('\n')

/**
 * A card applies to a page when its prompt line is not empty and, if its "applies when" names page flags, the page has one of them.
 * "any page" (or no flag named) means every page. ponytail: the output kind and source in applies_when are not read here; the caller's
 * `active` set (the resolved rule set's IDs) narrows by book.
 */
const applies = (c: PromptCard, flags: PageFlag[]) => {
  const named = FLAGS.filter((f) => new RegExp(`\\b${f}\\b`).test(c.applies_when))
  return named.length === 0 || named.some((f) => flags.includes(f))
}

export interface Prompt {
  system: string
  version: string
  /** the numbered rule lines in the prompt: "PFG-003: …" */
  rules: string[]
}

/** The system prompt for a page with these flags, and its version. Same flags and cards in any order give the same text. */
export function buildPrompt(flags: PageFlag[], o: { cards?: readonly PromptCard[]; active?: ReadonlySet<string> } = {}): Prompt {
  const rules = [...(o.cards ?? RULEBOOK)]
    .filter((c) => c.prompt_text.trim() && (o.active?.has(c.id) ?? true) && applies(c, flags))
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((c) => `${c.id}: ${c.prompt_text.trim()}`)
  const shots = FLAGS.filter((f) => flags.includes(f))
    .flatMap((f) => EXAMPLES.filter((x) => x.flag === f).slice(0, 1))
    .slice(0, MAX_EXAMPLES)
    .map((x) => `Example (${x.flag})\nLayout: ${JSON.stringify(x.layout)}\nAnswer: ${JSON.stringify(x.answer)}`)
  const system = [FRAME, rules.length ? `Rules for this page:\n${rules.join('\n')}` : '', ...shots].filter(Boolean).join('\n\n')
  return { system, version: promptVersion(system), rules }
}
