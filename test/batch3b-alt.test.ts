// Batch 3B: the vision model classifies a picture, then describes it. No network.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bytes } from '../src/engine/zip.ts'
import { altGuards } from '../src/engine/check/guards.ts'
import { parseVisionReply, draftPictureAlts, visionPrompt, GROQ_VISION_BASE, GROQ_VISION_MODEL, type VisionConfig } from '../src/engine/epub/alt-ai.ts'
import { resolveAlt } from '../src/engine/epub/alt.ts'
import { figureChoice } from '../src/engine/pdfua/index.ts'
import { setSettings, DEFAULT_SETTINGS } from '../src/engine/settings.ts'

const cfg: VisionConfig = { apiKey: 'test-key', baseUrl: GROQ_VISION_BASE, model: GROQ_VISION_MODEL }
const item = { id: 'images/a.jpg', bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), mime: 'image/jpeg', caption: 'Die alte Halle am Feldrand', nearby: '' }

test('the prompt classifies first and asks for strict JSON in the book language', () => {
  const p = visionPrompt('de', 'Die alte Halle', 'Neben dem Tor.', 80)
  assert.match(p, /Classify the picture/)
  assert.match(p, /\{"kind":"photo"/)
  assert.match(p, /at most 80 characters/)
  assert.match(p, /in German/)
  assert.match(p, /image of/)
  assert.match(p, /Bild von/)
  assert.match(p, /Caption \(do not repeat it\): Die alte Halle/)
  assert.equal(visionPrompt('en', '', '').includes('There is no caption.'), true)
})

test('JSON classifies decoration, a chart, and a text picture; plain text still becomes an alt', () => {
  const ornament = parseVisionReply('{"kind":"ornament","decorative":true,"alt":"a rule","longdesc":"ignored"}', '')
  assert.deepEqual(ornament, { kind: 'decorative', decorative: true, alt: '', longDesc: '' })

  const chart = parseVisionReply('```json\n{"kind":"graph","decorative":false,"alt":"Image of sales by year","longdesc":"2020 was 4. 2021 was 9."}\n```', 'Sales', 140)
  assert.equal(chart.kind, 'chart')
  assert.equal(chart.decorative, false)
  assert.equal(chart.alt, 'sales by year')
  assert.equal(chart.longDesc, '2020 was 4. 2021 was 9.')

  const logo = parseVisionReply('{"kind":"text","decorative":false,"alt":"Bild von ACME PRESS","longdesc":"should drop"}', '')
  assert.equal(logo.kind, 'text')
  assert.equal(logo.alt, 'ACME PRESS')
  assert.equal(logo.longDesc, '')

  const plain = parseVisionReply('Alternativtext: Eine rote Halle am Rand des Feldes.', 'Die alte Halle')
  assert.equal(plain.kind, 'photo')
  assert.equal(plain.alt, 'Eine rote Halle am Rand des Feldes.')
  assert.equal(plain.longDesc, '')

  const same = parseVisionReply('{"kind":"photo","decorative":false,"alt":"Die alte Halle am Feldrand steht noch"}', 'Die alte Halle am Feldrand steht noch')
  assert.equal(same.alt, '')
})

test('a mocked model returns the three classes and drops a caption repeat', async () => {
  const replies = [
    '{"kind":"decorative","decorative":true,"alt":"flourish","longdesc":""}',
    '{"kind":"diagram","decorative":false,"alt":"The airfield drainage","longdesc":"North ditch 2 m, south ditch 4 m."}',
    '{"kind":"cover","decorative":false,"alt":"A Dark History of Birmingham","longdesc":""}',
    'Die alte Halle am Feldrand',
  ]
  let n = 0
  const out = await draftPictureAlts(
    replies.map((_, i) => ({ ...item, id: `images/${i}.jpg` })),
    'en',
    cfg,
    undefined,
    async () => Response.json({ choices: [{ message: { content: replies[n++] } }] }),
  )
  assert.equal(out[0].decorative, true)
  assert.equal(out[0].alt, '')
  assert.equal(out[0].kind, 'decorative')
  assert.equal(out[1].kind, 'diagram')
  assert.match(out[1].longDesc, /North ditch/)
  assert.equal(out[2].kind, 'cover')
  assert.equal(out[2].alt, 'A Dark History of Birmingham')
  assert.equal(out[3].alt, '')
  assert.match(out[3].error ?? '', /caption/)
})

test('a decorative draft is an unapproved empty alt, and a chart keeps its long description', () => {
  const deco = resolveAlt({ ai: { alt: 'ignored', decorative: true }, caption: '' })
  assert.equal(deco.decorative, true)
  assert.equal(deco.alt, '')
  assert.equal(deco.source, 'ai')
  assert.equal(deco.approved, false)
  const typed = resolveAlt({ typed: { alt: 'Typed by the reviewer' }, ai: { alt: '', decorative: true } })
  assert.equal(typed.source, 'typed')
  assert.equal(typed.decorative, false)

  const chart = figureChoice({
    key: 'c', caption: 'Chart 1', alt: {},
    ai: { c: { alt: 'Sales by year', longDesc: '2020: 4. 2021: 9.', decorative: false } },
  })
  assert.equal(chart.alt, 'Sales by year\n2020: 4. 2021: 9.')
  assert.equal(chart.pendingAi, true)
  const hidden = figureChoice({ key: 'c', caption: '', alt: {}, ai: { c: { alt: 'x', decorative: true } } })
  assert.equal(hidden.decorative, true)
  assert.equal(hidden.alt, '')
  assert.equal(hidden.pendingAi, true)
})

test('guards flag a caption repeat, a filler opening, an over-long alt, and a decorative picture with text', () => {
  const prev = DEFAULT_SETTINGS.altMaxChars
  setSettings({ altMaxChars: 40 })
  try {
    const page = (body: string) => bytes(`<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml"><body>${body}</body></html>`)
    const files = new Map<string, Uint8Array>([
      ['OEBPS/a.xhtml', page('<figure><img src="images/a.jpg" alt="The old hall at the edge of the field"/><figcaption>The old hall at the edge of the field</figcaption></figure>')],
      ['OEBPS/b.xhtml', page('<img src="images/b.jpg" alt="Image of a red machine on the runway"/>')],
      ['OEBPS/c.xhtml', page('<img src="images/c.jpg" alt="Bild von der roten Halle am Rand"/>')],
      ['OEBPS/d.xhtml', page(`<img src="images/d.jpg" alt="${'A very long description of the machine '.repeat(4)}"/>`)],
      ['OEBPS/e.xhtml', page('<img src="images/e.jpg" alt="a flourish" role="presentation"/>')],
      ['OEBPS/f.xhtml', page('<img src="images/f.jpg" alt="A red machine stands on the runway."/>')],
    ])
    const found = altGuards(files)
    const msgs = found.map((r) => r.msg)
    assert.ok(msgs.some((m) => m.startsWith('IMG-002:') && m.includes('repeats its caption')))
    assert.ok(msgs.some((m) => m.startsWith('IMG-002:') && /Image of/.test(m)))
    assert.ok(msgs.some((m) => m.startsWith('IMG-002:') && /Bild von/.test(m)))
    const over = found.find((r) => r.msg.startsWith('IMG-002:') && r.msg.includes('over the limit of 40'))
    assert.ok(over)
    assert.equal(over.level, 'warn')
    assert.equal(found.filter((r) => r.msg.startsWith('IMG-001:') || r.msg.includes('repeats its caption') || /Image of|Bild von/.test(r.msg)).every((r) => r.level === 'error'), true)
    assert.ok(msgs.some((m) => m.startsWith('IMG-001:') && m.includes('decorative')))
    assert.equal(msgs.some((m) => m.includes('images/f.jpg')), false)
  } finally {
    setSettings({ altMaxChars: prev })
  }
})
