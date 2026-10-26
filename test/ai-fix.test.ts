import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { handle, groq, POST, MODELS } from '../api/ai-fix.ts'
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
