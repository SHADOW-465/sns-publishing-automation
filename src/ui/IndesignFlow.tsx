import { useMemo, useState } from 'react'
import { FileDrop, type Picked } from './FileDrop.tsx'
import { BookDetails, download, remember, useObjectUrls } from './shared.tsx'
import { Steps, StepNav, Help, Status, Outline, CheckReportView, DeliverButton, ComparePrint, flaggedPages } from './wizard.tsx'
import { unzip } from '../engine/zip.ts'
import { analyze, build, type Analysis, type BuildResult, type ImageChoice } from '../engine/indesign/build.ts'
import { ROLES, ROLE_HELP, type Profile, type Role, type StyleInfo } from '../engine/indesign/read.ts'
import { checkEpub, type CheckReport } from '../engine/check/epub.ts'
import { isbn13Valid, type BookMeta } from '../engine/epub/package.ts'
import type { SectionType } from '../engine/epub/locale.ts'
import type { PrintPage } from '../engine/pdf/pages.ts'

const toProfile = (styles: StyleInfo[]): Profile => Object.fromEntries(styles.map((s) => [s.key, { role: s.role, outClass: s.outClass }]))

// InDesign EPUB export → finished, accessible EPUB 3, in five steps.

export function IndesignFlow() {
  const [step, setStep] = useState(0)
  const [exp, setExp] = useState<Picked>()
  const [cover, setCover] = useState<Picked>()
  const [pdf, setPdf] = useState<Picked>()
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const [analysis, setAnalysis] = useState<Analysis>()
  const [printPages, setPrintPages] = useState<PrintPage[]>()
  const [styles, setStyles] = useState<StyleInfo[]>([])
  const [meta, setMeta] = useState<BookMeta>()
  const [images, setImages] = useState<ImageChoice[]>([])
  const [result, setResult] = useState<BuildResult>()
  const [report, setReport] = useState<CheckReport>()
  const [stale, setStale] = useState(true)
  const [types, setTypes] = useState<Record<number, SectionType>>({})

  const thumbs = useObjectUrls(useMemo(() => [...(analysis?.ex.images ?? [])], [analysis]))

  const run = async (label: string, fn: () => Promise<void> | void) => {
    setBusy(label)
    setError(undefined)
    await new Promise((r) => setTimeout(r, 30)) // let the status line paint
    try {
      await fn()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(undefined)
    }
  }

  const onAnalyse = () =>
    run('Reading the InDesign export…', async () => {
      const files = unzip(exp!.data)
      let a = analyze(files)
      const saved = remember<Profile>('profile', a.meta.publisher)
      if (saved) {
        a = analyze(files, saved)
        setNotice(`Applied the style settings saved for “${a.meta.publisher}”.`)
      } else setNotice(undefined)
      setAnalysis(a)
      setStyles(a.styles)
      setMeta(a.meta)
      setImages(a.images)
      setResult(undefined)
      setTypes({})
      setStale(true)
      if (pdf) {
        setBusy('Reading the print PDF (page numbers)…')
        const { printPagesOf } = await import('./pdf.ts') // pdf.js is large: load it only when needed
        setPrintPages(await printPagesOf(pdf.data))
      } else setPrintPages(undefined)
      setStep(1)
    })

  /** builds the EPUB (fast) and runs the quality check on it */
  const rebuild = (then?: number) =>
    run('Building the e-book and checking it…', () => {
      const r = build(analysis!, { styles, meta: meta!, images, cover: cover ? { name: cover.name, data: cover.data } : undefined, printPages, sectionTypes: types })
      setResult(r)
      setReport(checkEpub(r.files, r.source))
      setStale(false)
      remember('profile', meta!.publisher, toProfile(styles))
      if (then !== undefined) setStep(then)
    })
  const go = (i: number) => (i >= 2 && (stale || !result) ? rebuild(i) : setStep(i))
  const changed = <T,>(set: (v: T) => void) => (v: T) => (set(v), setStale(true))

  const setStyle = (key: string, patch: Partial<StyleInfo>) => (setStyles((s) => s.map((x) => (x.key === key ? { ...x, ...patch, unsure: false } : x))), setStale(true))
  const setImage = (im: ImageChoice, patch: Partial<ImageChoice>) => (setImages(images.map((x) => (x === im ? { ...x, ...patch } : x))), setStale(true))
  const importProfile = async (f: Picked) => {
    const p = JSON.parse(new TextDecoder().decode(f.data)) as Profile
    setStyles((s) => s.map((x) => (p[x.key] ? { ...x, ...p[x.key], unsure: false, reason: 'from imported profile' } : x)))
    setStale(true)
  }

  const inline = images.filter((i) => i.placement !== 'drop')
  const needAlt = inline.filter((i) => !i.alt.trim() && !i.decorative)
  const errors = (report?.errors ?? 0) + (result?.review.filter((r) => r.level === 'error').length ?? 0)
  const steps = [
    { title: 'Files', hint: 'what you start from', enabled: true, done: !!analysis },
    { title: 'Book details', hint: 'title, author, ISBN', enabled: !!analysis, done: !!meta && isbn13Valid(meta.eisbn) },
    { title: 'Structure', hint: 'chapters and pages', enabled: !!analysis, done: !!result && step > 2 },
    { title: 'Pictures', hint: 'descriptions', enabled: !!analysis, done: !!analysis && needAlt.length === 0 },
    { title: 'Check & download', hint: 'quality report', enabled: !!analysis, done: !!report && !stale && errors === 0 },
  ]

  return (
    <div className="flow">
      <Steps steps={steps} at={step} onGo={go} />
      <Status busy={busy} error={error} notice={notice} />

      {step === 0 && (
        <section className="card">
          <h2>1. Add the files</h2>
          <p className="muted">
            Start from the EPUB that InDesign exports (<em>File › Export › EPUB (Reflowable)</em>). It holds the text and styles, but it is not ready to sell: this tool
            cleans it up and makes it accessible.
          </p>
          <div className="drops">
            <FileDrop label="InDesign EPUB export" hint="the .epub (or .zip) InDesign made" accept=".zip,.epub" value={exp} onPick={setExp} required />
            <FileDrop label="Cover image" hint="final front cover, JPG or PNG, 1600×2560 px ideal" accept="image/jpeg,image/png" value={cover} onPick={changed(setCover)} required />
            <FileDrop label="Print PDF (recommended)" hint="the printed book: used to check every page number" accept="application/pdf" value={pdf} onPick={setPdf} />
          </div>
          <Help title="Why these files?">
            <ul>
              <li><strong>InDesign export</strong> — the book text. InDesign’s export has leftovers (file names as titles, empty links, unneeded bold/italic, missing page numbers) that people used to fix by hand.</li>
              <li><strong>Cover</strong> — the export only has a placeholder cover.</li>
              <li><strong>Print PDF</strong> — e-books carry the printed page numbers (“go to page 45”), so classes and citations match the paper book. The PDF lets the tool put back any InDesign dropped and check all of them.</li>
            </ul>
            Nothing is uploaded: the files are read in this browser.
          </Help>
          <StepNav onNext={onAnalyse} next="Read the files" nextDisabled={!exp || !!busy}>
            {!exp ? 'Add the InDesign export to start.' : !cover ? 'You can add the cover later, before building.' : ''}
          </StepNav>
        </section>
      )}

      {step === 1 && analysis && meta && (
        <>
          <BookDetails meta={meta} onChange={changed(setMeta)} sources={analysis.sources} note="Read from the book’s own title and copyright pages. Fields in red need a look. The e-book ISBN is never in the InDesign file — type it in." />
          <Help title="Where are these used?">
            Stores (Apple Books, Amazon, Google Play), library systems and reading apps show these details, and screen readers announce the title and language.
            The language decides the voice a screen reader uses. The print ISBN names the paper edition the page numbers come from.
          </Help>
          <StepNav onBack={() => setStep(0)} onNext={() => go(2)} nextDisabled={!!busy}>
            {!isbn13Valid(meta.eisbn) ? 'The e-book ISBN is still missing — you can add it later.' : ''}
          </StepNav>
        </>
      )}

      {step === 2 && analysis && result && (
        <section className="card">
          <h2>3. Check the structure</h2>
          <p className="muted">
            This is the book as a reader will get it: each line is one part of the e-book, in reading order, with its printed pages. Click a line to see it. If a
            part has the wrong label (a dedication marked as a chapter), change it in its drop-down and update the preview. Also look for missing titles or chapters
            that are far too short.
          </p>
          {stale && (
            <p className="note warnbox">
              Settings changed. <button onClick={() => rebuild()}>Update the preview</button>
            </p>
          )}
          <Outline sections={result.sections} files={result.files} onType={(i, t) => (setTypes({ ...types, [i]: t as SectionType }), setStale(true))} />
          <details className="advanced">
            <summary>Advanced: how the InDesign styles are read ({styles.filter((s) => s.unsure).length} guesses to confirm)</summary>
            <p className="muted small">
              Each InDesign paragraph style and what it becomes. The structure above comes from this table. If a part is wrong, change the meaning of its style here and update
              the preview. Choices are remembered for this publisher.
            </p>
            <StyleTable styles={styles} setStyle={setStyle} />
            <div className="row">
              <button onClick={() => download(JSON.stringify(toProfile(styles), null, 2), `${meta?.publisher || 'publisher'}-styles.json`, 'application/json')}>Save settings to a file</button>
              <label className="button">
                Load settings from a file
                <input type="file" accept=".json" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) await importProfile({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) }) }} />
              </label>
              <button onClick={() => rebuild()} disabled={!!busy}>Update the preview</button>
            </div>
          </details>
          <StepNav onBack={() => setStep(1)} onNext={() => go(3)} nextDisabled={!!busy} />
        </section>
      )}

      {step === 3 && analysis && (
        <section className="card">
          <h2>4. Describe the pictures</h2>
          <p className="muted">
            People who cannot see the pictures hear this description instead (“alt text”). Say what the picture shows and why it matters, in a sentence or two. Tick
            “decorative” only for ornaments that carry no information.
          </p>
          {images.length === 0 && <p className="muted">This book has no pictures besides the cover.</p>}
          <div className="images">
            {images.map((im) => (
              <div key={im.src} className={`img-row ${im.placement !== 'drop' && !im.alt.trim() && !im.decorative ? 'todo' : ''}`}>
                <img src={thumbs.get(im.src)} alt="" />
                <div>
                  <code>{im.src.split('/').pop()}</code> <span className="muted small">{im.width}×{im.height}</span>
                  <select value={im.placement} onChange={(e) => setImage(im, { placement: e.target.value as ImageChoice['placement'] })}>
                    <option value="inline">Keep where it is in the text</option>
                    <option value="logo">Publisher logo on the title page</option>
                    <option value="drop">Leave out (back cover, print-only)</option>
                  </select>
                  {im.placement !== 'drop' && (
                    <>
                      <label className="alt">
                        <span>Description</span>
                        <textarea rows={2} value={im.alt} disabled={im.decorative} placeholder="e.g. Black-and-white photo of … at …, 1968" onChange={(e) => setImage(im, { alt: e.target.value })} />
                      </label>
                      <label className="small">
                        <input type="checkbox" checked={!!im.decorative} onChange={(e) => setImage(im, { decorative: e.target.checked })} /> Decorative only (screen readers skip it)
                      </label>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
          <StepNav onBack={() => setStep(2)} onNext={() => rebuild(4)} next="Build and check" nextDisabled={!!busy}>
            {needAlt.length ? `${needAlt.length} picture(s) still need a description.` : ''}
          </StepNav>
        </section>
      )}

      {step === 4 && analysis && result && report && meta && (
        <section className="card">
          <h2>5. Check and download</h2>
          {!cover && <p className="err box">No cover uploaded: the placeholder from InDesign was used. Add the real cover in step 1.</p>}
          {stale && (
            <p className="note warnbox">
              Settings changed since this check. <button onClick={() => rebuild()}>Build and check again</button>
            </p>
          )}
          <CheckReportView report={report} review={result.review} />
          <div className="row">
            <DeliverButton data={result.epub} name={`${meta.eisbn ? meta.eisbn.replace(/[^\dXx]/g, '') : meta.title || 'book'}.epub`} type="application/epub+zip" errors={errors} label="Download EPUB" />
            <button onClick={() => rebuild()} disabled={!!busy}>Build and check again</button>
          </div>
          <Help title="What happens after download?">
            The built-in check covers the common problems. For delivery, run EPUBCheck (file validity) and Ace by DAISY (accessibility) once more — the stores run the same
            validator — and look through the book in a reader such as Apple Books or Thorium.
          </Help>
          {pdf && printPages ? (
            <>
              <h3>Compare with the print book</h3>
              <p className="muted small">The printed page next to the same page of the e-book. Pages the check flagged come first.</p>
              <ComparePrint files={result.files} pages={printPages} pdf={pdf.data} flagged={flaggedPages(report)} />
            </>
          ) : (
            <p className="muted small">Add the print PDF in step 1 to compare every page with the print book.</p>
          )}
          <h3>Preview</h3>
          <Outline sections={result.sections} files={result.files} />
        </section>
      )}
    </div>
  )
}

function StyleTable({ styles, setStyle }: { styles: StyleInfo[]; setStyle: (key: string, patch: Partial<StyleInfo>) => void }) {
  return (
    <div className="table-wrap">
      <table className="styles">
        <thead>
          <tr>
            <th>InDesign style</th>
            <th>Uses</th>
            <th>Example</th>
            <th>Becomes</th>
            <th>CSS class</th>
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
              <td className="sample">{s.samples[0] ?? <em>(empty)</em>}</td>
              <td>
                <select value={s.role} onChange={(e) => setStyle(s.key, { role: e.target.value as Role })} title={ROLE_HELP[s.role]}>
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {ROLE_HELP[r]}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <input className="cls" value={s.outClass} onChange={(e) => setStyle(s.key, { outClass: e.target.value.replace(/[^\w-]/g, '') })} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
