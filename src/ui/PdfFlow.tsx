import { useMemo, useState } from 'react'
import { FileDrop, type Picked } from './FileDrop.tsx'
import { BookDetails, remember, useObjectUrls } from './shared.tsx'
import { Steps, StepNav, Help, Status, Outline, CheckReportView, DeliverButton } from './wizard.tsx'
import { browserRaster } from './raster-browser.ts'
import { PDF_ROLES, PDF_ROLE_HELP, type PdfBook, type PdfProfile, type PdfRole, type PdfStyleInfo } from '../engine/pdfepub/analyze.ts'
import type { PdfBuildResult } from '../engine/pdfepub/build.ts'
import { rulesFor, type CopyrightRules } from '../engine/epub/imprint.ts'
import { checkEpub, type CheckReport } from '../engine/check/epub.ts'
import { isbn13Valid, type BookMeta } from '../engine/epub/package.ts'

// Print PDF (or Word, via its PDF) → EPUB 3, in five steps. The print PDF is the source: the Word
// file in the sample was itself a partial conversion of it. The cover comes as an image or as the
// print cover spread PDF.

export function PdfFlow() {
  const [step, setStep] = useState(0)
  const [pdf, setPdf] = useState<Picked>()
  const [cover, setCover] = useState<Picked>()
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const [book, setBook] = useState<PdfBook>()
  const [styles, setStyles] = useState<PdfStyleInfo[]>([])
  const [meta, setMeta] = useState<BookMeta>()
  const [rules, setRules] = useState<CopyrightRules>(rulesFor('en'))
  const [result, setResult] = useState<PdfBuildResult>()
  const [report, setReport] = useState<CheckReport>()
  const [alt, setAlt] = useState<Record<string, string>>({})
  const [stale, setStale] = useState(true)

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
      setStyles(b.styles.map((s) => (saved?.[s.key] ? { ...s, role: saved[s.key], unsure: false, reason: 'from saved publisher settings' } : s)))
      setRules(savedRules ?? rulesFor(b.meta.language))
      setNotice(saved ? `Applied the settings saved for “${b.meta.publisher}”.` : undefined)
      setBook(b)
      setMeta(b.meta)
      setResult(undefined)
      setAlt({})
      setStale(true)
      setStep(1)
    })

  const rebuild = (then?: number) =>
    run('Building the e-book (pictures, contents, index) and checking it…', async () => {
      const { buildPdfEpub } = await import('../engine/pdfepub/build.ts')
      let coverImg = cover
      if (cover && /\.pdf$/i.test(cover.name)) {
        setBusy('Cutting the front cover out of the cover PDF…')
        const { pdfjs } = await import('./pdf.ts')
        const { coverFromSpread } = await import('../engine/pdfepub/cover.ts')
        coverImg = { name: 'cover.jpg', data: await coverFromSpread(pdfjs, cover.data, book!.pages[0], browserRaster, []) }
      }
      setBusy('Building the e-book (pictures, contents, index) and checking it…')
      const r = await buildPdfEpub(book!, { styles, meta: meta!, rules, cover: coverImg, alt }, browserRaster)
      setResult(r)
      setAlt(Object.fromEntries(r.pictures.map((p) => [p.path, p.alt])))
      setReport(checkEpub(r.files, r.source))
      setStale(false)
      remember('pdfprofile', meta!.publisher, Object.fromEntries(styles.map((s) => [s.key, s.role])))
      remember('copyright', meta!.publisher, rules)
      if (then !== undefined) setStep(then)
    })
  const go = (i: number) => (i >= 2 && (stale || !result) ? rebuild(i) : setStep(i))
  const setRole = (key: string, role: PdfRole) => (setStyles((s) => s.map((x) => (x.key === key ? { ...x, role, unsure: false } : x))), setStale(true))

  const todo = result ? result.pictures.filter((p) => !alt[p.path] || alt[p.path] === p.caption) : []
  const errors = (report?.errors ?? 0) + (result?.review.filter((r) => r.level === 'error').length ?? 0)
  const steps = [
    { title: 'Files', hint: 'print PDF and cover', enabled: true, done: !!book },
    { title: 'Book details', hint: 'title, ISBN, copyright', enabled: !!book, done: !!meta && isbn13Valid(meta.eisbn) },
    { title: 'Structure', hint: 'chapters and pages', enabled: !!book && !!cover, done: !!result && step > 2 },
    { title: 'Pictures', hint: 'descriptions', enabled: !!result, done: !!result && todo.length === 0 },
    { title: 'Check & download', hint: 'quality report', enabled: !!result, done: !!report && !stale && errors === 0 },
  ]

  return (
    <div className="flow">
      <Steps steps={steps} at={step} onGo={go} />
      <Status busy={busy} error={error} notice={notice} />

      {step === 0 && (
        <section className="card">
          <h2>1. Add the files</h2>
          <p className="muted">
            For books with no InDesign export — typeset in another program, or only available as Word and PDF. The final print PDF is the source: the tool reads its
            text, fonts, pictures and page numbers and rebuilds the book as an EPUB.
          </p>
          <div className="drops">
            <FileDrop label="Print PDF" hint="the final print PDF of the book" accept="application/pdf" value={pdf} onPick={setPdf} required />
            <FileDrop label="Cover" hint="front cover image, or the print cover spread PDF" accept="image/jpeg,image/png,application/pdf" value={cover} onPick={(c) => (setCover(c), setStale(true))} required />
          </div>
          <Help title="Why the PDF and not the Word file?">
            Word files sent for conversion are often an earlier or partial version. The print PDF is what was actually published, so text, page numbers and pictures come
            from it. Large PDFs take a few minutes: every page is read in this browser, nothing is uploaded.
          </Help>
          <StepNav onNext={onAnalyse} next="Read the PDF" nextDisabled={!pdf || !!busy} />
        </section>
      )}

      {step === 1 && book && meta && (
        <>
          <BookDetails meta={meta} onChange={(m) => (setMeta(m), setStale(true))} note="Read from the title pages and the imprint. Fields in red need a look. Type in the e-book ISBN." />
          <section className="card">
            <h2>Copyright page</h2>
            <p className="muted">
              Built from the print imprint: print-only lines (printer, legal deposit) are removed and the print ISBN is replaced by the e-book ISBN. These lines are added
              for the e-book ({'{year}'} and {'{author}'} are filled in). Leave empty to keep the print wording.
            </p>
            <div className="form">
              <label>
                <span>E-book notice</span>
                <input value={rules.ebookNotice} onChange={(e) => (setRules({ ...rules, ebookNotice: e.target.value }), setStale(true))} />
              </label>
              <label>
                <span>Copyright line</span>
                <input value={rules.copyrightLine} onChange={(e) => (setRules({ ...rules, copyrightLine: e.target.value }), setStale(true))} />
              </label>
            </div>
            <label className="alt" style={{ marginTop: 10 }}>
              <span>Rights statement (replaces the print “no part of this publication…” paragraph)</span>
              <textarea rows={4} value={rules.rightsStatement} onChange={(e) => (setRules({ ...rules, rightsStatement: e.target.value }), setStale(true))} />
            </label>
          </section>
          <StepNav onBack={() => setStep(0)} onNext={() => go(2)} next="Build the e-book" nextDisabled={!!busy || !cover}>
            {!cover ? 'Add the cover in step 1 first.' : ''}
          </StepNav>
        </>
      )}

      {step === 2 && book && result && (
        <section className="card">
          <h2>3. Check the structure</h2>
          <p className="muted">
            The book as a reader will get it, in order, with its printed pages. Click a line to see it. Look for parts with the wrong label, missing titles or chapters
            that are far too short.
          </p>
          {stale && (
            <p className="note warnbox">
              Settings changed. <button onClick={() => rebuild()}>Rebuild</button>
            </p>
          )}
          <Outline sections={result.sections} files={result.files} />
          <details className="advanced">
            <summary>Advanced: what each font and size is used for ({styles.filter((s) => s.unsure).length} guesses to confirm)</summary>
            <p className="muted small">
              {book.pages.length} pages · body text {book.bodyKey} · line spacing {book.lead}pt · paragraph indent {book.step}pt · brand colour{' '}
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
            <div className="row">
              <button onClick={() => rebuild()} disabled={!!busy}>Rebuild with these settings</button>
            </div>
          </details>
          <StepNav onBack={() => setStep(1)} onNext={() => setStep(3)} />
        </section>
      )}

      {step === 3 && result && <Pictures result={result} alt={alt} setAlt={(a) => (setAlt(a), setStale(true))} onBack={() => setStep(2)} onNext={() => rebuild(4)} busy={!!busy} todo={todo.length} />}

      {step === 4 && result && report && meta && (
        <section className="card">
          <h2>5. Check and download</h2>
          {stale && (
            <p className="note warnbox">
              Settings changed since this check. <button onClick={() => rebuild()}>Build and check again</button>
            </p>
          )}
          <CheckReportView report={report} review={result.review} />
          <div className="row">
            <DeliverButton data={result.epub} name={`${meta.eisbn ? meta.eisbn.replace(/[^\dXx]/g, '') : meta.title || 'book'}.epub`} type="application/epub+zip" errors={errors} label="Download EPUB" />
          </div>
          <Help title="What happens after download?">
            Run EPUBCheck (file validity) and Ace by DAISY (accessibility) as the final check before delivery, and look through the book in a reader such as Apple Books
            or Thorium.
          </Help>
          <h3>Preview</h3>
          <Outline sections={result.sections} files={result.files} />
        </section>
      )}
    </div>
  )
}

function Pictures({ result, alt, setAlt, onBack, onNext, busy, todo }: { result: PdfBuildResult; alt: Record<string, string>; setAlt: (a: Record<string, string>) => void; onBack: () => void; onNext: () => void; busy: boolean; todo: number }) {
  const [filter, setFilter] = useState<'todo' | 'all'>(todo ? 'todo' : 'all')
  const urls = useObjectUrls(useMemo(() => result.pictures.map((p) => [p.path, result.files.get(`OEBPS/${p.path}`)!] as [string, Uint8Array]), [result]), 'image/jpeg')
  const shown = filter === 'todo' ? result.pictures.filter((p) => !alt[p.path] || alt[p.path] === p.caption) : result.pictures
  return (
    <section className="card">
      <h2>4. Describe the pictures</h2>
      <p className="muted">
        People who cannot see the pictures hear this description instead (“alt text”). Captions were used as a starting point; {todo} of {result.pictures.length} still
        need a real description — what the picture shows, in a sentence or two.
      </p>
      <div className="row">
        <label>
          <input type="radio" checked={filter === 'todo'} onChange={() => setFilter('todo')} /> Needs a description ({todo})
        </label>
        <label>
          <input type="radio" checked={filter === 'all'} onChange={() => setFilter('all')} /> All ({result.pictures.length})
        </label>
      </div>
      <div className="images pics">
        {shown.map((p) => (
          <div key={p.path} className="img-row">
            <img src={urls.get(p.path)} alt="" loading="lazy" />
            <div>
              <code>{p.path.replace('images/', '')}</code>
              {p.caption && <div className="why">Caption: {p.caption}</div>}
              <label className="alt">
                <span>Description</span>
                <textarea rows={2} value={alt[p.path] ?? ''} onChange={(e) => setAlt({ ...alt, [p.path]: e.target.value })} />
              </label>
            </div>
          </div>
        ))}
      </div>
      <StepNav onBack={onBack} onNext={onNext} next="Build and check" nextDisabled={busy}>
        {todo ? `${todo} picture(s) still need a description.` : ''}
      </StepNav>
    </section>
  )
}
