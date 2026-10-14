import { useMemo, useState } from 'react'
import { FileDrop, type Picked } from './FileDrop.tsx'
import { BookDetails, remember, useObjectUrls } from './shared.tsx'
import { Steps, StepNav, Help, Status, Outline, CheckReportView, DeliverButton, ComparePrint, flaggedPages, useConfirmNext } from './wizard.tsx'
import { reviewList } from '../engine/review/confidence.ts'
import type { PrintPage } from '../engine/pdf/pages.ts'
import { browserRaster } from './raster-browser.ts'
import { PDF_ROLES, PDF_ROLE_HELP, type PdfBook, type PdfProfile, type PdfRole, type PdfStyleInfo } from '../engine/pdfepub/analyze.ts'
import type { PdfBuildResult } from '../engine/pdfepub/build.ts'
import { rulesFor, type CopyrightRules } from '../engine/epub/imprint.ts'
import { checkEpub, type CheckReport } from '../engine/check/epub.ts'
import { deliveryCounts } from '../engine/check/counts.ts'
import { isbn13Valid, type BookMeta } from '../engine/epub/package.ts'
import { ALT_SOURCE_LABEL, isPlaceholderAlt, type SpecPicture } from '../engine/epub/alt.ts'
import { draftPictureAlts, mimeOf, visionConfig } from '../engine/epub/alt-ai.ts'
import { readRequirements } from '../engine/spec/requirements.ts'
import type { WordBook } from '../engine/wordepub/read.ts'

// Print PDF, or a Word manuscript read from its heading styles, → EPUB 3. A .docx is the source when
// one is attached; otherwise the print PDF is. The cover is a JPG or PNG. The vision key stays in Settings.

type AiDraft = { alt: string; approved: boolean }
type Over = { alt?: Record<string, string>; ai?: Record<string, AiDraft>; pictures?: SpecPicture[] }

const emptyMeta = (b: { title: string; authors: string; publisher: string; language: string }): BookMeta => ({
  title: b.title,
  subtitle: '',
  authors: b.authors,
  publisher: b.publisher,
  language: b.language || 'en',
  eisbn: '',
  printIsbn: '',
  rights: '',
  certifiedBy: '',
  conformsTo: '',
})

export function PdfFlow() {
  const [step, setStep] = useState(0)
  const [pdf, setPdf] = useState<Picked>()
  const [docx, setDocx] = useState<Picked>()
  const [cover, setCover] = useState<Picked>()
  const [busy, setBusy] = useState<string>()
  const [progress, setProgress] = useState<{ done: number; total: number }>()
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const [book, setBook] = useState<PdfBook>()
  const [wordBook, setWordBook] = useState<WordBook>()
  const [styles, setStyles] = useState<PdfStyleInfo[]>([])
  const [meta, setMeta] = useState<BookMeta>()
  const [rules, setRules] = useState<CopyrightRules>(rulesFor('en'))
  const [result, setResult] = useState<PdfBuildResult>()
  const [report, setReport] = useState<CheckReport>()
  const [alt, setAlt] = useState<Record<string, string>>({})
  const [ai, setAi] = useState<Record<string, AiDraft>>({})
  const [specPictures, setSpecPictures] = useState<SpecPicture[]>([])
  const [stale, setStale] = useState(true)
  const [layout, setLayout] = useState<PrintPage[]>()
  const [navs, setNavs] = useState<Record<number, string>>({})

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label)
    setProgress(undefined)
    setError(undefined)
    await new Promise((r) => setTimeout(r, 30))
    try {
      await fn()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(undefined)
      setProgress(undefined)
    }
  }

  const onAnalyse = () =>
    run(docx ? 'Reading the Word manuscript…' : 'Loading the PDF reader…', async () => {
      setResult(undefined)
      setLayout(undefined)
      setAlt({})
      setAi({})
      setSpecPictures([])
      setNavs({})
      setStale(true)
      if (docx) {
        const { readWordBook } = await import('../engine/wordepub/read.ts')
        const wb = readWordBook(docx.data)
        const savedRules = remember<CopyrightRules>('copyright', wb.publisher)
        setWordBook(wb)
        setBook(undefined)
        setStyles([])
        setRules(savedRules ?? rulesFor(wb.language))
        setMeta(emptyMeta(wb))
        setNotice(wb.toc.length ? `Read ${wb.toc.length} contents entries. Chapters follow that list.` : 'No contents list in the manuscript: every Heading 1 starts a chapter.')
        setStep(1)
        return
      }
      const { pdfjs } = await import('./pdf.ts')
      const { analyzePdf } = await import('../engine/pdfepub/analyze.ts')
      const b = await analyzePdf(pdfjs, pdf!.data, browserRaster, {}, (done, total) => {
        setBusy(`Reading page ${done} of ${total} (text, fonts and pictures)…`)
        setProgress({ done, total })
      }, { splitSpreads: true })
      const saved = remember<PdfProfile>('pdfprofile', b.meta.publisher)
      const savedRules = remember<CopyrightRules>('copyright', b.meta.publisher)
      setWordBook(undefined)
      setStyles(b.styles.map((s) => (saved?.[s.key] ? { ...s, role: saved[s.key], unsure: false, reason: 'from saved publisher settings' } : s)))
      setRules(savedRules ?? rulesFor(b.meta.language))
      setNotice(saved ? `Applied the settings saved for “${b.meta.publisher}”.` : undefined)
      setBook(b)
      setMeta(b.meta)
      setStep(1)
    })

  const rebuild = async (then?: number, over?: Over) => {
    const altNow = over?.alt ?? alt
    const aiNow = over?.ai ?? ai
    const picsNow = over?.pictures ?? specPictures
    let coverImg = cover
    if (!coverImg) throw new Error('A cover image is required (JPG or PNG).')
    if (book && cover && /\.pdf$/i.test(cover.name)) {
      setBusy('Cutting the front cover out of the cover PDF…')
      const { pdfjs } = await import('./pdf.ts')
      const { coverFromSpread } = await import('../engine/pdfepub/cover.ts')
      coverImg = { name: 'cover.jpg', data: await coverFromSpread(pdfjs, cover.data, book.pages[0], browserRaster, []) }
    }
    setBusy('Building the e-book…')
    setProgress({ done: 0, total: 2 })
    await new Promise((r) => setTimeout(r, 30))
    let r: PdfBuildResult
    if (wordBook) {
      const { buildWordEpub } = await import('../engine/wordepub/build.ts')
      r = buildWordEpub(wordBook, { meta: meta!, cover: { name: coverImg.name, data: coverImg.data }, alt: altNow, pictures: picsNow, ai: aiNow, sectionNav: navs })
    } else {
      const { buildPdfEpub } = await import('../engine/pdfepub/build.ts')
      r = await buildPdfEpub(book!, { styles, meta: meta!, rules, cover: coverImg, alt: altNow, pictures: picsNow, ai: aiNow, sectionNav: navs }, browserRaster)
    }
    setResult(r)
    // `alt` stays the reviewer's own text. Copying the resolved description in here would make the
    // next build treat a spec row, an image-file text, or an AI draft as something the reviewer typed.
    setProgress({ done: 1, total: 2 })
    let lay = layout
    if (pdf && !lay) {
      const { printPagesOf } = await import('./pdf.ts')
      setLayout((lay = await printPagesOf(pdf.data, (done, total) => {
        setBusy(`Reading the print PDF, page ${done} of ${total}…`)
        setProgress({ done, total })
      })))
    }
    setBusy('Checking the e-book…')
    setProgress({ done: 2, total: 2 })
    setReport(checkEpub(r.files, { ...r.source, printLayout: lay }))
    setStale(false)
    if (book) remember('pdfprofile', meta!.publisher, Object.fromEntries(styles.map((s) => [s.key, s.role])))
    remember('copyright', meta!.publisher, rules)
    if (then !== undefined) setStep(then)
  }
  const buildAnd = (then?: number, over?: Over) => run('Building the e-book…', () => rebuild(then, over))
  const go = (i: number) => (i >= 2 && (stale || !result) ? buildAnd(i) : setStep(i))
  const setRole = (key: string, role: PdfRole) => (setStyles((s) => s.map((x) => (x.key === key ? { ...x, role, unsure: false } : x))), setStale(true))

  const ready = !!book || !!wordBook
  const structurePending = result && meta
    ? reviewList({
        styles: styles.map((s) => ({ ...s, outClass: '', role: 'p' as const, unsure: s.unsure, reason: s.reason })),
        sources: {},
        meta,
        sections: result.sections.map((s, i) => ({ type: s.type, nav: (navs[i] ?? '').trim() || s.nav })),
        notes: [],
      }).items.filter((it) => it.area !== 'note').length
    : 0
  const structureNext = useConfirmNext(structurePending, () => setStep(3))
  const todo = result ? result.pictures.filter((p) => needsPictureDescription(p, alt)) : []
  const pendingAi = result ? result.pictures.filter((p) => p.source === 'ai' && !p.approved && !!p.alt.trim() && !isPlaceholderAlt(p.alt)) : []
  const visionOn = !!visionConfig().apiKey.trim()
  const errors = report ? deliveryCounts(report, result?.review ?? []).errors : 0
  const steps = [
    { title: 'Files', hint: wordBook ? 'Word manuscript and cover' : 'print PDF and cover', enabled: true, done: ready },
    { title: 'Book details', hint: 'title, ISBN, copyright', enabled: ready, done: !!meta && isbn13Valid(meta.eisbn) },
    { title: 'Structure', hint: 'chapters and pages', enabled: ready && !!cover, done: !!result && step > 2 },
    { title: 'Pictures', hint: 'descriptions', enabled: !!result, done: !!result && todo.length === 0 },
    { title: 'Check & download', hint: 'quality report', enabled: !!result, done: !!report && !stale && errors === 0 },
  ]

  const draftPictures = (paths: string[]) =>
    run(paths.length === 1 ? 'Drafting a description…' : 'Drafting picture descriptions…', async () => {
      if (!result) return
      const targets = result.pictures.filter((p) => paths.includes(p.path))
      const drafted = await draftPictureAlts(
        targets.map((p) => {
          const bytes = result.files.get(`OEBPS/${p.path}`) ?? new Uint8Array()
          return { id: p.path, bytes, mime: mimeOf(p.path, bytes), caption: p.caption, nearby: '' }
        }),
        meta?.language || wordBook?.language || book?.meta.language || 'en',
        visionConfig(),
        (done, total) => setProgress({ done, total }),
      )
      const next = { ...ai }
      for (const d of drafted) if (d.alt) next[d.id] = { alt: d.alt, approved: false }
      setAi(next)
      const failed = drafted.filter((d) => d.error)
      setNotice(failed[0]?.error ?? `Drafted ${drafted.filter((d) => d.alt).length} description(s). Each one needs approval.`)
      await rebuild(undefined, { ai: next })
    })

  const approve = (paths: string[]) => {
    if (!result) return
    const next = { ...ai }
    for (const id of paths) {
      const cur = next[id]?.alt || result.pictures.find((p) => p.path === id)?.alt || ''
      next[id] = { alt: cur, approved: true }
    }
    setAi(next)
    buildAnd(undefined, { ai: next })
  }

  const loadPictureSheet = (file: File) =>
    run('Reading the picture sheet…', async () => {
      const { pictures } = readRequirements(file.name, new Uint8Array(await file.arrayBuffer()))
      if (!pictures?.length) {
        setNotice('That file has no picture-description sheet. It needs a file-name column and an alt-text column.')
        return
      }
      setSpecPictures(pictures)
      setNotice(`Loaded ${pictures.length} picture description${pictures.length === 1 ? '' : 's'} from ${file.name}. A typed description still wins.`)
      await rebuild(undefined, { pictures })
    })

  return (
    <div className="flow">
      <Steps steps={steps} at={step} onGo={go} />
      <Status busy={busy} error={error} notice={notice} progress={progress} />

      {step === 0 && (
        <section className="card">
          <h2>1. Add the files</h2>
          <p className="muted">
            Start from a Word manuscript when you have one: chapters come from its heading styles and its own contents list. When there is no Word file, the final print PDF is the source.
          </p>
          <div className="drops">
            <FileDrop label="Word manuscript" hint="a .docx — heading styles become the chapters" accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document" value={docx} onPick={setDocx} />
            <FileDrop label="Print PDF" hint={docx ? 'optional — compare the e-book with the printed pages' : 'the final print PDF of the book'} accept="application/pdf" value={pdf} onPick={setPdf} required={!docx} />
            <FileDrop label="Cover image" hint="front cover, JPG or PNG" accept="image/jpeg,image/png" value={cover} onPick={(c) => (setCover(c), setStale(true))} required />
          </div>
          <Help title="Word manuscript or print PDF?">
            <ul>
              <li><strong>Word</strong> — the chapters are the Heading 1 styles (Überschrift 1, Titre 1, and the same styles in other languages) that the book’s own contents list names. Lists, tables and page breaks are kept. A paragraph marked “run on”, or one that continues a sentence, joins the line above.</li>
              <li><strong>Print PDF</strong> — used when there is no Word file. Text, fonts, pictures and page numbers are read from the published pages. Attach it beside a Word file only to compare those pages afterwards.</li>
              <li><strong>Cover</strong> — a JPG or PNG. The manuscript does not include the final cover.</li>
            </ul>
            Nothing is uploaded: the files are read in this browser.
          </Help>
          <StepNav onNext={onAnalyse} next={docx ? 'Read the Word file' : 'Read the PDF'} nextDisabled={(!pdf && !docx) || !!busy} />
        </section>
      )}

      {step === 1 && ready && meta && (
        <>
          <BookDetails
            meta={meta}
            onChange={(m) => (setMeta(m), setStale(true))}
            certifyBlocked={pendingAi.length > 0}
            note={wordBook ? 'Title and author are read from the Word file. The e-book ISBN is not in the manuscript — type it in.' : 'Read from the title pages and the imprint. Fields in red need a look. Type in the e-book ISBN.'}
          />
          {book && (
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
          )}
          <StepNav onBack={() => setStep(0)} onNext={() => go(2)} next="Build the e-book" nextDisabled={!!busy || !cover}>
            {!cover ? 'Add the cover in step 1 first.' : ''}
          </StepNav>
        </>
      )}

      {step === 2 && ready && result && (
        <section className="card">
          <h2>3. Check the structure</h2>
          <p className="muted">
            The book as a reader will get it, in order, with its printed pages. Click a line to see it. Look for parts with the wrong label, missing titles or chapters
            that are far too short.
          </p>
          {stale && (
            <p className="note warnbox">
              Settings changed. <button onClick={() => buildAnd()}>Rebuild</button>
            </p>
          )}
          <Outline sections={result.sections} files={result.files} titles={navs} onTitle={(i, t) => (setNavs({ ...navs, [i]: t }), setStale(true))} />
          {book && (
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
                <button onClick={() => buildAnd()} disabled={!!busy}>Rebuild with these settings</button>
              </div>
            </details>
          )}
          {structureNext.asked && (
            <p className="note warnbox" role="status">
              {structurePending} item{structurePending === 1 ? '' : 's'} still need a look: a missing title, an unknown part, or a guess. Check the list, or continue anyway.
            </p>
          )}
          <StepNav onBack={() => setStep(1)} onNext={structureNext.onNext} next={structureNext.next} />
        </section>
      )}

      {step === 3 && result && (
        <Pictures
          result={result}
          alt={alt}
          setAlt={(a) => (setAlt(a), setStale(true))}
          onBack={() => setStep(2)}
          onNext={() => buildAnd(4)}
          busy={!!busy}
          todo={todo.length}
          pending={pendingAi.length}
          visionOn={visionOn}
          onDraft={() => draftPictures(todo.map((p) => p.path))}
          onDraftOne={(path) => draftPictures([path])}
          onApprove={(path) => approve([path])}
          onApproveAll={() => approve(pendingAi.map((p) => p.path))}
          onSheet={loadPictureSheet}
        />
      )}

      {step === 4 && result && report && meta && (
        <section className="card">
          <h2>5. Check and download</h2>
          {stale && (
            <p className="note warnbox">
              Settings changed since this check. <button onClick={() => buildAnd()}>Build and check again</button>
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
          {layout && pdf && (
            <>
              <h3>Compare with the print book</h3>
              <p className="muted small">The printed page next to the same page of the e-book. Pages the check flagged come first.</p>
              <ComparePrint files={result.files} pages={layout} pdf={pdf.data} flagged={flaggedPages(report)} />
            </>
          )}
          <h3>Preview</h3>
          <Outline sections={result.sections} files={result.files} />
        </section>
      )}
    </div>
  )
}

/** What the description box shows: the reviewer's text when they have typed, otherwise the resolved one. */
function shownDescription(p: { path: string; alt: string; decorative: boolean }, alt: Record<string, string>): string {
  return Object.prototype.hasOwnProperty.call(alt, p.path) ? alt[p.path] : p.decorative ? '' : p.alt
}

/** A decorative picture is finished. A real AI draft is waiting for approval, not missing. Placeholders still count as missing. */
function needsPictureDescription(p: { path: string; alt: string; decorative: boolean; caption: string }, alt: Record<string, string>): boolean {
  if (Object.prototype.hasOwnProperty.call(alt, p.path)) {
    const typed = alt[p.path].trim()
    if (!typed) return !p.decorative && (!p.alt.trim() || isPlaceholderAlt(p.alt) || p.alt.trim() === p.caption.trim())
    return isPlaceholderAlt(typed) || typed === p.caption.trim()
  }
  if (p.decorative) return false
  const text = p.alt.trim()
  return !text || isPlaceholderAlt(text) || text === p.caption.trim()
}

function Pictures({ result, alt, setAlt, onBack, onNext, busy, todo, pending, visionOn, onDraft, onDraftOne, onApprove, onApproveAll, onSheet }: {
  result: PdfBuildResult
  alt: Record<string, string>
  setAlt: (a: Record<string, string>) => void
  onBack: () => void
  onNext: () => void
  busy: boolean
  todo: number
  pending: number
  visionOn: boolean
  onDraft: () => void
  onDraftOne: (path: string) => void
  onApprove: (path: string) => void
  onApproveAll: () => void
  onSheet: (file: File) => void
}) {
  const [filter, setFilter] = useState<'todo' | 'all'>(todo ? 'todo' : 'all')
  const urls = useObjectUrls(useMemo(() => result.pictures.map((p) => [p.path, result.files.get(`OEBPS/${p.path}`)!] as [string, Uint8Array]), [result]), 'image/jpeg')
  const needs = (p: PdfBuildResult['pictures'][number]) => needsPictureDescription(p, alt) || (p.source === 'ai' && !p.approved)
  const shown = filter === 'todo' ? result.pictures.filter(needs) : result.pictures
  return (
    <section className="card">
      <h2>4. Describe the pictures</h2>
      <p className="muted">
        People who cannot see the pictures hear this description instead (“alt text”). The caption is shown beside the picture and is not reused as the description. {todo} of {result.pictures.length} still
        need a real description — what the picture shows, in a sentence or two.
      </p>
      {!visionOn && <p className="muted">Picture descriptions from a vision model are off. Add an API key in Settings to draft the ones that are still empty.</p>}
      {pending > 0 && (
        <p className="note warnbox">
          {pending} AI draft{pending === 1 ? '' : 's'} need approval before this book can be marked as certified. They are counted as items to check, not as missing descriptions.
        </p>
      )}
      <div className="row">
        <button onClick={onDraft} disabled={busy || !visionOn || todo === 0} title={visionOn ? 'Asks the vision model only for pictures that have no description' : 'Add an API key in Settings'}>
          Draft the missing descriptions
        </button>
        {pending > 0 && <button onClick={onApproveAll} disabled={busy}>Approve all reviewed</button>}
        <label className="button">
          Load picture descriptions
          <input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) onSheet(f) }} />
        </label>
        <label>
          <input type="radio" checked={filter === 'todo'} onChange={() => setFilter('todo')} /> Needs a description ({todo})
        </label>
        <label>
          <input type="radio" checked={filter === 'all'} onChange={() => setFilter('all')} /> All ({result.pictures.length})
        </label>
      </div>
      <div className="images pics">
        {shown.map((p) => {
          const openDraft = p.source === 'ai' && !p.approved
          return (
            <div key={p.path} className={`img-row ${needsPictureDescription(p, alt) ? 'todo' : ''} ${openDraft ? 'pending' : ''}`}>
              <img src={urls.get(p.path)} alt="" loading="lazy" />
              <div>
                <code>{p.path.replace('images/', '')}</code>
                {p.alt || p.decorative ? <span className={`src-badge ${p.source}${openDraft ? ' pending' : ''}`}>{ALT_SOURCE_LABEL[p.source]}{openDraft ? ' · needs approval' : ''}</span> : null}
                {p.caption && <div className="why">Caption: {p.caption}</div>}
                {p.decorative && !(alt[p.path] ?? '').trim() ? (
                  <div className="why">A screen reader skips this picture. Type a description below to treat it as content instead.</div>
                ) : null}
                <label className="alt">
                  <span>Description</span>
                  <textarea rows={2} value={shownDescription(p, alt)} placeholder={p.decorative ? '(decorative — leave empty)' : ''} onChange={(e) => setAlt({ ...alt, [p.path]: e.target.value })} />
                </label>
                {openDraft && <button onClick={() => onApprove(p.path)} disabled={busy}>Approve</button>}
                {visionOn && !p.decorative && <button className="ghost" onClick={() => onDraftOne(p.path)} disabled={busy}>Draft again</button>}
              </div>
            </div>
          )
        })}
      </div>
      <StepNav onBack={onBack} onNext={onNext} next="Build and check" nextDisabled={busy}>
        {todo ? `${todo} picture(s) still need a description.` : ''}
      </StepNav>
    </section>
  )
}
