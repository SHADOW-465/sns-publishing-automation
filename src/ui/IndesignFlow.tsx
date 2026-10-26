import { useMemo, useState } from 'react'
import { FileDrop, type Picked } from './FileDrop.tsx'
import { BookDetails, download, remember, useObjectUrls } from './shared.tsx'
import { Steps, StepNav, Help, Status, Outline, CheckReportView, EpubcheckBox, runEpubcheck, AccessibilityBox, runAccessibility, type A11yResult, ComparePrint, flaggedPages } from './wizard.tsx'
import type { ValidatorResult } from '../engine/check/gate.ts'
import { unzip, text } from '../engine/zip.ts'
import { analyzeSteps, build, usePdfPictures, type Analysis, type BuildResult, type ImageChoice } from '../engine/indesign/build.ts'
import { ALT_SOURCE_LABEL, decorativeReason, isPlaceholderAlt, matchSpecPicture, needsLongDescription, settleAlt } from '../engine/epub/alt.ts'
import { draftPictureAlts, mimeOf, visionConfig } from '../engine/epub/alt-ai.ts'
import { ROLES, ROLE_HELP, type Profile, type Role, type StyleInfo } from '../engine/indesign/read.ts'
import { checkEpub, type CheckReport } from '../engine/check/epub.ts'
import { deliveryCounts } from '../engine/check/counts.ts'
import { isbn13Valid, epubFileName, type BookMeta } from '../engine/epub/package.ts'
import type { SectionType } from '../engine/epub/locale.ts'
import type { PrintPage } from '../engine/pdf/pages.ts'
import { SpecStep } from './SpecStep.tsx'
import { GatedDownload } from './GatedDownload.tsx'
import { openSpec, applySpec, setRule, saveStyleRule, migrateProfile, applyBookDetailsToSpec, type Spec } from '../engine/spec/session.ts'
import { readRequirements } from '../engine/spec/requirements.ts'
import { collectGate, uiStages, type ExportGate, type GateOverride } from '../engine/check/exportgate.ts'
import { CheckFirst } from './CheckFirst.tsx'
import { exportPictures, missingPictures, pdfRenderer, readPdfPictures } from '../engine/indesign/pdfpictures.ts'
import { browserRaster } from './raster-browser.ts'
import { reviewList, blockingItems, acceptable, acceptAllIds } from '../engine/review/confidence.ts'
import { structureNeeds, detailNeeds, targetId, keepStylePatch, type Need } from './needs.ts'
import { useReviewNotes, ReviewSummary } from './ReviewNotes.tsx'
import { aiDetails, frontMatterText } from '../engine/review/ai-fix.ts'
import { decideDetails, decideStructure, leftNote, missingDetails, reviewNotes, whereOfItem, withLeft, type DecisionNote } from '../engine/review/decisions.ts'
import { defaultFor } from '../engine/output/standards.ts'
import { actorName } from './SpecStep.tsx'
import { setSettings, houseSettings, settings } from '../engine/settings.ts'
import { outputViolations } from '../engine/output/standards.ts'
import { jobChoice, profileFor } from './job-choice.ts'
import { specHash } from '../engine/spec/layers.ts'
import type { Decision } from '../engine/spec/store.ts'

const toProfile = (styles: StyleInfo[]): Profile => Object.fromEntries(styles.map((s) => [s.key, { role: s.role, outClass: s.outClass }]))

// InDesign EPUB export → finished, accessible EPUB 3, in six steps (the third is the client's spec).

export function IndesignFlow() {
  const [step, setStep] = useState(0)
  const [exp, setExp] = useState<Picked>()
  const [cover, setCover] = useState<Picked>()
  const [pdf, setPdf] = useState<Picked>()
  const [bookDetails, setBookDetails] = useState<Picked>()
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
  const [a11y, setA11y] = useState<A11yResult | null>()
  const [gate, setGate] = useState<ExportGate>()
  const [stale, setStale] = useState(true)
  const [types, setTypes] = useState<Record<number, SectionType>>({})
  const [navs, setNavs] = useState<Record<number, string>>({})
  const [spec, setSpec] = useState<Spec>()
  const [decision, setDecision] = useState<Decision>()
  const rn = useReviewNotes()

  const thumbs = useObjectUrls(useMemo(() => [...(analysis?.ex.images ?? [])], [analysis]))

  /** a failed job shows its error and returns undefined: the person can try again or go on anyway */
  const run = async <T,>(label: string, fn: () => Promise<T> | T): Promise<T | undefined> => {
    setBusy(label)
    setProgress(undefined)
    setError(undefined)
    await new Promise((r) => setTimeout(r, 30)) // let the status line paint
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
    run('Reading the InDesign export…', async () => {
      const files = unzip(exp!.data)
      let a = await analyzeSteps(files, {}, [], (label) => setBusy(label))
      // the client's own style decisions (its layer's styleMap) apply before any guess
      const sp0 = await openSpec({ client: a.meta.publisher, series: '', book: a.meta.title })
      applySpec(sp0)
      try {
        a = await analyzeSteps(files, {}, [], (label) => setBusy(label))
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
          a = await analyzeSteps(files, {}, [], (label) => setBusy(label))
        } finally {
          setSettings(houseSettings())
        }
        setNotice(`Moved the style settings saved in this browser for “${a.meta.publisher}” into the client’s rules.`)
      } else setNotice(undefined)
      setAnalysis(a)
      setStyles(a.styles)
      const chosen = profileFor(jobChoice()?.output)
      setMeta(chosen ? { ...a.meta, profile: chosen } : a.meta)
      setImages(a.images)
      setResult(undefined)
      setTypes({})
      setNavs({})
      setSpec(undefined) // a new book: its spec is opened (and decided) again
      rn.clear()
      setDecision(undefined)
      setStale(true)
      if (pdf) {
        setBusy('Reading the print PDF…')
        const { printPagesOf } = await import('./pdf.ts') // pdf.js is large: load it only when needed
        const pp = await printPagesOf(pdf.data, (done, total) => {
          setBusy(`Reading the print PDF, page ${done} of ${total}…`)
          setProgress({ done, total })
        })
        setPrintPages(pp)
        // pictures come from the print PDF, not from InDesign (client image spec); missing or grey-placeholder ones too (IMG-009)
        if (exportPictures(a.ex).length) {
          const { pdfjs } = await import('./pdf.ts')
          // page by page, each page released before the next: a 70 MB book is never in memory whole
          const pics = await readPdfPictures(pdfjs, pdf.data, browserRaster, pp, (done, total) => {
            setBusy(`Taking the pictures from the print PDF, page ${done} of ${total}…`)
            setProgress({ done, total })
          })
          await usePdfPictures(a, pics, [], {
            printPages: pp,
            render: pdfRenderer(pdfjs, pdf.data, browserRaster),
            onRender: (done, total) => {
              setBusy(`Drawing the pictures the PDF has no file for, ${done} of ${total}…`)
              setProgress({ done, total })
            },
          })
          rn.add(a.pictureNotes)
          setAnalysis({ ...a })
          setImages(a.images)
        }
      } else {
        setPrintPages(undefined)
        // no print PDF to take pictures from: InDesign's grey placeholders are still listed, never placed silently
        if (missingPictures(a.ex).length) {
          await usePdfPictures(a, [])
          rn.add(a.pictureNotes)
          setAnalysis({ ...a })
        }
      }
      setStep(1)
    })

  /** builds the EPUB (fast) and runs the quality check on it */
  const rebuild = (then?: number, over?: { images?: ImageChoice[]; spec?: Spec }) =>
    run('Building the preview. Large books can take a minute or two; the page is working…', async () => {
      // the rules the client set (or accepted) in the Spec step are the rules the build follows
      let sp = over?.spec ?? spec ?? (await openSpec({ client: meta!.publisher, series: '', book: meta!.eisbn || meta!.title }))
      // the client's Book_Details file is a book-layer setting, read by the spec loader and recorded in the log
      if (bookDetails && sp.layers.find((l) => l.level === 'book')?.bookDetails?.source !== bookDetails.name) {
        const bd = readRequirements(bookDetails.name, bookDetails.data).bookDetails
        if (!bd) throw new Error(`“${bookDetails.name}” is not a Book_Details file: it has no NAV-NCX sheet with a “Chapter Name” column.`)
        sp = await applyBookDetailsToSpec(sp, 'book', bd, actorName() || 'reviewer')
      }
      if (sp !== spec) setSpec(sp)
      applySpec(sp)
      setGate(undefined)
      try {
        setProgress({ done: 0, total: 2 })
        await new Promise((r) => setTimeout(r, 30))
        const r = build(analysis!, { styles, meta: meta!, images: over?.images ?? images, cover: cover ? { name: cover.name, data: cover.data } : undefined, printPages, sectionTypes: types, sectionNav: navs })
        setResult(r)
        setBusy('Checking the e-book…')
        setProgress({ done: 1, total: 2 })
        await new Promise((r) => setTimeout(r, 30))
        const rep = checkEpub(r.files, r.source)
        setReport(rep)
        setBusy('Running EPUBCheck…')
        const ecNow = await runEpubcheck(r.epub)
        setEc(ecNow)
        setBusy('Checking accessibility…')
        const a11yNow = await runAccessibility(r.epub)
        setA11y(a11yNow)
        // VAL-001: every guard and EPUBCheck, before any download
        setGate(collectGate({ report: rep, review: r.review, stages: uiStages(r.files, settings(), ecNow, a11yNow) }))
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
  // anything under 0.6 is listed as unsure; it never holds the step: Fix with AI keeps the tool's best reading, I'll fix it myself
  // shows the item, Continue anyway leaves it (build messages and an untitled part are not decisions: a picture-only page has no title on purpose)
  const blocking = blockingItems(structureReview.items, acked)
  const sectionsNow = liveSections.map((s) => ({ nav: s.nav, file: s.file }))
  const structureBlock = structureNeeds(blocking, acceptable, (it) => whereOfItem(it, sectionsNow))
  const acceptAll = () => {
    const d = decideStructure(blocking.filter(acceptable), { roleOf: () => undefined, typeOf: (i) => liveSections[i]?.type, valueOf: () => undefined, sections: sectionsNow })
    setAcked((s) => new Set([...s, ...d.ack]))
    rn.add(d.notes)
  }
  /** Fix with AI on the Structure step: keep the tool's best reading of every unsure style, part, picture and note */
  const fixStructure = () => {
    const d = decideStructure(blocking, { roleOf: (k) => styles.find((x) => x.key === k)?.role, typeOf: (i) => liveSections[i]?.type, valueOf: (f) => (meta as unknown as Record<string, string> | undefined)?.[f], sections: sectionsNow })
    // the role stays what it was, so the build does not change: only the "unsure" marks go
    setStyles((ss) => ss.map((x) => (d.keepStyles.includes(x.key) ? { ...x, ...keepStylePatch(x.role), unsure: false, confidence: 1 } : x)))
    setAcked((s) => new Set([...s, ...d.ack]))
    return { notes: d.notes }
  }
  const fileNeeds: Need[] = exp ? [] : [{ id: 'file:export', label: 'Add the InDesign EPUB export (the .epub, a .zip, or the unzipped folder)', group: 'InDesign export', kind: 'choice' }]
  const outputKind = (meta?.profile ?? settings().defaultProfile) === 'standard' ? 'standard-epub' as const : 'accessible-epub' as const
  const outputProblems = outputViolations(outputKind, spec?.resolved.settings ?? settings())
  const outputErrors = outputProblems.filter((p) => p.level === 'error')
  const inline = images.filter((i) => i.placement !== 'drop')
  const needAlt = inline.filter((i) => !i.decorative && (!i.alt.trim() || isPlaceholderAlt(i.alt)))
  const pendingAi = inline.filter((i) => i.source === 'ai' && !i.approved)
  const visionOn = !!visionConfig().apiKey.trim()
  const fileOf = (im: ImageChoice) => im.src.split('/').pop()!
  const pictureNeed = (im: ImageChoice, why: string): Need => ({ id: 'alt:' + im.src, label: `Picture ${fileOf(im)}: ${why}`, group: 'picture', kind: 'choice', target: targetId('alt:' + im.src), where: `picture file ${fileOf(im)}` })
  const outputNeed = (p: { message: string; ruleId?: string }, i: number): Need => ({ id: 'output:' + i, label: p.message, group: 'setting', kind: 'choice', where: p.ruleId ? `rule ${p.ruleId}` : undefined })
  const noAlt = 'no description yet'
  const unapproved = 'AI description not approved yet'
  const pictureNeeds: Need[] = [...outputErrors.map(outputNeed), ...needAlt.map((im) => pictureNeed(im, noAlt)), ...pendingAi.filter((im) => !needAlt.includes(im)).map((im) => pictureNeed(im, unapproved))]
  /** asks the vision model for the pictures given; returns the new list (nothing is set here) and what happened to each */
  const draftFor = async (targets: ImageChoice[], list: ImageChoice[]) => {
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
    const next = list.map((im) => {
      const d = byId.get(im.src)
      if (!d || (!d.alt && !d.longDesc && !d.decorative)) return im
      return settleAlt({ ...im, userSet: false, approved: false, layers: { ...im.layers, aiAlt: d.alt, aiLong: d.longDesc, aiDecorative: d.decorative } })
    })
    return { next, drafted }
  }
  const draftImages = (targets: ImageChoice[]) =>
    run(targets.length === 1 ? 'Drafting a description…' : 'Drafting picture descriptions…', async () => {
      const { next, drafted } = await draftFor(targets, images)
      setImages(next)
      setStale(true)
      const failed = drafted.filter((d) => d.error)
      const kept = drafted.filter((d) => d.alt || d.decorative).length
      setNotice(failed[0]?.error ?? `Drafted ${kept} description(s). Each one needs approval.`)
    })
  /** Fix with AI on the pictures: the vision model describes the ones without a description (when a key is set), every AI draft is
   *  approved, and a setting that breaks the chosen kind of e-book takes the standard's own value. What cannot be decided is written as left. */
  const fixPictures = (): Promise<{ notes: DecisionNote[]; over: { images: ImageChoice[]; spec?: Spec } } | undefined> =>
    run('Deciding the pictures…', async () => {
      const notes: DecisionNote[] = []
      let list = images
      if (visionOn && needAlt.length) {
        const { next, drafted } = await draftFor(needAlt, list)
        list = next
        const failed = drafted.find((d) => d.error)
        if (failed) setNotice(failed.error)
      }
      list = list.map((im) => (im.placement !== 'drop' && im.source === 'ai' && !im.approved ? { ...im, approved: true } : im))
      for (const before of inline) {
        const wasMissing = needAlt.includes(before)
        if (!wasMissing && !pendingAi.includes(before)) continue
        const im = list.find((x) => x.src === before.src)!
        const need = pictureNeed(before, wasMissing ? noAlt : unapproved)
        if (im.decorative || (!!im.alt.trim() && !isPlaceholderAlt(im.alt))) {
          notes.push({ step: 'Pictures', item: need.label, chosen: im.decorative ? 'The picture AI marked it decorative; accepted without a person reading it.' : `The picture AI wrote “${im.alt}”; accepted without a person reading it.`, how: 'ai', where: need.where })
        } else notes.push({ ...leftNote('Pictures', need), chosen: visionOn ? 'The picture AI gave no description. Left without one.' : 'No picture AI is set up (add a key in Settings), so it is left without a description.' })
      }
      let sp = spec ?? (await openSpec({ client: meta!.publisher, series: '', book: meta!.eisbn || meta!.title }))
      for (const p of outputErrors.filter((x) => x.ruleId)) {
        const v = defaultFor(outputKind, p.ruleId!).value
        if (v === undefined) continue
        sp = await setRule(sp, 'book', p.ruleId!, v, actorName() || 'reviewer')
        notes.push({ step: 'Pictures', item: p.message, chosen: `Set rule ${p.ruleId} to ${String(v)}, the value the ${outputKind === 'standard-epub' ? 'Standard' : 'Accessible'} EPUB standard asks for.`, how: 'guess', where: `rule ${p.ruleId}` })
      }
      setImages(list)
      setSpec(sp)
      setStale(true)
      return { notes, over: { images: list, spec: sp } }
    })
  /** What is still unsure when the file is made, written next to what was decided on the way. */
  const leftNow = (): DecisionNote[] => [
    ...structureReview.items.filter((it) => !acked.has(it.id)).map((it) => leftNote('Structure', { label: it.title, where: whereOfItem(it, sectionsNow) })),
    ...needAlt.map((im) => ({ ...leftNote('Pictures', pictureNeed(im, noAlt)), chosen: 'Left without a description.' })),
    ...pendingAi.filter((im) => !needAlt.includes(im)).map((im) => leftNote('Pictures', pictureNeed(im, unapproved))),
    ...outputErrors.map((p, i) => leftNote('Pictures', outputNeed(p, i))),
    ...(cover ? [] : [{ step: 'Files', item: 'No cover image was added', chosen: 'The placeholder cover from InDesign was kept.', how: 'left' as const, where: 'Files › Cover image' }]),
  ]
  const notesText = (o?: GateOverride) => reviewNotes({ file: epubFileName(meta!), kind: outputKind === 'standard-epub' ? 'Standard EPUB' : 'Accessible EPUB', notes: withLeft(rn.notes, leftNow()), missing: missingDetails(meta!), gate, override: o })
  const detailBlock = meta ? detailNeeds(meta) : []
  const fixDetails = async () => {
    const ai = await aiDetails(meta!, frontMatterText((analysis?.ex.blocks ?? []).flatMap((b) => (b.t === 'p' ? [b.text] : []))))
    const d = decideDetails(ai.meta, exp?.name)
    if (d.meta !== meta) (setMeta(d.meta), setStale(true))
    return { notes: [...ai.notes, ...d.notes] }
  }
  /** Fix with AI at the end: everything still unsure is decided, and the file is built and checked again */
  const fixAll = async () => {
    const s = fixStructure()
    rn.add(s.notes)
    const p = await fixPictures()
    if (!p) return
    rn.add(p.notes)
    await rebuild(undefined, p.over)
  }
  const errors = (report ? deliveryCounts(report, result?.review ?? []).errors : 0) + (ec?.errors.length ?? 0) + (a11y?.errors.length ?? 0)
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
            <FileDrop label="InDesign EPUB export" hint="the .epub InDesign made, a .zip of it, or its unzipped folder (with a Links folder, if you have one)" accept=".zip,.epub" value={exp} onPick={setExp} required folder />
            <FileDrop label="Cover image" hint="final front cover, JPG or PNG, 1600×2560 px ideal" accept="image/jpeg,image/png" value={cover} onPick={changed(setCover)} required />
            <FileDrop label="Print PDF" hint="the printed book: used to check every page number" accept="application/pdf" value={pdf} onPick={setPdf} />
            <FileDrop label="Book_Details" hint="the client’s .xlsx: file names, epub:type and roles" accept=".xlsx" value={bookDetails} onPick={changed(setBookDetails)} />
          </div>
          <Help title="Why these files?">
            <ul>
              <li><strong>InDesign export</strong> — the book text. InDesign’s export has leftovers (file names as titles, empty links, unneeded bold/italic, missing page numbers) that people used to fix by hand.</li>
              <li><strong>Cover</strong> — the export only has a placeholder cover.</li>
              <li><strong>Book_Details</strong> — the client’s workbook for this book. Each file takes the name, epub:type and role of its row; a row that matches nothing is reported.</li>
              <li><strong>Print PDF</strong> — e-books carry the printed page numbers (“go to page 45”), so classes and citations match the paper book. The PDF lets the tool put back any InDesign dropped and check all of them.</li>
            </ul>
            Nothing is uploaded: the files are read in this browser.
          </Help>
          <StepNav onNext={onAnalyse} next="Read the files" nextDisabled={!!busy} needs={fileNeeds}>
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
          <StepNav onBack={() => setStep(0)} onNext={() => setStep(2)} nextDisabled={!!busy} {...rn.choices('Book details', detailBlock, fixDetails, () => setStep(2))}>
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
            onAck={(id) => setAcked((s) => new Set([...s, id]))}
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
          <StepNav onBack={() => setStep(2)} onNext={() => go(4)} nextDisabled={!!busy} onAcceptAll={acceptAll} autoOpen {...rn.choices('Structure', structureBlock, fixStructure, () => go(4))} />
        </section>
      )}

      {step === 4 && analysis && (
        <section className="card">
          <h2>5. Describe the pictures</h2>
          <p className="muted">
            People who cannot see the pictures hear this description instead (“alt text”). Say what the picture shows, in about {settings().altMaxChars} characters, and do not repeat the caption.
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
              <div key={im.src} id={targetId('alt:' + im.src)} className={`img-row ${im.placement !== 'drop' && !im.decorative && (!im.alt.trim() || isPlaceholderAlt(im.alt)) ? 'todo' : ''} ${im.source === 'ai' && !im.approved ? 'pending' : ''}`}>
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
                      {!im.decorative && im.alt.trim().length > settings().altMaxChars && <p className="muted small">About {settings().altMaxChars} characters is easier to follow. This one is {im.alt.trim().length}.</p>}
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
                      {visionOn && <button className="ghost" onClick={() => draftImages([im])} disabled={!!busy}>Draft again</button>}
                    </>
                  )}
                </div>
              </div>
              )
            })}
          </div>
          {outputProblems.length > 0 && (
            <ul className="review">
              {outputProblems.map((p) => (
                <li key={p.message} className={p.level === 'error' ? 'error' : 'warn'}>{p.message}</li>
              ))}
            </ul>
          )}
          <StepNav onBack={() => setStep(3)} onNext={() => rebuild(5)} next="Build and check" nextDisabled={!!busy} autoOpen={outputErrors.length > 0} {...rn.choices('Pictures', pictureNeeds, fixPictures, (over) => rebuild(5, over))}>
            {outputErrors.length ? 'Some settings do not fit this kind of e-book.' : needAlt.length ? `${needAlt.length} picture(s) still need a description.` : ''}
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
          <AccessibilityBox result={a11y} />
          <CheckReportView report={report} review={result.review} epubcheckErrors={(ec?.errors.length ?? 0) + (a11y?.errors.length ?? 0)} />
          <div className="row">
            <GatedDownload gate={stale ? undefined : gate} data={result.epub} name={epubFileName(meta)} type="application/epub+zip" label="Download EPUB" notes={notesText} onFix={fixAll} busy={!!busy} ctx={{ client: meta.publisher, book: meta.eisbn || meta.title, specHash: spec ? specHash(spec.resolved.settings) : undefined }} />
            <button onClick={() => rebuild()} disabled={!!busy}>Build and check again</button>
          </div>
          <ReviewSummary notes={withLeft(rn.notes, leftNow())} missing={missingDetails(meta)} build={{ file: epubFileName(meta), kind: 'EPUB' }} />
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
