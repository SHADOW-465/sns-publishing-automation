import { type Files, text } from '../zip.ts'
import { parseXml, resolvePath, epubType } from '../xml.ts'
import type { ReviewItem } from './package.ts'

// In-app checks that catch what EPUBCheck / Ace would reject, so the reviewer sees problems
// before the file leaves the tool. (EPUBCheck + Ace still run in the QA step: see README.)

const KNOWN_TYPES = new Set([
  'cover', 'frontmatter', 'bodymatter', 'backmatter', 'halftitlepage', 'titlepage', 'copyright-page',
  'dedication', 'toc', 'landmarks', 'page-list', 'introduction', 'preface', 'foreword', 'prologue', 'part',
  'chapter', 'conclusion', 'epilogue', 'afterword', 'glossary', 'appendix', 'bibliography', 'endnotes',
  'index', 'contributors', 'acknowledgments', 'pagebreak', 'noteref', 'footnote', 'backlink', 'bodymatter',
])

export function validateEpub(files: Files): ReviewItem[] {
  const out: ReviewItem[] = []
  const ids = new Map<string, Set<string>>()
  const docs = new Map<string, Document>()
  for (const [path, data] of files) {
    if (!/\.(xhtml|opf|ncx|xml)$/.test(path)) continue
    try {
      docs.set(path, parseXml(text(data), path))
    } catch (e) {
      out.push({ level: 'error', msg: (e as Error).message, where: path })
    }
  }
  for (const [path, doc] of docs) {
    if (!path.endsWith('.xhtml')) continue
    const set = new Set<string>()
    for (const el of Array.from(doc.querySelectorAll('[id]'))) {
      if (set.has(el.id)) out.push({ level: 'error', msg: `Duplicate id "${el.id}".`, where: path })
      set.add(el.id)
    }
    ids.set(path, set)
  }
  const opf = docs.get('OEBPS/content.opf')
  const manifest = new Set(Array.from(opf?.getElementsByTagName('item') ?? []).map((i) => resolvePath('OEBPS/content.opf', i.getAttribute('href')!)))
  for (const m of manifest) if (!files.has(m)) out.push({ level: 'error', msg: `Manifest lists a missing file: ${m}` })
  for (const f of files.keys())
    if (f.startsWith('OEBPS/') && f !== 'OEBPS/content.opf' && !manifest.has(f)) out.push({ level: 'error', msg: `File not in manifest: ${f}` })

  for (const [path, doc] of docs) {
    if (!path.endsWith('.xhtml')) continue
    for (const a of Array.from(doc.querySelectorAll('[href], [src]'))) {
      const ref = a.getAttribute('href') ?? a.getAttribute('src')!
      if (/^(https?:|mailto:)/.test(ref) || a.localName === 'link') continue
      const [file, frag] = ref.split('#')
      const target = file ? resolvePath(path, file) : path
      if (!files.has(target)) out.push({ level: 'error', msg: `Broken link "${ref}".`, where: path })
      else if (frag && target.endsWith('.xhtml') && !ids.get(target)?.has(frag)) out.push({ level: 'error', msg: `Link to missing anchor "${ref}".`, where: path })
    }
    for (const img of Array.from(doc.querySelectorAll('img'))) {
      if (!img.hasAttribute('alt')) out.push({ level: 'error', msg: `Image without alt attribute: ${img.getAttribute('src')}`, where: path })
    }
    for (const el of Array.from(doc.querySelectorAll('*'))) {
      for (const t of epubType(el).split(/\s+/).filter(Boolean)) if (!KNOWN_TYPES.has(t)) out.push({ level: 'warn', msg: `Unknown epub:type "${t}".`, where: path })
    }
    for (const h of Array.from(doc.querySelectorAll('h1,h2,h3,h4,h5,h6'))) {
      if (!(h.textContent ?? '').trim()) out.push({ level: 'warn', msg: `Empty heading <${h.localName}>.`, where: path })
    }
    const empties = Array.from(doc.querySelectorAll('p')).filter((p) => !(p.textContent ?? '').trim() && !p.querySelector('img'))
    if (empties.length) out.push({ level: 'warn', msg: `${empties.length} empty paragraph(s).`, where: path })
    if (path !== 'OEBPS/nav.xhtml' && path !== 'OEBPS/cover.xhtml' && !doc.querySelector('h1,h2,h3') && !doc.querySelector('section[aria-label]'))
      out.push({ level: 'warn', msg: 'Document has no heading.', where: path })
  }
  return out
}
