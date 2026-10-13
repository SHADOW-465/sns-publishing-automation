// Vision drafts: the request, a rate-limit retry, and a clear message when there is no key.
// Unapproved drafts are warnings. A book that still claims a certificate while they are open is an error.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bytes } from '../src/engine/zip.ts'
import { checkEpub } from '../src/engine/check/epub.ts'
import { draftPictureAlts, visionPrompt, saveVisionConfig, visionConfig, GROQ_VISION_BASE, GROQ_VISION_MODEL, type VisionConfig } from '../src/engine/epub/alt-ai.ts'

const cfg: VisionConfig = { apiKey: 'test-key', baseUrl: GROQ_VISION_BASE, model: GROQ_VISION_MODEL }
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 8, 0, 0, 0, 8])
const item = { id: 'images/photo.jpg', bytes: png, mime: 'image/jpeg', caption: 'Die alte Halle', nearby: 'Sie steht am Rand des Feldes.' }

test('a German book asks for a short description that does not repeat the caption', () => {
  const p = visionPrompt('de-DE', 'Die alte Halle', 'Sie steht am Rand des Feldes.')
  assert.match(p, /Beschreibe/)
  assert.match(p, /140/)
  assert.match(p, /Bildunterschrift/)
  assert.match(p, /Die alte Halle/)
  assert.match(visionPrompt('en-GB', '', ''), /Write in English/)
})

test('without a key nothing is sent', async () => {
  let called = 0
  await assert.rejects(
    draftPictureAlts([item], 'de', { ...cfg, apiKey: '  ' }, undefined, async () => {
      called++
      return new Response('{}')
    }),
    /vision model are off/,
  )
  assert.equal(called, 0)
})

test('the request uses the configured model and retries after a rate limit', async () => {
  const seen: { url: string; auth: string; model: string; prompt: string; image: string }[] = []
  let n = 0
  const out = await draftPictureAlts([item], 'de-DE', cfg, undefined, async (url, init) => {
    n++
    const body = JSON.parse(String(init?.body))
    const content = body.messages[1].content
    seen.push({ url: String(url), auth: String((init?.headers as Record<string, string>).Authorization), model: body.model, prompt: content[0].text, image: content[1].image_url.url })
    if (n === 1) return new Response('', { status: 429, headers: { 'retry-after': '0' } })
    return Response.json({ choices: [{ message: { content: 'Alternativtext: Eine rote Halle am Rand des Feldes.' } }] })
  })
  assert.equal(n, 2)
  assert.equal(seen[0].url, 'https://api.groq.com/openai/v1/chat/completions')
  assert.equal(seen[0].auth, 'Bearer test-key')
  assert.equal(seen[0].model, GROQ_VISION_MODEL)
  assert.match(seen[0].prompt, /Beschreibe/)
  assert.match(seen[0].image, /^data:image\/jpeg;base64,/)
  assert.equal(out[0].alt, 'Eine rote Halle am Rand des Feldes.')
  assert.equal(out[0].error, undefined)
})

test('a draft that repeats the caption is not kept, and a refused key stops the batch', async () => {
  const same = await draftPictureAlts([item], 'de', cfg, undefined, async () => Response.json({ choices: [{ message: { content: 'Die alte Halle' } }] }))
  assert.equal(same[0].alt, '')
  assert.match(same[0].error ?? '', /caption/)
  let n = 0
  await assert.rejects(
    draftPictureAlts([item, { ...item, id: 'b' }], 'de', cfg, undefined, async () => {
      n++
      return new Response('', { status: 401 })
    }),
    /refused/,
  )
  assert.equal(n, 1)
})

test('the key stays in localStorage under its own name', () => {
  const mem = new Map<string, string>()
  Object.assign(globalThis, {
    localStorage: {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => mem.set(k, v),
      removeItem: (k: string) => mem.delete(k),
    },
  })
  saveVisionConfig({ apiKey: 'test-key', baseUrl: 'https://openrouter.ai/api/v1/', model: 'custom/model' })
  const c = visionConfig()
  assert.equal(c.apiKey, 'test-key')
  assert.equal(c.baseUrl, 'https://openrouter.ai/api/v1')
  assert.equal(c.model, 'custom/model')
  assert.equal(mem.has('automation:ai'), false)
  assert.equal(mem.has('automation:vision'), true)
  mem.clear()
})

function book(alt: string, certified: boolean): Map<string, Uint8Array> {
  const x = (body: string) => bytes(`<?xml version="1.0" encoding="utf-8"?><html xmlns="http://www.w3.org/1999/xhtml" lang="de" xml:lang="de"><head><title>t</title></head><body>${body}</body></html>`)
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 8, 0, 0, 0, 8])
  const cert = certified ? '<meta property="dcterms:conformsTo">EPUB Accessibility 1.1</meta><meta property="a11y:certifiedBy">Someone</meta>' : ''
  const opf = `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">urn:isbn:9780306406157</dc:identifier><dc:title>Feld</dc:title><dc:language>de-DE</dc:language><meta property="dcterms:modified">2026-10-13T12:00:00Z</meta>${cert}</metadata><manifest><item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/><item id="a" href="images/a.png" media-type="image/png"/></manifest><spine><itemref idref="c1"/></spine></package>`
  return new Map([
    ['mimetype', bytes('application/epub+zip')],
    ['META-INF/container.xml', bytes('<?xml version="1.0"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf"/></rootfiles></container>')],
    ['OEBPS/content.opf', bytes(opf)],
    ['OEBPS/c1.xhtml', x(`<h1>Luftfahrt</h1><p><img src="images/a.png" alt="${alt}"/></p>`)],
    ['OEBPS/images/a.png', png],
  ])
}

test('an unapproved AI draft is something to check, not a missing description', () => {
  const open = checkEpub(book('Eine rote Halle am Rand des Feldes.', false), { pendingAi: ['images/a.png'] })
  const msgs = open.groups.flatMap((g) => g.findings.map((f) => `${f.level} ${f.msg}`)).join('\n')
  assert.match(msgs, /warn Picture description for images\/a\.png is an AI draft and needs approval/)
  assert.doesNotMatch(msgs, /error Picture description/)
  assert.doesNotMatch(msgs, /has no description/)
  const certified = checkEpub(book('Eine rote Halle am Rand des Feldes.', true), { pendingAi: ['images/a.png'] })
  const bad = certified.groups.flatMap((g) => g.findings.map((f) => `${f.level} ${f.msg}`)).join('\n')
  assert.match(bad, /error \d+ AI picture description\(s\) are not approved/)
  const placeholder = checkEpub(book('Bild', false), { pendingAi: ['images/a.png'] })
  const ph = placeholder.groups.flatMap((g) => g.findings.map((f) => `${f.level} ${f.msg}`)).join('\n')
  assert.match(ph, /error Picture description "Bild" is not a real description/)
  assert.doesNotMatch(ph, /needs approval/)
})
