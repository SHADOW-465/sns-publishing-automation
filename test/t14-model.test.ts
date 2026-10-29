// T14 (OPUS_DESIGN2 §b.2, §b.4, §b.7, §b.8): the model client and page rendering in Node.
// A fake OpenAI-compatible server answers valid, invalid and slow; with the server off, the build goes on and the pages are "left".
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PageEvidence } from '../src/engine/pdf/evidence.ts'
import { askPage, askPages, renderPage, pageAnswerSchema, PAGE_MODEL_TIMEOUT_MS } from '../src/engine/pdf/page-model.ts'
import { nodeRaster } from './raster-node.ts'

const ev = (page: number): PageEvidence => ({
  page, printed: String(page), w: 400, h: 600, columns: [[60, 340]],
  blocks: [{ id: `p${page}.b01`, kind: 'text', bbox: [60, 70, 200, 94], size: 12, bodySize: 11, lines: 1, text: 'Chapter One', lineIds: [`p${page}.l01`], role: 'H1' }],
  engineOrder: [`p${page}.b01`], engineConfidence: 0.6,
})
const PNG1 = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const answer = (page: number) => ({ page, ops: [{ op: 'role', id: `p${page}.b01`, role: 'H2' }, { op: 'none' }], confidence: 0.9, reasons: [{ op: 0, why: 'a chapter title' }] })

/** a fake chat-completions server: `reply(n, body)` gives the message text for request n, or undefined to hang */
async function serve(reply: (n: number, body: Record<string, any>, req: IncomingMessage) => string | undefined | Promise<string | undefined>) {
  let n = 0
  const seen: Record<string, any>[] = []
  const hung: (() => void)[] = []
  const server: Server = createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', async () => {
      const body = JSON.parse(raw)
      seen.push(body)
      const text = await reply(n++, body, req)
      if (text === undefined) return void hung.push(() => res.destroy()) // never answers
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ choices: [{ message: { content: text } }] }))
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`
  return { baseUrl, seen, close: () => (hung.forEach((h) => h()), server.close()) }
}
const cfg = (baseUrl: string) => ({ apiKey: '', baseUrl, model: 'fake-vl' })
const req = (page: number) => ({ ev: ev(page), images: [{ dpi: 150, png: PNG1 }], hints: ['The captions are the small italic lines.'], rules: ['PRO-001 columns read left to right'] })

test('T14: a valid answer is parsed, and the request is pinned, schema-guided and carries the page image and the layout JSON', async () => {
  const s = await serve(() => '```json\n' + JSON.stringify(answer(7)) + '\n```')
  try {
    const r = await askPage(cfg(s.baseUrl), req(7))
    assert.equal(r.status, 'ok')
    if (r.status !== 'ok') return
    assert.deepEqual(r.answer.ops, answer(7).ops)
    assert.equal(r.answer.confidence, 0.9)
    assert.match(r.raw, /"role"/)
    const b = s.seen[0]
    assert.equal(b.model, 'fake-vl')
    assert.equal(b.temperature, 0)
    assert.equal(typeof b.seed, 'number')
    assert.equal(b.top_k, 1)
    assert.equal(typeof b.max_tokens, 'number')
    assert.equal(b.response_format.type, 'json_schema')
    assert.deepEqual(b.response_format.json_schema.schema, pageAnswerSchema())
    const user = b.messages.find((m: any) => m.role === 'user').content
    assert.ok(user.some((p: any) => p.type === 'image_url' && p.image_url.url.startsWith('data:image/png;base64,iVBORw0KGgo')))
    const text = user.filter((p: any) => p.type === 'text').map((p: any) => p.text).join('\n')
    assert.match(text, /"id":\s*"p7\.b01"/)
    assert.match(text, /PRO-001/)
    assert.match(text, /small italic lines/)
  } finally {
    s.close()
  }
})

test('T14: the answer schema names every op of §b.5', () => {
  const ops = JSON.stringify(pageAnswerSchema());
  for (const op of ['order', 'role', 'split', 'merge', 'continues', 'figure', 'caption', 'none']) assert.ok(ops.includes(`"${op}"`), op)
})

test('T14: an invalid answer (not JSON, wrong shape, another page) is reported as invalid with the reason, and nothing throws', async () => {
  const bad = ['I think the order is fine.', '{"page":7,"ops":"none","confidence":0.5,"reasons":[]}', JSON.stringify(answer(8)), '{"page":7,"ops":[{"id":"x"}],"confidence":2,"reasons":[]}', '']
  const s = await serve((n) => bad[n])
  try {
    for (let i = 0; i < bad.length; i++) {
      const r = await askPage(cfg(s.baseUrl), req(7))
      assert.equal(r.status, 'invalid', `case ${i}`)
      if (r.status === 'invalid') assert.ok(r.why.length > 5 && r.raw === bad[i], `case ${i}: ${r.why}`)
    }
  } finally {
    s.close()
  }
})

test('T14: a server that does not answer in time is a timeout, not a hang (the default is 60 s)', async () => {
  assert.equal(PAGE_MODEL_TIMEOUT_MS, 60_000)
  const s = await serve(() => undefined)
  try {
    const t0 = Date.now()
    const r = await askPage(cfg(s.baseUrl), req(7), { timeoutMs: 150 })
    assert.equal(r.status, 'timeout')
    assert.ok(Date.now() - t0 < 5000)
  } finally {
    s.close()
  }
})

test('T14: an error status from the server is unavailable (a refused key is said plainly)', async () => {
  const s = await serve(() => '')
  s.close()
  const down = await askPage(cfg(s.baseUrl), req(7), { fetch: async () => new Response('no', { status: 401 }) })
  assert.equal(down.status, 'unavailable')
  if (down.status === 'unavailable') assert.match(down.why, /key/i)
  const busy = await askPage(cfg(s.baseUrl), req(7), { fetch: async () => new Response('x', { status: 503 }) })
  assert.equal(busy.status, 'unavailable')
})

test('T14: askPages keeps the good answers and lists every page it could not get as "left", with the reason', async () => {
  const s = await serve((n) => (n === 0 ? JSON.stringify(answer(1)) : n === 1 ? 'not json' : undefined))
  try {
    const r = await askPages(cfg(s.baseUrl), [req(1), req(2), req(3)], { timeoutMs: 150 })
    assert.deepEqual([...r.answers.keys()], [1])
    assert.deepEqual(r.left.map((l) => l.page), [2, 3])
    assert.match(r.left[0].why, /answer/i)
    assert.match(r.left[1].why, /time/i)
  } finally {
    s.close()
  }
})

test('T14: with the server off the build goes on: no throw, every page is "left: page reader not available", and the other pages are not tried', async () => {
  const s = await serve(() => '')
  const baseUrl = s.baseUrl
  s.close()
  let calls = 0
  const r = await askPages(cfg(baseUrl), [req(1), req(2), req(3)], { fetch: async (...a) => (calls++, fetch(...a)) })
  assert.equal(r.answers.size, 0)
  assert.deepEqual(r.left, [1, 2, 3].map((page) => ({ page, why: 'page reader not available' })))
  assert.equal(calls, 1)
})

test('T14: Raster.page in Node renders a page at 150 and at 300 dpi as PNG, and a crop of a region', async () => {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.TimesRoman)
  doc.addPage([288, 432]).drawText('Figure 1. The mill', { x: 40, y: 300, size: 14, font })
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await doc.save()), useSystemFonts: false, verbosity: 0 }).promise
  const page = await pdf.getPage(1)
  const size = (png: Uint8Array) => ({ sig: Buffer.from(png.subarray(0, 4)).toString('hex'), w: new DataView(png.buffer, png.byteOffset).getUint32(16), h: new DataView(png.buffer, png.byteOffset).getUint32(20) })
  assert.deepEqual(size(await renderPage(nodeRaster, page, 150)), { sig: '89504e47', w: 600, h: 900 })
  assert.deepEqual(size(await renderPage(nodeRaster, page, 300)), { sig: '89504e47', w: 1200, h: 1800 })
  const crop = size(await renderPage(nodeRaster, page, 300, { x0: 36, y0: 100, x1: 180, y1: 172 }))
  assert.deepEqual([crop.w, crop.h], [600, 300])
  // PNG is lossless, so the same page renders to the same bytes every time
  assert.deepEqual(await renderPage(nodeRaster, page, 150), await renderPage(nodeRaster, page, 150))
})
