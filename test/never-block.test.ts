// Client rule (Oct 26): the app never blocks. Whenever it is unsure, Next / Download stays on and offers three ways in: Fix with AI,
// I'll fix it myself, Continue anyway. What was decided or left unsure goes into <name>_REVIEW_NOTES.txt beside the file.
// Pure logic, the dialog in jsdom, and a scan of the screens for any condition that could grey a button out. Synthetic data only.
import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { JSDOM } from 'jsdom'
import { detailNeeds, isInput, nextPlan, structureNeeds, type Need } from '../src/ui/needs.ts'
import { acceptable, blockingItems, type CheckItem } from '../src/engine/review/confidence.ts'
import { decideDetails, decideStructure, leftNote, mergeNotes, missingDetails, reviewNotes, reviewNotesName, tally, whereOfItem, withLeft, type DecisionNote } from '../src/engine/review/decisions.ts'
import { collectGate, continueAnyway, DEFAULT_REASON, mayExport, MIN_REASON, overrideGate, type ExportGate } from '../src/engine/check/exportgate.ts'
import { MemoryStore, setStore, store } from '../src/engine/spec/store.ts'
import { placeholderCover } from '../src/engine/epub/placeholder-cover.ts'
import { unzip } from '../src/engine/zip.ts'
import { packageEpub, type Section } from '../src/engine/epub/package.ts'
import { PNG } from './fixtures/indesign-export.ts'

beforeEach(() => setStore(new MemoryStore()))

// ---- a book the size of the Vietnam sample: 83 unplaced pictures, 147 unknown parts, a style the tool doubts, no publisher ----
const items: CheckItem[] = [
  ...Array.from({ length: 83 }, (_, i): CheckItem => ({ id: `picture:OEBPS/image/${1000 + i}.jpg`, area: 'picture', confidence: 'low', score: 0, title: `Picture ${1000 + i}.jpg: printed page ${i + 4} (placed by nothing)`, why: 'No signal placed it.', ref: `OEBPS/image/${1000 + i}.jpg`, topic: 'figure' })),
  ...Array.from({ length: 147 }, (_, i): CheckItem => ({ id: `section:${i}`, area: 'section', confidence: 'low', score: 0.4, title: `“Part ${i}” is an unknown kind of section`, why: 'Choose what it is.', ref: i })),
  { id: 'style:tital', area: 'style', confidence: 'low', score: 0.55, title: 'Style “tital” (1×) is read as: section-title', why: 'Seen once.', ref: 'tital', topic: 'heading' },
  { id: 'meta:publisher', area: 'meta', confidence: 'low', score: 0.3, title: 'Publisher not found', why: 'Nothing says it.', ref: 'publisher' },
]
const sections = Array.from({ length: 147 }, (_, i) => ({ nav: `Part ${i}`, file: `part${i}.xhtml` }))
const fix = () => decideStructure(blockingItems(items, new Set()), { roleOf: (k) => (k === 'tital' ? 'section-title' : undefined), typeOf: () => 'other', valueOf: () => '', sections })

test('Next is only ever off while a job runs; unsure items open the three choices, a missing file explains itself', () => {
  const unsure: Need[] = structureNeeds(blockingItems(items, new Set()), acceptable)
  assert.equal(unsure.length, 83 + 147 + 2)
  const busy = nextPlan({ busy: true, needs: unsure })
  assert.equal(busy.disabled, true, 'a running job may grey the button')
  const p = nextPlan({ needs: unsure })
  assert.equal(p.disabled, false, '233 unsure items never switch Next off')
  assert.equal(p.opens, 'dialog')
  assert.deepEqual([...p.choices], ['fix', 'myself', 'anyway'])
  assert.deepEqual(nextPlan({ needs: [] }), { disabled: false, opens: 'go', choices: [], missingInput: [] })
  const noFile: Need[] = [{ id: 'file:export', label: 'Add the InDesign EPUB export', group: 'InDesign export', kind: 'choice' }]
  const f = nextPlan({ needs: noFile })
  assert.equal(f.disabled, false, 'even with no file the button answers (it says what to add)')
  assert.deepEqual([...f.choices], [], 'nothing to guess without a file')
  assert.ok(isInput(noFile[0]))
})

test('Fix with AI on the Structure step decides all 232 items and the step is no longer held', () => {
  const d = fix()
  assert.equal(d.notes.length, 83 + 147 + 2)
  assert.deepEqual(blockingItems(items, new Set(d.ack)), [], 'nothing is left to hold Next')
  assert.deepEqual(d.keepStyles, ['tital'])
  const style = d.notes.find((n) => n.item.startsWith('Style'))!
  assert.match(style.chosen, /Kept as “section-title” \(55% sure\)/)
  assert.equal(style.where, 'style “tital”')
  const pic = d.notes.find((n) => n.item.startsWith('Picture 1006.jpg'))!
  assert.equal(pic.where, 'picture file 1006.jpg, printed page 10')
  assert.match(pic.chosen, /Kept where the tool placed it/)
  const part = d.notes.find((n) => n.item.includes('“Part 5”'))!
  assert.equal(part.where, 'part 6 (“Part 5”), file part5.xhtml')
  const pub = d.notes.find((n) => n.item === 'Publisher not found')!
  assert.equal(pub.how, 'left', 'a publisher the book does not name cannot be guessed')
  assert.equal(pub.where, 'Book details › publisher')
  for (const n of d.notes) assert.ok(n.step && n.item && n.chosen && n.where, `${n.item} has step, item, choice and place`)
})

test('Continue anyway leaves the items as guessed: each is written as left, with its place', () => {
  const needs = structureNeeds(blockingItems(items, new Set()), acceptable, (it) => whereOfItem(it, sections))
  const left = needs.filter((n) => !isInput(n)).map((n) => leftNote('Structure', n))
  assert.equal(left.length, 232)
  assert.ok(left.every((n) => n.how === 'left' && n.chosen.length > 0 && n.where))
  assert.equal(tally(left).left, 232)
})

test('Book details: nothing missing ever stops the step; the empty ones are listed, the title takes the file name', () => {
  const empty = { title: '', authors: '', publisher: '', eisbn: '' }
  const needs = detailNeeds(empty)
  assert.deepEqual(needs.map((n) => n.group), ['book title', 'author name', 'publisher name', 'e-book ISBN'])
  assert.equal(nextPlan({ needs }).disabled, false)
  assert.deepEqual(detailNeeds({ title: 'T', authors: 'A', publisher: 'P', eisbn: '978-0-306-40615-7' }), [])
  const d = decideDetails(empty, 'Das_Feld-final.epub')
  assert.equal(d.meta.title, 'Das Feld final')
  assert.deepEqual(d.notes.map((n) => n.how), ['guess', 'left', 'left', 'left'])
  assert.ok(d.notes.every((n) => n.step === 'Book details' && n.where))
  assert.deepEqual(missingDetails({ ...empty, language: 'de' }), ['Title: not given.', 'Author: not given.', 'Publisher: not given.', 'E-book ISBN: not given (the file name starts with NO-ISBN).'])
  assert.match(missingDetails({ title: 'T', authors: 'A', publisher: 'P', language: 'de', eisbn: '123' })[0], /not a valid 13-digit ISBN/)
})

// ---- the export gate ----
const blocked: ExportGate = {
  kind: 'epub',
  fixes: [{ source: 'EPUBCheck', msg: 'ERROR(RSC-005): chapter01.xhtml(12,3): element "foo" not allowed here', where: 'chapter01.xhtml' }, { source: 'Quality check', msg: 'Picture 1006.jpg has no description', where: 'images/1006.jpg' }],
  checks: [{ source: 'Quality check', msg: 'Page 12 looks different in print' }],
  ran: ['Quality check', 'EPUBCheck'],
  skipped: [],
  blocked: true,
  at: '2026-10-26T10:00:00.000Z',
}

test('Download is never refused: Continue anyway needs no name and no reason, and logs the override', async () => {
  const o = await continueAnyway(blocked, { client: 'Crowood', book: 'Das Feld' })
  assert.equal(o.actor, 'reviewer')
  assert.equal(o.reason, DEFAULT_REASON)
  assert.ok(DEFAULT_REASON.length >= MIN_REASON)
  assert.equal(o.fixes, 2)
  assert.equal(mayExport(blocked, o), true)
  const log = await store().listDecisions({ client: 'Crowood', book: 'Das Feld' })
  assert.equal(log.length, 1)
  assert.equal(log[0].action, 'override')
  assert.match(log[0].detail, /2 fix-severity problems still open/)
  // a typed reason still wins, and the strict override keeps refusing a one-word reason (nothing weakened)
  const typed = await continueAnyway(blocked, { actor: 'Ana', reason: 'The client approved this file on the phone', client: 'Crowood', book: 'Das Feld' })
  assert.deepEqual([typed.actor, typed.reason], ['Ana', 'The client approved this file on the phone'])
  await assert.rejects(overrideGate(blocked, { actor: 'Ana', reason: 'ok', client: 'c', book: 'b' }), /at least 12 characters/)
})

test('Download is not held back when the decision log cannot be written', async () => {
  setStore({ ...new MemoryStore(), addDecision: async () => { throw new Error('storage is full') } } as unknown as MemoryStore)
  const o = await continueAnyway(blocked, { actor: 'Ana', client: 'c', book: 'b' })
  assert.equal(mayExport(blocked, o), true)
  assert.equal(o.fixes, 2)
})

// ---- the review notes ----
test('the review notes name the item, the choice and the place; they go beside the file, never into it', async () => {
  const d = fix()
  const picked: DecisionNote[] = [
    ...d.notes.slice(0, 2),
    ...d.notes.filter((n) => n.item === 'Publisher not found' || n.item.startsWith('Style')),
    { step: 'Pictures', item: 'Picture 1006.jpg: no description yet', chosen: 'The picture AI wrote “A river at dawn”; accepted without a person reading it.', how: 'ai', where: 'picture file 1006.jpg' },
  ]
  const o = await continueAnyway(blocked, { client: 'c', book: 'b' })
  const txt = reviewNotes({ file: 'Das Feld.epub', kind: 'Accessible EPUB', notes: picked, missing: missingDetails({ title: 'Das Feld', authors: 'Ana', publisher: '', language: 'de', eisbn: '' }), gate: blocked, override: o, at: new Date('2026-10-26T10:00:00Z') })
  assert.match(txt, /^REVIEW NOTES for Das Feld\.epub/)
  assert.match(txt, /Decided by the picture AI \(1\)/)
  assert.match(txt, /\[Pictures\] Picture 1006\.jpg: no description yet\n {4}Chosen: The picture AI wrote “A river at dawn”/)
  assert.match(txt, /Where: picture file 1006\.jpg/)
  assert.match(txt, /\[Structure\] Style “tital” \(1×\) is read as: section-title\n {4}Chosen: Kept as “section-title” \(55% sure\)\n {4}Where: style “tital”/)
  assert.match(txt, /Left as guessed \(still unsure\): please look at these \(1\)/)
  assert.match(txt, /Publisher not found\n {4}Chosen: Left empty/)
  assert.match(txt, /Publisher: not given\./)
  assert.match(txt, /Problems still open in the file \(2\)/)
  assert.match(txt, /- EPUBCheck: ERROR\(RSC-005\)/)
  assert.match(txt, /Exported anyway by reviewer on /)
  assert.equal(reviewNotesName('9781234567897.epub'), '9781234567897_REVIEW_NOTES.txt')
  assert.equal(reviewNotesName('My Book.report.pdf'), 'My Book.report_REVIEW_NOTES.txt')
  // an EPUB built by the packager holds no notes file (an unmanifested file would fail EPUBCheck)
  const meta = { title: 'Das Feld', subtitle: '', authors: 'Ana', publisher: 'Verlag', language: 'de', eisbn: '978-0-306-40615-7', printIsbn: '', rights: '', certifiedBy: '', conformsTo: '' }
  const sec: Section = { file: 'chapter01.xhtml', id: 'chapter01', type: 'chapter', nav: 'Eins', title: 'Eins', body: '<section epub:type="chapter" role="doc-chapter"><h2>Eins</h2><p>Text.</p></section>' }
  const epub = packageEpub({ meta, sections: [sec], cover: { path: 'images/cover.png', data: PNG }, images: [], usedClasses: new Map(), bodyDecls: {}, review: [], css: 'p{}' })
  assert.ok(![...unzip(epub.epub).keys()].some((p) => /REVIEW_NOTES/i.test(p)))
})

test('notes: deciding twice is written once; an item decided on the way is not repeated as left', () => {
  const a: DecisionNote = { step: 'Structure', item: 'X', chosen: 'Left', how: 'left' }
  const b: DecisionNote = { ...a, chosen: 'Kept', how: 'guess' }
  assert.deepEqual(mergeNotes([a], [b]), [b])
  assert.deepEqual(withLeft([b], [a, { ...a, item: 'Y' }]).map((n) => n.item), ['X', 'Y'])
  assert.equal(withLeft([b], [a])[0].how, 'guess')
})

test('no cover must not stop an export: the placeholder is a real PNG', () => {
  const c = placeholderCover()
  assert.deepEqual([...c.data.slice(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const v = new DataView(c.data.buffer, c.data.byteOffset)
  assert.deepEqual([v.getUint32(16), v.getUint32(20)], [600, 900])
})

// ---- the dialog ----
const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true })
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true })
const { createElement: h, act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { NeedsDialog } = await import('../src/ui/NeedsDialog.ts')

async function render(el: unknown) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(el as never))
  return { host, root }
}
const buttons = (host: Element) => [...host.querySelectorAll('button')]
const named = (host: Element, label: string) => buttons(host).find((b) => b.textContent === label)

test('the dialog offers Fix with AI, I’ll fix it myself and Continue anyway, all on, each doing its own thing', async () => {
  const needs = structureNeeds(blockingItems(items, new Set()), acceptable)
  const calls: string[] = []
  const target = document.createElement('li')
  target.id = needs[0].target!
  document.body.append(target)
  const { host, root } = await render(h(NeedsDialog, { needs, onClose: () => calls.push('close'), onFix: () => calls.push('fix'), onContinueAnyway: () => calls.push('anyway') }))
  for (const label of ['Fix with AI', 'I’ll fix it myself', 'Continue anyway']) {
    const b = named(host, label)
    assert.ok(b, `${label} is offered`)
    assert.equal((b as HTMLButtonElement).disabled, false, `${label} is never disabled`)
  }
  assert.equal(document.activeElement?.textContent, 'Fix with AI', 'focus starts on the first way on')
  await act(async () => void named(host, 'Fix with AI')!.click())
  await act(async () => void named(host, 'Continue anyway')!.click())
  assert.deepEqual(calls, ['close', 'fix', 'close', 'anyway'])
  // I'll fix it myself stays on the step and highlights the unsure items
  await act(async () => void named(host, 'I’ll fix it myself')!.click())
  await act(async () => void (await new Promise((r) => setTimeout(r, 5))))
  assert.ok(target.classList.contains('need-highlight'))
  await act(async () => root.unmount())
  host.remove()
  target.remove()
})

test('the dialog for a missing file offers no guess, only the way to add it', async () => {
  const needs: Need[] = [{ id: 'file:export', label: 'Add the InDesign EPUB export', group: 'InDesign export', kind: 'choice' }]
  const { host, root } = await render(h(NeedsDialog, { needs, onClose: () => {}, onFix: () => {}, onContinueAnyway: () => {} }))
  assert.equal(named(host, 'Fix with AI'), undefined)
  assert.equal(named(host, 'Continue anyway'), undefined)
  assert.ok(named(host, 'Close'))
  await act(async () => root.unmount())
  host.remove()
})

// ---- the screens: a scan for anything that could grey a button out or leave a dead end ----
const ui = join(import.meta.dirname, '..', 'src', 'ui')
const src = (f: string) => readFileSync(join(ui, f), 'utf8')
const flows = ['IndesignFlow.tsx', 'PdfFlow.tsx', 'PdfUaFlow.tsx']
/** `<StepNav ...>` opening tags, from "<StepNav" to the first ">" that is not an arrow or inside braces */
const stepNavs = (code: string) => {
  const out: string[] = []
  for (let i = code.indexOf('<StepNav'); i >= 0; i = code.indexOf('<StepNav', i + 1)) {
    let depth = 0
    let j = i
    for (; j < code.length; j++) {
      const c = code[j]
      if (c === '{') depth++
      else if (c === '}') depth--
      else if (c === '>' && depth === 0 && code[j - 1] !== '=') break
    }
    out.push(code.slice(i, j + 1))
  }
  return out
}

test('every Next button is greyed out only while a job runs', () => {
  let n = 0
  for (const f of [...flows, 'wizard.tsx']) {
    for (const tag of stepNavs(src(f)).filter((t) => !t.includes('export function'))) {
      n++
      const d = tag.match(/nextDisabled=\{([^}]*)\}/)
      if (d) assert.match(d[1].trim(), /^(!!)?busy$/, `${f}: nextDisabled must be only “busy”, found {${d[1]}}`)
    }
  }
  assert.ok(n >= 9, `found ${n} StepNav buttons`)
  assert.match(src('wizard.tsx'), /disabled=\{plan\.disabled\}/)
  assert.doesNotMatch(src('wizard.tsx'), /useConfirmNext/, 'the two-click warning that held Next is gone')
})

test('every step that lists unsure items gives the three choices (Fix with AI, a way to look, Continue anyway)', () => {
  for (const f of flows) {
    for (const tag of stepNavs(src(f))) {
      if (!/needs=|choices/.test(tag)) continue
      const onlyFiles = /needs=\{(fileNeeds|[^}]*'file:)/.test(tag) && !/choices/.test(tag)
      if (onlyFiles) continue // nothing to guess without a file
      assert.match(tag, /\.\.\.(rn\.choices\(|choices)/, `${f}: a StepNav with needs must spread rn.choices(...) (Fix with AI and Continue anyway)`)
    }
  }
  // the dialog and the inline gate list the same three labels
  const dialog = src('NeedsDialog.ts')
  for (const label of ['Fix with AI', 'I’ll fix it myself', 'Continue anyway']) assert.ok(dialog.includes(label), `${label} in the dialog`)
  const gated = src('GatedDownload.tsx')
  for (const label of ['Fix with AI', 'I’ll fix it myself', 'Continue anyway']) assert.ok(gated.includes(label), `${label} beside Download`)
  assert.match(gated, /<button className="primary big" onClick=\{[^}]*\} disabled=\{busy\}/, 'Download is off only while a job runs')
  assert.doesNotMatch(gated, /disabled=\{!ok\}|mayExport\(gate, override\)\s*\?/, 'Download no longer waits for an override')
  assert.doesNotMatch(src('SpecStep.tsx'), /disabled=\{!actor/, 'accepting the spec no longer waits for a name')
})

test('the only other disabled conditions are jobs that run, helpers that need a key or a file, and fixed rules', () => {
  const allowed = new Set([
    '!!busy', 'busy',
    '!!busy || !visionOn || needAlt.length === 0', 'busy || !visionOn || todo === 0', 'busy || !visionOn || todo.length === 0', // "Draft the missing descriptions": a helper, not a way on
    'im.decorative', '!!decorative[f.key]', // the description box of a decorative picture
    '!epub || !!busy', // the stand-alone checker has nothing to check without a file
    "certifyBlocked && (k === 'certifiedBy' || k === 'conformsTo')", // the certification fields stay empty while AI drafts are unapproved
    "!spec?.layers.some((l) => l.level === 'client')", // a choice in a list
    '!s.enabled', 'plan.disabled', 'at <= 0', 'at >= list.length - 1', // the step bar, Next while busy, Previous/Next page in the print compare
    '!!busy || !ai.apiKey', '!!busy || !confirmed.size', "!rule || r.value === undefined || rule.kind === 'locked'", '!chosen.length || !!busy', // importing a requirements file
  ])
  const found: string[] = []
  for (const f of readdirSync(ui).filter((x) => x.endsWith('.tsx'))) for (const m of src(f).matchAll(/disabled=\{([^}]*)\}/g)) found.push(`${f}: ${m[1]}`)
  assert.ok(found.length > 20)
  for (const x of found) assert.ok(allowed.has(x.split(': ').slice(1).join(': ')), `unexpected disabled condition ${x}: it could block someone; use the three choices instead`)
})

test('the flows carry the notes with the file and show them on the last step', () => {
  for (const f of flows) {
    const code = src(f)
    assert.match(code, /notes=\{notesText\}|notes=\{notes\}/, `${f}: GatedDownload gets the review notes`)
    assert.match(code, /<ReviewSummary/, `${f}: the summary is on screen`)
    assert.match(code, /onFix=\{/, `${f}: Fix with AI is wired at the download`)
  }
  assert.match(src('GatedDownload.tsx'), /reviewNotesName\(name\)/)
  // the notes are never put into the EPUB or PDF packaging
  for (const dir of ['epub', 'indesign', 'pdfepub', 'wordepub', 'pdfua']) for (const f of readdirSync(join(import.meta.dirname, '..', 'src', 'engine', dir))) assert.doesNotMatch(readFileSync(join(import.meta.dirname, '..', 'src', 'engine', dir, f), 'utf8'), /REVIEW_NOTES/, `${dir}/${f}`)
})

test('a gate collected from a clean book still passes with nothing to override', () => {
  const g = collectGate({ report: { groups: [], stats: { documents: 0, words: 0, pages: 0, images: 0, notes: 0 } } as never, review: [] })
  assert.equal(g.blocked, false)
  assert.equal(mayExport(g), true)
})
