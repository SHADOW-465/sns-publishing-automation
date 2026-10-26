import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { handle, groq, POST, MODELS, VISION_MODELS } from '../api/ai-fix.ts'
import { aiDetails, callAiFix, frontMatterText } from '../src/engine/review/ai-fix.ts'

const reply = (content: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }), { status, headers })

test('ai-fix route: details are copied only when printed in the text', async () => {
  const f = (async () => reply({ title: 'X', authors: 'Denis Dunstone', publisher: 'Made Up Press', eisbn: '' })) as unknown as typeof fetch
  const r = (await handle({ task: 'details', text: 'By Denis Dunstone. First published by Cybirdy Publishing', missing: ['authors', 'publisher'] }, 'k', f)) as { found: Record<string, string> }
  assert.deepEqual(r.found, { authors: 'Denis Dunstone' })
})

test('ai-fix route: 429 is retried, then succeeds', async () => {
  let n = 0
  const f = (async () => (++n === 1 ? new Response('', { status: 429, headers: { 'retry-after': '0' } }) : reply({ decisions: [{ id: 'a', choice: 'chapter', reason: 'r' }] }))) as unknown as typeof fetch
  const r = (await handle({ task: 'choose', items: [{ id: 'a', label: 'part 1', options: ['chapter', 'part'], currentGuess: 'part' }] }, 'k', f)) as { decisions: { choice: string }[] }
  assert.equal(n, 2)
  assert.equal(r.decisions[0].choice, 'chapter')
})

test('ai-fix route: an answer that is not one of the options keeps the current guess', async () => {
  const f = (async () => reply({ decisions: [{ id: 'a', choice: 'nonsense' }] })) as unknown as typeof fetch
  const r = (await handle({ task: 'choose', items: [{ id: 'a', label: 'x', options: ['chapter', 'part'], currentGuess: 'part' }] }, 'k', f)) as { decisions: { choice: string }[] }
  assert.equal(r.decisions[0].choice, 'part')
})

test('ai-fix route: a failing model call throws (the route answers fallback)', async () => {
  const f = (async () => new Response('', { status: 500 })) as unknown as typeof fetch
  await assert.rejects(groq('k', [], f))
})

test('ai-fix route: no key -> 503 fallback, key never echoed', async () => {
  const old = process.env.GROQ_API_KEY
  delete process.env.GROQ_API_KEY
  const r = await POST(new Request('http://x/api/ai-fix', { method: 'POST', body: '{}' }))
  assert.equal(r.status, 503)
  assert.equal((await r.json()).fallback, true)
  if (old !== undefined) process.env.GROQ_API_KEY = old
})

test('client: any failure falls back (undefined) and Book details stay as they were', async () => {
  const down = (async () => { throw new Error('offline') }) as unknown as typeof fetch
  assert.equal(await callAiFix({}, { fetchImpl: down }), undefined)
  const slow = ((_u: string, i: RequestInit) => new Promise((_, rej) => i.signal?.addEventListener('abort', () => rej(new Error('abort'))))) as unknown as typeof fetch
  assert.equal(await callAiFix({}, { fetchImpl: slow, timeoutMs: 50 }), undefined)
  const meta = { title: 'T', authors: '', publisher: '', eisbn: '' }
  const r = await aiDetails(meta, 'some text', { fetchImpl: down })
  assert.equal(r.meta, meta)
  assert.equal(r.notes.length, 0)
})

test('client: AI values are applied and written as AI decisions', async () => {
  const ok = (async () => new Response(JSON.stringify({ found: { publisher: 'Cybirdy Publishing' } }), { status: 200 })) as unknown as typeof fetch
  const r = await aiDetails({ title: 'T', authors: 'A', publisher: '', eisbn: '' }, frontMatterText(['First published by Cybirdy Publishing']), { fetchImpl: ok })
  assert.equal(r.meta.publisher, 'Cybirdy Publishing')
  assert.equal(r.notes[0].how, 'ai')
})

test('no browser source mentions GROQ_API_KEY', () => {
  const walk = (d: string): string[] => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)]))
  for (const f of walk('src')) assert.ok(!readFileSync(f, 'utf8').includes('GROQ_API_KEY'), f)
})

test('groq falls back to the next free model when the key has no access to one', async () => {
  const seen: string[] = []
  const f = (async (_u: string, init: RequestInit) => {
    const m = JSON.parse(String(init.body)).model
    seen.push(m)
    if (seen.length === 1) return new Response('{"error":{"message":"The model does not exist or you do not have access to it.","code":"model_not_found"}}', { status: 404 })
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":1}' } }] }), { status: 200 })
  }) as unknown as typeof fetch
  assert.deepEqual(await groq('k', [{ role: 'user', content: 'json' }], f), { ok: 1 })
  assert.equal(seen[0], MODELS[0])
  assert.equal(seen[1], MODELS[1])
})

// ---- B9 item 10: picture descriptions through the server route ----------------------------------------------------------------
const JPEG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAAAP/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AP//Z'

test('vision: the picture goes to a vision model as an image part, the answer is one short plain sentence', async () => {
  const seen: { model: string; messages: { content: unknown }[] }[] = []
  const f = (async (_u: string, init: RequestInit) => {
    seen.push(JSON.parse(String(init.body)))
    return new Response(JSON.stringify({ choices: [{ message: { content: '<think>hm</think> "Image of a brick mill beside a canal, with a barge moored at the lock gate and chimneys behind it that rise into a grey sky over the town and its crowded streets, long after the last shift."' } }] }), { status: 200 })
  }) as unknown as typeof fetch
  const r = (await handle({ task: 'vision', image: JPEG, caption: 'The mill', lang: 'en-GB' }, 'k', f)) as { alt: string }
  assert.ok(r.alt.length > 20 && r.alt.length <= 150, String(r.alt.length))
  assert.doesNotMatch(r.alt, /^image of|think|"/i)
  assert.equal(seen[0].model, VISION_MODELS[0])
  const parts = seen[0].messages[1].content as { type: string; image_url?: { url: string } }[]
  assert.equal(parts.find((p) => p.type === 'image_url')?.image_url?.url, JPEG)
  assert.match(JSON.stringify(seen[0]), /English/)
})

test('vision: a model the key cannot use is skipped for the next vision model; a bad image, an empty answer or a caption copy throw (the route answers fallback)', async () => {
  const seen: string[] = []
  const f = (async (_u: string, init: RequestInit) => {
    const m = JSON.parse(String(init.body)).model
    seen.push(m)
    if (seen.length === 1) return new Response('{"error":{"message":"model_not_found"}}', { status: 404 })
    return new Response(JSON.stringify({ choices: [{ message: { content: 'A woman cooks on a stove.' } }] }), { status: 200 })
  }) as unknown as typeof fetch
  assert.equal(((await handle({ task: 'vision', image: JPEG }, 'k', f)) as { alt: string }).alt, 'A woman cooks on a stove.')
  assert.deepEqual(seen, [VISION_MODELS[0], VISION_MODELS[1]])
  const empty = (async () => new Response(JSON.stringify({ choices: [{ message: { content: '   ' } }] }), { status: 200 })) as unknown as typeof fetch
  await assert.rejects(handle({ task: 'vision', image: JPEG }, 'k', empty))
  await assert.rejects(handle({ task: 'vision', image: 'https://example.com/x.jpg' }, 'k', empty), /bad image/)
  const same = (async () => new Response(JSON.stringify({ choices: [{ message: { content: 'The mill' } }] }), { status: 200 })) as unknown as typeof fetch
  await assert.rejects(handle({ task: 'vision', image: JPEG, caption: 'The mill' }, 'k', same))
})

test('vision: the route answers 200 with the description, 413 for a huge body, 503 with no key, and never echoes the key', async () => {
  const old = process.env.GROQ_API_KEY
  const realFetch = globalThis.fetch
  process.env.GROQ_API_KEY = 'gsk_secret_for_test'
  try {
    globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: 'A brick mill by a canal.' } }] }), { status: 200 })) as typeof fetch
    const ok = await POST(new Request('http://x/api/ai-fix', { method: 'POST', body: JSON.stringify({ task: 'vision', image: JPEG }) }))
    const text = await ok.text()
    assert.equal(ok.status, 200)
    assert.equal(JSON.parse(text).alt, 'A brick mill by a canal.')
    assert.ok(!text.includes('gsk_secret_for_test'))
    const big = await POST(new Request('http://x/api/ai-fix', { method: 'POST', body: JSON.stringify({ task: 'vision', image: 'data:image/jpeg;base64,' + 'A'.repeat(700_000) }) }))
    assert.equal(big.status, 413)
    globalThis.fetch = (async () => new Response('boom gsk_secret_for_test', { status: 500 })) as typeof fetch
    const bad = await POST(new Request('http://x/api/ai-fix', { method: 'POST', body: JSON.stringify({ task: 'vision', image: JPEG }) }))
    assert.equal(bad.status, 502)
    const badText = await bad.text()
    assert.equal(JSON.parse(badText).fallback, true)
    assert.ok(!badText.includes('gsk_secret_for_test'), 'an upstream error that echoes the key is redacted')
  } finally {
    globalThis.fetch = realFetch
    if (old === undefined) delete process.env.GROQ_API_KEY
    else process.env.GROQ_API_KEY = old
  }
})
