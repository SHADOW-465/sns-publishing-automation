// Chapter splitting regression: a "CHAPTER n" label, its title and its body become ONE chapter file, whatever the
// typesetter called the styles. Synthetic fixtures only (no client files).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { text } from '../src/engine/zip.ts'
import { analyze, build } from '../src/engine/indesign/build.ts'
import { synthExport } from './synth.ts'

const cover = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))
const words = (s: string) => s.replace(/<[^>]+>/g, ' ').split(/\s+/).filter(Boolean).length
const body = (cls: string, n: number) => `<p class="${cls}">${`Body text of chapter ${n} goes on about churches and towns. `.repeat(30)}</p>`.repeat(3)

function run(html: string, css: string, roles: Record<string, string> = {}) {
  const a = analyze(synthExport(html, css, 'en-GB'))
  const r = build(a, {
    styles: a.styles.map((s) => (roles[s.key] ? { ...s, role: roles[s.key] as typeof s.role } : s)), images: a.images,
    meta: { ...a.meta, title: 'Sample Book', authors: 'A. Writer', publisher: 'Example Press', eisbn: '9780306406157', language: 'en-GB' },
    cover: { name: 'cover.png', data: cover },
  })
  return { a, r }
}

function assertGoodSplit(r: ReturnType<typeof build>, n: number) {
  const ch = r.sections.filter((s) => s.type === 'chapter')
  assert.equal(ch.length, n, `chapters: ${r.sections.map((s) => `${s.file}:${s.type}:${s.nav}`).join(' | ')}`)
  for (const s of ch) {
    const x = text(r.files.get(`OEBPS/${s.file}`)!)
    assert.ok(words(x.replace(/[\s\S]*<body[^>]*>/, '')) > 50, `${s.file} (${s.nav}) has only a heading`)
  }
  assert.ok(!r.sections.some((s) => /^bm\d/.test(s.file.replace('.xhtml', '')) && /Body text of chapter/.test(text(r.files.get(`OEBPS/${s.file}`)!))), 'chapter body fell into a back-matter file')
  const nav = text(r.files.get('OEBPS/nav.xhtml')!)
  const tocNav = nav.match(/<nav[^>]*epub:type="toc"[\s\S]*?<\/nav>/)![0]
  for (const s of r.sections) assert.ok(tocNav.includes(`href="${s.file}`), `${s.file} missing from nav`)
}

test('label style "Chapter-title" with "CHAPTER n" + a "Main-head" title + body = one chapter file each', () => {
  const css = `p.Basic { font-size:1em; text-align:justify; font-family:serif; }
p.Chapter-title { font-size:1.6em; text-align:center; font-family:sans-serif; }
p.Main-head { font-size:2.2em; text-align:center; font-family:sans-serif; }`
  let html = '<p class="Basic">Front line.</p>\n'
  const T = ['Normandy', 'King William', 'Romanesque', 'Gothic']
  T.forEach((t, i) => { html += `<p class="Chapter-title">CHAPTER ${i + 1}</p>\n<p class="Main-head">${t}</p>\n${body('Basic', i + 1)}\n` })
  // as analysed, and as the 1066 book was read: the label style as chapter-label or chapter-title, the title style as section-title / h2
  const variants: Record<string, string>[] = [{}, { 'Chapter-title': 'chapter-label', 'Main-head': 'section-title' }, { 'Chapter-title': 'chapter-title', 'Main-head': 'section-title' }, { 'Chapter-title': 'chapter-label', 'Main-head': 'h2' }]
  for (const roles of variants) {
    const { r } = run(html, css, roles)
    assertGoodSplit(r, 4)
    r.sections.filter((s) => s.type === 'chapter').forEach((s, i) => assert.match(s.nav, new RegExp(`^CHAPTER ${i + 1}\\.? ${T[i]}$`), JSON.stringify(roles)))
  }
})

test('a style named "CT" is a chapter title by default (no manual mapping)', () => {
  const css = `p.Basic-Paragraph { font-size:1em; text-align:justify; font-family:serif; }
p.CT { font-size:1.3em; text-align:left; font-weight:bold; font-family:serif; }
p.A { font-size:1.1em; text-align:left; font-weight:bold; font-family:serif; }`
  let html = '<p class="Basic-Paragraph">Front line.</p>\n'
  for (let i = 1; i <= 5; i++) html += `<p class="CT">Kapitel ${i}: Der Titel ${i}</p>\n${body('Basic-Paragraph', i)}\n<p class="A">Unterteil ${i}</p>\n${body('Basic-Paragraph', i)}\n`
  const { a, r } = run(html, css)
  assert.equal(a.styles.find((s) => s.key === 'CT')?.role, 'chapter-title')
  assertGoodSplit(r, 5)
})

test('chapter style names in other languages and with a style-group prefix: CN + ChapterTitle, Titoli_Titolo-capitolo', () => {
  const css = `p.Body { font-size:1em; text-align:justify; font-family:serif; }
p.CN { font-size:1.1em; text-align:left; font-family:serif; }
p.ChapterTitle { font-size:1.2em; text-align:left; font-family:serif; }
p.Titoli_Titolo-capitolo { font-size:1.2em; text-align:left; font-family:serif; }`
  let html = '<p class="Body">Front line.</p>\n'
  for (let i = 1; i <= 3; i++) html += `<p class="CN">${i}</p>\n<p class="ChapterTitle">Title ${i}</p>\n${body('Body', i)}\n`
  for (let i = 4; i <= 6; i++) html += `<p class="Titoli_Titolo-capitolo">Capitolo ${i}</p>\n${body('Body', i)}\n`
  const { a, r } = run(html, css)
  assert.equal(a.styles.find((s) => s.key === 'CN')?.role, 'chapter-label')
  assert.equal(a.styles.find((s) => s.key === 'ChapterTitle')?.role, 'chapter-title')
  assert.equal(a.styles.find((s) => s.key === 'Titoli_Titolo-capitolo')?.role, 'chapter-title')
  assertGoodSplit(r, 6)
})
