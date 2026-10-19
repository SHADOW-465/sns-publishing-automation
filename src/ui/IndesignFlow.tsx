import { useMemo, useState } from 'react'
import { FileDrop, type Picked } from './FileDrop.tsx'
import { BookDetails, download, remember, useObjectUrls } from './shared.tsx'
import { Steps, StepNav, Help, Status, Outline, CheckReportView, DeliverButton, EpubcheckBox, runEpubcheck, ComparePrint, flaggedPages, useConfirmNext } from './wizard.tsx'
import type { ValidatorResult } from '../engine/check/gate.ts'
import { unzip, text } from '../engine/zip.ts'
import { analyze, build, type Analysis, type BuildResult, type ImageChoice } from '../engine/indesign/build.ts'
import { ALT_SOURCE_LABEL, decorativeReason, isPlaceholderAlt, matchSpecPicture, needsLongDescription, settleAlt } from '../engine/epub/alt.ts'
import { draftPictureAlts, mimeOf, visionConfig } from '../engine/epub/alt-ai.ts'
import { ROLES, ROLE_HELP, type Profile, type Role, type StyleInfo } from '../engine/indesign/read.ts'
import { checkEpub, type CheckReport } from '../engine/check/epub.ts'
import { deliveryCounts } from '../engine/check/counts.ts'
import { isbn13Valid, type BookMeta } from '../engine/epub/package.ts'
import type { SectionType } from '../engine/epub/locale.ts'
import type { PrintPage } from '../engine/pdf/pages.ts'
import { SpecStep } from './SpecStep.tsx'
import { openSpec, applySpec, setRule, saveStyleRule, migrateProfile, type Spec } from '../engine/spec/session.ts'
import { CheckFirst } from './CheckFirst.tsx'
import { reviewList } from '../engine/review/confidence.ts'
import { actorName } from './SpecStep.tsx'
import { setSettings, houseSettings } from '../engine/settings.ts'
import { specHash } from '../engine/spec/layers.ts'
import type { Decision } from '../engine/spec/store.ts'

const toProfile = (styles: StyleInfo[]): Profile => Object.fromEntries(styles.map((s) => [s.key, { role: s.role, outClass: s.outClass }]))

// InDesign EPUB export → finished, accessible EPUB 3, in six steps (the third is the client's spec).

export function IndesignFlow() {
  const [step, setStep] = useState(0)
  const [exp, setExp] = useState<Picked>()
  const [cover, setCover] = useState<Picked>()
  const [pdf, setPdf] = useState<Picked>()
  const [busy, setBusy] = useState<string>()
  const [progress, setProgress] = useState<{ done: number; total: number }>()
  const [error, setError] = useState<string>()
  const [notice, setNotice] = useState<string>()
  const [analysis, setAnalysis] = useState<Analysis>()
  const [printPages, setPrintPages] = useState<PrintPage[]>()
  const [styles, setStyles] = useState<StyleInfo[]>([])
  const [meta, setMeta] = useState<BookMeta>()
  const [images, setImages] = useState<ImageChoice[]>([])
  const [acked, setAcked] = useState<Set<string>>(new Set())
  const [result, setResult] = useState<BuildResult>()
  const [report, setReport] = useState<CheckReport>()
  const [ec, setEc] = useState<ValidatorResult | null>()
  const [stale, setStale] = useState(true)
  const [types, setTypes] = useState<Record<number, SectionType>>({})
  const [navs, setNavs] = useState<Record<number, string>>({})
  const [spec, setSpec] = useState<Spec>()
  const [decision, setDecision] = useState<Decision>()

  const thumbs = useObjectUrls(useMemo(() => [...(analysis?.ex.images ?? [])], [analysis]))

  const run = async (label: string, fn: () => Promise<void> | void) => {
    setBusy(label)
    setProgress(undefined)
    setError(undefined)
    await new Promise((r) => setTimeout(r, 30)) // let the status line paint
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
    run('Reading the InDesign export…', async () => {
      const files = unzip(exp!.data)
      let a = analyze(files)
      // the client's own style decisions (its layer's styleMap) apply before any guess
      const sp0 = await openSpec({ client: a.meta.publisher, series: '', book: a.meta.title })
      applySpec(sp0)
      try {
        a = analyze(files)
      } finally {
        setSettings(houseSettings())
      }
      // style settings an older version kept in this browser move into the client's rules once (they have provenance there)
      const saved = remember<Profile>('profile', a.meta.publisher)
      if (saved && Object.keys(saved).length) {
        const moved = await migrateProfile(sp0, saved, actorName())
        remember('profile', a.meta.publisher, {})
        applySpec(moved)
        try {
          a = analyze(files)
        } finally {
          setSettings(houseSettings())
        }
        setNotice(`Moved the style settings saved in this browser for “${a.meta.publisher}” into the client’s rules.`)
      } else setNotice(undefined)
      setAnalysis(a)
      setStyles(a.styles)
      setMeta(a.meta)
      setImages(a.images)
      setResult(undefined)
      setTypes({})
      setNavs({})
      setSpec(undefined) // a new book: its spec is opened (and decided) again
      setDecision(undefined)
      setStale(true)
      if (pdf) {
        setBusy('Reading the print PDF…')
        const { printPagesOf } = await import('./pdf.ts') // pdf.js is large: load it only when needed
        setPrintPages(await printPagesOf(pdf.data, (done, total) => {
          setBusy(`Reading the print PDF, page ${done} of ${total}…`)
          setProgress({ done, total })
        }))
      } else setPrintPages(undefined)
      setStep(1)
    })

  /** builds the EPUB (fast) and runs the quality check on it */
  const rebuild = (then?: number) =>
    run('Building the e-book…', async () => {
      // the rules the client set (or accepted) in the Spec step are the rules the build follows
      const sp = spec ?? (await openSpec({ client: meta!.publisher, series: '', book: meta!.eisbn || meta!.title }))
      if (!spec) setSpec(sp)
      applySpec(sp)
      try {
        setProgress({ done: 0, total: 2 })
        await new Promise((r) => setTimeout(r, 30))
        const r = build(analysis!, { styles, meta: meta!, images, cover: cover ? { name: cover.name, data: cover.data } : undefined, printPages, sectionTypes: types, sectionNav: navs })
        setResult(r)
        setBusy('Checking the e-book…')
        setProgress({ done: 1, total: 2 })
        await new Promise((r) => setTimeout(r, 30))
        setReport(checkEpub(r.files, r.source))
        setBusy('Running EPUBCheck…')
        setEc(await runEpubcheck(r.epub))
      } finally {
        setSettings(houseSettings()) // other workflows keep building with the house settings
      }
      setStale(false)
      if (then !== undefined) setStep(then)
    })
  const go = (i: number) => (i >= 3 && (stale || !result) ? rebuild(i) : setStep(i))
  const changed = <T,>(set: (v: T) => void) => (v: T) => (set(v), setStale(true))

  const setStyle = (key: string, patch: Partial<StyleInfo>) => (setStyles((s) => s.map((x) => (x.key === key ? { ...x, ...patch, unsure: false, confidence: 1 } : x))), setStale(true))
  /** "for this client": write the decision to the client layer so the next book of the publisher needs no review */
  const rememberFor = async (key: string, scope: 'book' | 'client') => {
    const st = styles.find((x) => x.key === key)
    if (!st) return
    const sp = spec ?? (await openSpec({ client: meta!.publisher, series: '', book: meta!.eisbn || meta!.title }))
    setSpec(await saveStyleRule(sp, scope, key, st.role, st.outClass, actorName()))
    setNotice(`“${key}” is remembered for ${scope === 'client' ? `every ${meta!.publisher} book` : 'this book'}.`)
  }
  const setImage = (im: ImageChoice, patch: Partial<ImageChoice>) => (setImages(images.map((x) => (x === im ? { ...x, ...patch } : x))), setStale(true))
  const applyPictures = (pics: { file: string; alt: string; decorative: boolean; longDesc: string }[]) => {
    setImages(images.map((im) => settleAlt({ ...im, spec: matchSpecPicture(im.src, pics) ?? im.spec })))
    setNotice(`Filled picture descriptions from the spec where the file name matched.`)
    setStale(true)
  }
  const importProfile = async (f: Picked) => {
    const p = JSON.parse(new TextDecoder().decode(f.data)) as Profile
    setStyles((s) => s.map((x) => (p[x.key] ? { ...x, ...p[x.key], unsure: false, reason: 'from imported profile' } : x)))
    setStale(true)
  }

  // a rule changed from the "Check these first" list: this book only, or every book of the publisher
  const onRule = (id: string, level: 'book' | 'client', v: string | number | boolean | string[]) =>
    run('Applying the rule…', async () => {
      const sp = spec ?? (await openSpec({ client: meta!.publisher, series: '', book: meta!.eisbn || meta!.title }))
      const next = await setRule(sp, level, id, v, actorName() || 'reviewer')
      setSpec(next)
      setStale(true)
    })

  const liveSections = (result?.sections ?? []).map((s, i) => ({ ...s, type: types[i] ?? s.type, nav: (navs[i] ?? '').trim() || s.nav }))
  const structureInput = result && analysis && meta
    ? {
        styles, sources: analysis.sources, meta, notes: result.review, noteFindings: analysis.notes, pictures: result.pictures,
        sections: liveSections.map((x) => ({ ...x, preview: text(result.files.get('OEBPS/' + x.file) ?? new Uint8Array()).replace(/^[\s\S]*<body>/, '').replace(/<\/?(?:span|b|i|sup|sub|a)\b[^>]*>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 70) })),
      }
    : undefined
  const structureReview = structureInput ? reviewList(structureInput) : { items: [], sure: 0, auto: 0, banner: [] as string[] }
  const structurePending = structureReview.items.length
  // anything under 0.6 blocks until a person decides: a style by choosing its meaning, a note or picture by accepting it
  // (build messages and an untitled page are not decisions: a picture-only page has no title on purpose, and a missing picture description is fixed on its own step)
  const blocking = structureReview.items.filter((x) => x.score < 0.6 && !acked.has(x.id) && !/^(note|nav):/.test(x.id))
  const structureNext = useConfirmNext(structurePending, () => go(4))
  const inline = images.filter((i) => i.placement !== 'drop')
  const needAlt = inline.filter((i) => !i.decorative && (!i.alt.trim() || isPlaceholderAlt(i.alt)))
  const pendingAi = inline.filter((i) => i.source === 'ai' && !i.approved)
  const visionOn = !!visionConfig().apiKey.trim()
  const draftImages = (targets: ImageChoice[]) =>
    run(targets.length === 1 ? 'Drafting a description…' : 'Drafting picture descriptions…', async () => {
      const drafted = await draftPictureAlts(
        targets.map((im) => {
          const bytes = analysis!.ex.images.get(im.src) ?? new Uint8Array()
          return { id: im.src, bytes, mime: mimeOf(im.src, bytes), caption: im.caption, nearby: im.nearby }
        }),
        meta?.language || analysis?.meta.language || 'en',
        visionConfig(),
        (done, total) => setProgress({ done, total }),
      )
      const byId = new Map(drafted.map((d) => [d.id, d]))
      setImages(images.map((im) => {
        const d = byId.get(im.src)
        if (!d?.alt) return im
        return settleAlt({ ...im, userSet: false, approved: false, layers: { ...im.layers, aiAlt: d.alt } })
      }))
      setStale(true)
      const failed = drafted.filter((d) => d.error)
      setNotice(failed[0]?.error ?? `Drafted ${drafted.filter((d) => d.alt).length} description(s). Each one needs approval.`)
    })
  const errors = (report ? deliveryCounts(report, result?.review ?? []).errors : 0) + (ec?.errors.length ?? 0)
  const steps = [
    { title: 'Files', hint: 'what you start from', enabled: true, done: !!analysis },
    { title: 'Book details', hint: 'title, author, ISBN', enabled: !!analysis, done: !!meta && isbn13Valid(meta.eisbn) },
    { title: 'House style', hint: 'your rules, accepted', enabled: !!analysis, done: !!decision },
    { title: 'Structure', hint: 'chapters and pages', enabled: !!decision, done: !!result && step > 3 },
    { title: 'Pictures', hint: 'descriptions', enabled: !!decision, done: !!analysis && needAlt.length === 0 },
    { title: 'Check & download', hint: 'quality report', enabled: !!decision, done: !!report && !stale && errors === 0 },
  ]

  return (
    <div className="flow">
      <Steps steps={steps} at={step} onGo={go} />
      <Status busy={busy} error={error} notice={notice} progress={progress} />

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
            <FileDrop label="Print PDF" hint="the printed book: used to check every page number" accept="application/pdf" value={pdf} onPick={setPdf} />
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
          <BookDetails meta={meta} onChange={changed(setMeta)} sources={analysis.sources} certifyBlocked={images.some((i) => i.source === 'ai' && !i.approved)} note="Read from the book’s own title and copyright pages. Fields in red need a look. The e-book ISBN is never in the InDesign file — type it in." />
          <Help title="Where are these used?">
            Stores (Apple Books, Amazon, Google Play), library systems and reading apps show these details, and screen readers announce the title and language.
            The language decides the voice a screen reader uses. The print ISBN names the paper edition the page numbers come from.
          </Help>
          <StepNav onBack={() => setStep(0)} onNext={() => setStep(2)} nextDisabled={!!busy}>
            {!isbn13Valid(meta.eisbn) ? 'The e-book ISBN is still missing — you can add it later.' : ''}
          </StepNav>
        </>
      )}

      {step === 2 && analysis && meta && (
        <SpecStep
          ctx={{ client: meta.publisher, series: spec?.ctx.series ?? '', book: meta.eisbn || meta.title }}
          spec={spec}
          pictures={images.map((im) => ({ file: im.src.split('/').pop()!, alt: im.decorative ? '' : im.alt, decorative: im.decorative, longDesc: im.longDesc }))}
          onPictures={applyPictures}
          onSpec={(s) => (setSpec(s), setStale(true))}
          onDecided={(d) => (setDecision(d), rebuild(3))}
          onBack={() => setStep(1)}
        />
      )}

      {step === 3 && analysis && result && (
        <section className="card">
          <h2>4. Check the structure</h2>
          <p className="muted">
            This is the book as a reader will get it: each line is one part of the e-book, in reading order, with its printed pages. Click a line to see it. If a
            part has the wrong label (a dedication marked as a chapter), change it in its drop-down and update the preview. Also look for missing titles or chapters
            that are far too short.
          </p>
          <div className="row">
            <button onClick={() => rebuild()} disabled={!!busy}>Update the preview</button>
            <span className="muted small">{stale ? 'The preview is behind your changes.' : 'The preview matches the choices above.'}</span>
          </div>
          {structureInput && (
          <CheckFirst
            input={structureInput}
            review={structureReview}
            setStyle={setStyle}
            onType={(i, t) => (setTypes({ ...types, [i]: t as SectionType }), setStale(true))}
            onMeta={() => setStep(1)}
            spec={spec}
            onRule={onRule}
            standard={(meta?.profile ?? 'accessible') === 'standard'}
            acked={acked}
            onAck={(id) => setAcked(new Set([...acked, id]))}
          />
          )}
          <Outline sections={result.sections.map((s, i) => ({ ...s, type: types[i] ?? s.type }))} files={result.files} titles={navs} onTitle={(i, t) => (setNavs({ ...navs, [i]: t }), setStale(true))} onType={(i, t) => (setTypes({ ...types, [i]: t as SectionType }), setStale(true))} />
          <details className="advanced">
            <summary>Advanced: how the InDesign styles are read ({styles.filter((s) => s.unsure).length} guesses to confirm)</summary>
            <p className="muted small">
              Each InDesign paragraph style and what it becomes. The structure above comes from this table. If a part is wrong, change the meaning of its style here and update
              the preview. Choices are remembered for this publisher.
            </p>
            <StyleTable styles={styles} setStyle={setStyle} onScope={rememberFor} />
            <div className="row">
              <button onClick={() => download(JSON.stringify(toProfile(styles), null, 2), `${meta?.publisher || 'publisher'}-styles.json`, 'application/json')}>Save settings to a file</button>
              <label className="button">
                Load settings from a file
                <input type="file" accept=".json" hidden onChange={async (e) => { const f = e.target.files?.[0]; if (f) await importProfile({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) }) }} />
              </label>
              <button onClick={() => rebuild()} disabled={!!busy}>Update the preview</button>
            </div>
          </details>
          {structureNext.asked && (
            <p className="note warnbox" role="status">
              {structurePending} item{structurePending === 1 ? '' : 's'} still need a look — the same number as “Check these first”.
              {structureReview.auto > 0 ? ` ${structureReview.auto} other change${structureReview.auto === 1 ? ' was' : 's were'} made automatically and ${structureReview.auto === 1 ? 'is' : 'are'} not in that count.` : ''} Check the list, or continue anyway.
            </p>
          )}
          <StepNav onBack={() => setStep(2)} onNext={structureNext.onNext} next={structureNext.next} nextDisabled={!!busy || blocking.length > 0} />
          {blocking.length > 0 && <p className="err small" role="status">{blocking.length} item{blocking.length === 1 ? '' : 's'} in the list above {blocking.length === 1 ? 'is' : 'are'} under 60% sure: {blocking.slice(0, 2).map((x) => x.title).join('; ')}{blocking.length > 2 ? '…' : ''}. Decide {blocking.length === 1 ? 'it' : 'them'} to go on.</p>}
        </section>
      )}

      {step === 4 && analysis && (
        <section className="card">
          <h2>5. Describe the pictures</h2>
          <p className="muted">
            People who cannot see the pictures hear this description instead (“alt text”). Say what the picture shows, in about 140 characters, and do not repeat the caption.
            Tick “decorative” only for ornaments that carry no information: those get an empty description so a screen reader skips them.
          </p>
          {!visionOn && <p className="muted">Picture descriptions from a vision model are off. Add an API key in Settings to draft the ones that are still empty.</p>}
          {pendingAi.length > 0 && (
            <p className="note warnbox">
              {pendingAi.length} AI draft{pendingAi.length === 1 ? '' : 's'} need approval before this book can be marked as certified. They are counted as items to check, not as missing descriptions.
            </p>
          )}
          <div className="row">
            <button onClick={() => draftImages(needAlt)} disabled={!!busy || !visionOn || needAlt.length === 0} title={visionOn ? 'Asks the vision model only for pictures that have no description' : 'Add an API key in Settings'}>
              Draft the missing descriptions
            </button>
            {pendingAi.length > 0 && <button onClick={() => (setImages(images.map((im) => (im.source === 'ai' && !im.approved ? { ...im, approved: true } : im))), setStale(true))}>Approve all reviewed</button>}
          </div>
          {images.length === 0 && <p className="muted">This book has no pictures besides the cover.</p>}
          <div className="images">
            {images.map((im) => {
              const chart = needsLongDescription(im.src, im.caption, im.alt)
              return (
              <div key={im.src} className={`img-row ${im.placement !== 'drop' && !im.decorative && (!im.alt.trim() || isPlaceholderAlt(im.alt)) ? 'todo' : ''} ${im.source === 'ai' && !im.approved ? 'pending' : ''}`}>
                <img src={thumbs.get(im.src)} alt="" />
                <div>
                  <code>{im.src.split('/').pop()}</code> <span className="muted small">{im.width}×{im.height}</span>
                  <span className={`src-badge ${im.source}${im.source === 'ai' && !im.approved ? ' pending' : ''}`}>{ALT_SOURCE_LABEL[im.source]}{im.source === 'ai' && !im.approved ? ' · needs approval' : ''}</span>
                  <select value={im.placement} onChange={(e) => setImage(im, { placement: e.target.value as ImageChoice['placement'] })}>
                    <option value="inline">Keep where it is in the text</option>
                    <option value="logo">Publisher logo on the title page</option>
                    <option value="drop">Leave out (back cover, print-only)</option>
                  </select>
                  {im.placement !== 'drop' && (
                    <>
                      {im.caption && <p className="caption-note"><span className="muted">Caption: </span>{im.caption}</p>}
                      <label className="alt">
                        <span>Description</span>
                        <textarea rows={2} value={im.alt} disabled={im.decorative} placeholder="e.g. Black-and-white photo of … at …, 1968" onChange={(e) => setImage(im, { alt: e.target.value, userSet: true, source: 'typed', approved: true, decorative: false })} />
                      </label>
                      {!im.decorative && im.alt.trim().length > 180 && <p className="muted small">About 140 characters is easier to follow. This one is {im.alt.trim().length}.</p>}
                      <label className={`alt ${chart ? 'needed' : ''}`}>
                        <span>Long description {chart ? <strong>needed for this chart or map</strong> : <span className="muted">for a chart or map</span>}</span>
                        <textarea rows={chart ? 4 : 2} value={im.longDesc} disabled={im.decorative} placeholder="Only when the short description is not enough" onChange={(e) => setImage(im, { longDesc: e.target.value, userSet: true, source: 'typed', approved: true })} />
                      </label>
                      <label className="small">
                        <input type="checkbox" checked={!!im.decorative} onChange={(e) => setImage(im, { decorative: e.target.checked, userSet: true, source: 'typed', approved: true, alt: e.target.checked ? '' : im.alt })} /> Decorative only (screen readers skip it)
                      </label>
                      {im.source === 'decorative' && (
                        <p className="muted small">{decorativeReason({ name: im.src, width: im.width, height: im.height }) ?? 'Suggested as decorative.'} Untick this if the picture carries information.</p>
                      )}
                      {im.source === 'ai' && !im.approved && <button onClick={() => setImage(im, { approved: true })}>Approve</button>}
                      {visionOn && !im.decorative && <button className="ghost" onClick={() => draftImages([im])} disabled={!!busy}>Draft again</button>}
                    </>
                  )}
                </div>
              </div>
              )
            })}
          </div>
          <StepNav onBack={() => setStep(3)} onNext={() => rebuild(5)} next="Build and check" nextDisabled={!!busy}>
            {needAlt.length ? `${needAlt.length} picture(s) still need a description.` : ''}
          </StepNav>
        </section>
      )}

      {step === 5 && analysis && result && report && meta && (
        <section className="card">
          <h2>6. Check and download</h2>
          {decision && spec && (
            <p className={decision.action === 'accepted' && decision.specHash === specHash(spec.resolved.settings) ? 'note small' : 'note warnbox'}>
              Built with spec {specHash(spec.resolved.settings)}:{' '}
              {decision.action === 'accepted' ? `accepted by ${decision.actor} on ${new Date(decision.at).toLocaleString()}` : `not accepted (${decision.actor} continued without accepting)`}
              {decision.specHash !== specHash(spec.resolved.settings) ? ' — the rules changed after that decision; go back to House style to accept them.' : '.'}
            </p>
          )}
          {!cover && <p className="err box">No cover uploaded: the placeholder from InDesign was used. Add the real cover in step 1.</p>}
          {stale && (
            <p className="note warnbox">
              Settings changed since this check. <button onClick={() => rebuild()}>Build and check again</button>
            </p>
          )}
          <EpubcheckBox result={ec} />
          <CheckReportView report={report} review={result.review} epubcheckErrors={ec?.errors.length ?? 0} />
          <div className="row">
            <DeliverButton data={result.epub} name={`${meta.eisbn ? meta.eisbn.replace(/[^\dXx]/g, '') : meta.title || 'book'}.epub`} type="application/epub+zip" errors={errors} label="Download EPUB" />
            <button onClick={() => rebuild()} disabled={!!busy}>Build and check again</button>
          </div>
          <Help title="What happens after download?">
            The built-in check covers the common problems. For delivery, run EPUBCheck (file validity) and Ace by DAISY (accessibility) once more — the stores run the same
            validator — and look through the book in a reader such as Apple Books or Thorium.
          </Help>
          {pdf && printPages ? (
            <details className="panel" open>
              <summary>Compare with the print book</summary>
              <p className="muted small">The printed page next to the same page of the e-book. Pages the check flagged come first.</p>
              <ComparePrint files={result.files} pages={printPages} pdf={pdf.data} flagged={flaggedPages(report)} />
            </details>
          ) : (
            <p className="muted small">Add the print PDF in step 1 to compare every page with the print book.</p>
          )}
          <details className="panel" open>
            <summary>Preview</summary>
            <Outline sections={result.sections} files={result.files} />
          </details>
        </section>
      )}
    </div>
  )
}

function StyleTable({ styles, setStyle, onScope }: { styles: StyleInfo[]; setStyle: (key: string, patch: Partial<StyleInfo>) => void; onScope: (key: string, scope: 'book' | 'client') => void }) {
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
            <th>Remember for</th>
          </tr>
        </thead>
        <tbody>
          {styles.map((s) => (
            <tr key={s.key} className={s.unsure ? 'unsure' : ''}>
              <td>
                <code>{s.key}</code>
                {s.unsure && <span className="flag">check</span>}
                <div className="why">{s.reason}</div>
                {s.evidence && (
                  <div className="chips">
                    {s.evidence.map((e, i) => (
                      <span key={i} className="badge info" title={e.note}>{e.signal}</span>
                    ))}
                    <meter min={0} max={1} low={0.6} high={0.85} optimum={1} value={s.confidence ?? 1} aria-label={`Confidence ${Math.round((s.confidence ?? 1) * 100)}%`} />
                  </div>
                )}
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
              <td>
                <select value="" onChange={(e) => e.target.value && onScope(s.key, e.target.value as 'book' | 'client')} aria-label={`Remember the meaning of ${s.key} for`}>
                  <option value="">…</option>
                  <option value="book">This book</option>
                  <option value="client">This client</option>
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
