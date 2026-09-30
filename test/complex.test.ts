// "Complex" books: real lists (nested, numbered), MathML, tables, right-to-left languages, the standard profile.
// Built from a tiny in-memory export, so no client material is needed.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { text } from '../src/engine/zip.ts'
import { analyze, build } from '../src/engine/indesign/build.ts'
import { checkEpub } from '../src/engine/check/epub.ts'
import { synthExport, synthBook, SYNTH_CSS } from './synth.ts'
import { epubcheck } from './epubcheck.ts'

const cover = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))
const para = (t: string) => `<p class="Cuerpo">${t}</p>`
const body = (n: number) =>
  [
    para(`Body text of chapter ${n}, long enough to be a paragraph of the book. `.repeat(6)),
    '<ul class="Lista"><li>First point<ul><li>Nested one</li><li>Nested two</li></ul></li><li>Second point</li></ul>',
    '<ol><li>Step one</li><li>Step two</li></ol>',
    para('Formula <math xmlns="http://www.w3.org/1998/Math/MathML"><mi>x</mi><mo>=</mo><mn>2</mn></math> inline.'),
    '<table class="Tabla"><colgroup><col/><col/></colgroup><tbody><tr><td><p>Name</p></td><td><p>Value</p></td></tr><tr><td><p>a</p></td><td><p>1</p></td></tr></tbody></table>',
  ].join('\n')

function make(lang: string, profile: 'accessible' | 'standard' = 'accessible') {
  const a = analyze(synthExport(synthBook(3, body), SYNTH_CSS, lang))
  return build(a, { styles: a.styles, images: [], meta: { ...a.meta, title: 'Sample', authors: 'A. Writer', publisher: 'Test Press', eisbn: '9780306406157', profile, language: lang }, cover: { name: 'cover.jpg', data: cover } })
}
const chapter = (r: ReturnType<typeof make>) => text([...r.files].find(([p]) => /chapter01\.xhtml$/.test(p))![1])

test('real lists keep their nesting and kind; MathML and tables survive', () => {
  const html = chapter(make('en-GB'))
  assert.match(html, /<ul class="bull">\n<li>First point\n<ul class="bull">\n<li>Nested one<\/li>\n<li>Nested two<\/li>\n<\/ul>\n<\/li>\n<li>Second point<\/li>\n<\/ul>/)
  assert.match(html, /<ol class="num">\n<li>Step one<\/li>\n<li>Step two<\/li>\n<\/ol>/)
  assert.match(html, /<math xmlns="http:\/\/www\.w3\.org\/1998\/Math\/MathML"><mi>x<\/mi><mo>=<\/mo><mn>2<\/mn><\/math>/)
  assert.match(html, /<table class="Tabla">\n<colgroup>\n<col style="width:\d+%;"\/>\n<col style="width:\d+%;"\/>\n<\/colgroup>\n<tbody>/)
})

test('right-to-left books get their direction; the standard profile drops the accessibility layer', () => {
  const ar = make('ar')
  assert.match(chapter(ar), /<html [^>]*xml:lang="ar" dir="rtl">/)
  assert.match(text(ar.files.get('OEBPS/content.opf')!), /page-progression-direction="rtl"/)
  assert.doesNotMatch(text(ar.files.get('OEBPS/css/style.css')!), /direction:/, 'EPUB forbids the CSS direction property: dir="rtl" carries it')
  const std = make('en-GB', 'standard')
  const all = [...std.files].filter(([p]) => /\.(xhtml|opf)$/.test(p)).map(([, d]) => text(d)).join('\n')
  assert.doesNotMatch(all, /\srole="|\saria-|epub:type="pagebreak"|schema:access/)
  for (const r of [make('en-GB'), std, ar]) {
    assert.deepEqual(checkEpub(r.files, r.source).groups.flatMap((g) => g.findings).filter((f) => f.level === 'error' && !/description|ISBN|cover/i.test(f.msg)), [])
    const ec = epubcheck(r.epub)
    if (ec) assert.deepEqual(ec.errors, [])
  }
})
