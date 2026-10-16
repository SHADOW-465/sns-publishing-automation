// Detection numbers for the two reference books: chapters, headings per level, role per style, where the notes
// went, pictures placed or not, review items. Used to compare detection before and after a change.
//   node --import ./test/setup.ts test/detect-report.ts <out.json>
import { resolve } from 'node:path'
import { existsSync, writeFileSync } from 'node:fs'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { unzip, text } from '../src/engine/zip.ts'
import { analyze, build } from '../src/engine/indesign/build.ts'
import { readPrintPages } from '../src/engine/pdf/pages.ts'
import { reviewList } from '../src/engine/review/confidence.ts'
import { openSpec, applySpec } from '../src/engine/spec/session.ts'
import { DEFAULT_SETTINGS, setSettings } from '../src/engine/settings.ts'
import { INDD, read } from './samples.ts'

const C = resolve(import.meta.dirname, '../../corrections')
const books = [
  { name: 'Tempelhofer', epub: resolve(C, 'Indesign-Tempelhofer_Feld_Inhalt_de9fa898-27c3-45dc-838c-2e847d2fa889.epub'), pdf: resolve(C, 'Weigel_Tempelhofer_Feld_Inhalt_print_83fe21e0-beb6-458a-a56b-d5f74054d93d.pdf'), eisbn: '9783814803562', client: true },
  { name: 'Cambia', epub: resolve(INDD, 'Input/88228-02 Cambia tu mente.zip'), pdf: resolve(INDD, 'Input/88228-02 Cambia tu mente.pdf'), eisbn: '9791388228261', cover: resolve(INDD, 'Output/Cambia tu mente.epub'), client: false },
]
const PNG = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0))

const out: Record<string, unknown> = {}
const tally = (xs: string[]) => xs.reduce<Record<string, number>>((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {})
for (const b of books) {
  if (!existsSync(b.epub)) continue
  setSettings(DEFAULT_SETTINGS)
  const a = analyze(unzip(read(b.epub)))
  if (b.client) applySpec(await openSpec({ client: a.meta.publisher, series: '', book: b.eisbn }, DEFAULT_SETTINGS))
  const printPages = existsSync(b.pdf) ? await readPrintPages(pdfjs as never, read(b.pdf)) : undefined
  const cover = b.cover ? { name: 'cover.jpg', data: unzip(read(b.cover)).get('OEBPS/images/cover.jpg')! } : { name: 'cover.png', data: PNG }
  const r = build(a, { styles: a.styles, images: a.images, printPages, meta: { ...a.meta, eisbn: b.eisbn }, cover })
  const xhtml = [...r.files].filter(([p]) => p.endsWith('.xhtml') && !/nav\.xhtml$/.test(p))
  const headings: Record<string, number> = {}
  const notes: Record<string, string> = {}
  let figures = 0
  const figuresIn: Record<string, number> = {}
  for (const [p, d] of xhtml) {
    const t = text(d)
    const f = p.replace('OEBPS/', '')
    for (const m of t.matchAll(/<h([1-6])[ >]/g)) headings[`h${m[1]}`] = (headings[`h${m[1]}`] ?? 0) + 1
    const refs = (t.match(/epub:type="noteref"/g) ?? []).length
    const inline = (t.match(/class="footnotes"/g) ?? []).length
    const asides = (t.match(/role="doc-footnote"/g) ?? []).length
    if (refs || inline || asides) notes[f] = `refs ${refs}, notes ${asides}${inline ? ' (under the chapter)' : ''}`
    const n = (t.match(/<img /g) ?? []).length
    if (n) ((figures += n), (figuresIn[f] = n))
  }
  const rv = reviewList({ styles: a.styles, sources: a.sources, meta: a.meta, sections: r.sections, notes: r.review, noteFindings: a.notes, pictures: r.pictures })
  const lvl = (l: string) => r.review.filter((x) => x.level === l).length
  out[b.name] = {
    sections: r.sections.length,
    chapters: r.sections.filter((s) => s.type === 'chapter').length,
    sectionTypes: Object.fromEntries([...new Set(r.sections.map((s) => s.type))].map((t) => [t, r.sections.filter((s) => s.type === t).length])),
    headings,
    roles: Object.fromEntries(a.styles.filter((s) => s.count).map((s) => [s.key, `${s.role} (${s.count}x${s.confidence !== undefined ? `, ${s.confidence}` : ''}${s.unsure ? ', unsure' : ''})`])),
    notes,
    pictures: { inBook: figures, imagesInExport: a.images.length, leftOut: r.review.filter((x) => /^Left out picture/.test(x.msg)).length, onNotesPage: r.review.filter((x) => /still on the notes page/.test(x.msg)).length, movedByCaption: Number(r.review.find((x) => /^Moved \d+ picture/.test(x.msg))?.msg.match(/\d+/)?.[0] ?? 0), figuresIn },
    // phase 3 additions (the baseline had no confidence for these)
    detection: {
      styleActions: tally(a.styles.filter((x) => x.count).map((x) => x.action ?? 'none')),
      pictureSignals: tally(r.pictures.map((p) => p.signal)),
      pictureActions: tally(r.pictures.map((p) => p.action)),
      noteKinds: a.notes.map((n) => `${n.kind}: ${n.notes} notes, ${n.refs} refs, ${n.unmatchedRefs.length + n.unmatchedNotes.length} unmatched, ${n.confidence}`),
      crossChecks: r.review.filter((x) => x.kind === 'cross-check').map((x) => x.msg),
      blocking: rv.items.filter((i) => i.score < 0.6).length,
      listed: rv.items.filter((i) => i.score >= 0.6).length,
    },
    review: { error: lvl('error'), warn: lvl('warn'), info: lvl('info'), checkLow: rv.items.filter((i) => i.confidence === 'low').length, checkMedium: rv.items.filter((i) => i.confidence === 'medium').length, sure: rv.sure, messages: r.review.map((x) => `${x.level}: ${x.msg}`) },
  }
}
writeFileSync(resolve(process.argv[2] ?? 'detect.json'), JSON.stringify(out, null, 1))
console.log(JSON.stringify(out, (k, v) => (k === 'messages' || k === 'roles' || k === 'figuresIn' ? undefined : v), 1))
