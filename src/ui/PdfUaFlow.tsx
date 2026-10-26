import { useMemo, useState, type ReactNode } from 'react'
import { FileDrop, type Picked } from './FileDrop.tsx'
import { remember, useObjectUrls } from './shared.tsx'
import { GatedDownload } from './GatedDownload.tsx'
import { collectPdfGate, type ExportGate } from '../engine/check/exportgate.ts'
import { Help, Status, StepNav } from './wizard.tsx'
import { targetId, type Need } from './needs.ts'
import { useReviewNotes, ReviewSummary } from './ReviewNotes.tsx'
import { leftNote, reviewNotes, withLeft, type DecisionNote } from '../engine/review/decisions.ts'
import type { GateOverride } from '../engine/check/exportgate.ts'
import { browserRaster } from './raster-browser.ts'
import { UA_ROLES, UA_ROLE_HELP, type UaRole, type UaStyle } from '../engine/pdfua/structure.ts'
import { specForFigures, type UaAnalysis } from '../engine/pdfua/index.ts'
import { draftPictureAlts, mimeOf, visionConfig } from '../engine/epub/alt-ai.ts'
import { readRequirements } from '../engine/spec/requirements.ts'
import { jobChoice } from './job-choice.ts'
import type { ReviewItem } from '../engine/epub/package.ts'

// Print PDF → accessible PDF (PDF/UA-1). The PDF is re-tagged from scratch; the reviewer checks
// text styles and picture descriptions, then runs PAC on the download as the final check.

type Built = { pdf: Uint8Array; review: ReviewItem[]; stats: Record<string, number>; fileName: string; gate: ExportGate; client: string }

export function PdfUaFlow() {
  const [pdf, setPdf] = useState<Picked>()
  const [cover, setCover] = useState<Picked>()
  const [altDocx, setAltDocx] = useState<Picked>()
  const [extras, setExtras] = useState<Picked[]>([])
  const [plates, setPlates] = useState<Picked | undefined>()
  const [busy, setBusy] = useState<string>()
  const [progress, setProgress] = useState<{ done: number; total: number }>()
  const [error, setError] = useState<string>()
  const [a, setA] = useState<UaAnalysis>()
  const [styles, setStyles] = useState<UaStyle[]>([])
  const [meta, setMeta] = useState<UaAnalysis['meta']>()
  const [alt, setAlt] = useState<Record<string, string>>({})
  const [decorative, setDecorative] = useState<Record<string, boolean>>({})
  const [spec, setSpec] = useState<Record<string, { alt: string; longDesc?: string; decorative?: boolean }>>({})
  const [ai, setAi] = useState<Record<string, { alt: string; longDesc?: string; approved?: boolean; decorative?: boolean }>>({})
  const [crop, setCrop] = useState(true)
  const [result, setResult] = useState<Built>()
  const [notice, setNotice] = useState<string>()
  const rn = useReviewNotes()

  /** a failed job shows its error and returns undefined: the person can try again or go on anyway */
  const run = async <T,>(label: string, fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(label)
    setProgress(undefined)
    setError(undefined)
    await new Promise((r) => setTimeout(r, 30))
    try {
      return await fn()
    } catch (e) {
      setError((e as Error).message)
      return undefined
    } finally {
      setBusy(undefined)
      setProgress(undefined)
    }
  }

  const onAnalyse = () =>
    run('Loading the PDF reader…', async () => {
      const { pdfjs } = await import('./pdf.ts')
      const { analyzeUa } = await import('../engine/pdfua/index.ts')
      const inputs = {
        main: pdf!.data,
        plates: plates?.data,
        extras: extras.map((x) => x.data),
        cover: cover ? { data: cover.data, png: /\.png$/i.test(cover.name) } : undefined,
        altDocx: altDocx?.data,
      }
      const r = await analyzeUa(pdfjs, browserRaster, inputs, (done, total, stage) => {
        const name = stage ?? 'Reading the pages'
        setBusy(total ? `${name}: ${done} of ${total}` : name)
        setProgress(total ? { done, total } : undefined)
      })
      const saved = remember<Record<string, UaRole>>('uaprofile', r.book.meta.publisher)
      setStyles(r.styles.map((s) => (saved?.[s.key] ? { ...s, role: saved[s.key], reason: 'from saved publisher profile' } : s)))
      setNotice(saved ? `Applied the saved settings for “${r.book.meta.publisher}”.` : undefined)
      setMeta(r.meta)
      setAlt(Object.fromEntries(r.figures.map((f) => [f.key, f.alt])))
      setDecorative({})
      setSpec({})
      setAi({})
      rn.clear()
      setA(r)
      setResult(undefined)
    })

  type Over = { meta?: UaAnalysis['meta']; alt?: Record<string, string>; decorative?: Record<string, boolean>; ai?: typeof ai }
  const onBuild = (over?: Over) =>
    run('Tagging the PDF…', async () => {
      const metaNow = over?.meta ?? meta!
      const altNow = over?.alt ?? alt
      const decorativeNow = over?.decorative ?? decorative
      const aiNow = over?.ai ?? ai
      const { buildUa } = await import('../engine/pdfua/index.ts')
      const { openSpec } = await import('../engine/spec/session.ts')
      const { uaOptionsFrom } = await import('../engine/pdfua/structure.ts')
      // the client's layers, then the Accessible PDF defaults, give the options (heading level, bookmarks, logos, links)
      const uaSpec = await openSpec({ client: jobChoice()?.client || a!.book.meta.publisher, series: '', book: metaNow.isbn || metaNow.title, kind: 'accessible-pdf' })
      const options = uaOptionsFrom(uaSpec.resolved.settings)
      const built = await buildUa(a!, {
        styles, meta: metaNow, alt: altNow, spec, ai: aiNow, decorative: decorativeNow, cropToTrim: crop, sourceName: pdf!.name, options,
        onProgress: (done, total, stage) => {
          const name = stage ?? 'Tagging the PDF'
          setBusy(total ? `${name}: ${done} of ${total}` : name)
          setProgress(total ? { done, total } : undefined)
        },
      })
      // VAL-001: the Matterhorn checks run again on the written file before any download
      const { checkUa } = await import('../engine/pdfua/check.ts')
      setBusy('Checking the PDF…')
      setResult({ ...built, gate: collectPdfGate(await checkUa(built.pdf), built.review), client: jobChoice()?.client || a!.book.meta.publisher })
      if (a!.book.meta.publisher) remember('uaprofile', a!.book.meta.publisher, Object.fromEntries(styles.map((s) => [s.key, s.role])))
    })

  const pickExtras = async (files: FileList | null) =>
    setExtras(await Promise.all([...(files ?? [])].map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) }))))
  const setRole = (key: string, role: UaRole) => setStyles((s) => s.map((x) => (x.key === key ? { ...x, role } : x)))
  const set = (k: keyof UaAnalysis['meta'], v: string) => setMeta({ ...meta!, [k]: v })
  const loadSheet = (file: File) =>
    run('Reading the picture sheet…', async () => {
      if (!a) return
      const { pictures } = readRequirements(file.name, new Uint8Array(await file.arrayBuffer()))
      if (!pictures?.length) {
        setNotice('That file has no picture-description sheet. It needs a file-name column and an alt-text column.')
        return
      }
      const matched = specForFigures(a.figures.map((f) => ({ key: f.key, caption: f.caption })), pictures)
      setSpec(matched)
      const n = Object.keys(matched).length
      setNotice(`Loaded ${pictures.length} picture description${pictures.length === 1 ? '' : 's'}. ${n} match a caption on this PDF. A typed description still wins.`)
    })

  // the picture AI is always there: the key typed in Settings, else the app's own server route (api/ai-fix)
  const visionOn = true
  /** asks the vision model for the pictures given; nothing is set here */
  const draftNext = async (keys: string[]) => {
    const targets = a!.figures.filter((f) => keys.includes(f.key) && f.thumb && f.thumb.length)
    if (!targets.length) return undefined
    const drafted = await draftPictureAlts(
      targets.map((f) => ({ id: f.key, bytes: f.thumb!, mime: mimeOf('picture.jpg', f.thumb!), caption: f.caption, nearby: '' })),
      meta?.lang || 'en',
      visionConfig(),
      (done, total) => setProgress({ done, total }),
    )
    const next = { ...ai }
    for (const d of drafted) if (d.alt || d.longDesc || d.decorative) next[d.id] = { alt: d.alt, longDesc: d.longDesc, decorative: d.decorative, approved: false }
    return { next, drafted }
  }
  const draftFigures = (keys: string[]) =>
    run(keys.length === 1 ? 'Drafting a description…' : 'Drafting picture descriptions…', async () => {
      if (!a) return
      const r = await draftNext(keys)
      if (!r) {
        setNotice('Those pictures have no preview to send to the vision model.')
        return
      }
      setAi(r.next)
      const failed = r.drafted.filter((d) => d.error)
      setNotice(failed[0]?.error ?? `Drafted ${r.drafted.filter((d) => d.alt || d.decorative).length} description(s). Approve each one before it is treated as final. A chart’s long description is added to the PDF description.`)
    })

  const pageOf = (page: number) => a?.book.numbers[page] ?? `PDF page ${page + 1}`
  const figNeed = (f: UaAnalysis['figures'][number], why: string): Need => ({ id: 'alt:' + f.key, label: `Picture on page ${pageOf(f.page)}: ${why}`, group: 'picture', kind: 'choice', target: targetId('alt:' + f.key), where: `page ${pageOf(f.page)}` })
  const noAlt = 'no description yet'
  const unapproved = 'AI description not approved yet'
  const todoFigs = a ? a.figures.filter((f) => !decorative[f.key] && !alt[f.key]?.trim()) : []
  const pendingFigs = a ? a.figures.filter((f) => ai[f.key] && !ai[f.key].approved && !todoFigs.includes(f)) : []
  const buildNeeds: Need[] = meta
    ? [
        ...(!meta.title.trim() ? [{ id: 'meta:title', label: 'The title is missing', group: 'book title', kind: 'choice' as const, target: 'ua-meta-title', where: 'Document details › Title' }] : []),
        ...(!meta.lang.trim() ? [{ id: 'meta:lang', label: 'The language is missing', group: 'language', kind: 'choice' as const, target: 'ua-meta-lang', where: 'Document details › Language' }] : []),
        ...todoFigs.map((f) => figNeed(f, noAlt)),
        ...pendingFigs.map((f) => figNeed(f, unapproved)),
      ]
    : []
  /** Fix with AI: a missing title takes the file name and a missing language the one the text is in (or English); the vision model describes the pictures
   *  without a description (when a key is set); every AI draft is approved. What cannot be decided is written as left. */
  const fixBuild = (): Promise<{ notes: DecisionNote[]; over: Over } | undefined> =>
    run('Deciding the open items…', async () => {
      const notes: DecisionNote[] = []
      let m = meta!
      if (!m.title.trim()) {
        const t = pdf!.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim()
        m = { ...m, title: t }
        notes.push({ step: 'Build', item: 'The title is missing', chosen: `Used the file name: “${t}”`, how: 'guess', where: 'Document details › Title' })
      }
      if (!m.lang.trim()) {
        const l = a!.book.meta.language || 'en'
        m = { ...m, lang: l }
        notes.push({ step: 'Build', item: 'The language is missing', chosen: `Set to “${l}”${a!.book.meta.language ? ', the language the text is in' : ', the default'}`, how: 'guess', where: 'Document details › Language' })
      }
      let next = { ...ai }
      if (visionOn && todoFigs.length) {
        const r = await draftNext(todoFigs.map((f) => f.key))
        if (r) {
          next = r.next
          const failed = r.drafted.find((d) => d.error)
          if (failed) setNotice(failed.error)
        }
      }
      const altNow = { ...alt }
      const decNow = { ...decorative }
      for (const f of [...todoFigs, ...pendingFigs]) {
        const d = next[f.key]
        const need = figNeed(f, todoFigs.includes(f) ? noAlt : unapproved)
        if (d && (d.decorative || d.alt?.trim())) {
          if (d.decorative) decNow[f.key] = true
          else altNow[f.key] = d.alt
          next[f.key] = { ...d, approved: true }
          notes.push({ step: 'Build', item: need.label, chosen: d.decorative ? 'The picture AI marked it decorative; accepted without a person reading it.' : `The picture AI wrote “${d.alt}”; accepted without a person reading it.`, how: 'ai', where: need.where })
        } else notes.push({ ...leftNote('Build', need), chosen: 'The picture AI gave no description. Left without one.' })
      }
      setMeta(m)
      setAlt(altNow)
      setDecorative(decNow)
      setAi(next)
      return { notes, over: { meta: m, alt: altNow, decorative: decNow, ai: next } }
    })
  const leftNow = (): DecisionNote[] => [
    ...buildNeeds.map((n) => leftNote('Build', n)),
  ]
  const notesText = (o?: GateOverride) =>
    reviewNotes({ file: result!.fileName, kind: 'Accessible PDF', notes: withLeft(rn.notes, leftNow()), missing: [...(meta?.title.trim() ? [] : ['Title: not given.']), ...(meta?.lang.trim() ? [] : ['Language: not given.'])], gate: result!.gate, override: o })
  /** Fix with AI on the finished PDF: decide what can be decided, then tag the PDF again */
  const fixAll = async () => {
    const f = await fixBuild()
    if (!f) return
    rn.add(f.notes)
    await onBuild(f.over)
  }

  return (
    <div className="flow">
      <Status busy={busy} error={error} notice={notice} progress={progress} />
      <section className="card">
        <h2>1. Files</h2>
        <p className="muted">
          Makes the print PDF readable with a screen reader: every piece of text gets a tag (heading, paragraph, list, note…) in reading order, pictures get
          descriptions, and decoration is hidden. The result follows PDF/UA, the standard that the PAC checker tests.
        </p>
        <div className="drops">
          <FileDrop label="Print PDF" hint="the final PDF of the book" accept="application/pdf" value={pdf} onPick={setPdf} required />
          <FileDrop label="Cover image" hint="placed as page 1" accept="image/jpeg,image/png" value={cover} onPick={setCover} />
          <FileDrop label="Alt text (Word)" hint="descriptions of the pictures" accept=".docx" value={altDocx} onPick={setAltDocx} />
          <FileDrop label="Plates" hint="a separate plates PDF, added after the book" accept="application/pdf" value={plates} onPick={setPlates} />
        </div>
        <label className="alt">
          <span>Other PDFs appended at the end (inserts) — optional</span>
          <input type="file" accept="application/pdf" multiple onChange={(e) => pickExtras(e.target.files)} />
        </label>
        {extras.length > 0 && <p className="muted small">Appended in this order: {extras.map((x) => x.name).join(', ')}</p>}
        <Help title="What are these files for?">
          <ul>
            <li><strong>Print PDF</strong> — the book to make accessible.</li>
            <li><strong>Cover image</strong> — added as page 1, as publishers deliver it.</li>
            <li><strong>Alt text (Word)</strong> — descriptions of the pictures, if someone wrote them; they are matched to the pictures by label (“Abb. 3”) or order.</li>
            <li><strong>Plates</strong> — the plate section when it is a PDF of its own: it is added after the book, tagged with it and gets a “Plate” bookmark.</li>
            <li><strong>Extra PDFs</strong> — plates or inserts printed separately, appended at the end.</li>
          </ul>
          Everything runs in this browser; nothing is uploaded. At the end, open the result in PAC (PDF Accessibility Checker) for the official report.
        </Help>
        <StepNav onNext={onAnalyse} next="Analyse" nextDisabled={!!busy} needs={pdf ? [] : [{ id: 'file:pdf', label: 'Add the print PDF', group: 'print PDF', kind: 'choice' }]} />
      </section>

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
                <label key={k} id={`ua-meta-${k}`} className={(k === 'title' || k === 'lang') && !meta[k] ? 'bad' : ''}>
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

          <Figures
            a={a}
            alt={alt}
            setAlt={setAlt}
            decorative={decorative}
            setDecorative={setDecorative}
            ai={ai}
            busy={!!busy}
            visionOn={visionOn}
            onDraft={() => draftFigures(a.figures.filter((f) => !decorative[f.key] && !alt[f.key]?.trim()).map((f) => f.key))}
            onDraftOne={(key) => draftFigures([key])}
            onAccept={(key) => {
              const d = ai[key]
              if (!d) return
              if (d.decorative) setDecorative({ ...decorative, [key]: true })
              else if (d.alt) setAlt({ ...alt, [key]: d.alt })
              setAi({ ...ai, [key]: { ...d, approved: true } })
            }}
            onSheet={(file) => loadSheet(file)}
          />

          <section className="card">
            <h2>Build</h2>
            <StepNav onNext={() => onBuild()} next={result ? 'Rebuild accessible PDF' : 'Build accessible PDF'} nextDisabled={!!busy} {...rn.choices('Build', buildNeeds, fixBuild, (over) => onBuild(over))} />
          </section>
        </>
      )}

      {result && <UaResult result={result} notes={notesText} onFix={fixAll} busy={!!busy} summary={<ReviewSummary notes={withLeft(rn.notes, leftNow())} build={{ file: result.fileName, kind: 'PDF' }} />} />}
    </div>
  )
}

function Figures({ a, alt, setAlt, decorative, setDecorative, ai, busy, visionOn, onDraft, onDraftOne, onAccept, onSheet }: {
  a: UaAnalysis
  alt: Record<string, string>
  setAlt: (x: Record<string, string>) => void
  decorative: Record<string, boolean>
  setDecorative: (x: Record<string, boolean>) => void
  ai: Record<string, { alt: string; longDesc?: string; approved?: boolean; decorative?: boolean }>
  busy: boolean
  visionOn: boolean
  onDraft: () => void
  onDraftOne: (key: string) => void
  onAccept: (key: string) => void
  onSheet: (file: File) => void
}) {
  const [filter, setFilter] = useState<'todo' | 'all'>('todo')
  const urls = useObjectUrls(useMemo(() => a.figures.filter((f) => f.thumb).map((f) => [f.key, f.thumb!] as [string, Uint8Array]), [a]))
  const todo = a.figures.filter((f) => !decorative[f.key] && !alt[f.key]?.trim())
  const shown = filter === 'todo' ? todo : a.figures
  const label = (page: number) => a.book.numbers[page] ?? `PDF page ${page + 1}`
  return (
    <section className="card">
      <h2>Pictures (alt text)</h2>
      <p className="muted">
        PDF/UA needs a description for every picture and chart. {a.figures.length - todo.length} of {a.figures.length} were filled in from the Word file or marked as decoration
        {a.altUnused.length ? `; ${a.altUnused.length} description(s) from it matched no picture (listed below)` : ''}. A typed description wins over the spec sheet.
      </p>
      <label className="alt">
        <span>Picture descriptions (spec sheet)</span>
        <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => { const f = e.target.files?.[0]; if (f) onSheet(f); e.target.value = '' }} />
      </label>
            <div className="row">
        <button onClick={onDraft} disabled={busy || !visionOn || todo.length === 0}>Draft the missing descriptions</button>
        <label>
          <input type="radio" checked={filter === 'todo'} onChange={() => setFilter('todo')} /> Needs a description ({todo.length})
        </label>
        <label>
          <input type="radio" checked={filter === 'all'} onChange={() => setFilter('all')} /> All ({a.figures.length})
        </label>
      </div>
      <div className="images pics">
        {shown.map((f) => (
          <div key={f.key} id={targetId('alt:' + f.key)} className="img-row">
            {urls.get(f.key) ? <img src={urls.get(f.key)} alt="" loading="lazy" /> : <div className="muted small">no preview</div>}
            <div>
              <code>
                page {label(f.page)} · {f.vector ? 'chart / drawing' : 'image'}
              </code>
              {f.caption && <div className="why">Caption: {f.caption}</div>}
              {ai[f.key] && !ai[f.key].approved && (
                <div className="why">
                  {ai[f.key].decorative
                    ? 'Draft: decorative. Approving hides it from the reading order.'
                    : `Draft: ${ai[f.key].alt || '(empty)'}`}
                  {ai[f.key].longDesc ? ` Long description: ${ai[f.key].longDesc}` : ''}
                  {' '}
                  <button onClick={() => onAccept(f.key)} disabled={busy}>Approve</button>
                </div>
              )}
              <label>
                <input
                  type="checkbox"
                  checked={!!decorative[f.key]}
                  onChange={(e) => setDecorative({ ...decorative, [f.key]: e.target.checked })}
                />{' '}
                Decoration — hide from the reading order
              </label>
              <label className="alt">
                <span>Alt text</span>
                <textarea rows={2} disabled={!!decorative[f.key]} value={alt[f.key] ?? ''} onChange={(e) => setAlt({ ...alt, [f.key]: e.target.value })} />
              </label>
              {visionOn && <button className="ghost" onClick={() => onDraftOne(f.key)} disabled={busy}>Draft again</button>}
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

function UaResult({ result, notes, onFix, busy, summary }: { result: Built; notes: (o?: GateOverride) => string; onFix: () => Promise<void>; busy: boolean; summary: ReactNode }) {
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
      {summary}
      <div className="row">
        <GatedDownload gate={result.gate} data={result.pdf} name={result.fileName} type="application/pdf" label={`Download ${result.fileName}`} notes={notes} onFix={onFix} busy={busy} ctx={{ client: result.client, book: result.fileName }} />
        <span className="muted">Then run PAC (PDF Accessibility Checker) on it as the final check.</span>
      </div>
    </section>
  )
}
