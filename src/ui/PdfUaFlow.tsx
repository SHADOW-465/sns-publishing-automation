import { useMemo, useState } from 'react'
import { FileDrop, type Picked } from './FileDrop.tsx'
import { download, remember, useObjectUrls } from './shared.tsx'
import { Help } from './wizard.tsx'
import { browserRaster } from './raster-browser.ts'
import { UA_ROLES, UA_ROLE_HELP, type UaRole, type UaStyle } from '../engine/pdfua/structure.ts'
import type { UaAnalysis } from '../engine/pdfua/index.ts'
import type { ReviewItem } from '../engine/epub/package.ts'

// Print PDF → accessible PDF (PDF/UA-1). The PDF is re-tagged from scratch; the reviewer checks
// text styles and picture descriptions, then runs PAC on the download as the final check.

type Built = { pdf: Uint8Array; review: ReviewItem[]; stats: Record<string, number>; fileName: string }

export function PdfUaFlow() {
  const [pdf, setPdf] = useState<Picked>()
  const [cover, setCover] = useState<Picked>()
  const [altDocx, setAltDocx] = useState<Picked>()
  const [extras, setExtras] = useState<Picked[]>([])
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState<string>()
  const [a, setA] = useState<UaAnalysis>()
  const [styles, setStyles] = useState<UaStyle[]>([])
  const [meta, setMeta] = useState<UaAnalysis['meta']>()
  const [alt, setAlt] = useState<Record<string, string>>({})
  const [crop, setCrop] = useState(true)
  const [result, setResult] = useState<Built>()
  const [notice, setNotice] = useState<string>()

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label)
    setError(undefined)
    await new Promise((r) => setTimeout(r, 30))
    try {
      await fn()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(undefined)
    }
  }

  const onAnalyse = () =>
    run('Loading the PDF reader…', async () => {
      const { pdfjs } = await import('./pdf.ts')
      const { analyzeUa } = await import('../engine/pdfua/index.ts')
      const inputs = {
        main: pdf!.data,
        extras: extras.map((x) => x.data),
        cover: cover ? { data: cover.data, png: /\.png$/i.test(cover.name) } : undefined,
        altDocx: altDocx?.data,
      }
      const r = await analyzeUa(pdfjs, browserRaster, inputs, (done, total) => setBusy(`Reading page ${done} of ${total}…`))
      const saved = remember<Record<string, UaRole>>('uaprofile', r.book.meta.publisher)
      setStyles(r.styles.map((s) => (saved?.[s.key] ? { ...s, role: saved[s.key], reason: 'from saved publisher profile' } : s)))
      setNotice(saved ? `Applied the saved settings for “${r.book.meta.publisher}”.` : undefined)
      setMeta(r.meta)
      setAlt(Object.fromEntries(r.figures.map((f) => [f.key, f.alt])))
      setA(r)
      setResult(undefined)
    })

  const onBuild = () =>
    run('Tagging the PDF…', async () => {
      const { buildUa } = await import('../engine/pdfua/index.ts')
      setResult(await buildUa(a!, { styles, meta: meta!, alt, cropToTrim: crop, sourceName: pdf!.name }))
      if (a!.book.meta.publisher) remember('uaprofile', a!.book.meta.publisher, Object.fromEntries(styles.map((s) => [s.key, s.role])))
    })

  const pickExtras = async (files: FileList | null) =>
    setExtras(await Promise.all([...(files ?? [])].map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) }))))
  const setRole = (key: string, role: UaRole) => setStyles((s) => s.map((x) => (x.key === key ? { ...x, role } : x)))
  const set = (k: keyof UaAnalysis['meta'], v: string) => setMeta({ ...meta!, [k]: v })

  return (
    <div className="flow">
      <section className="card">
        <h2>1. Files</h2>
        <p className="muted">
          Makes the print PDF readable with a screen reader: every piece of text gets a tag (heading, paragraph, list, note…) in reading order, pictures get
          descriptions, and decoration is hidden. The result follows PDF/UA, the standard that the PAC checker tests.
        </p>
        <div className="drops">
          <FileDrop label="Print PDF" hint="the final PDF of the book" accept="application/pdf" value={pdf} onPick={setPdf} required />
          <FileDrop label="Cover image" hint="optional — placed as page 1" accept="image/jpeg,image/png" value={cover} onPick={setCover} />
          <FileDrop label="Alt text (Word)" hint="optional — picture descriptions" accept=".docx" value={altDocx} onPick={setAltDocx} />
        </div>
        <label className="alt">
          <span>Extra PDFs appended at the end (plates, inserts) — optional</span>
          <input type="file" accept="application/pdf" multiple onChange={(e) => pickExtras(e.target.files)} />
        </label>
        {extras.length > 0 && <p className="muted small">Appended in this order: {extras.map((x) => x.name).join(', ')}</p>}
        <Help title="What are these files for?">
          <ul>
            <li><strong>Print PDF</strong> — the book to make accessible.</li>
            <li><strong>Cover image</strong> — added as page 1, as publishers deliver it.</li>
            <li><strong>Alt text (Word)</strong> — descriptions of the pictures, if someone wrote them; they are matched to the pictures by label (“Abb. 3”) or order.</li>
            <li><strong>Extra PDFs</strong> — plates or inserts printed separately, appended at the end.</li>
          </ul>
          Everything runs in this browser; nothing is uploaded. At the end, open the result in PAC (PDF Accessibility Checker) for the official report.
        </Help>
        <button className="primary" disabled={!pdf || !!busy} onClick={onAnalyse}>
          Analyse
        </button>
      </section>

      {busy && <p className="busy" role="status">{busy}</p>}
      {error && <p className="err" role="alert">{error}</p>}
      {notice && <p className="note">{notice}</p>}

      {a && meta && (
        <>
          <section className="card">
            <h2>Document details</h2>
            <p className="muted">Pre-filled from the title pages. The title is shown in the reader’s window bar; the language tells screen readers how to pronounce the text.</p>
            <div className="form">
              {(
                [
                  ['title', 'Title'],
                  ['author', 'Author(s)'],
                  ['lang', 'Language', 'e.g. en, de, en-GB'],
                  ['subject', 'Subject'],
                  ['keywords', 'Keywords'],
                  ['isbn', 'E-ISBN', 'optional — added to the file name'],
                ] as [keyof UaAnalysis['meta'], string, string?][]
              ).map(([k, label, hint]) => (
                <label key={k} className={(k === 'title' || k === 'lang') && !meta[k] ? 'bad' : ''}>
                  <span>{label}</span>
                  <input value={meta[k]} placeholder={hint} onChange={(e) => set(k, e.target.value)} />
                </label>
              ))}
            </div>
            <label className="row small">
              <input type="checkbox" checked={crop} onChange={(e) => setCrop(e.target.checked)} /> Hide the printer’s marks (crop pages to the trimmed size)
            </label>
          </section>

          <section className="card">
            <h2>Text styles</h2>
            <p className="muted">
              Each font and size in the PDF and the tag it gets. Headings define the bookmarks and the document outline; decoration is skipped by screen readers.
              Choices are remembered for this publisher.
            </p>
            <div className="table-wrap">
              <table className="styles">
                <thead>
                  <tr>
                    <th>Font and size</th>
                    <th>Lines</th>
                    <th>Example</th>
                    <th>Tag</th>
                  </tr>
                </thead>
                <tbody>
                  {styles.map((s) => (
                    <tr key={s.key}>
                      <td>
                        <code>{s.key}</code>
                        <div className="why">{s.reason}</div>
                      </td>
                      <td className="num">{s.count}</td>
                      <td className="sample">{s.samples[0]}</td>
                      <td>
                        <select value={s.role} onChange={(e) => setRole(s.key, e.target.value as UaRole)}>
                          {UA_ROLES.map((r) => (
                            <option key={r} value={r}>
                              {UA_ROLE_HELP[r]}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <Figures a={a} alt={alt} setAlt={setAlt} />

          <section className="card">
            <h2>Build</h2>
            {!meta.title && <p className="err small">Enter the document title.</p>}
            <button className="primary" disabled={!!busy || !meta.title || !meta.lang} onClick={onBuild}>
              {result ? 'Rebuild accessible PDF' : 'Build accessible PDF'}
            </button>
          </section>
        </>
      )}

      {result && <UaResult result={result} />}
    </div>
  )
}

function Figures({ a, alt, setAlt }: { a: UaAnalysis; alt: Record<string, string>; setAlt: (x: Record<string, string>) => void }) {
  const [filter, setFilter] = useState<'todo' | 'all'>('todo')
  const urls = useObjectUrls(useMemo(() => a.figures.filter((f) => f.thumb).map((f) => [f.key, f.thumb!] as [string, Uint8Array]), [a]), 'image/jpeg')
  const todo = a.figures.filter((f) => !alt[f.key]?.trim())
  const shown = filter === 'todo' ? todo : a.figures
  const label = (page: number) => a.book.numbers[page] ?? `PDF page ${page + 1}`
  return (
    <section className="card">
      <h2>Pictures (alt text)</h2>
      <p className="muted">
        PDF/UA needs a description for every picture and chart. {a.figures.length - todo.length} of {a.figures.length} were filled in from the Word file
        {a.altUnused.length ? `; ${a.altUnused.length} description(s) from it matched no picture (listed below)` : ''}.
      </p>
      <div className="row">
        <label>
          <input type="radio" checked={filter === 'todo'} onChange={() => setFilter('todo')} /> Needs a description ({todo.length})
        </label>
        <label>
          <input type="radio" checked={filter === 'all'} onChange={() => setFilter('all')} /> All ({a.figures.length})
        </label>
      </div>
      <div className="images pics">
        {shown.map((f) => (
          <div key={f.key} className="img-row">
            {urls.get(f.key) ? <img src={urls.get(f.key)} alt="" loading="lazy" /> : <div className="muted small">no preview</div>}
            <div>
              <code>
                page {label(f.page)} · {f.vector ? 'chart / drawing' : 'image'}
              </code>
              {f.caption && <div className="why">Caption: {f.caption}</div>}
              <label className="alt">
                <span>Alt text</span>
                <textarea rows={2} value={alt[f.key] ?? ''} onChange={(e) => setAlt({ ...alt, [f.key]: e.target.value })} />
              </label>
            </div>
          </div>
        ))}
      </div>
      {a.altUnused.length > 0 && (
        <details>
          <summary>Unmatched descriptions from the Word file</summary>
          <ul className="small">
            {a.altUnused.map((u, i) => (
              <li key={i}>
                {u.label && <strong>{u.label}: </strong>}
                {u.text}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  )
}

function UaResult({ result }: { result: Built }) {
  const by = (l: ReviewItem['level']) => result.review.filter((r) => r.level === l)
  const errors = by('error')
  const s = result.stats
  return (
    <section className="card">
      <h2>Review and download</h2>
      <div className={`summary ${errors.length ? 'has-err' : 'ok'}`}>
        {errors.length ? `${errors.length} problem(s) to fix before delivery` : 'No blocking problems found'} · {by('warn').length} to check · {by('info').length} automatic changes
      </div>
      <p className="muted small">
        {s.headings} headings · {s.figures} pictures · {s.links} links · {s.taggedOps} content pieces tagged · {s.artifactOps} marked as decoration
      </p>
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
        <button className="primary" onClick={() => download(result.pdf, result.fileName, 'application/pdf')}>
          Download {result.fileName}
        </button>
        <span className="muted">Then run PAC (PDF Accessibility Checker) on it as the final check.</span>
      </div>
    </section>
  )
}
