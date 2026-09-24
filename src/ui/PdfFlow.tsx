import { useMemo, useState } from 'react'
import { FileDrop, type Picked } from './FileDrop.tsx'
import { BookDetails, Result, remember, useObjectUrls } from './shared.tsx'
import { browserRaster } from './raster-browser.ts'
import { PDF_ROLES, PDF_ROLE_HELP, type PdfBook, type PdfProfile, type PdfRole, type PdfStyleInfo } from '../engine/pdfepub/analyze.ts'
import type { PdfBuildResult } from '../engine/pdfepub/build.ts'
import { rulesFor, type CopyrightRules } from '../engine/epub/imprint.ts'
import type { BookMeta } from '../engine/epub/package.ts'

// Word / print-PDF → EPUB. The print PDF is the source (the Word file in the sample was itself a
// partial conversion of it); the cover comes as an image or as the print cover spread PDF.

export function PdfFlow() {
  const [pdf, setPdf] = useState<Picked>()
  const [cover, setCover] = useState<Picked>()
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState<string>()
  const [book, setBook] = useState<PdfBook>()
  const [styles, setStyles] = useState<PdfStyleInfo[]>([])
  const [meta, setMeta] = useState<BookMeta>()
  const [rules, setRules] = useState<CopyrightRules>(rulesFor('en'))
  const [result, setResult] = useState<PdfBuildResult>()
  const [alt, setAlt] = useState<Record<string, string>>({})
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
      const { analyzePdf } = await import('../engine/pdfepub/analyze.ts')
      const b = await analyzePdf(pdfjs, pdf!.data, browserRaster, {}, (done, total) => setBusy(`Reading page ${done} of ${total} (text, fonts and pictures)…`))
      const saved = remember<PdfProfile>('pdfprofile', b.meta.publisher)
      const savedRules = remember<CopyrightRules>('copyright', b.meta.publisher)
      setStyles(b.styles.map((s) => (saved?.[s.key] ? { ...s, role: saved[s.key], unsure: false, reason: 'from saved publisher profile' } : s)))
      setRules(savedRules ?? rulesFor(b.meta.language))
      setNotice(saved ? `Applied the saved settings for “${b.meta.publisher}”.` : undefined)
      setBook(b)
      setMeta(b.meta)
      setResult(undefined)
      setAlt({})
    })

  const onBuild = () =>
    run('Building the EPUB (pictures, contents, index)…', async () => {
      const { buildPdfEpub } = await import('../engine/pdfepub/build.ts')
      let coverImg = cover!
      if (/\.pdf$/i.test(cover!.name)) {
        setBusy('Cutting the front cover out of the cover PDF…')
        const { pdfjs } = await import('./pdf.ts')
        const { coverFromSpread } = await import('../engine/pdfepub/cover.ts')
        const review: never[] = []
        coverImg = { name: 'cover.jpg', data: await coverFromSpread(pdfjs, cover!.data, book!.pages[0], browserRaster, review) }
      }
      setBusy('Building the EPUB (pictures, contents, index)…')
      const r = await buildPdfEpub(book!, { styles, meta: meta!, rules, cover: coverImg, alt }, browserRaster)
      setResult(r)
      setAlt(Object.fromEntries(r.pictures.map((p) => [p.path, p.alt])))
      remember('pdfprofile', meta!.publisher, Object.fromEntries(styles.map((s) => [s.key, s.role])))
      remember('copyright', meta!.publisher, rules)
    })

  const setRole = (key: string, role: PdfRole) => setStyles((s) => s.map((x) => (x.key === key ? { ...x, role, unsure: false } : x)))

  return (
    <div className="flow">
      <section className="card">
        <h2>1. Files</h2>
        <div className="drops">
          <FileDrop label="Print PDF" hint="the final print PDF of the book" accept="application/pdf" value={pdf} onPick={setPdf} required />
          <FileDrop label="Cover" hint="front cover image, or the print cover spread PDF" accept="image/jpeg,image/png,application/pdf" value={cover} onPick={setCover} required />
        </div>
        <p className="muted small">Large PDFs take a few minutes: every page is read in this browser, nothing is uploaded.</p>
        <button className="primary" disabled={!pdf || !!busy} onClick={onAnalyse}>
          Analyse
        </button>
      </section>

      {busy && <p className="busy" role="status">{busy}</p>}
      {error && <p className="err" role="alert">{error}</p>}
      {notice && <p className="note">{notice}</p>}

      {book && meta && (
        <>
          <BookDetails meta={meta} onChange={setMeta} note="Pre-filled from the PDF (title pages and imprint). Type in the e-book ISBN." />

          <section className="card">
            <h2>Text styles</h2>
            <p className="muted">
              Each font and size used in the PDF, and what it is for. Rows marked <span className="flag">check</span> are guesses. Choices are remembered for this publisher.
            </p>
            <p className="muted small">
              {book.pages.length} pages · body text {book.bodyKey} · line spacing {book.lead}pt · paragraph indent {book.step}pt · {book.front.length} front pages · brand colour{' '}
              <span style={{ background: book.brand, color: '#fff', padding: '0 6px', borderRadius: 4 }}>{book.brand}</span>
            </p>
            <div className="table-wrap">
              <table className="styles">
                <thead>
                  <tr>
                    <th>Font and size</th>
                    <th>Lines</th>
                    <th>Example</th>
                    <th>Used for</th>
                  </tr>
                </thead>
                <tbody>
                  {styles.map((s) => (
                    <tr key={s.key} className={s.unsure ? 'unsure' : ''}>
                      <td>
                        <code>{s.key}</code>
                        {s.unsure && <span className="flag">check</span>}
                        <div className="why">{s.reason}</div>
                      </td>
                      <td className="num">{s.count}</td>
                      <td className="sample">{s.samples[0]}</td>
                      <td>
                        <select value={s.role} onChange={(e) => setRole(s.key, e.target.value as PdfRole)}>
                          {PDF_ROLES.map((r) => (
                            <option key={r} value={r}>
                              {PDF_ROLE_HELP[r]}
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

          <section className="card">
            <h2>Copyright page</h2>
            <p className="muted">
              Built from the print imprint: print-only lines are removed and the ISBN is replaced. These lines are added for the e-book ({'{year}'} and {'{author}'} are filled in). Leave empty to keep the print wording.
            </p>
            <div className="form">
              <label>
                <span>E-book notice</span>
                <input value={rules.ebookNotice} onChange={(e) => setRules({ ...rules, ebookNotice: e.target.value })} />
              </label>
              <label>
                <span>Copyright line</span>
                <input value={rules.copyrightLine} onChange={(e) => setRules({ ...rules, copyrightLine: e.target.value })} />
              </label>
            </div>
            <label className="alt" style={{ marginTop: 10 }}>
              <span>Rights statement (replaces the print “no part of this publication…” paragraph)</span>
              <textarea rows={4} value={rules.rightsStatement} onChange={(e) => setRules({ ...rules, rightsStatement: e.target.value })} />
            </label>
          </section>

          <section className="card">
            <h2>Build</h2>
            {!cover && <p className="err small">Add the cover (image or cover PDF).</p>}
            <button className="primary" disabled={!!busy || !cover} onClick={onBuild}>
              {result ? 'Rebuild EPUB' : 'Build EPUB'}
            </button>
          </section>
        </>
      )}

      {result && meta && (
        <>
          <Result result={result} meta={meta} />
          <Pictures result={result} alt={alt} setAlt={setAlt} onRebuild={onBuild} busy={!!busy} />
        </>
      )}
    </div>
  )
}

function Pictures({ result, alt, setAlt, onRebuild, busy }: { result: PdfBuildResult; alt: Record<string, string>; setAlt: (a: Record<string, string>) => void; onRebuild: () => void; busy: boolean }) {
  const [filter, setFilter] = useState<'todo' | 'all'>('todo')
  const urls = useObjectUrls(useMemo(() => result.pictures.map((p) => [p.path, result.files.get(`OEBPS/${p.path}`)!] as [string, Uint8Array]), [result]), 'image/jpeg')
  const todo = result.pictures.filter((p) => !alt[p.path] || alt[p.path] === p.caption)
  const shown = filter === 'todo' ? todo : result.pictures
  return (
    <section className="card">
      <h2>Picture descriptions (alt text)</h2>
      <p className="muted">
        Screen-reader users hear this instead of seeing the picture. Captions were used as a starting point; {todo.length} of {result.pictures.length} still need a real description (or leave empty for purely decorative pictures).
      </p>
      <div className="row">
        <label>
          <input type="radio" checked={filter === 'todo'} onChange={() => setFilter('todo')} /> Needs a description ({todo.length})
        </label>
        <label>
          <input type="radio" checked={filter === 'all'} onChange={() => setFilter('all')} /> All ({result.pictures.length})
        </label>
        <button className="primary" disabled={busy} onClick={onRebuild}>
          Rebuild with these descriptions
        </button>
      </div>
      <div className="images pics">
        {shown.map((p) => (
          <div key={p.path} className="img-row">
            <img src={urls.get(p.path)} alt="" loading="lazy" />
            <div>
              <code>{p.path.replace('images/', '')}</code>
              {p.caption && <div className="why">Caption: {p.caption}</div>}
              <label className="alt">
                <span>Alt text</span>
                <input value={alt[p.path] ?? ''} onChange={(e) => setAlt({ ...alt, [p.path]: e.target.value })} />
              </label>
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
