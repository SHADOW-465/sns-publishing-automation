// Picture descriptions: spec workbook, image metadata, InDesign alt, decorative rules.
// Priority is typed, then spec, then the image file, then a decorative rule, then an AI draft.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { text } from '../src/engine/zip.ts'
import { readXlsx } from '../src/engine/spec/office.ts'
import { specWorkbook, readRequirements, pictureAltsFromWorkbook } from '../src/engine/spec/requirements.ts'
import { resolve, emptyLayer } from '../src/engine/spec/layers.ts'
import { analyze, build } from '../src/engine/indesign/build.ts'
import { synthExport, SYNTH_CSS } from './synth.ts'
import {
  isPlaceholderAlt, classifyGivenAlt, repeatsCaption, resolveAlt, fitAlt, matchSpecPicture, yesNo,
  settleAlt, altTally, decorativeReason, needsLongDescription, readImageMetadata,
  type AltState, type SpecPicture,
} from '../src/engine/epub/alt.ts'

const base = (over: Partial<AltState> = {}): AltState => ({
  alt: '', longDesc: '', decorative: false, source: 'file', approved: true, userSet: false,
  caption: '', layers: { fileAlt: '', fileLong: '', decorativeHint: false, aiAlt: '', aiLong: '' }, spec: null,
  ...over,
})

test('priority: typed wins, then spec, then the image file, then a decorative rule, then an AI draft', () => {
  const all = {
    typed: { alt: 'Typed by the reviewer' },
    spec: { alt: 'From the spec', decorative: false },
    file: { alt: 'From the image file' },
    decorative: true,
    ai: { alt: 'Drafted by the model' },
    caption: 'A different caption',
  }
  assert.equal(resolveAlt(all).source, 'typed')
  assert.equal(resolveAlt(all).alt, 'Typed by the reviewer')
  assert.equal(resolveAlt({ ...all, typed: { alt: '', decorative: true } }).alt, '')
  assert.equal(resolveAlt({ ...all, typed: { alt: '', decorative: true } }).source, 'typed')

  const noTyped = { spec: all.spec, file: all.file, decorative: true, ai: all.ai, caption: all.caption }
  assert.deepEqual(resolveAlt(noTyped), { alt: 'From the spec', longDesc: '', decorative: false, source: 'spec', approved: true })
  const decoSpec = resolveAlt({ ...noTyped, spec: { alt: '', decorative: true } })
  assert.equal(decoSpec.source, 'spec')
  assert.equal(decoSpec.decorative, true)
  assert.equal(decoSpec.alt, '')

  assert.equal(resolveAlt({ file: all.file, decorative: true, ai: all.ai }).source, 'file')
  assert.equal(resolveAlt({ decorative: true, ai: all.ai }).source, 'decorative')
  assert.equal(resolveAlt({ decorative: true, ai: all.ai }).alt, '')
  const ai = resolveAlt({ ai: all.ai })
  assert.equal(ai.source, 'ai')
  assert.equal(ai.approved, false)
  assert.equal(ai.alt, 'Drafted by the model')
  assert.equal(resolveAlt({}).source, 'file')
  assert.equal(resolveAlt({}).alt, '')
})

test('placeholders and a repeated caption never count as a description', () => {
  for (const bad of ['', 'Bild', 'bild 2', 'imagen', 'image', 'photo.jpg', 'Bild.png', '[Fehler: kein Alternativtext]', 'Beschreibung von KI generiert', 'Alternativtext wurde nicht generiert']) {
    assert.equal(isPlaceholderAlt(bad), true, bad)
  }
  assert.equal(isPlaceholderAlt('dekorativ'), false)
  assert.equal(isPlaceholderAlt('todo el campo de un vistazo'), false)
  assert.equal(isPlaceholderAlt('Eine rote Maschine auf der Startbahn'), false)

  const given = classifyGivenAlt('Eine rote Maschine auf der Startbahn\n\nBeschreibung von KI generiert')
  assert.deepEqual(given, { kind: 'ai', text: 'Eine rote Maschine auf der Startbahn' })
  assert.equal(classifyGivenAlt('Beschreibung von KI generiert').kind, 'placeholder')
  assert.equal(classifyGivenAlt('Bild\n\nBeschreibung von KI generiert').kind, 'placeholder')
  assert.equal(classifyGivenAlt('Foto der Startbahn von Westen').kind, 'file')

  const caption = 'Karte des Tempelhofer Feldes im Jahr 1923'
  assert.equal(repeatsCaption(caption, caption), true)
  assert.equal(resolveAlt({ file: { alt: caption }, caption, ai: { alt: 'Wege und Hallen des Feldes' } }).alt, 'Wege und Hallen des Feldes')
  assert.equal(resolveAlt({ spec: { alt: caption, decorative: false }, caption }).alt, '')
})

test('decorative rules: ornaments, backgrounds, hairlines and tiny images; a wide photo is not one', () => {
  assert.match(decorativeReason({ name: 'images/schmuck_01.png', width: 400, height: 80 }) ?? '', /ornament/i)
  assert.match(decorativeReason({ name: 'hintergrund.jpg', width: 1000, height: 800 }) ?? '', /background/i)
  assert.match(decorativeReason({ name: 'images/rule.png', width: 600, height: 8 }) ?? '', /rule|line/i)
  assert.match(decorativeReason({ name: 'photo.png', width: 800, height: 4 }) ?? '', /thin line/i)
  assert.match(decorativeReason({ name: 'bullet.gif', width: 16, height: 16 }) ?? '', /ornament|tiny/i)
  assert.equal(decorativeReason({ name: 'images/Bild1.jpg', width: 1200, height: 800 }), undefined)
  assert.equal(decorativeReason({ name: 'airline.png', width: 900, height: 600 }), undefined)
  assert.equal(needsLongDescription('karte_feld.png', 'Die Hallen', ''), true)
  assert.equal(needsLongDescription('photo.jpg', 'Porträt', ''), false)
})

test('image metadata: accessibility alt wins over description and title; IPTC caption is used when there is no XMP', () => {
  const xmp = `<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description>
    <Iptc4xmpCore:AltTextAccessibility><rdf:Alt><rdf:li xml:lang="x-default">A map of the airfield</rdf:li></rdf:Alt></Iptc4xmpCore:AltTextAccessibility>
    <Iptc4xmpCore:ExtDescrAccessibility>The long description of the map.</Iptc4xmpCore:ExtDescrAccessibility>
    <dc:description><rdf:Alt><rdf:li>Shorter caption</rdf:li></rdf:Alt></dc:description>
    <dc:title><rdf:Alt><rdf:li>Title only</rdf:li></rdf:Alt></dc:title>
  </rdf:Description></rdf:RDF></x:xmpmeta>`
  const meta = readImageMetadata(new TextEncoder().encode(xmp))
  assert.equal(meta?.from, 'accessibility')
  assert.equal(meta?.alt, 'A map of the airfield')
  assert.equal(meta?.longDesc, 'The long description of the map.')

  const placeholder = xmp.replace('A map of the airfield', 'Bild')
  assert.equal(readImageMetadata(new TextEncoder().encode(placeholder))?.alt, 'Shorter caption')

  const caption = 'A red biplane over the field'
  const payload = new Uint8Array([0x1c, 0x02, 120, 0, caption.length, ...new TextEncoder().encode(caption)])
  const len = payload.length + 2
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xed, len >> 8, len & 0xff, ...payload])
  assert.equal(readImageMetadata(jpeg)?.from, 'description')
  assert.equal(readImageMetadata(jpeg)?.alt, caption)
  assert.equal(readImageMetadata(new Uint8Array([1, 2, 3])), undefined)
})

test('spec workbook: picture descriptions round-trip and match by file name', () => {
  const resolved = resolve([emptyLayer('book', 'book')])
  const pictures: SpecPicture[] = [
    { file: 'images/Karte.png', alt: 'Karte des Feldes 1923', decorative: false, longDesc: 'Wege, Hallen und die Bahn.' },
    { file: 'ornament.png', alt: '', decorative: true, longDesc: '' },
  ]
  const wb = specWorkbook({ client: 'BeBra', book: 'Tempelhofer', resolved, pictures })
  const sheets = readXlsx(wb)
  assert.deepEqual(sheets.map((s) => s.name), ['Spec', 'Picture descriptions', 'About'])
  const pic = sheets.find((s) => s.name === 'Picture descriptions')!
  assert.deepEqual(pic.rows[0], ['Image file name', 'Alt text', 'Decorative', 'Long description'])
  assert.equal(pic.rows[1][1], 'Karte des Feldes 1923')
  assert.equal(pic.rows[2][2], 'Yes')
  const back = readRequirements('spec.xlsx', wb)
  assert.equal(back.pictures?.length, 2)
  assert.equal(matchSpecPicture('OEBPS/image/karte.PNG', back.pictures!)?.alt, 'Karte des Feldes 1923')
  assert.equal(matchSpecPicture('ornament.jpg', back.pictures!)?.decorative, true)
  assert.equal(yesNo('Ja'), true)
  assert.equal(yesNo('Nein'), false)

  const german = pictureAltsFromWorkbook([{
    name: 'Bilder',
    rows: [
      ['Dateiname', 'Alternativtext', 'Dekorativ', 'Langbeschreibung'],
      ['foto.jpg', 'Die alte Halle', 'nein', ''],
    ],
  }])
  assert.equal(german[0].alt, 'Die alte Halle')
  assert.equal(german[0].decorative, false)
})

test('an approved AI draft stays approved only while its text is unchanged', () => {
  const approved = settleAlt(base({ alt: 'Drafted sentence', source: 'ai', approved: true, layers: { fileAlt: '', fileLong: '', decorativeHint: false, aiAlt: 'Drafted sentence', aiLong: '' } }))
  assert.equal(approved.approved, true)
  assert.equal(approved.source, 'ai')
  const edited = settleAlt(base({ alt: 'A different sentence', source: 'ai', approved: true, layers: { fileAlt: '', fileLong: '', decorativeHint: false, aiAlt: 'Drafted sentence', aiLong: '' } }))
  assert.equal(edited.approved, false)
  assert.equal(edited.alt, 'Drafted sentence')
  const typed = settleAlt(base({ alt: 'Reviewer text', userSet: true, source: 'typed', spec: { file: 'a.jpg', alt: 'Spec text', decorative: false, longDesc: '' } }))
  assert.equal(typed.source, 'typed')
  assert.equal(typed.alt, 'Reviewer text')
  const words = Array.from({ length: 40 }, (_, i) => `wort${i}`).join(' ')
  const fitted = fitAlt(words)
  assert.ok(fitted.length <= 140 && fitted.length > 60, fitted)
  assert.equal(fitAlt('short text'), 'short text')
  assert.equal(fitAlt('Alternativtext: Eine rote Halle'), 'Eine rote Halle')
})

test('tally: decorative and real text count as filled; a placeholder counts as missing', () => {
  const t = altTally([
    { alt: 'From the spec', decorative: false, source: 'spec' },
    { alt: 'From the file', decorative: false, source: 'file' },
    { alt: '', decorative: true, source: 'decorative' },
    { alt: 'Draft', decorative: false, source: 'ai' },
    { alt: 'Typed', decorative: false, source: 'typed' },
    { alt: 'Bild', decorative: false, source: 'file' },
    { alt: '', decorative: false, source: 'file' },
  ])
  assert.deepEqual(t, { spec: 1, file: 1, decorative: 1, ai: 1, typed: 1, missing: 2 })
})

/** PNG header with the given pixel size. Enough for the image-size reader. */
function png(w: number, h: number, extra = ''): Uint8Array {
  const head = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, w >> 24, (w >> 16) & 255, (w >> 8) & 255, w & 255, h >> 24, (h >> 16) & 255, (h >> 8) & 255, h & 255])
  if (!extra) return head
  const tail = new TextEncoder().encode(extra)
  const out = new Uint8Array(head.length + tail.length)
  out.set(head)
  out.set(tail, head.length)
  return out
}

test('analyze applies the layers and the build writes an empty alt for a decorative picture', () => {
  const xmp = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:Description><dc:description><rdf:li>Text stored in the file</rdf:li></dc:description></rdf:Description></x:xmpmeta>'
  const body = [
    '<p class="Etiqueta">Kapitel 1</p>',
    '<p class="Titulo">Luftfahrt</p>',
    '<p class="Cuerpo">Ein langer Absatz über das Feld, die Hallen und die Maschinen, die dort standen, bevor der Wind über die Bahn zog.</p>',
    '<img src="images/ornament.png" alt=""/>',
    '<p class="Cuerpo">Schmuck am Kapitelanfang.</p>',
    '<img src="images/photo.jpg" alt="Eine rote Maschine auf der Startbahn\n\nBeschreibung von KI generiert"/>',
    '<p class="Cuerpo">Die Maschine steht bereit für den Flug.</p>',
    '<img src="images/map.png" alt="Bild"/>',
    '<p class="Cuerpo">Die Wege zwischen den Hallen.</p>',
    '<img src="images/file.png" alt=""/>',
    '<p class="Cuerpo">Noch ein Satz danach, lang genug.</p>',
  ].join('\n')
  const files = synthExport(body, SYNTH_CSS, 'de-DE')
  files.set('OEBPS/images/ornament.png', png(8, 8))
  files.set('OEBPS/images/photo.jpg', png(400, 300))
  files.set('OEBPS/images/map.png', png(500, 400))
  files.set('OEBPS/images/file.png', png(500, 400, xmp))
  const opf = text(files.get('OEBPS/content.opf')!)
  files.set('OEBPS/content.opf', new TextEncoder().encode(opf.replace('</manifest>', '<item id="i1" href="images/ornament.png" media-type="image/png"/><item id="i2" href="images/photo.jpg" media-type="image/jpeg"/><item id="i3" href="images/map.png" media-type="image/png"/><item id="i4" href="images/file.png" media-type="image/png"/></manifest>')))
  const pictures: SpecPicture[] = [{ file: 'map.png', alt: 'Karte des Feldes 1923', decorative: false, longDesc: 'Wege, Hallen und die Bahn.' }]
  const a = analyze(files, {}, pictures)
  const by = (name: string) => a.images.find((i) => i.src.endsWith(name))!
  assert.equal(by('ornament.png').source, 'decorative')
  assert.equal(by('ornament.png').decorative, true)
  assert.equal(by('photo.jpg').source, 'ai')
  assert.equal(by('photo.jpg').approved, false)
  assert.equal(by('photo.jpg').alt, 'Eine rote Maschine auf der Startbahn')
  assert.equal(by('map.png').source, 'spec')
  assert.equal(by('map.png').alt, 'Karte des Feldes 1923')
  assert.equal(by('map.png').longDesc, 'Wege, Hallen und die Bahn.')
  assert.equal(by('file.png').source, 'file')
  assert.equal(by('file.png').alt, 'Text stored in the file')

  const r = build(a, {
    styles: a.styles, images: a.images,
    meta: { ...a.meta, title: 'Feld', authors: 'B. Weigel', publisher: 'BeBra', eisbn: '9780306406157', language: 'de-DE' },
    cover: { name: 'cover.png', data: png(1600, 2560) },
  })
  const html = [...r.files].filter(([p]) => p.endsWith('.xhtml')).map(([, d]) => text(d)).join('\n')
  assert.match(html, /<img alt="" role="presentation" src="images\/ornament\.png"\/>/)
  assert.match(html, /alt="Eine rote Maschine auf der Startbahn"/)
  assert.doesNotMatch(html, /Beschreibung von KI generiert/)
  assert.match(html, /alt="Karte des Feldes 1923"/)
  assert.match(html, /class="longdesc">Wege, Hallen und die Bahn\./)
  assert.match(html, /alt="Text stored in the file"/)
  assert.doesNotMatch(html, /alt="Bild"/)
})
