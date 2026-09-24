import { useEffect, useState } from 'react'
import { Preview } from './Preview.tsx'
import { isbn13Valid, type BookMeta, type ReviewItem, type Section } from '../engine/epub/package.ts'
import type { Files } from '../engine/zip.ts'

export function download(data: Uint8Array | string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type }))
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}

/** per-publisher settings remembered in this browser (style profiles, copyright wording) */
export function remember<T>(key: string, publisher: string, value?: T): T | undefined {
  const k = `automation:${key}:${publisher.trim().toLowerCase()}`
  try {
    if (value !== undefined) localStorage.setItem(k, JSON.stringify(value))
    const s = localStorage.getItem(k)
    return s ? (JSON.parse(s) as T) : undefined
  } catch {
    return undefined // storage unavailable: settings just aren't remembered
  }
}

const META_FIELDS: [keyof BookMeta, string, string?][] = [
  ['title', 'Title'],
  ['subtitle', 'Subtitle'],
  ['authors', 'Author(s)', 'comma separated'],
  ['publisher', 'Publisher'],
  ['language', 'Language', 'e.g. es-ES, en-GB'],
  ['eisbn', 'E-book ISBN', 'e.g. 979-13-88228-26-1'],
  ['printIsbn', 'Print ISBN', 'used as the page-number source'],
  ['rights', 'Rights'],
  ['certifiedBy', 'Accessibility certified by'],
  ['conformsTo', 'Conforms to'],
]

export function BookDetails({ meta, onChange, note, sources = {} }: { meta: BookMeta; onChange: (m: BookMeta) => void; note: string; sources?: Partial<Record<keyof BookMeta, string>> }) {
  const ok = isbn13Valid(meta.eisbn)
  const caps = (s: string) => s === s.toUpperCase() && /\p{L}{3}/u.test(s)
  const suspicious = (k: keyof BookMeta) =>
    (k === 'title' && (/_|\.(indd|pdf|docx?)\b/i.test(meta.title) || !meta.title.trim() || caps(meta.title))) ||
    (k === 'authors' && (!meta.authors.trim() || caps(meta.authors))) ||
    (k === 'publisher' && !meta.publisher.trim()) ||
    /check/.test(sources[k] ?? '')
  return (
    <section className="card">
      <h2>Book details</h2>
      <p className="muted">{note}</p>
      <div className="form">
        {META_FIELDS.map(([k, label, hint]) => (
          <label key={k} className={(k === 'eisbn' && !ok) || suspicious(k) ? 'bad' : ''}>
            <span>{label}</span>
            <input value={meta[k]} placeholder={hint} onChange={(e) => onChange({ ...meta, [k]: e.target.value })} />
            {sources[k] && <small className="src">from the {sources[k]}</small>}
          </label>
        ))}
      </div>
      {!ok && <p className="err small">Enter a valid 13-digit e-book ISBN (it is never in the source files).</p>}
    </section>
  )
}

export function Result({ result, meta }: { result: { epub: Uint8Array; files: Files; sections: Section[]; review: ReviewItem[] }; meta: BookMeta }) {
  const [open, setOpen] = useState<string>(result.sections.find((s) => s.type === 'chapter')?.file ?? result.sections[0]?.file)
  const by = (l: ReviewItem['level']) => result.review.filter((r) => r.level === l)
  const errors = by('error')
  return (
    <section className="card">
      <h2>Review and download</h2>
      <div className={`summary ${errors.length ? 'has-err' : 'ok'}`}>
        {errors.length ? `${errors.length} problem(s) to fix before delivery` : 'No blocking problems found'} · {by('warn').length} to check · {by('info').length} automatic changes
      </div>
      <ul className="review">
        {(['error', 'warn', 'info'] as const).flatMap((l) =>
          by(l).map((r, i) => (
            <li key={l + i} className={l}>
              <span className="lvl">{l === 'error' ? 'Fix' : l === 'warn' ? 'Check' : 'Done'}</span> {r.msg} {r.where && <code>{r.where}</code>}
            </li>
          )),
        )}
      </ul>
      <div className="row">
        <button className="primary" onClick={() => download(result.epub, `${meta.title || 'book'}.epub`, 'application/epub+zip')}>
          Download EPUB
        </button>
        <span className="muted">Then run EPUBCheck and Ace by DAISY as the final QA step.</span>
      </div>
      <div className="preview-grid">
        <nav aria-label="EPUB files">
          <ol>
            {result.sections.map((s) => (
              <li key={s.file}>
                <button className={open === s.file ? 'on' : ''} onClick={() => setOpen(s.file)}>
                  {s.nav || s.file}
                  <small>{s.file}</small>
                </button>
              </li>
            ))}
          </ol>
        </nav>
        <Preview files={result.files} file={open} />
      </div>
    </section>
  )
}

/** Object URLs for in-memory files, created and revoked with the component (StrictMode-safe). */
export function useObjectUrls(entries: [string, Uint8Array][], type?: string): Map<string, string> {
  const [urls, setUrls] = useState(() => new Map<string, string>())
  useEffect(() => {
    const m = new Map(entries.map(([k, d]) => [k, URL.createObjectURL(new Blob([d as BlobPart], type ? { type } : undefined))]))
    setUrls(m)
    return () => m.forEach((u) => URL.revokeObjectURL(u))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries])
  return urls
}
