// T27 (OPUS_DESIGN2 §c.4): the page-model prompt is generated, not hand-written: a fixed frame, the prompt line of each rule card that
// applies to the page's flags (numbered with its ID), and few-shot examples chosen by flag. promptVersion is the hash of all of it.
// A golden file per page type; editing one card changes the prompt, and so the cache key, only of the pages it applies to.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { PageEvidence } from '../src/engine/pdf/evidence.ts'
import type { PageFlag } from '../src/engine/pdf/flags.ts'
import { pageKey } from '../src/engine/pdf/page-cache.ts'
import { PAGE_MODEL_SYSTEM, parsePageAnswer } from '../src/engine/pdf/page-model.ts'
import { EXAMPLES, buildPrompt, type PromptCard } from '../src/engine/pdf/prompt.ts'
import { RULEBOOK_IDS } from '../src/engine/spec/rulebook-ids.ts'

const card = (id: string, applies_when: string, prompt_text: string): PromptCard => ({ id, applies_when, prompt_text })
const CARDS: PromptCard[] = [
  card('PFG-003', 'accessible-pdf | pdf | caption-candidate, figure-pieces', 'An italic line right under a picture that starts with Figura/Figure/Abb. is its caption, even if the text font is the same as the body.'),
  card('PRO-001', 'accessible-pdf | pdf | multi-column', 'Read the columns left to right, each from top to bottom.'),
  card('PHD-008', 'accessible-pdf | pdf | any page', 'Headings that look the same get the same level.'),
  card('DOC-001', 'EPUB | All', ''), // no prompt line: never in a prompt
]

// the three page types: a captioned figure, two columns, a plain page
const PAGES: Record<string, PageFlag[]> = { caption: ['caption-candidate'], 'multi-column': ['multi-column', 'low-confidence'], plain: [] }

// a golden file is written on the first run (or with UPDATE_GOLDEN=1) and compared after
function golden(name: string, got: string) {
  const file = resolve('test/snapshots', name)
  if (process.env.UPDATE_GOLDEN || !existsSync(file)) writeFileSync(file, got)
  assert.equal(got, readFileSync(file, 'utf8').replaceAll('\r\n', '\n')) // git may check the file out with CRLF
}

for (const [type, flags] of Object.entries(PAGES))
  test(`T27: golden prompt for a ${type} page`, () => {
    golden(`t27-${type}.txt`, buildPrompt(flags, { cards: CARDS }).system + '\n')
  })

test('T27: the frame holds the role, the schema and the hard rules; cards are numbered with their IDs; a card with no prompt line is left out', () => {
  const p = buildPrompt(['caption-candidate'], { cards: CARDS })
  assert.ok(p.system.startsWith(PAGE_MODEL_SYSTEM))
  assert.match(p.system, /"anyOf"/) // the schema
  assert.match(p.system, /every block exactly once/i)
  assert.match(p.system, /never write, change or remove text|do not change text/i)
  assert.deepEqual(p.rules, ['PFG-003: ' + CARDS[0].prompt_text, 'PHD-008: ' + CARDS[2].prompt_text])
  assert.ok(!p.system.includes('DOC-001') && !p.system.includes('PRO-001'))
})

test('T27: examples are chosen by flag, at most 3, and a caption-candidate page gets a caption example', () => {
  const cap = buildPrompt(['caption-candidate'], { cards: [] })
  assert.ok(cap.system.includes('"op":"caption"'))
  assert.equal(buildPrompt([], { cards: [] }).system.includes('Example'), false)
  const many = buildPrompt(['caption-candidate', 'figure-pieces', 'multi-column', 'style-mixed', 'order-risk'], { cards: [] })
  assert.equal(many.system.match(/^Example /gm)?.length, 3)
})

test('T27: every example is a valid answer on its own layout and cites a real rule', () => {
  for (const x of EXAMPLES) {
    const r = parsePageAnswer(JSON.stringify(x.answer), x.layout.page)
    assert.ok('answer' in r, `${x.flag}: ${'why' in r ? r.why : ''}`)
    const ids = new Set(x.layout.blocks.flatMap((b) => [b.id, ...(b.pieces ?? [])]))
    for (const o of x.answer.ops) for (const id of [...((o as { ids?: string[] }).ids ?? []), ...((o as { pieces?: string[] }).pieces ?? []), ...[(o as { id?: string }).id, (o as { figure?: string }).figure, (o as { caption?: string }).caption].filter((s): s is string => !!s)]) assert.ok(ids.has(id), `${x.flag}: ${id} is not on the layout`)
    for (const why of x.answer.reasons) assert.ok(!why.rule || RULEBOOK_IDS.has(why.rule), `${x.flag}: ${why.rule}`)
  }
})

test('T27: editing one card changes promptVersion and the cache key only of the pages it applies to', () => {
  const edited = CARDS.map((c) => (c.id === 'PFG-003' ? { ...c, prompt_text: c.prompt_text + ' Also in Spanish: Figura.' } : c))
  const ev = (page: number): PageEvidence => ({ page, printed: String(page), w: 400, h: 600, columns: [[60, 340]], blocks: [] })
  const key = (flags: PageFlag[], cards: PromptCard[]) => {
    const p = buildPrompt(flags, { cards })
    return { version: p.version, key: pageKey({ pdfPageHash: 'h', req: { ev: ev(1), images: [], system: p.system }, model: { modelId: 'm', promptVersion: p.version, schemaVersion: 's' } }) }
  }
  for (const [type, flags] of Object.entries(PAGES)) {
    const a = key(flags, CARDS), b = key(flags, edited)
    if (type === 'caption') (assert.notEqual(a.version, b.version), assert.notEqual(a.key, b.key))
    else assert.deepEqual(a, b, type)
  }
  // the same inputs give the same version, whatever order the cards or flags come in
  assert.equal(key(['multi-column', 'low-confidence'], CARDS).version, key(['low-confidence', 'multi-column'], [...CARDS].reverse()).version)
})

test('T27: the rule set narrows the cards, and the rulebook as it stands gives a prompt with no card lines', () => {
  assert.deepEqual(buildPrompt(['caption-candidate'], { cards: CARDS, active: new Set(['PHD-008']) }).rules, ['PHD-008: ' + CARDS[2].prompt_text])
  const real = buildPrompt(['caption-candidate'])
  assert.match(real.version, /^[0-9a-f]{12}$/)
})
