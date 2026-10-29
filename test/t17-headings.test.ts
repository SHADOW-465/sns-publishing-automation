// T17 (OPUS_DESIGN2 §b.5.4, book-level reconciliation): page answers propose a role per block; one pass over the book groups the heading
// proposals by look (font, size, weight, case, alignment, space above). The same look gets the same level everywhere, the instruction's
// heading_map beats the majority, a 50/50 group goes to one text-only call (P5) and then to a person, and levels never skip.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { PageEvidence, EvidenceBlock } from '../src/engine/pdf/evidence.ts'
import type { PageDecision } from '../src/engine/pdf/decision.ts'
import { askHeadingTie, reconcileHeadings, type TieQuery } from '../src/engine/pdf/headings.ts'
import { reviewNotes } from '../src/engine/review/decisions.ts'

type Look = 'A' | 'B' | 'C'
// A: bold 16 centred "Chapter" heads; B: bold 12 left section heads; C: italic 12 left run-in heads
const LOOKS: Record<Look, Partial<EvidenceBlock> & { x0: number; x1: number }> = {
  A: { style: 'Minion-Bold 16', bold: true, size: 16, x0: 120, x1: 280 },
  B: { style: 'Minion-Bold 12', bold: true, size: 12, x0: 60, x1: 180 },
  C: { style: 'Minion-It 12', italic: true, size: 12, x0: 60, x1: 180 },
}
const W = 400
/** a page: its headings (look, text, engine role if any) at 100pt intervals, and one body block under the last */
function page(n: number, heads: [Look, string, string?][]): PageEvidence {
  const blocks: EvidenceBlock[] = heads.map(([look, text, role], i) => {
    const { x0, x1, ...rest } = LOOKS[look]
    const top = 80 + i * 100
    return { id: `p${n}.b${String(i + 1).padStart(2, '0')}`, kind: 'text', bbox: [x0, top, x1, top + 14], bodySize: 11, lines: 1, text, lineIds: [`p${n}.l${i + 1}`], ...(role ? { role } : {}), ...rest }
  })
  blocks.push({ id: `p${n}.b${String(heads.length + 1).padStart(2, '0')}`, kind: 'text', bbox: [60, 80 + heads.length * 100, 340, 120 + heads.length * 100], style: 'Minion 11', size: 11, bodySize: 11, lines: 3, text: 'Some body text goes here.', lineIds: [], role: 'P' })
  return { page: n, printed: String(n), w: W, h: 600, columns: [[60, 340]], blocks }
}
const role = (page: number, i: number, r: string) => ({ op: 'role' as const, id: `p${page}.b${String(i).padStart(2, '0')}`, role: r as 'H2' })
const ai = (page: number, ...ops: PageDecision['ops']): PageDecision => ({ page, ops, by: 'ai' })
/** the role a block ends with: the decision's role op, or undefined */
const roleOf = (ds: PageDecision[], id: string) => ds.flatMap((d) => d.ops).find((o) => o.op === 'role' && o.id === id) as { role: string } | undefined

test('T17: one look gets one level everywhere (the majority of the page proposals)', async () => {
  const ev = [1, 2, 3, 4, 5].map((n) => page(n, [['B', `Section ${n}`]]))
  const ds = [ai(1, role(1, 1, 'H2')), ai(2, role(2, 1, 'H2')), ai(3, role(3, 1, 'H3')), ai(4, role(4, 1, 'H2')), ai(5, role(5, 1, 'H2'))]
  // the look B is the only one: its level is made contiguous, so H2 becomes H1 on every page
  const r = await reconcileHeadings(ds, ev)
  const levels = [1, 2, 3, 4, 5].map((n) => roleOf(r.decisions, `p${n}.b01`)!.role)
  assert.equal(new Set(levels).size, 1)
  assert.equal(levels[0], 'H1')
})

test('T17: two looks keep their order; a look the engine already tagged on other pages votes with those pages', async () => {
  // look A is H1 on 3 pages (engine), the page reader says H3 on page 4 only: 3 to 1, so H1 there too
  const ev = [1, 2, 3, 4].map((n) => page(n, [['A', `Chapter ${n}`, n < 4 ? 'H1' : undefined], ['B', `Part ${n}`]]))
  const ds = [ai(4, role(4, 1, 'H3'), role(4, 2, 'H2')), ai(1, role(1, 2, 'H2')), ai(2, role(2, 2, 'H2')), ai(3, role(3, 2, 'H2'))]
  const r = await reconcileHeadings(ds, ev)
  assert.equal(roleOf(r.decisions, 'p4.b01')!.role, 'H1')
  assert.equal(roleOf(r.decisions, 'p4.b02')!.role, 'H2')
  assert.equal(roleOf(r.decisions, 'p1.b02')!.role, 'H2')
})

test('T17: the same size in another weight, case or alignment is another look', async () => {
  const ev = [page(1, [['B', 'Part One']]), page(2, [['C', 'Part Two']]), page(3, [['B', 'PART THREE']])]
  const ds = [ai(1, role(1, 1, 'H1')), ai(2, role(2, 1, 'H2')), ai(3, role(3, 1, 'H3'))]
  const r = await reconcileHeadings(ds, ev)
  assert.deepEqual([1, 2, 3].map((n) => roleOf(r.decisions, `p${n}.b01`)!.role), ['H1', 'H2', 'H3'])
})

test('T17: heading_map beats the majority, for every block of the look', async () => {
  // per page: a chapter head (A, H1), a run-in head (C, H2), and section heads (B) the page reader calls H2; one of them reads "Conclusiones"
  const ev = [1, 2, 3, 4].map((n) => page(n, [['A', 'Chapter'], ['C', 'Notes on it'], ['B', n === 2 ? 'Conclusiones' : `Part ${n}`]]))
  const ds = [1, 2, 3, 4].map((n) => ai(n, role(n, 1, 'H1'), role(n, 2, 'H2'), role(n, 3, 'H2')))
  const r = await reconcileHeadings(ds, ev, { headingMap: [{ sample: 'conclusiones', level: 'H3' }] })
  assert.deepEqual([1, 2, 3, 4].map((n) => roleOf(r.decisions, `p${n}.b03`)!.role), ['H3', 'H3', 'H3', 'H3'])
  assert.deepEqual([1, 2, 3, 4].map((n) => roleOf(r.decisions, `p${n}.b02`)!.role), ['H2', 'H2', 'H2', 'H2'])
  assert.ok(r.notes.some((n) => /instruction/.test(n.chosen)))
})

test('T17: a heading_map level that would skip a level is pulled up (no skipped levels beats the map)', async () => {
  const ev = [1, 2].map((n) => page(n, [['A', 'Chapter'], ['B', n === 2 ? 'Conclusiones' : 'Part 1']]))
  const ds = [1, 2].map((n) => ai(n, role(n, 1, 'H1'), role(n, 2, 'H2')))
  const r = await reconcileHeadings(ds, ev, { headingMap: [{ sample: 'Conclusiones', level: 'H3' }] })
  assert.deepEqual([1, 2].map((n) => roleOf(r.decisions, `p${n}.b02`)!.role), ['H2', 'H2'])
  assert.match(r.notes.find((n) => /instruction/.test(n.chosen))!.chosen, /skipped a level/)
})

test('T17: an engine heading of a look the page reader re-levelled on most pages gets a role op of its own', async () => {
  const ev = [1, 2, 3].map((n) => page(n, [['A', 'Chapter', 'H1'], ['B', `Part ${n}`, n === 1 ? 'H3' : undefined]]))
  const r = await reconcileHeadings([ai(2, role(2, 2, 'H2')), ai(3, role(3, 2, 'H2'))], ev)
  assert.equal(roleOf(r.decisions, 'p1.b02')!.role, 'H2')
  assert.equal(r.decisions.find((d) => d.page === 1)!.by, 'ai')
})

test('T17: heading_map to P takes the look out of the headings', async () => {
  const ev = [1, 2].map((n) => page(n, [['B', 'Conclusiones']]))
  const r = await reconcileHeadings([ai(1, role(1, 1, 'H2')), ai(2, role(2, 1, 'H2'))], ev, { headingMap: [{ sample: 'Conclusiones', level: 'P' }] })
  assert.deepEqual([1, 2].map((n) => roleOf(r.decisions, `p${n}.b01`)!.role), ['P', 'P'])
})

test('T17: no level is skipped, in reading order, and the first heading is H1', async () => {
  const ev = [page(1, [['A', 'Chapter 1'], ['B', 'Part 1.1']]), page(2, [['A', 'Chapter 2'], ['B', 'Part 2.1']])]
  const ds = [ai(1, role(1, 1, 'H1'), role(1, 2, 'H3')), ai(2, role(2, 1, 'H1'), role(2, 2, 'H3'))]
  const r = await reconcileHeadings(ds, ev)
  assert.equal(roleOf(r.decisions, 'p1.b02')!.role, 'H2')
  assert.equal(roleOf(r.decisions, 'p2.b02')!.role, 'H2')
  const first = await reconcileHeadings([ai(1, role(1, 1, 'H3'))], [page(1, [['A', 'Chapter 1']])])
  assert.equal(roleOf(first.decisions, 'p1.b01')!.role, 'H1')
})

test('T17: a look that splits 50/50 goes to one text-only call with its samples; the answer decides', async () => {
  const ev = [1, 2, 3, 4].map((n) => page(n, [['A', 'Chapter'], ['B', `Part ${n}`]]))
  const ds = [1, 2, 3, 4].map((n) => ai(n, role(n, 1, 'H1'), role(n, 2, n % 2 ? 'H2' : 'H3')))
  let asked: TieQuery | undefined
  const r = await reconcileHeadings(ds, ev, { tieBreak: async (q) => ((asked = q), { [q.clusters[0].key]: 3 }) })
  assert.equal(asked!.clusters.length, 1)
  assert.deepEqual(asked!.clusters[0].votes, { 2: 2, 3: 2 })
  assert.ok(asked!.clusters[0].samples.includes('Part 1'))
  assert.equal(roleOf(r.decisions, 'p1.b02')!.role, 'H2') // contiguous: H1 then H3 would skip
  assert.equal(roleOf(r.decisions, 'p2.b02')!.role, roleOf(r.decisions, 'p4.b02')!.role)
  assert.equal(r.person.length, 0)
  assert.ok(r.notes.some((n) => n.how === 'ai'))
})

test('T17: a tie nobody breaks goes to a person; the engine keeps its reading of that look and REVIEW_NOTES lists it', async () => {
  const ev = [1, 2, 3, 4].map((n) => page(n, [['B', `Part ${n}`]]))
  const ds = [1, 2, 3, 4].map((n) => ai(n, role(n, 1, n % 2 ? 'H2' : 'H3')))
  for (const tieBreak of [undefined, async () => undefined, async () => ({ nope: 2 }), async (q: TieQuery) => ({ [q.clusters[0].key]: 5 })]) {
    const r = await reconcileHeadings(ds, ev, { tieBreak })
    assert.equal(r.person.length, 1)
    assert.equal(roleOf(r.decisions, 'p1.b01'), undefined)
    const note = r.notes.find((n) => n.how === 'left')!
    assert.match(note.chosen, /person/i)
    assert.match(reviewNotes({ file: 'x.pdf', kind: 'Accessible PDF', notes: r.notes }), /Part 1/)
  }
})

test('T17: no page-reader proposals means no change; text, order and a person’s decision are untouched', async () => {
  const ev = [page(1, [['A', 'Chapter 1', 'H1'], ['B', 'Part 1', 'H3']]), page(2, [['B', 'Part 2', 'H2']])]
  assert.deepEqual((await reconcileHeadings([], ev)).decisions, [])
  const person: PageDecision = { page: 2, ops: [role(2, 1, 'H3')], by: 'person' }
  const mixed: PageDecision = ai(1, { op: 'order', ids: ['p1.b01', 'p1.b02', 'p1.b03'] }, role(1, 2, 'H2'))
  const r = await reconcileHeadings([mixed, person], ev)
  assert.deepEqual(r.decisions.find((d) => d.by === 'person'), person)
  assert.deepEqual(r.decisions.find((d) => d.page === 1)!.ops[0], mixed.ops[0])
  assert.ok(r.decisions.flatMap((d) => d.ops).every((o) => ['order', 'role'].includes(o.op)))
})

test('T17: a split’s heading half takes the look’s level', async () => {
  const ev = [1, 2, 3].map((n) => page(n, [['B', `Part ${n}`]]))
  const ds = [ai(1, role(1, 1, 'H2')), ai(2, role(2, 1, 'H2')), ai(3, { op: 'split', id: 'p3.b01', atLine: 'p3.l2', roles: ['H3', 'P'] })]
  const r = await reconcileHeadings(ds, ev)
  const s = r.decisions.find((d) => d.page === 3)!.ops[0] as { roles: string[] }
  assert.deepEqual(s.roles, [roleOf(r.decisions, 'p1.b01')!.role, 'P'])
})

test('T17: the tie-break call is text only, asks for a JSON schema answer, and a bad answer is no answer', async () => {
  const q: TieQuery = { clusters: [{ key: 'k1', look: 'bold 12 pt, left, title case', votes: { 2: 2, 3: 2 }, samples: ['Part 1', 'Part 2'], pages: [1, 2] }] }
  let body: { messages: { content: unknown }[]; response_format: { type: string } } | undefined
  const reply = (content: string) => (async (_u: unknown, init: { body: string }) => ((body = JSON.parse(init.body)), { ok: true, status: 200, json: async () => ({ choices: [{ message: { content } }] }) })) as unknown as typeof fetch
  const cfg = { baseUrl: 'http://x/v1', apiKey: '', model: 'm' }
  assert.deepEqual(await askHeadingTie(cfg, q, { fetch: reply('{"levels":[{"key":"k1","level":3}]}') }), { k1: 3 })
  assert.equal(body!.response_format.type, 'json_schema')
  assert.equal(typeof body!.messages[1].content, 'string') // no image
  assert.match(String(body!.messages[1].content), /Part 1/)
  assert.equal(await askHeadingTie(cfg, q, { fetch: reply('{"levels":[{"key":"k1","level":6}]}') }), undefined) // not one of the tied levels
  assert.equal(await askHeadingTie(cfg, q, { fetch: reply('nonsense') }), undefined)
  assert.equal(await askHeadingTie(cfg, q, { fetch: (async () => { throw new Error('down') }) as unknown as typeof fetch }), undefined)
})

test('T17: whatever the page reader proposes, a look has one level and the book has no skipped level', async () => {
  let seed = 17
  const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff), seed % n)
  for (let round = 0; round < 60; round++) {
    const looks = (['A', 'B', 'C'] as Look[]).slice(0, 1 + rnd(3))
    const ev = Array.from({ length: 8 }, (_, i) => page(i + 1, looks.filter(() => rnd(4) > 0).map((l) => [l, `Head ${i}`] as [Look, string])))
    const ds = ev.map((e) => ai(e.page, ...e.blocks.filter((b) => b.bold || b.italic).map((b) => ({ op: 'role' as const, id: b.id, role: `H${1 + rnd(6)}` as 'H1' }))))
    const r = await reconcileHeadings(ds, ev, { tieBreak: async (q) => Object.fromEntries(q.clusters.map((c) => [c.key, Number(Object.keys(c.votes)[0])])) })
    const byLook = new Map<string, Set<string>>()
    let prev = 0
    for (const e of ev) {
      for (const b of e.blocks.filter((b) => b.bold || b.italic)) {
        const got = roleOf(r.decisions, b.id)?.role
        if (!got || got === 'P') continue
        byLook.set(b.style!, (byLook.get(b.style!) ?? new Set()).add(got))
        const l = Number(got[1])
        assert.ok(l <= prev + 1, `H${l} after H${prev} skips a level (round ${round})`)
        prev = l
      }
    }
    for (const [look, set] of byLook) assert.equal(set.size, 1, `${look} has ${[...set]} (round ${round})`)
  }
})
