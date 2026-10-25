// The pre-export gate (VAL-001, VAL-004): block while a fix-severity problem remains, pass when none does, export anyway only with a
// typed reason that goes to the decision log and the report. Synthetic books only; EPUBCheck is stood in for by a function.
import { test, afterEach, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { packageEpub, type ReviewItem, type Section } from '../src/engine/epub/package.ts'
import { collectGate, collectPdfGate, gateGuards, gateReport, mayExport, MIN_REASON, overrideGate, runEpubGate } from '../src/engine/check/exportgate.ts'
import type { EpubValidator } from '../src/engine/check/gate.ts'
import { DEFAULT_SETTINGS, setSettings, settings } from '../src/engine/settings.ts'
import { MemoryStore, setStore, store } from '../src/engine/spec/store.ts'
import { gatedWrite } from './gate-run.ts'
import { PNG } from './fixtures/indesign-export.ts'

beforeEach(() => setStore(new MemoryStore()))
afterEach(() => {
  setSettings(DEFAULT_SETTINGS)
  delete process.env.GATE_OVERRIDE
  delete process.env.GATE_ACTOR
  process.exitCode = 0 // a blocked headless write sets 3; this suite checks that, it must not fail the run
})

const page = (n: number) => `<span aria-label="page ${n}" epub:type="pagebreak" id="page-${n}" role="doc-pagebreak" title="page ${n}"/>`
const sec = (file: string, nav: string, n: number, extra = ''): Section => ({
  file, id: file.replace('.xhtml', ''), type: 'chapter', nav, title: nav,
  body: `<section aria-labelledby="h-${n}" epub:type="chapter" role="doc-chapter">\n${page(n)}<h2 id="h-${n}">${nav}</h2><p>Ein Absatz Text für ${nav}, lang genug um zu zählen. ${extra}</p>\n</section>`,
})
const meta = { title: 'Das Feld', subtitle: '', authors: 'Ana Autorin', publisher: 'Verlag Test', language: 'de', eisbn: '978-0-306-40615-7', printIsbn: '978-1-86197-271-2', rights: '', certifiedBy: '', conformsTo: '' }
const book = (extra = '') => {
  const review: ReviewItem[] = []
  const r = packageEpub({ meta, sections: [sec('chapter01.xhtml', 'Eins', 1, extra), sec('chapter02.xhtml', 'Zwei', 2)], cover: { path: 'images/cover.png', data: PNG }, images: [], usedClasses: new Map(), bodyDecls: {}, review, css: 'p{}' })
  return { ...r, review }
}
/** a picture the package does not hold: an error from the build's own guard (IMG-011) */
const BROKEN = '<img src="images/missing.png" alt="Ein Bild"/>'
const ok: EpubValidator = async () => ({ errors: [], warnings: [] })
const bad: EpubValidator = async () => ({ errors: ['ERROR(RSC-005): chapter01.xhtml(12,3): element "foo" not allowed here'], warnings: [] })
const none: EpubValidator = async () => null

test('VAL-001 pass: no fix-severity problem, EPUBCheck ran and passed: the export is free', async () => {
  const b = book()
  const g = await runEpubGate(b.epub, b.review, settings(), { validator: ok })
  assert.deepEqual(g.fixes, [], 'the synthetic book is clean')
  assert.equal(g.blocked, false)
  assert.ok(g.ran.includes('EPUBCheck'))
  assert.equal(mayExport(g), true)
  assert.deepEqual(gateGuards(g), [])
  assert.match(gateReport(g, undefined, 'x.epub'), /\*\*Result: PASS\*\*/)
})

test('VAL-001 block: a missing picture and an EPUBCheck error block the export, and the list says what and which check found it', async () => {
  const b = book(BROKEN)
  const g = await runEpubGate(b.epub, b.review, settings(), { validator: bad })
  assert.equal(g.blocked, true)
  assert.ok(g.fixes.some((f) => f.source === 'EPUBCheck' && /RSC-005/.test(f.msg)), 'EPUBCheck’s error is a fix')
  assert.ok(g.fixes.some((f) => /IMG-011/.test(f.msg)), 'the build’s picture guard is a fix')
  assert.equal(mayExport(g), false)
  const [guard] = gateGuards(g)
  assert.equal(guard.level, 'error')
  assert.match(guard.msg, /^VAL-001: export blocked while \d+ problems? to fix remain/)
  assert.match(gateReport(g, undefined, 'x.epub'), /FAIL, EXPORT BLOCKED/)
})

test('VAL-001: a warning never blocks; a validator that cannot run is named, not counted as a failure', async () => {
  const b = book()
  const warned: EpubValidator = async () => ({ errors: [], warnings: ['WARNING(OPF-014): something minor'] })
  const g1 = await runEpubGate(b.epub, b.review, settings(), { validator: warned })
  assert.equal(g1.blocked, false)
  assert.ok(g1.checks.some((c) => /OPF-014/.test(c.msg)))
  const g2 = await runEpubGate(b.epub, b.review, settings(), { validator: none })
  assert.equal(g2.blocked, false)
  assert.ok(g2.skipped.some((s) => /EPUBCheck did not run/.test(s)))
  assert.match(gateReport(g2, undefined, 'x.epub'), /NOT RUN: EPUBCheck did not run/)
})

test('VAL-001 override: needs a name and a typed reason; both are logged and put in the report; a refusal records nothing', async () => {
  const b = book(BROKEN)
  const g = await runEpubGate(b.epub, b.review, settings(), { validator: bad })
  const ctx = { client: 'Verlag Test', book: '9780306406157', specHash: 'abc123' }
  await assert.rejects(overrideGate(g, { ...ctx, actor: '', reason: 'Der Kunde wartet auf die Datei' }), /name/)
  await assert.rejects(overrideGate(g, { ...ctx, actor: 'Ana', reason: 'eilig' }), new RegExp(`at least ${MIN_REASON} characters`))
  await assert.rejects(overrideGate(g, { ...ctx, actor: 'Ana', reason: '            ' }), /reason/)
  assert.deepEqual(await store().listDecisions({ book: ctx.book }), [], 'refused: nothing recorded')
  const o = await overrideGate(g, { ...ctx, actor: ' Ana ', reason: 'Der Kunde wartet auf  die Datei; Bilder folgen.' })
  assert.equal(o.actor, 'Ana')
  assert.equal(o.reason, 'Der Kunde wartet auf die Datei; Bilder folgen.')
  assert.equal(o.fixes, g.fixes.length)
  assert.equal(mayExport(g, o), true)
  // the decision log
  const log = await store().listDecisions({ book: ctx.book })
  assert.equal(log.length, 1)
  assert.deepEqual([log[0].action, log[0].ruleId, log[0].actor, log[0].specHash], ['override', 'VAL-001', 'Ana', 'abc123'])
  assert.match(log[0].detail, /with \d+ fix-severity problems? still open\. Reason: Der Kunde wartet auf die Datei; Bilder folgen\./)
  // the report and the guard
  const rep = gateReport(g, o, 'x.epub')
  assert.match(rep, /FAIL, EXPORTED WITH AN OVERRIDE/)
  assert.match(rep, /- Who: Ana/)
  assert.match(rep, /- Reason: Der Kunde wartet auf die Datei; Bilder folgen\./)
  const [guard] = gateGuards(g, o)
  assert.equal(guard.level, 'info')
  assert.match(guard.msg, /^VAL-004: exported with \d+ problems? open, overridden by Ana on \d{4}-\d\d-\d\d: Der Kunde/)
})

test('VAL-001 override: it covers the problems that were open, not new ones; a clean file has nothing to override', async () => {
  const b = book(BROKEN)
  const g = await runEpubGate(b.epub, b.review, settings(), { validator: bad })
  const o = await overrideGate(g, { actor: 'Ana', reason: 'Bilder folgen im nächsten Durchgang', client: 'c', book: 'b' })
  const worse = { ...g, fixes: [...g.fixes, { source: 'EPUBCheck', msg: 'a new error after a rebuild' }] }
  assert.equal(mayExport(worse, o), false)
  const c = book()
  const clean = await runEpubGate(c.epub, c.review, settings(), { validator: ok })
  await assert.rejects(overrideGate(clean, { actor: 'Ana', reason: 'no reason needed here at all', client: 'c', book: 'b' }), /nothing is blocking/i)
})

test('VAL-001 accessible PDF: a Matterhorn error on the written file blocks; warnings do not; the same message is listed once', () => {
  const err: ReviewItem = { level: 'error', msg: 'Document language (/Lang) is missing.' }
  const warn: ReviewItem = { level: 'warn', msg: 'A link has no description.' }
  const g = collectPdfGate([err, warn], [err, { level: 'info', msg: 'done' }])
  assert.equal(g.kind, 'pdf')
  assert.equal(g.fixes.length, 1)
  assert.equal(g.checks.length, 1)
  assert.equal(g.blocked, true)
  assert.equal(collectPdfGate([warn], []).blocked, false)
})

test('VAL-001: a note the quality check already reports is listed once', async () => {
  const b = book(BROKEN)
  const g = await runEpubGate(b.epub, b.review, settings(), { validator: ok })
  const msgs = g.fixes.map((f) => f.msg)
  assert.equal(new Set(msgs).size, msgs.length, 'no problem listed twice')
  assert.equal(collectGate({ report: { groups: [], errors: 0, warnings: 0, stats: { documents: 0, words: 0, pages: 0, images: 0, notes: 0 } }, review: [] }).blocked, false)
})

test('headless runners: gatedWrite writes a clean file, refuses a blocked one (exit code 3), and writes an overridden one with the reason in the report', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gate-'))
  const clean = book()
  const f1 = join(dir, 'clean.epub')
  const r1 = await gatedWrite('epub', clean.epub, f1, clean.review, { validator: ok })
  assert.equal(r1.written, true)
  assert.ok(existsSync(f1))
  assert.match(readFileSync(join(dir, 'clean.report.md'), 'utf8'), /Result: PASS/)

  const b = book(BROKEN)
  const f2 = join(dir, 'blocked.epub')
  const r2 = await gatedWrite('epub', b.epub, f2, b.review, { validator: bad })
  assert.equal(r2.written, false)
  assert.equal(existsSync(f2), false, 'a blocked file is not written')
  assert.equal(process.exitCode, 3)
  assert.match(readFileSync(join(dir, 'blocked.report.md'), 'utf8'), /FAIL, EXPORT BLOCKED/)
  process.exitCode = 0

  process.env.GATE_OVERRIDE = 'zu kurz'
  const f3 = join(dir, 'short.epub')
  assert.equal((await gatedWrite('epub', b.epub, f3, b.review, { validator: bad })).written, false, 'a one-line reason is refused')
  process.exitCode = 0

  process.env.GATE_OVERRIDE = 'Die Bilder werden im nächsten Durchgang nachgeliefert.'
  process.env.GATE_ACTOR = 'Ana'
  const f4 = join(dir, 'override.epub')
  const r4 = await gatedWrite('epub', b.epub, f4, b.review, { validator: bad, client: 'Verlag Test', book: 'b' })
  assert.equal(r4.written, true)
  assert.ok(existsSync(f4))
  assert.match(readFileSync(join(dir, 'override.report.md'), 'utf8'), /Reason: Die Bilder werden im nächsten Durchgang nachgeliefert\./)
  assert.equal((await store().listDecisions({ book: 'b' }))[0].action, 'override')
  assert.equal(r4.guards[0].msg.slice(0, 8), 'VAL-004:')
})
