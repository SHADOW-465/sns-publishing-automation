// A picture anchored inside an otherwise empty paragraph (<p><span><img/></span></p>, as InDesign exports it) is kept.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { text } from '../src/engine/zip.ts'
import { analyze, build } from '../src/engine/indesign/build.ts'
import { synthExport, synthBook, SYNTH_CSS } from './synth.ts'

const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))
test('picture inside an empty paragraph is not dropped', () => {
  const body = (n: number) => `<p class="Cuerpo">${'Texto del capítulo con datos. '.repeat(40)}</p>${n === 2 ? '<p class="Cuerpo"><span class="negrita"><img src="image/grafica.png" alt="Gráfica de partidos"/></span></p>' : ''}<p class="Cuerpo">Fuente: elaboración propia.</p>`
  const files = synthExport(synthBook(3, body), SYNTH_CSS, 'es-ES', { 'image/grafica.png': png })
  const a = analyze(files)
  const r = build(a, { styles: a.styles, images: a.images, meta: { ...a.meta, title: 'T', authors: 'A', publisher: 'P', eisbn: '9780306406157', language: 'es-ES' }, cover: { name: 'cover.png', data: png } })
  const all = [...r.files].filter(([k]) => /chapter\d+\.xhtml$/.test(k)).map(([, v]) => text(v)).join('\n')
  assert.match(all, /<img[^>]*grafica/)
})

test('a style named "captions" (plural, Birmingham) is the picture caption: figcaption inside the figure', () => {
  const body = (n: number) => `<p class="Cuerpo">${'Text of the chapter with facts. '.repeat(40)}</p>${n === 2 ? '<div class="_idGenObjectLayout-1"><div><img src="image/plan.png" alt=""/></div></div><div class="Basic-Text-Frame"><p class="captions">Plan of the town. (Courtesy of the Museum)</p></div>' : ''}<p class="Cuerpo">More text.</p>`
  const css = SYNTH_CSS + '\np.captions { font-size:0.8em; font-style:italic; font-family:"Sans", sans-serif; }\n'
  const files = synthExport(synthBook(3, body), css, 'en-GB', { 'image/plan.png': png })
  const a = analyze(files)
  const r = build(a, { styles: a.styles, images: a.images, meta: { ...a.meta, title: 'T', authors: 'A', publisher: 'P', eisbn: '9780306406157', language: 'en-GB' }, cover: { name: 'cover.png', data: png } })
  const all = [...r.files].filter(([k]) => /chapter\d+\.xhtml$/.test(k)).map(([, v]) => text(v)).join('\n')
  assert.match(all, /<figcaption>[^]*Plan of the town/)
})
