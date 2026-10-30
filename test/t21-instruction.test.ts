// T21 (OPUS_DESIGN2 §a.2–a.4, §a.3 table): the typed instruction for one book. A text model (a fake server here) turns free text in any
// language into a CompiledInstruction; the engine validates it (rule IDs real, values coerce, pages inside the book, closed directive
// vocabulary, nothing locked); the result sits in the `book` layer above the spec rows; the directives reach the knobs that exist.
import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_SETTINGS, setSettings } from '../src/engine/settings.ts'
import { emptyLayer, resolve } from '../src/engine/spec/layers.ts'
import { MemoryStore, setStore, store } from '../src/engine/spec/store.ts'
import { openSpec, applyInstruction } from '../src/engine/spec/session.ts'
import { reviewNotes } from '../src/engine/review/decisions.ts'
import type { PageEvidence } from '../src/engine/pdf/evidence.ts'
import {
  compileInstruction, instructionLayer, instructionNotes, knobsOf, memoryCache, parsePages, skipDecisions, aiPageSet, holdStrict,
  type CompiledInstruction,
} from '../src/engine/spec/instruction.ts'
import { fileCache, readInstruction } from '../src/engine/spec/instruction-fs.ts'

afterEach(() => (setSettings(DEFAULT_SETTINGS), setStore(new MemoryStore())))

const cfg = { apiKey: '', baseUrl: 'http://model.test/v1', model: 'text-model' }
const q = (quote: string) => ({ quote })

/** a fake chat-completions endpoint: the reply for an instruction text comes from the table; every request is kept */
function fake(table: Record<string, unknown>) {
  const seen: Record<string, any>[] = []
  const f = (async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body)
    seen.push(body)
    const text = body.messages.at(-1).content as string
    if (!(text in table)) return new Response('no', { status: 500 })
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(table[text]) } }] }), { status: 200 })
  }) as unknown as typeof fetch
  return { fetch: f, seen }
}
const reply = (o: Partial<Record<'rules' | 'directives' | 'hints' | 'unmapped', unknown[]>>) => ({ rules: [], directives: [], hints: [], unmapped: [], ...o })
const rule = (ruleId: string, value: string, quote: string, confidence = 0.95, waiver = false) => ({ ruleId, value, quote, confidence, waiver })

// ---- 15 sample instructions: English, Spanish, German -------------------------------------------------------------------------------------------

interface Sample {
  text: string
  says: unknown
  rules?: [string, string | number | boolean][]
  directives?: Record<string, unknown>[]
  hints?: { scope: unknown; text: string }[]
}
const SAMPLES: Sample[] = [
  { text: 'Chapters are H1.', says: reply({ rules: [rule('UA-01', '1', 'Chapters are H1')] }), rules: [['UA-01', 1]] },
  { text: 'Keep the running heads in the reading order.', says: reply({ rules: [rule('UA-10', 'keep', 'Keep the running heads')] }), rules: [['UA-10', 'keep']] },
  {
    text: 'Pages 3-6 are plates. The captions are the small italic lines.',
    says: reply({ directives: [{ op: 'plates', pages: '3-6', ...q('Pages 3-6 are plates') }, { op: 'caption_style', signal: 'italic', near: 'figure', ...q('The captions are the small italic lines') }] }),
    directives: [{ op: 'plates', pages: [[3, 6]] }, { op: 'caption_style', signal: 'italic', near: 'figure' }],
  },
  { text: 'Check the reading order on every page.', says: reply({ directives: [{ op: 'ai_pages', pages: 'all', ...q('every page') }] }), directives: [{ op: 'ai_pages', pages: 'all' }] },
  { text: 'Pages 1-2 are blank: leave them out.', says: reply({ directives: [{ op: 'skip_pages', pages: '1-2', as: 'artifact', ...q('Pages 1-2 are blank') }] }), directives: [{ op: 'skip_pages', pages: [[1, 2]], as: 'artifact' }] },
  { text: 'The "Conclusions" headings are H3.', says: reply({ directives: [{ op: 'heading_map', sample: 'Conclusions', level: 'H3', ...q('The "Conclusions" headings are H3') }] }), directives: [{ op: 'heading_map', sample: 'Conclusions', level: 'H3' }] },
  {
    text: 'Los capítulos son H1; las páginas 3–6 son láminas.',
    says: reply({ rules: [rule('UA-01', '1', 'Los capítulos son H1')], directives: [{ op: 'plates', pages: '3–6', ...q('las páginas 3–6 son láminas') }] }),
    rules: [['UA-01', 1]], directives: [{ op: 'plates', pages: [[3, 6]] }],
  },
  { text: 'Las leyendas son las líneas pequeñas en cursiva.', says: reply({ directives: [{ op: 'caption_style', signal: 'italic', near: 'figure', ...q('las líneas pequeñas en cursiva') }] }), directives: [{ op: 'caption_style', signal: 'italic', near: 'figure' }] },
  { text: 'Los números de nota no deben ser enlaces.', says: reply({ rules: [rule('UA-07', 'no', 'no deben ser enlaces')] }), rules: [['UA-07', false]] },
  {
    text: 'Las páginas 10 a 12 son el índice; revisa cada página con cuidado.',
    says: reply({ directives: [{ op: 'treat_as', pages: '10-12', kind: 'index', ...q('Las páginas 10 a 12 son el índice') }, { op: 'strict_review', pages: 'all', ...q('revisa cada página con cuidado') }] }),
    directives: [{ op: 'treat_as', pages: [[10, 12]], kind: 'index' }, { op: 'strict_review', pages: 'all' }],
  },
  { text: 'Die Seiten 8-9 haben zwei Spalten.', says: reply({ directives: [{ op: 'columns', pages: '8-9', n: 2, ...q('Die Seiten 8-9 haben zwei Spalten') }] }), directives: [{ op: 'columns', pages: [[8, 9]], n: 2 }] },
  {
    text: 'Die Überschriften „Fazit“ sind H3. Prüfe die Lesereihenfolge auf allen Seiten.',
    says: reply({ directives: [{ op: 'heading_map', sample: 'Fazit', level: 'H3', ...q('Die Überschriften „Fazit“ sind H3') }, { op: 'ai_pages', pages: 'all', ...q('auf allen Seiten') }] }),
    directives: [{ op: 'heading_map', sample: 'Fazit', level: 'H3' }, { op: 'ai_pages', pages: 'all' }],
  },
  { text: 'Lesezeichen nur bis Ebene 2.', says: reply({ rules: [rule('UA-03', '2', 'bis Ebene 2')] }), rules: [['UA-03', 2]] },
  { text: 'Die Bildunterschrift steht im Figure-Element.', says: reply({ rules: [rule('UA-09', 'inside', 'im Figure-Element')] }), rules: [['UA-09', 'inside']] },
  {
    text: 'Auf Seite 5 steht eine Tabelle mit zwei Kopfzeilen.',
    says: reply({ hints: [{ scope: '5', text: 'The table has two header rows.', ...q('zwei Kopfzeilen') }] }),
    hints: [{ scope: [[5, 5]], text: 'The table has two header rows.' }],
  },
]

test('15 sample instructions (EN, ES, DE) compile to the expected rules, directives and hints', async () => {
  assert.equal(SAMPLES.length, 15)
  const { fetch } = fake(Object.fromEntries(SAMPLES.map((s) => [s.text, s.says])))
  for (const s of SAMPLES) {
    const r = await compileInstruction(s.text, cfg, { fetch, pages: 40, cache: memoryCache() })
    assert.ok(r.ok, s.text)
    assert.deepEqual(r.compiled.rules.map((x) => [x.ruleId, x.value]), s.rules ?? [], s.text)
    assert.deepEqual(r.compiled.directives.map(({ quote, ...d }) => d), s.directives ?? [], s.text)
    assert.deepEqual(r.compiled.hints.map((h) => ({ scope: h.scope, text: h.text })), s.hints ?? [], s.text)
    assert.ok(r.compiled.rules.every((x) => x.quote) && r.compiled.directives.every((d) => d.quote), 'every item keeps the words it came from')
    assert.deepEqual(r.compiled.unmapped, [])
    assert.deepEqual(r.refused, [])
  }
})

test('the request is pinned: temperature 0, a strict JSON schema, and the rule catalogue in the system prompt', async () => {
  const { fetch, seen } = fake({ 'Chapters are H1.': reply({}) })
  await compileInstruction('Chapters are H1.', cfg, { fetch, cache: memoryCache() })
  assert.equal(seen[0].temperature, 0)
  assert.equal(seen[0].response_format.type, 'json_schema')
  assert.equal(seen[0].response_format.json_schema.strict, true)
  assert.match(seen[0].messages[0].content, /UA-10:/)
})

test('the same text gives a cached, identical compile (memory and file cache)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 't21-'))
  try {
    for (const cache of [memoryCache(), fileCache(dir)]) {
      const { fetch, seen } = fake({ 'Chapters are H1.': reply({ rules: [rule('UA-01', '1', 'Chapters are H1')] }) })
      const a = await compileInstruction('Chapters are H1.', cfg, { fetch, cache })
      const b = await compileInstruction('  Chapters are H1.\n', cfg, { fetch, cache }) // outer white space is not part of the text
      assert.ok(a.ok && b.ok)
      assert.equal(seen.length, 1, 'the model is asked once')
      assert.equal(a.cached, false)
      assert.equal(b.cached, true)
      assert.deepEqual(a.compiled, b.compiled)
    }
    // a fresh file cache (another run) still hits
    const { fetch, seen } = fake({})
    const c = await compileInstruction('Chapters are H1.', cfg, { fetch, cache: fileCache(dir) })
    assert.ok(c.ok && c.cached && seen.length === 0)
    // cache-only: a miss is "not compiled yet", never a call
    const d = await compileInstruction('Something new.', cfg, { fetch, cache: fileCache(dir), cacheOnly: true })
    assert.ok(!d.ok && seen.length === 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('nothing the engine cannot check gets through: unknown rules, bad values, pages outside the book, unknown ops are listed as unmapped', async () => {
  const { fetch } = fake({
    x: reply({
      rules: [rule('NOPE-9', 'yes', 'q1'), rule('UA-10', 'sometimes', 'q2'), rule('UA-01', '2', 'q3')],
      directives: [{ op: 'plates', pages: '40-45', ...q('q4') }, { op: 'reboot', pages: '1', ...q('q5') }, { op: 'heading_map', sample: 'X', level: 'H9', ...q('q6') }, { op: 'columns', pages: '3', n: 4, ...q('q7') }],
      hints: [{ scope: '99', text: 'late', ...q('q8') }],
    }),
  })
  const r = await compileInstruction('x', cfg, { fetch, pages: 24, cache: memoryCache() })
  assert.ok(r.ok)
  assert.deepEqual(r.compiled.rules.map((x) => x.ruleId), ['UA-01'])
  assert.deepEqual(r.compiled.directives, [])
  assert.deepEqual(r.compiled.hints, [])
  assert.deepEqual(r.compiled.unmapped.map((u) => u.quote), ['q1', 'q2', 'q4', 'q5', 'q6', 'q7', 'q8'])
  assert.ok(r.compiled.unmapped.every((u) => u.why))
})

test('an instruction asking for a locked change is refused and listed, never applied', async () => {
  const { fetch } = fake({ y: reply({ rules: [rule('PG-01', 'anywhere', 'put the page numbers wherever'), rule('UA-01', '1', 'chapters are H1')] }) })
  const r = await compileInstruction('y', cfg, { fetch, cache: memoryCache() })
  assert.ok(r.ok)
  assert.deepEqual(r.compiled.rules.map((x) => x.ruleId), ['UA-01'])
  assert.equal(r.refused.length, 1)
  assert.equal(r.refused[0].ruleId, 'PG-01')
  assert.match(r.refused[0].why, /Where page markers go/)
  const { layer } = instructionLayer('B', r.compiled, { actor: 'ana', at: '2026-10-30T00:00:00Z' })
  assert.deepEqual(Object.keys(layer.values), ['UA-01'])
  const notes = instructionNotes({ compiled: r.compiled, refused: r.refused })
  assert.ok(notes.some((n) => /Not applied: breaks/.test(n.chosen) && /PG-01/.test(n.item) && n.how === 'left'))
})

test('no model, or an answer that is not JSON: the instruction could not be read (never throws)', async () => {
  const down = (async () => { throw new Error('connect ECONNREFUSED') }) as unknown as typeof fetch
  const a = await compileInstruction('Chapters are H1.', cfg, { fetch: down, cache: memoryCache() })
  assert.ok(!a.ok && a.why)
  const junk = (async () => new Response(JSON.stringify({ choices: [{ message: { content: 'not json' } }] }))) as unknown as typeof fetch
  assert.ok(!(await compileInstruction('Chapters are H1.', cfg, { fetch: junk, cache: memoryCache() })).ok)
  assert.ok(!(await compileInstruction('   ', cfg, { fetch: down, cache: memoryCache() })).ok, 'empty text is absent')
  const notes = instructionNotes({ unreadable: { text: 'Chapters are H1.', why: a.ok ? '' : a.why } })
  assert.match(notes[0].item, /Instruction could not be read: Chapters are H1\./)
})

test('parsePages: ranges in plain and typographic form, kept inside the book', () => {
  assert.deepEqual(parsePages('3-6, 9'), [[3, 6], [9, 9]])
  assert.deepEqual(parsePages('3–6'), [[3, 6]])
  assert.deepEqual(parsePages('10 a 12'), [[10, 12]])
  assert.deepEqual(parsePages('8 bis 9'), [[8, 9]])
  assert.equal(parsePages('6-3'), undefined)
  assert.equal(parsePages('x'), undefined)
  assert.equal(parsePages('0-2'), undefined)
  assert.equal(parsePages('20-25', 24), undefined)
})

// ---- precedence: book:spec < book:instruction ---------------------------------------------------------------------------------------------------

const specLayer = () => {
  const l = emptyLayer('book', 'B')
  l.values['UA-10'] = 'artifact'
  l.values['UA-03'] = 3
  l.sources['UA-10'] = { file: 'client-spec.xlsx', where: 'row 14', text: 'Running heads are artifacts', by: 'template' }
  return l
}
const keepHeads: CompiledInstruction = {
  rules: [{ ruleId: 'UA-10', value: 'keep', quote: 'keep the running heads', confidence: 0.95 }], directives: [], hints: [], unmapped: [],
}

test('inside the book layer the instruction beats the spec, whatever the order of the layers; from[] names the winner and what it overrode', () => {
  const { layer } = instructionLayer('B', keepHeads, { actor: 'ana', at: '2026-10-30T00:00:00Z' })
  assert.equal(layer.level, 'book')
  for (const layers of [[specLayer(), layer], [layer, specLayer()]]) {
    const r = resolve(layers, DEFAULT_SETTINGS, 'accessible-pdf')
    assert.equal(r.settings.uaRunningHeads, 'keep')
    assert.equal(r.settings.uaBookmarkLevels, 3, 'a spec row the instruction does not touch stays')
    assert.equal(r.from['UA-10'].source?.file, 'instruction')
    assert.equal(r.from['UA-10'].level, 'book')
    assert.equal(r.from['UA-10'].overrode?.source?.where, 'row 14')
    assert.equal(r.from['UA-10'].overrode?.value, 'artifact')
    assert.equal(r.from['UA-03'].overrode, undefined)
  }
  // without the instruction the spec row stands
  assert.equal(resolve([specLayer()], DEFAULT_SETTINGS, 'accessible-pdf').settings.uaRunningHeads, 'artifact')
})

test('an override of a spec row is written in REVIEW_NOTES: "Instruction overrode <rule> (spec row N said X)"', () => {
  const { layer } = instructionLayer('B', keepHeads, { actor: 'ana', at: '2026-10-30T00:00:00Z' })
  const r = resolve([specLayer(), layer], DEFAULT_SETTINGS, 'accessible-pdf')
  const notes = instructionNotes({ compiled: keepHeads, resolved: r })
  const n = notes.find((x) => /overrode UA-10/.test(x.item))
  assert.ok(n)
  assert.match(n.item, /Instruction overrode UA-10 \(spec row 14 said artifact\)/)
  assert.equal(n.how, 'person')
  const text = reviewNotes({ file: 'B.pdf', kind: 'Accessible PDF', notes })
  assert.match(text, /Instruction overrode UA-10 \(spec row 14 said artifact\)/)
})

test('an accessibility-lowering value needs the words "even though it is less accessible"; with them the instruction is the waiver (actor, time, text)', async () => {
  const plain: CompiledInstruction = { ...keepHeads, rules: [{ ruleId: 'TBL-01', value: 'reference', quote: 'plain cells in tables', confidence: 0.95 }] }
  const said: CompiledInstruction = { ...keepHeads, rules: [{ ruleId: 'TBL-01', value: 'reference', quote: 'plain cells in tables, even though it is less accessible', confidence: 0.95, waiver: true }] }
  setStore(new MemoryStore())
  const a = await applyInstruction(await openSpec({ client: '', series: '', book: 'B', kind: 'accessible-epub' }, DEFAULT_SETTINGS), { compiled: plain, actor: 'ana', at: '2026-10-30T10:00:00Z' })
  assert.equal(a.resolved.settings.tableHeaders, 'th')
  assert.deepEqual(a.resolved.pendingWaivers.map((p) => p.ruleId), ['TBL-01'])
  const b = await applyInstruction(await openSpec({ client: '', series: '', book: 'B', kind: 'accessible-epub' }, DEFAULT_SETTINGS), { compiled: said, actor: 'ana', at: '2026-10-30T10:00:00Z' })
  assert.equal(b.resolved.settings.tableHeaders, 'reference')
  assert.equal(b.resolved.from['TBL-01'].waiver?.by, 'ana')
  assert.equal(b.resolved.from['TBL-01'].waiver?.at, '2026-10-30T10:00:00Z')
  assert.match(b.resolved.from['TBL-01'].waiver!.text, /even though it is less accessible/)
  const log = await store().listDecisions({ book: 'B' })
  assert.ok(log.some((d) => d.action === 'waiver' && d.ruleId === 'TBL-01' && d.actor === 'ana'))
  assert.ok(log.some((d) => d.action === 'import' && /Instruction/.test(d.detail)))
})

test('openSpec with an applied instruction resolves the same as applyInstruction, and the other layers are untouched', async () => {
  const applied = { compiled: keepHeads, actor: 'ana', at: '2026-10-30T10:00:00Z' }
  const s = await openSpec({ client: '', series: '', book: 'B', kind: 'accessible-pdf', instruction: applied }, DEFAULT_SETTINGS)
  assert.equal(s.resolved.settings.uaRunningHeads, 'keep')
  assert.equal(s.resolved.from['UA-10'].source?.file, 'instruction')
  assert.equal(s.layers.length, 1, 'the instruction is not one of the editable layers')
  const none = await openSpec({ client: '', series: '', book: 'B', kind: 'accessible-pdf' }, DEFAULT_SETTINGS)
  assert.equal(none.resolved.settings.uaRunningHeads, 'artifact')
})

test('unattended: only items of confidence 0.85 or more that touch no accessibility rule are applied; the rest become hints and are listed', () => {
  const c: CompiledInstruction = {
    rules: [
      { ruleId: 'UA-01', value: 1, quote: 'chapters are H1', confidence: 0.9 },
      { ruleId: 'UA-10', value: 'keep', quote: 'maybe keep running heads', confidence: 0.6 },
      { ruleId: 'TBL-01', value: 'reference', quote: 'plain tables', confidence: 0.99 },
    ],
    directives: [], hints: [], unmapped: [],
  }
  const { layer, asHints, partly } = instructionLayer('B', c, { actor: 'batch', at: '2026-10-30T00:00:00Z', unattended: true })
  assert.deepEqual(Object.keys(layer.values), ['UA-01'])
  assert.equal(asHints.length, 2)
  assert.ok(asHints.every((h) => /maybe keep running heads|plain tables/.test(h)))
  assert.deepEqual(partly.map((p) => p.ruleId), ['UA-10', 'TBL-01'])
  assert.ok(instructionNotes({ compiled: c, partly }).some((n) => /Instruction partly understood/.test(n.item)))
})

// ---- directives reach the knobs that exist --------------------------------------------------------------------------------------------------------

const compiled = (...directives: Record<string, unknown>[]): CompiledInstruction => ({ rules: [], directives: directives.map((d) => ({ quote: 'q', ...d })) as CompiledInstruction['directives'], hints: [{ scope: 'book', text: 'Footnotes are at the end of each chapter.', quote: 'q' }, { scope: [[5, 5]], text: 'Two header rows.', quote: 'q' }], unmapped: [] })

test('directives: caption_style and heading_map reach their knobs; ai_pages and strict_review reach the page reader; the rest are hints, and listed as such', () => {
  const k = knobsOf(compiled(
    { op: 'caption_style', signal: 'italic', near: 'figure' },
    { op: 'heading_map', sample: 'Conclusiones', level: 'H3' },
    { op: 'ai_pages', pages: [[2, 3]] },
    { op: 'strict_review', pages: [[8, 9]] },
    { op: 'plates', pages: [[3, 6]] },
    { op: 'columns', pages: [[8, 9]], n: 2 },
    { op: 'treat_as', pages: [[10, 12]], kind: 'index' },
    { op: 'skip_pages', pages: [[1, 1]], as: 'keep' },
  ))
  assert.deepEqual(k.captionStyle, { signal: 'italic', near: 'figure' })
  assert.deepEqual(k.headingMap, [{ sample: 'Conclusiones', level: 'H3' }])
  assert.deepEqual(k.aiPages, [[2, 3]])
  assert.deepEqual(k.strictPages, [[8, 9]])
  assert.deepEqual(k.asHints.map((d) => d.op), ['plates', 'columns', 'treat_as', 'skip_pages'])
  // the page model's context for one page: the book hints, the hints of that page, and the directives that are hints only
  assert.deepEqual(k.hintsFor(5), ['Footnotes are at the end of each chapter.', 'Two header rows.', 'Pages 3–6 are plates (pictures with their captions).'])
  assert.ok(k.hintsFor(4).length === 1 + 1 && k.hintsFor(4)[1] === 'Pages 3–6 are plates (pictures with their captions).')
  assert.ok(k.hintsFor(9).some((h) => /two columns/i.test(h)))
  assert.ok(k.hintsFor(11).some((h) => /index/i.test(h)))
  assert.deepEqual(knobsOf(compiled()).aiPages, 'flagged', 'the default is the flagged pages')
  assert.equal(knobsOf(compiled()).strictPages, undefined)
})

test('ai_pages picks the pages the page reader runs on; strict_review holds the edits of its pages back as pending', () => {
  assert.deepEqual(aiPageSet('flagged', [2, 4], [1, 2, 3, 4, 5]), [2, 4])
  assert.deepEqual(aiPageSet('all', [2, 4], [1, 2, 3, 4, 5]), [1, 2, 3, 4, 5])
  assert.deepEqual(aiPageSet([[3, 4]], [2], [1, 2, 3, 4, 5]), [2, 3, 4], 'a named range is added to the flagged pages')
  const k = knobsOf(compiled({ op: 'strict_review', pages: [[2, 2]] }))
  assert.equal(k.isStrict(2), true)
  assert.equal(k.isStrict(3), false)
  assert.equal(knobsOf(compiled({ op: 'strict_review', pages: 'all' })).isStrict(77), true)
})

test('strict_review: the edits on its pages are not applied and the notes say they wait for a person', () => {
  const k = knobsOf(compiled({ op: 'strict_review', pages: [[2, 2]] }))
  const note = (page: number) => ({ step: 'Page reader', item: 'x', chosen: 'moved', how: 'ai' as const, where: `page ${page}`, status: 'applied' as const })
  const r = holdStrict({ decisions: [{ page: 1, ops: [], by: 'ai' as const }, { page: 2, ops: [], by: 'ai' as const }], notes: [note(1), note(2)] }, k)
  assert.deepEqual(r.decisions.map((d) => d.page), [1])
  assert.deepEqual(r.held.map((d) => d.page), [2])
  assert.deepEqual(r.notes.map((n) => n.status), ['applied', 'pending'])
  assert.match(r.notes[1].chosen, /Waiting for a person/)
})

test('skip_pages as artifact: every text block of those pages becomes an Artifact decision of a person; a page not named is untouched', () => {
  const ev = (page: number): PageEvidence => ({
    page, printed: String(page), w: 400, h: 600, columns: [[60, 340]],
    blocks: [
      { id: `p${page}.t01`, kind: 'text', bbox: [60, 70, 200, 94], size: 12, bodySize: 11, lines: 1, text: 'Ad', lineIds: [`p${page}.l01`], role: 'P' },
      { id: `p${page}.f01`, kind: 'figure', bbox: [60, 100, 200, 200], pieces: [], caption: null },
    ],
    engineOrder: [`p${page}.t01`, `p${page}.f01`], engineConfidence: 0.9,
  })
  const k = knobsOf(compiled({ op: 'skip_pages', pages: [[2, 2]], as: 'artifact' }))
  const d = skipDecisions([ev(1), ev(2), ev(3)], k)
  assert.deepEqual(d, [{ page: 2, by: 'person', ops: [{ op: 'role', id: 'p2.t01', role: 'Artifact' }] }])
})

test('instruction.txt in the job folder (or <book>.instruction.txt beside the PDF) is the instruction; no file, no instruction', () => {
  const dir = mkdtempSync(join(tmpdir(), 't21-'))
  try {
    assert.equal(readInstruction(join(dir, 'job'), join(dir, 'Book.pdf')), undefined)
    writeFileSync(join(dir, 'Book.instruction.txt'), '  Chapters are H1.\n')
    assert.equal(readInstruction(join(dir, 'job'), join(dir, 'Book.pdf')), 'Chapters are H1.')
    writeFileSync(join(dir, 'instruction.txt'), 'Pages 3-6 are plates.')
    assert.equal(readInstruction(dir, join(dir, 'Other.pdf')), 'Pages 3-6 are plates.', 'the job folder first')
    writeFileSync(join(dir, 'instruction.txt'), '   ')
    assert.equal(readInstruction(dir, join(dir, 'Other.pdf')), undefined, 'an empty file is no instruction')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
