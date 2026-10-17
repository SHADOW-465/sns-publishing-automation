// Phase 1: EPUBCheck runs from the bundled JRE through a local service, and the gate reaches it over HTTP.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { toolPaths, epubcheckHandler } from '../server/epubcheck-service.ts'
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
