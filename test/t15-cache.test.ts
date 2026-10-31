// T15 (OPUS_DESIGN2 §b.6): cache and replay. A book rebuilt with --replay is the same as the first build and never calls the model;
// a rule card changes the keys only of the pages it applies to; a miss in replay mode fails loudly; a person's override is kept on the key.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { removeTempDir } from './cleanup.ts'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { PageEvidence } from '../src/engine/pdf/evidence.ts'
import { PageCache, ReplayMiss, askPagesCached, isReplay, pageKey, type CachedPage, type ModelId } from '../src/engine/pdf/page-cache.ts'

const ev = (page: number): PageEvidence => ({
  page, printed: String(page), w: 400, h: 600, columns: [[60, 340]],
  blocks: [{ id: `p${page}.b01`, kind: 'text', bbox: [60, 70, 200, 94], size: 12, bodySize: 11, lines: 1, text: 'Chapter One', lineIds: [`p${page}.l01`], role: 'H1' }],
  engineOrder: [`p${page}.b01`], engineConfidence: 0.6,
})
const MODEL: ModelId = { modelId: 'fake-vl', weightsSha256: 'aa', quant: 'q8', serverVersion: '1', promptVersion: 'p1', schemaVersion: 's1' }
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3])
const pg = (page: number, rules: string[] = ['PRO-001 columns', 'PFG-003 captions']): CachedPage => ({
  ev: ev(page), images: [{ dpi: 150, png: PNG }], rules, hints: ['small italic lines are captions'], pdfPageHash: 'h' + page,
})
const answer = (page: number, role = 'H2') => ({ page, ops: [{ op: 'role', id: `p${page}.b01`, role }], confidence: 0.9, reasons: [] })

async function serve(reply: (page: number, n: number) => string) {
  let n = 0
  const server: Server = createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      const page = Number(/Page (\d+)\./.exec(JSON.stringify(JSON.parse(raw).messages))?.[1])
      res.setHeader('content-type', 'application/json')
      res.end(JSON.stringify({ choices: [{ message: { content: reply(page, n++) } }] }))
    })
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  return { cfg: { apiKey: '', baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`, model: 'fake-vl' }, calls: () => n, close: () => server.close() }
}
const tmp = () => mkdtempSync(join(tmpdir(), 't15-'))
const snapshot = (dir: string) => readdirSync(dir).sort().map((f) => [f, readFileSync(join(dir, f), 'utf8')])

test('T15: a book rebuilt with replay is identical to the first build, and the model is not called', async () => {
  const root = tmp()
  const s = await serve((page) => JSON.stringify(answer(page)))
  try {
    const pages = [1, 2, 3].map((p) => pg(p))
    const cache = new PageCache(root, 'book1')
    const first = await askPagesCached(s.cfg, pages, { cache, model: MODEL })
    assert.equal(s.calls(), 3)
    const files = snapshot(cache.dir)
    const second = await askPagesCached({ ...s.cfg, baseUrl: 'http://127.0.0.1:1/v1' }, pages, { cache: new PageCache(root, 'book1'), model: MODEL, replay: true })
    assert.equal(s.calls(), 3)
    assert.equal(JSON.stringify(second.decisions), JSON.stringify(first.decisions))
    assert.equal(JSON.stringify([...second.keys]), JSON.stringify([...first.keys]))
    assert.deepEqual(snapshot(cache.dir), files, 'replay does not touch the cache')
    // a live rebuild also answers from the cache
    await askPagesCached(s.cfg, pages, { cache, model: MODEL })
    assert.equal(s.calls(), 3)
  } finally {
    s.close()
    removeTempDir(root)
  }
})

test('T15: a rule card changes the keys only of the pages it applies to; the model, prompt and picture change them all', () => {
  const key = (p: CachedPage, model = MODEL) => pageKey({ pdfPageHash: p.pdfPageHash, req: p, model })
  const card = 'PHD-008 same look same level'
  const before = [1, 2, 3].map((p) => key(pg(p, p === 2 ? ['PRO-001 columns', card] : ['PRO-001 columns'])))
  const after = [1, 2, 3].map((p) => key(pg(p, p === 2 ? ['PRO-001 columns', card + ' (edited)'] : ['PRO-001 columns'])))
  assert.equal(before[0], after[0])
  assert.notEqual(before[1], after[1])
  assert.equal(before[2], after[2])
  const base = key(pg(1))
  assert.notEqual(base, key(pg(1), { ...MODEL, promptVersion: 'p2' }))
  assert.notEqual(base, key(pg(1), { ...MODEL, weightsSha256: 'bb' }))
  assert.notEqual(base, key({ ...pg(1), images: [{ dpi: 150, png: new Uint8Array([9]) }] }))
  assert.notEqual(base, key({ ...pg(1), pdfPageHash: 'other' }))
  assert.equal(base, key({ ...pg(1), ev: JSON.parse(JSON.stringify(pg(1).ev)) }))
})

test('T15: a miss in replay mode fails loudly and says which page', async () => {
  const root = tmp()
  const s = await serve((page) => JSON.stringify(answer(page)))
  try {
    const cache = new PageCache(root, 'book2')
    await askPagesCached(s.cfg, [pg(1), pg(2)], { cache, model: MODEL })
    // page 2's rule card changed since: its key is a miss
    await assert.rejects(
      askPagesCached(s.cfg, [pg(1), pg(2, ['PRO-001 columns edited'])], { cache, model: MODEL, replay: true }),
      (e: unknown) => e instanceof ReplayMiss && e.page === 2 && /page 2/.test(e.message),
    )
    await assert.rejects(askPagesCached(s.cfg, [pg(5)], { cache: new PageCache(root, 'empty'), model: MODEL, replay: true }), ReplayMiss)
    assert.equal(s.calls(), 2)
  } finally {
    s.close()
    removeTempDir(root)
  }
})

test('T15: a person\'s override is stored on the key and wins, in later live builds and in replay', async () => {
  const root = tmp()
  const s = await serve((page) => JSON.stringify(answer(page)))
  try {
    const cache = new PageCache(root, 'book3')
    const first = await askPagesCached(s.cfg, [pg(1)], { cache, model: MODEL })
    assert.equal(first.decisions[0].by, 'ai')
    const mine = [{ op: 'role', id: 'p1.b01', role: 'H3' }] as const
    cache.setOverride(first.keys.get(1)!, 1, [...mine], 'sam')
    for (const replay of [false, true]) {
      const r = await askPagesCached(s.cfg, [pg(1)], { cache: new PageCache(root, 'book3'), model: MODEL, replay })
      assert.deepEqual(r.decisions, [{ page: 1, ops: [...mine], by: 'person' }])
    }
    assert.equal(s.calls(), 1)
    const e = cache.get(first.keys.get(1)!)!
    assert.equal(e.answer?.ops[0].op, 'role', 'the model answer stays beside the override')
    assert.equal(e.override?.by, 'sam')
  } finally {
    s.close()
    removeTempDir(root)
  }
})

test('T15: a bad answer is kept as "left" for replay, but a live build asks again; a server that is off is not cached', async () => {
  const root = tmp()
  let good = false
  const s = await serve((page) => (good ? JSON.stringify(answer(page)) : 'not json'))
  try {
    const cache = new PageCache(root, 'book4')
    const a = await askPagesCached(s.cfg, [pg(1)], { cache, model: MODEL })
    assert.equal(a.left.length, 1)
    const r = await askPagesCached(s.cfg, [pg(1)], { cache, model: MODEL, replay: true })
    assert.equal(r.left.length, 1)
    assert.equal(s.calls(), 1)
    good = true
    const b = await askPagesCached(s.cfg, [pg(1)], { cache, model: MODEL })
    assert.equal(b.left.length, 0)
    assert.equal(s.calls(), 2)
    const off = await askPagesCached({ ...s.cfg, baseUrl: 'http://127.0.0.1:1/v1' }, [pg(2)], { cache, model: MODEL })
    assert.equal(off.left.length, 1)
    assert.equal(readdirSync(cache.dir).length, 1)
  } finally {
    s.close()
    removeTempDir(root)
  }
})

test('T15: --replay is read from the command line', () => {
  assert.equal(isReplay(['node', 'x.ts', '--replay']), true)
  assert.equal(isReplay(['node', 'x.ts']), false)
})
