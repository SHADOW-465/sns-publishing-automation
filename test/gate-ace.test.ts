// Phase 1: axe-core on every page and the full Ace by DAISY run are stages of the gate.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { acePath, aceHandler, aceFindings, runAce } from '../server/ace-service.mjs'
import { gate, httpValidator } from '../src/engine/check/gate.ts'
import { DEFAULT_SETTINGS } from '../src/engine/settings.ts'
import { analyze, build } from '../src/engine/indesign/build.ts'
import { unzip, zipEpub, text, bytes } from '../src/engine/zip.ts'
import { synthExport, SYNTH_CSS, synthBook } from './synth.ts'
import { jsdomAxe } from './axe-node.ts'

const cover = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))
function book(profile: 'accessible' | 'standard' = 'accessible') {
  const a = analyze(synthExport(synthBook(2, (n) => `<p class="Cuerpo">${'Una frase del capítulo. '.repeat(30)}${n}</p>`), SYNTH_CSS))
  return build(a, { styles: a.styles, images: a.images, meta: { ...a.meta, eisbn: '9780306406157', profile }, cover: { name: 'cover.png', data: cover } })
}
/** the same book with a picture that has no alt and a link with no text in chapter 1 */
function broken(epub: Uint8Array) {
  const f = unzip(epub)
  const k = [...f.keys()].find((p) => /chapter01\.xhtml$/.test(p))!
  f.set(k, bytes(text(f.get(k)!).replace('</section>', '<p><a href="#top"></a></p><img src="images/none.png"/></section>')))
  return zipEpub(f)
}

test('axe-core runs on every page: a built book is clean, a missing alt and an empty link are errors', async () => {
  const r = book()
  const good = await gate(r.epub, DEFAULT_SETTINGS, { source: r.source, conformance: false, axe: jsdomAxe })
  assert.deepEqual(good.stages.find((s) => s.id === 'accessibility')!.errors, [])
  assert.ok(!good.notes.some((n) => /axe-core did not run/.test(n)))
  const bad = await gate(broken(r.epub), DEFAULT_SETTINGS, { conformance: false, axe: jsdomAxe })
  const errs = bad.stages.find((s) => s.id === 'accessibility')!.errors.join('\n')
  assert.match(errs, /chapter01\.xhtml: .*\(axe image-alt, 1 place\)/)
  assert.match(errs, /\(axe link-name/)
  assert.equal(bad.verdict, 'red')
  const none = await gate(r.epub, DEFAULT_SETTINGS, { conformance: false })
  assert.ok(none.notes.some((n) => /axe-core did not run/.test(n)), 'without a runner the gate says so')
})

test('Ace findings: critical and serious are errors, the rest warnings, one line per check and page', () => {
  const fail = (title: string, impact: string) => ({ 'earl:test': { 'dct:title': title, 'earl:impact': impact, help: { 'dct:description': `${title} help` } }, 'earl:result': { 'earl:outcome': 'fail' } })
  const r = aceFindings({ assertions: [
    { 'earl:testSubject': { url: 'chapter01.xhtml' }, assertions: [fail('image-alt', 'critical'), fail('image-alt', 'critical'), fail('heading-order', 'moderate')] },
    { 'earl:testSubject': { url: 'nav.xhtml' }, assertions: [{ ...fail('link-name', 'serious'), 'earl:result': { 'earl:outcome': 'pass' } }] },
  ] })
  assert.deepEqual(r, { errors: ['chapter01.xhtml: image-alt help (Ace image-alt)'], warnings: ['chapter01.xhtml: heading-order help (Ace heading-order)'] })
})

test('the full Ace run is a gate stage for an accessible book, reached over HTTP; a standard EPUB is not sent to it', { skip: !acePath() && 'Ace not installed in tools/ace (node scripts/fetch-tools.mjs --ace)', timeout: 300_000 }, async () => {
  const srv = createServer(aceHandler)
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))
  try {
    const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/api/ace`
    assert.deepEqual(await (await fetch(url)).json(), { available: true })
    const r = book()
    const good = await gate(r.epub, DEFAULT_SETTINGS, { source: r.source, conformance: false, ace: httpValidator(url) })
    const stage = good.stages.find((s) => s.id === 'ace')!
    assert.equal(stage.ran, true)
    assert.deepEqual(stage.errors, [])
    const bad = await gate(broken(r.epub), DEFAULT_SETTINGS, { conformance: false, ace: httpValidator(url) })
    assert.match(bad.stages.find((s) => s.id === 'ace')!.errors.join('\n'), /chapter01\.xhtml: .*\(Ace image-alt\)/)
    assert.equal(bad.verdict, 'red')
    const std = book('standard')
    assert.equal((await gate(std.epub, DEFAULT_SETTINGS, { conformance: false, ace: httpValidator(url) })).stages.some((s) => s.id === 'ace'), false)
  } finally {
    srv.close()
  }
})

test('Ace is optional: when it is missing or fails to run, the service says 503 and the gate falls back to axe-core, never red for that alone', async () => {
  const home = mkdtempSync(join(tmpdir(), 'ace-home-'))
  const before = process.env.ACE_HOME
  const srv = createServer(aceHandler)
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))
  const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/api/ace`
  try {
    // an install whose headless Chrome is missing: Ace starts, writes no report and exits 1
    const bin = join(home, 'node_modules', '@daisy', 'ace', 'bin')
    mkdirSync(bin, { recursive: true })
    writeFileSync(join(bin, 'ace-puppeteer.js'), 'console.error("Could not find Chrome"); process.exit(1)')
    process.env.ACE_HOME = home
    const r = book()
    assert.equal(await runAce(r.epub), null)
    const res = await fetch(url, { method: 'POST', body: r.epub as unknown as BodyInit })
    assert.equal(res.status, 503)
    assert.match((await res.json()).error, /did not run/)
    const g = await gate(r.epub, DEFAULT_SETTINGS, { source: r.source, conformance: false, axe: jsdomAxe, ace: httpValidator(url) })
    const stage = g.stages.find((s) => s.id === 'ace')!
    assert.deepEqual([stage.ran, stage.errors], [false, []])
    assert.notEqual(g.verdict, 'red')
    assert.ok(g.notes.some((n) => /Ace by DAISY did not run here, so the pages were checked with axe-core/.test(n)), g.notes.join(' | '))
    // the static web copy: no service at all
    const web = await gate(r.epub, DEFAULT_SETTINGS, { source: r.source, conformance: false, axe: jsdomAxe, ace: httpValidator('http://127.0.0.1:9/api/ace') })
    assert.equal(web.stages.find((s) => s.id === 'ace')!.ran, false)
    assert.notEqual(web.verdict, 'red')
  } finally {
    if (before === undefined) delete process.env.ACE_HOME
    else process.env.ACE_HOME = before
    srv.close()
    rmSync(home, { recursive: true, force: true })
  }
})

test('when the full Ace ran, axe-core does not run again (Ace already runs it), so its findings are not counted twice', async () => {
  const r = book()
  let pages = 0
  const counting = async (x: string) => (pages++, jsdomAxe(x))
  const ace = async () => ({ errors: ['chapter01.xhtml: Images must have alternative text (Ace image-alt)'], warnings: [] })
  const g = await gate(r.epub, DEFAULT_SETTINGS, { source: r.source, conformance: false, axe: counting, ace })
  assert.equal(pages, 0)
  assert.deepEqual(g.stages.filter((s) => s.errors.length).map((s) => s.id), ['ace'])
  assert.ok(!g.notes.some((n) => /axe-core did not run/.test(n)), g.notes.join(' | '))
  await gate(r.epub, DEFAULT_SETTINGS, { source: r.source, conformance: false, axe: counting, ace: async () => null })
  assert.ok(pages > 0, 'without Ace, axe-core checks every page')
})
