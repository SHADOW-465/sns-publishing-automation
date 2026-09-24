import { useMemo, useState } from 'react'
import { FileDrop, type Picked } from './FileDrop.tsx'
import { BookDetails, Result, download, remember, useObjectUrls } from './shared.tsx'
import { unzip } from '../engine/zip.ts'
import { analyze, build, type Analysis, type BuildResult, type ImageChoice } from '../engine/indesign/build.ts'
import { ROLES, ROLE_HELP, type Profile, type Role, type StyleInfo } from '../engine/indesign/read.ts'
import type { BookMeta } from '../engine/epub/package.ts'
import type { PrintPage } from '../engine/pdf/pages.ts'

const toProfile = (styles: StyleInfo[]): Profile => Object.fromEntries(styles.map((s) => [s.key, { role: s.role, outClass: s.outClass }]))

export function IndesignFlow() {
  const [exp, setExp] = useState<Picked>()
  const [cover, setCover] = useState<Picked>()
  const [pdf, setPdf] = useState<Picked>()
  const [busy, setBusy] = useState<string>()
  const [error, setError] = useState<string>()
  const [analysis, setAnalysis] = useState<Analysis>()
  const [printPages, setPrintPages] = useState<PrintPage[]>()
  const [styles, setStyles] = useState<StyleInfo[]>([])
  const [meta, setMeta] = useState<BookMeta>()
  const [images, setImages] = useState<ImageChoice[]>([])
  const [result, setResult] = useState<BuildResult>()
  const [notice, setNotice] = useState<string>()

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
        setNotice(`Applied the saved style profile for “${a.meta.publisher}”.`)
      } else setNotice(undefined)
      setAnalysis(a)
      setStyles(a.styles)
      setMeta(a.meta)
      setImages(a.images)
      setResult(undefined)
      if (pdf) {
        setBusy('Reading the print PDF (page numbers)…')
        const { printPagesOf } = await import('./pdf.ts') // pdf.js is large: load it only when needed
        setPrintPages(await printPagesOf(pdf.data))
      } else setPrintPages(undefined)
    })

  const onBuild = () =>
    run('Building the EPUB…', () => {
      setResult(build(analysis!, { styles, meta: meta!, images, cover: cover ? { name: cover.name, data: cover.data } : undefined, printPages }))
      remember('profile', meta!.publisher, toProfile(styles))
    })

  const setStyle = (key: string, patch: Partial<StyleInfo>) => setStyles((s) => s.map((x) => (x.key === key ? { ...x, ...patch, unsure: false } : x)))
  const importProfile = async (f: Picked) => {
    const p = JSON.parse(new TextDecoder().decode(f.data)) as Profile
    setStyles((s) => s.map((x) => (p[x.key] ? { ...x, ...p[x.key], unsure: false, reason: 'from imported profile' } : x)))
  }

  return (
    <div className="flow">
      <section className="card">
        <h2>1. Files</h2>
        <div className="drops">
          <FileDrop label="InDesign EPUB export" hint="the .zip / .epub InDesign exported" accept=".zip,.epub" value={exp} onPick={setExp} required />
          <FileDrop label="Cover image" hint="final front cover, .jpg or .png" accept="image/jpeg,image/png" value={cover} onPick={setCover} required />
          <FileDrop label="Print PDF" hint="optional — restores missing page numbers" accept="application/pdf" value={pdf} onPick={setPdf} />
        </div>
        <button className="primary" disabled={!exp || !!busy} onClick={onAnalyse}>
          Analyse
        </button>
      </section>

      {busy && <p className="busy" role="status">{busy}</p>}
      {error && <p className="err" role="alert">{error}</p>}
      {notice && <p className="note">{notice}</p>}

      {analysis && meta && (
        <>
          <BookDetails meta={meta} onChange={setMeta} note="Pre-filled from the export. The e-book ISBN is never in the InDesign file — type it in." />

          <section className="card">
            <h2>Paragraph styles</h2>
            <p className="muted">
              What each InDesign style means in the EPUB. Rows marked <span className="flag">check</span> are guesses — confirm them. Your choices are remembered for this publisher.
            </p>
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
            <div className="row">
              <button onClick={() => download(JSON.stringify(toProfile(styles), null, 2), `${meta.publisher || 'publisher'}-styles.json`, 'application/json')}>Export profile</button>
              <label className="button">
                Import profile
                <input type="file" accept=".json" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) await importProfile({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) }) }} />
              </label>
            </div>
          </section>

          <section className="card">
            <h2>Images</h2>
            {images.length === 0 && <p className="muted">No images besides the cover.</p>}
            <div className="images">
              {images.map((im) => (
                <div key={im.src} className="img-row">
                  <img src={thumbs.get(im.src)} alt="" />
                  <div>
                    <code>{im.src.split('/').pop()}</code> <span className="muted">{im.width}×{im.height}</span>
                    <select value={im.placement} onChange={(e) => setImages(images.map((x) => (x === im ? { ...x, placement: e.target.value as ImageChoice['placement'] } : x)))}>
                      <option value="inline">Keep where it is in the text</option>
                      <option value="logo">Publisher logo on the title page</option>
                      <option value="drop">Leave out (back cover, print-only)</option>
                    </select>
                    {im.placement !== 'drop' && (
                      <label className="alt">
                        <span>Alt text (what the image shows)</span>
                        <input value={im.alt} onChange={(e) => setImages(images.map((x) => (x === im ? { ...x, alt: e.target.value } : x)))} />
                      </label>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="card">
            <h2>Build</h2>
            {!cover && <p className="err small">Add the cover image first (the InDesign export only has a placeholder).</p>}
            {!pdf && <p className="muted">Tip: add the print PDF so page numbers InDesign skipped are restored.</p>}
            <button className="primary" disabled={!!busy || !cover} onClick={onBuild}>
              Build EPUB
            </button>
          </section>
        </>
      )}

      {result && meta && <Result result={result} meta={meta} />}
    </div>
  )
}
