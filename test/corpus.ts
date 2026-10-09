// Blind run over every InDesign sample book: how many things did the tool need a person to look at?
//   node --import ./test/setup.ts test/corpus.ts [standard|accessible]
// A new book that needs many low-confidence checks, or ends with errors, shows where the rules do not generalise yet.
import { resolve } from 'node:path'
import { unzip } from '../src/engine/zip.ts'
import { analyze, build } from '../src/engine/indesign/build.ts'
import { checkEpub } from '../src/engine/check/epub.ts'
import { reviewList } from '../src/engine/review/confidence.ts'
import { setSettings } from '../src/engine/settings.ts'
import { INDD, AUTOMATION, has, read } from './samples.ts'

const profile = (process.argv[2] === 'standard' ? 'standard' : 'accessible') as 'standard' | 'accessible'
const books: { name: string; path: string; inner?: string; cover?: string }[] = [
  { name: 'Cambia tu mente', path: resolve(INDD, 'Input/88228-02 Cambia tu mente.zip') },
  { name: 'La cara oculta de Sheinbaum', path: resolve(AUTOMATION, '../Outputs/input/La cara oculta de la presidenta_Grijalbo.epub') },
  { name: 'Cartografías del poder', path: resolve(AUTOMATION, '../corrections/Input_5d5f47c6-b94b-4ac3-b3aa-3a5c490a72b2.zip'), inner: 'Input_Indesign_cartografia_288p.epub', cover: 'cover.jpg' },
]
setSettings({})
console.log(`profile: ${profile}\n${'book'.padEnd(30)} sections chapters low  medium  sure  errors  check-errors`)
for (const b of books) {
  if (!has(b.path)) continue
  let files = unzip(read(b.path))
  const cover = b.cover ? files.get(b.cover) : undefined
  if (b.inner) files = unzip(files.get(b.inner)!)
  const a = analyze(files)
  const r = build(a, { styles: a.styles, images: a.images, cover: { name: 'cover.jpg', data: cover ?? new Uint8Array() }, meta: { ...a.meta, eisbn: '9781234567897', profile } })
  const rv = reviewList({ styles: a.styles, sources: a.sources, meta: a.meta, sections: r.sections, notes: r.review })
  const ck = checkEpub(r.files, r.source).groups.flatMap((g) => g.findings).filter((f) => f.level === 'error')
  const n = (c: string) => rv.items.filter((i) => i.confidence === c).length
  console.log(`${b.name.padEnd(30)} ${String(r.sections.length).padStart(8)} ${String(r.sections.filter((s) => s.type === 'chapter').length).padStart(8)} ${String(n('low')).padStart(4)} ${String(n('medium')).padStart(6)} ${String(rv.sure).padStart(5)} ${String(r.review.filter((x) => x.level === 'error').length).padStart(7)} ${String(ck.length).padStart(13)}`)
  for (const it of rv.items.filter((i) => process.env.ALL || i.confidence === 'low').slice(0, 8)) console.log(`    · ${it.title}`)
}
