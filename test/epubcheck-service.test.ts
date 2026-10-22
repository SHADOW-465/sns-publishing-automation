// Phase 1: EPUBCheck runs from the bundled JRE through a local service, and the gate reaches it over HTTP.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtempSync, mkdirSync, writeFileSync, linkSync, copyFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { toolPaths, epubcheckHandler, runEpubcheck } from '../server/epubcheck-service.mjs'
import { httpValidator, gate } from '../src/engine/check/gate.ts'
import { DEFAULT_SETTINGS } from '../src/engine/settings.ts'
import { analyze, build } from '../src/engine/indesign/build.ts'
import { synthExport, SYNTH_CSS, synthBook } from './synth.ts'

const cover = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))

test('the gate reaches the bundled EPUBCheck over HTTP; a bad file reports errors, a good one passes', { skip: !toolPaths() && 'EPUBCheck not installed in tools/', timeout: 120_000 }, async () => {
  const srv = createServer(epubcheckHandler)
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))
  try {
    const url = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/api/epubcheck`
    assert.deepEqual(await (await fetch(url)).json(), { available: true })
    const a = analyze(synthExport(synthBook(2, (n) => `<p class="Cuerpo">${'Una frase del capítulo. '.repeat(30)}${n}</p>`), SYNTH_CSS))
    const r = build(a, { styles: a.styles, images: a.images, meta: { ...a.meta, eisbn: '9780306406157' }, cover: { name: 'cover.png', data: cover } })
    const good = await gate(r.epub, DEFAULT_SETTINGS, { source: r.source, validator: httpValidator(url), conformance: false })
    assert.equal(good.stages.find((s) => s.id === 'epubcheck')!.ran, true)
    assert.deepEqual(good.stages.find((s) => s.id === 'epubcheck')!.errors, [])
    const bad = await httpValidator(url)(new Uint8Array([1, 2, 3]))
    assert.ok(bad && bad.errors.length > 0, 'a file that is not an EPUB is reported')
  } finally {
    srv.close()
  }
})

test('without a service the gate says EPUBCheck did not run instead of failing', async () => {
  const none = await httpValidator('http://127.0.0.1:9/api/epubcheck')(new Uint8Array([1]))
  assert.equal(none, null)
})

test('an EPUBCheck that did not run (no jar, a Java that will not start) is "did not run", never a pass', async () => {
  const home = mkdtempSync(join(tmpdir(), 'epc-home-'))
  const before = process.env.EPUBCHECK_HOME
  try {
    // a "java" that refuses the JVM options and exits: node itself (it rejects -Xmx384m)
    const bin = join(home, 'jdk-0-fake', 'bin')
    mkdirSync(bin, { recursive: true })
    const java = join(bin, process.platform === 'win32' ? 'java.exe' : 'java')
    try { linkSync(process.execPath, java) } catch { copyFileSync(process.execPath, java) }
    mkdirSync(join(home, 'epubcheck-0'))
    process.env.EPUBCHECK_HOME = home
    assert.notEqual(toolPaths()?.dir, home, 'an EPUBCheck folder without its jar is not an install')
    writeFileSync(join(home, 'epubcheck-0', 'epubcheck.jar'), '')
    assert.equal(toolPaths()?.dir, home)
    assert.equal(await runEpubcheck(new Uint8Array([1, 2, 3])), null, 'no EPUBCheck report in the output: it did not run')
  } finally {
    if (before === undefined) delete process.env.EPUBCHECK_HOME
    else process.env.EPUBCHECK_HOME = before
    rmSync(home, { recursive: true, force: true })
  }
})
