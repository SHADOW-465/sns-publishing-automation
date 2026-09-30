// Accessible vs standard EPUB from the same InDesign export (Cambia tu mente), plus the round-3 client
// feedback that only shows on the real book. Skipped when the samples are not present.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { unzip, text } from '../src/engine/zip.ts'
import { analyze, build } from '../src/engine/indesign/build.ts'
import { checkEpub } from '../src/engine/check/epub.ts'
import { setSettings } from '../src/engine/settings.ts'
import { INDD, has, read } from './samples.ts'
import { epubcheck } from './epubcheck.ts'

const input = resolve(INDD, 'Input/88228-02 Cambia tu mente.zip')
const reference = resolve(INDD, 'Output/Cambia tu mente.epub')

test('accessible and standard EPUB from one export', { skip: !has(input) && 'samples missing' }, () => {
  setSettings({})
  const files = unzip(read(input))
  const cover = unzip(read(reference)).get('OEBPS/images/cover.jpg')!
  const make = (profile: 'accessible' | 'standard') => {
    const a = analyze(files)
    return build(a, { styles: a.styles, images: a.images, cover: { name: 'cover.jpg', data: cover }, meta: { ...a.meta, eisbn: '979-13-88228-26-1', profile } })
  }
  const acc = make('accessible')
  const std = make('standard')
  const all = (r: ReturnType<typeof make>) => [...r.files].filter(([p]) => /\.(xhtml|opf|css)$/.test(p)).map(([p, d]) => [p, text(d)] as const)

  // feedback that only the real book shows
  const ch2 = text(acc.files.get('OEBPS/chapter02.xhtml')!)
  assert.match(ch2, /<html [^>]*xml:lang="es-ES">/, 'only xml:lang on <html>')
  assert.doesNotMatch(ch2, /<html [^>]*\slang=/, 'no duplicate lang attribute')
  const toc = text(acc.files.get('OEBPS/toc.xhtml')!)
  assert.match(toc, /page-10"[^>]*\/>\n<p class="toc_2"><a href="part2\.xhtml">/, 'page 10 marker sits where the printed page starts')
  assert.match(toc, /<p class="toc_1a"><a href="chapter01\.xhtml">C<span class="small-caps">APÍTULO<\/span> 1\./, 'chapter 1 small caps like the others')
  assert.match(toc, /<p class="toc_1t"><a href="concl\.xhtml">/, 'first plain entry after the chapters')
  assert.match(toc, /<p class="toc_1"><a href="app\.xhtml">/, 'appendix is a plain entry, not a chapter')
  assert.match(text(acc.files.get('OEBPS/list.xhtml')!), /page-12"[^>]*\/>\n<p class="toc_3"><a href="chapter10\.xhtml">/, 'page 12 marker inside the list of exercises')
  assert.match(text(acc.files.get('OEBPS/chapter04.xhtml')!), /<h3 class="[^"]+"><span class="list">1:<\/span> D/, 'numbered subheads hang in the margin')

  // accessible: the full layer; standard: none of it, same text
  assert.match(text(acc.files.get('OEBPS/content.opf')!), /schema:accessMode/)
  for (const [p, t] of all(std)) assert.doesNotMatch(t, /\srole="|\saria-[a-z]+="|epub:type="pagebreak"|schema:access|conformsTo|doc-pagelist|page-list/, `${p}: accessibility layer removed`)
  assert.match(text(std.files.get('OEBPS/chapter02.xhtml')!), /epub:type="chapter"/, 'structure semantics stay')
  const words = (r: ReturnType<typeof make>) => all(r).filter(([p]) => /chapter\d+\.xhtml/.test(p)).map(([, t]) => t.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length).reduce((a, b) => a + b, 0)
  assert.ok(Math.abs(words(std) - words(acc)) < 40, 'same words in both')

  for (const [name, r] of [['accessible', acc], ['standard', std]] as const) {
    assert.deepEqual(r.review.filter((x) => x.level === 'error'), [], `${name}: no build errors`)
    const rep = checkEpub(r.files, r.source)
    assert.deepEqual(rep.groups.flatMap((g) => g.findings).filter((f) => f.level === 'error'), [], `${name}: built-in check has no errors`)
    const ec = epubcheck(r.epub)
    if (ec) assert.deepEqual(ec.errors, [], `${name}: EPUBCheck reports no errors`)
  }
})
