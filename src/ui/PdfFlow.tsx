import { useMemo, useRef, useState } from 'react'
import { FileDrop, type Picked } from './FileDrop.tsx'
import { BookDetails, remember, useObjectUrls } from './shared.tsx'
import { Steps, StepNav, Help, Status, Outline, CheckReportView, EpubcheckBox, runEpubcheck, AccessibilityBox, runAccessibility, type A11yResult, ComparePrint, flaggedPages } from './wizard.tsx'
import type { ValidatorResult } from '../engine/check/gate.ts'
import { reviewList, blockingItems, acceptable } from '../engine/review/confidence.ts'
import type { PrintPage } from '../engine/pdf/pages.ts'
import { browserRaster } from './raster-browser.ts'
import { PDF_ROLES, PDF_ROLE_HELP, type PdfBook, type PdfProfile, type PdfRole, type PdfStyleInfo } from '../engine/pdfepub/analyze.ts'
import type { PdfBuildResult } from '../engine/pdfepub/build.ts'
import { rulesFor, type CopyrightRules } from '../engine/epub/imprint.ts'
import { checkEpub, type CheckReport } from '../engine/check/epub.ts'
import { deliveryCounts } from '../engine/check/counts.ts'
import { isbn13Valid, epubFileName, type BookMeta } from '../engine/epub/package.ts'
import { ALT_SOURCE_LABEL, isPlaceholderAlt, type SpecPicture } from '../engine/epub/alt.ts'
import { draftPictureAlts, mimeOf, visionConfig } from '../engine/epub/alt-ai.ts'
import { readRequirements } from '../engine/spec/requirements.ts'
import type { WordBook } from '../engine/wordepub/read.ts'
import { jobChoice, profileFor } from './job-choice.ts'
import { settings, setSettings, houseSettings } from '../engine/settings.ts'
import { GatedDownload } from './GatedDownload.tsx'
import { openSpec, applyBookDetailsToSpec } from '../engine/spec/session.ts'
import { collectGate, uiStages, type ExportGate } from '../engine/check/exportgate.ts'
import { outputViolations, defaultFor } from '../engine/output/standards.ts'
import { structureNeeds, detailNeeds, targetId, keepStylePatch, type Need } from './needs.ts'
import { useReviewNotes, ReviewSummary } from './ReviewNotes.tsx'
import { aiDetails, frontMatterText } from '../engine/review/ai-fix.ts'
import { decideDetails, decideStructure, leftNote, missingDetails, reviewNotes, whereOfItem, withLeft, type DecisionNote } from '../engine/review/decisions.ts'
import { placeholderCover } from '../engine/epub/placeholder-cover.ts'
import { ruleById } from '../engine/spec/rules.ts'
import type { GateOverride } from '../engine/check/exportgate.ts'

// Print PDF, or a Word manuscript read from its heading styles, → EPUB 3. A .docx is the source when
// one is attached; otherwise the print PDF is. The cover is a JPG or PNG. The vision key stays in Settings.

type AiDraft = { alt: string; longDesc?: string; approved: boolean; decorative?: boolean }
/** values for the next build that were set a moment ago (state set in the same click is not seen by the build yet) */
type Over = { alt?: Record<string, string>; ai?: Record<string, AiDraft>; pictures?: SpecPicture[]; meta?: BookMeta; fix?: Record<string, unknown> }

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
  const [bookDetails, setBookDetails] = useState<Picked>()
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
  const [ec, setEc] = useState<ValidatorResult | null>()
  const [a11y, setA11y] = useState<A11yResult | null>()
  const [gate, setGate] = useState<ExportGate>()
  const [alt, setAlt] = useState<Record<string, string>>({})
  const [ai, setAi] = useState<Record<string, AiDraft>>({})
  const [specPictures, setSpecPictures] = useState<SpecPicture[]>([])
  const [stale, setStale] = useState(true)
  const [layout, setLayout] = useState<PrintPage[]>()
  const [navs, setNavs] = useState<Record<number, string>>({})
  const [acked, setAcked] = useState<Set<string>>(new Set())
  /** settings the tool set to fit the kind of e-book chosen (Fix with AI); they apply to this book's builds only */
  const [fixedSettings, setFixedSettings] = useState<Record<string, unknown>>({})
  const rn = useReviewNotes()
  const scCache = useRef<{ key: string; words: string[] } | undefined>(undefined)

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
    run(docx ? 'Reading the Word manuscript…' : 'Loading the PDF reader…', async () => {
      setResult(undefined)
      setLayout(undefined)
      setAlt({})
      setAi({})
      setSpecPictures([])
      setNavs({})
      setAcked(new Set())
      setFixedSettings({})
      rn.clear()
      setStale(true)
      if (docx) {
        const { readWordBook } = await import('../engine/wordepub/read.ts')
        const wb = readWordBook(docx.data)
        const savedRules = remember<CopyrightRules>('copyright', wb.publisher)
        setWordBook(wb)
        setBook(undefined)
        setStyles([])
        setRules(savedRules ?? rulesFor(wb.language))
        const base = emptyMeta(wb)
        const chosen = profileFor(jobChoice()?.output)
        setMeta(chosen ? { ...base, profile: chosen } : base)
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
      const chosen = profileFor(jobChoice()?.output)
      setMeta(chosen ? { ...b.meta, profile: chosen } : b.meta)
      setStep(1)
    })

  /** the client's Book_Details file, read by the spec loader onto the book's layer (recorded in the log); only it is taken from the spec here */
  const bookDetailsSettings = async () => {
    if (!bookDetails) return undefined
    let sp = await openSpec({ client: meta!.publisher, series: '', book: meta!.eisbn || meta!.title })
    if (sp.layers.find((l) => l.level === 'book')?.bookDetails?.source !== bookDetails.name) {
      const bd = readRequirements(bookDetails.name, bookDetails.data).bookDetails
      if (!bd) throw new Error(`“${bookDetails.name}” is not a Book_Details file: it has no NAV-NCX sheet with a “Chapter Name” column.`)
      sp = await applyBookDetailsToSpec(sp, 'book', bd, 'reviewer')
    }
    return { bookDetails: sp.resolved.settings.bookDetails, bookDetailsNav: sp.resolved.settings.bookDetailsNav }
  }
  const rebuild = async (then?: number, over?: Over) => {
    const details = await bookDetailsSettings()
    const extra = { ...details, ...fixedSettings, ...over?.fix }
    if (Object.keys(extra).length) setSettings({ ...houseSettings(), ...extra })
    try {
      await rebuildBook(then, over)
    } finally {
      if (Object.keys(extra).length) setSettings(houseSettings())
    }
  }
  const rebuildBook = async (then?: number, over?: Over) => {
    setGate(undefined)
    const altNow = over?.alt ?? alt
    const aiNow = over?.ai ?? ai
    const picsNow = over?.pictures ?? specPictures
    const metaNow = over?.meta ?? meta!
    let coverImg = cover ?? placeholderCover() // no cover must not stop the export: a plain one is used and the review notes say so
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
    let lay = layout
    if (wordBook) {
      const { buildWordEpub } = await import('../engine/wordepub/build.ts')
      let printPages: { n: string; text: string }[] | undefined
      let smallCapWords: string[] | undefined
      if (pdf && (settings().wordPagesFromPdf || settings().wordSmallCapsFromPdf)) {
        const { printPagesOf, pdfjs } = await import('./pdf.ts')
        if (settings().wordPagesFromPdf) {
          if (!lay) {
            setLayout((lay = await printPagesOf(pdf.data, (done, total) => {
              setBusy(`Reading the print PDF, page ${done} of ${total}…`)
              setProgress({ done, total })
            })))
          }
          printPages = lay.filter((p) => !p.blank && !p.bare && p.text.trim().length >= 24).map((p) => ({ n: p.n, text: p.text }))
        }
        if (settings().wordSmallCapsFromPdf) {
          const key = `${pdf.name}:${pdf.data.byteLength}`
          if (scCache.current?.key !== key) {
            setBusy('Reading small caps from the print PDF…')
            const { smallCapTokensOf } = await import('../engine/pdf/layout.ts')
            scCache.current = { key, words: await smallCapTokensOf(pdfjs, pdf.data) }
          }
          smallCapWords = scCache.current.words
        }
      }
      r = buildWordEpub(wordBook, { meta: metaNow, cover: { name: coverImg.name, data: coverImg.data }, alt: altNow, pictures: picsNow, ai: aiNow, sectionNav: navs, printPages, smallCapWords })
    } else {
      const { buildPdfEpub } = await import('../engine/pdfepub/build.ts')
      r = await buildPdfEpub(book!, { styles, meta: metaNow, rules, cover: coverImg, alt: altNow, pictures: picsNow, ai: aiNow, sectionNav: navs }, browserRaster)
    }
    setResult(r)
    // `alt` stays the reviewer's own text. Copying the resolved description in here would make the
    // next build treat a spec row, an image-file text, or an AI draft as something the reviewer typed.
    setProgress({ done: 1, total: 2 })
    if (pdf && !lay) {
      const { printPagesOf } = await import('./pdf.ts')
      setLayout((lay = await printPagesOf(pdf.data, (done, total) => {
        setBusy(`Reading the print PDF, page ${done} of ${total}…`)
        setProgress({ done, total })
      })))
    }
    setBusy('Checking the e-book…')
    setProgress({ done: 2, total: 2 })
    const rep = checkEpub(r.files, { ...r.source, printLayout: lay })
    setReport(rep)
    const ecNow = await runEpubcheck(r.epub)
    setEc(ecNow)
    const a11yNow = await runAccessibility(r.epub)
    setA11y(a11yNow)
    // VAL-001: every guard and EPUBCheck, before any download
    setGate(collectGate({ report: rep, review: r.review, stages: uiStages(r.files, settings(), ecNow, a11yNow) }))
    setStale(false)
    if (book) remember('pdfprofile', metaNow.publisher, Object.fromEntries(styles.map((s) => [s.key, s.role])))
    remember('copyright', metaNow.publisher, rules)
    if (then !== undefined) setStep(then)
  }
  const buildAnd = (then?: number, over?: Over) => run('Building the e-book…', () => rebuild(then, over))
  const go = (i: number, over?: Over) => (i >= 2 && (stale || !result) ? buildAnd(i, over) : setStep(i))
  const setRole = (key: string, role: PdfRole) => (setStyles((s) => s.map((x) => (x.key === key ? { ...x, role, unsure: false } : x))), setStale(true))

  const ready = !!book || !!wordBook
  const structureReview = result && meta
    ? reviewList({
        styles: styles.map((s) => ({ ...s, outClass: '', role: 'p' as const, unsure: s.unsure, reason: s.reason, evidence: undefined, action: undefined })),
        sources: {},
        meta,
        sections: result.sections.map((s, i) => ({ type: s.type, nav: (navs[i] ?? '').trim() || s.nav })),
        notes: [],
        noteFindings: book?.notes,
      })
    : undefined
  const blocking = structureReview ? blockingItems(structureReview.items, acked) : []
  const sectionsNow = (result?.sections ?? []).map((s, i) => ({ nav: (navs[i] ?? '').trim() || s.nav, file: s.file }))
  const structureBlock = structureNeeds(blocking, acceptable, (it) => whereOfItem(it, sectionsNow))
  /** Fix with AI on the Structure step: keep the tool's best reading of every unsure item. Nothing changes in the book. */
  const fixStructure = () => {
    const d = decideStructure(blocking, { roleOf: (k) => styles.find((x) => x.key === k)?.role, typeOf: (i) => result?.sections[i]?.type, valueOf: (f) => (meta as unknown as Record<string, string> | undefined)?.[f], sections: sectionsNow })
    setStyles((ss) => ss.map((x) => (d.keepStyles.includes(x.key) ? { ...x, unsure: false, reason: 'kept as read by the reviewer' } : x)))
    setAcked((a) => new Set([...a, ...d.ack]))
    return { notes: d.notes }
  }
  const todo = result ? result.pictures.filter((p) => needsPictureDescription(p, alt)) : []
  const pendingAi = result ? result.pictures.filter((p) => p.source === 'ai' && !p.approved && (p.decorative || (!!p.alt.trim() && !isPlaceholderAlt(p.alt)))) : []
  const visionOn = !!visionConfig().apiKey.trim()
  const errors = (report ? deliveryCounts(report, result?.review ?? []).errors : 0) + (ec?.errors.length ?? 0) + (a11y?.errors.length ?? 0)
  const outputKind = (meta?.profile ?? settings().defaultProfile) === 'standard' ? 'standard-epub' as const : 'accessible-epub' as const
  const outputProblems = meta ? outputViolations(outputKind, { ...settings(), ...fixedSettings }) : []
  const outputErrors = outputProblems.filter((p) => p.level === 'error')
  const fileOf = (path: string) => path.replace('images/', '')
  const noAlt = 'no description yet'
  const unapproved = 'AI description not approved yet'
  const pictureNeed = (path: string, why: string): Need => ({ id: 'alt:' + path, label: `Picture ${fileOf(path)}: ${why}`, group: 'picture', kind: 'choice', target: targetId('alt:' + path), where: `picture file ${fileOf(path)}` })
  const outputNeed = (p: { message: string; ruleId?: string }, i: number): Need => ({ id: 'output:' + i, label: p.message, group: 'setting', kind: 'choice', where: p.ruleId ? `rule ${p.ruleId}` : undefined })
  const coverNeed: Need = { id: 'cover:missing', label: 'No cover image was added: a plain placeholder cover is used', group: 'cover image', kind: 'choice', where: 'Files › Cover image' }
  const buildNeeds: Need[] = [...(meta ? detailNeeds(meta) : []), ...(cover ? [] : [coverNeed]), ...outputErrors.map(outputNeed)]
  const pictureNeeds: Need[] = [...todo.map((p) => pictureNeed(p.path, noAlt)), ...pendingAi.filter((p) => !todo.includes(p)).map((p) => pictureNeed(p.path, unapproved))]
  /** Fix with AI before the build: title from the file name, a standard value for a setting that does not fit, a placeholder cover. */
  const fixBuild = async (): Promise<{ notes: DecisionNote[]; over: Over }> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const lines: string[] = book ? book.pages.slice(0, 10).flatMap((p) => p.lines.map((l) => l.text)) : (wordBook?.blocks ?? []).slice(0, 300).map((x) => String((x as any).text ?? ''))
    const ai = await aiDetails(meta!, frontMatterText(lines))
    const d = decideDetails(ai.meta, (docx ?? pdf)?.name)
    const notes = [...ai.notes, ...d.notes]
    if (d.meta !== meta) (setMeta(d.meta), setStale(true))
    const fix = { ...fixedSettings }
    for (const p of outputErrors.filter((x) => x.ruleId)) {
      const key = ruleById.get(p.ruleId!)?.key
      const v = defaultFor(outputKind, p.ruleId!).value
      if (!key || v === undefined) continue
      fix[key] = v
      notes.push({ step: 'Book details', item: p.message, chosen: `Set rule ${p.ruleId} to ${String(v)}, the value the ${outputKind === 'standard-epub' ? 'Standard' : 'Accessible'} EPUB standard asks for.`, how: 'guess', where: `rule ${p.ruleId}` })
    }
    setFixedSettings(fix)
    if (!cover) notes.push({ step: 'Book details', item: coverNeed.label, chosen: 'A plain placeholder cover was used. Add the real cover before publishing.', how: 'guess', where: coverNeed.where })
    return { notes, over: { meta: d.meta, fix } }
  }
  /** asks the vision model for the pictures given; nothing is set here */
  const draftNext = async (paths: string[]) => {
    const targets = result!.pictures.filter((p) => paths.includes(p.path))
    const drafted = await draftPictureAlts(
      targets.map((p) => {
        const bytes = result!.files.get(`OEBPS/${p.path}`) ?? new Uint8Array()
        return { id: p.path, bytes, mime: mimeOf(p.path, bytes), caption: p.caption, nearby: '' }
      }),
      meta?.language || wordBook?.language || book?.meta.language || 'en',
      visionConfig(),
      (done, total) => setProgress({ done, total }),
    )
    const next = { ...ai }
    for (const d of drafted) if (d.alt || d.longDesc || d.decorative) next[d.id] = { alt: d.alt, longDesc: d.longDesc, decorative: d.decorative, approved: false }
    return { next, drafted }
  }
  /** Fix with AI on the pictures: the vision model describes the ones without a description (when a key is set) and every AI draft is approved. */
  const fixPictures = (): Promise<{ notes: DecisionNote[]; over: Over } | undefined> =>
    run('Deciding the pictures…', async () => {
      if (!result) return { notes: [], over: {} }
      let next = { ...ai }
      if (visionOn && todo.length) {
        const r = await draftNext(todo.map((p) => p.path))
        next = r.next
        const failed = r.drafted.find((d) => d.error)
        if (failed) setNotice(failed.error)
      }
      const notes: DecisionNote[] = []
      for (const p of result.pictures.filter((x) => todo.includes(x) || pendingAi.includes(x))) {
        const need = pictureNeed(p.path, todo.includes(p) ? noAlt : unapproved)
        const cur = next[p.path]
        const text = cur?.alt || p.alt
        const has = !!cur?.decorative || p.decorative || (!!text.trim() && !isPlaceholderAlt(text))
        if (has && (cur || p.source === 'ai')) {
          next[p.path] = { alt: text, longDesc: cur?.longDesc || p.longDesc, decorative: cur?.decorative ?? p.decorative, approved: true }
          notes.push({ step: 'Pictures', item: need.label, chosen: next[p.path].decorative ? 'The picture AI marked it decorative; accepted without a person reading it.' : `The picture AI wrote “${text}”; accepted without a person reading it.`, how: 'ai', where: need.where })
        } else notes.push({ ...leftNote('Pictures', need), chosen: visionOn ? 'The picture AI gave no description. Left without one.' : 'No picture AI is set up (add a key in Settings), so it is left without a description.' })
      }
      setAi(next)
      setStale(true)
      return { notes, over: { ai: next } }
    })
  /** What is still unsure when the file is made, written next to what was decided on the way. */
  const leftNow = (): DecisionNote[] => [
    ...(structureReview?.items ?? []).filter((it) => !acked.has(it.id)).map((it) => leftNote('Structure', { label: it.title, where: whereOfItem(it, sectionsNow) })),
    ...todo.map((p) => ({ ...leftNote('Pictures', pictureNeed(p.path, noAlt)), chosen: 'Left without a description.' })),
    ...pendingAi.filter((p) => !todo.includes(p)).map((p) => leftNote('Pictures', pictureNeed(p.path, unapproved))),
    ...outputErrors.map((p, i) => leftNote('Book details', outputNeed(p, i))),
    ...(cover ? [] : [{ step: 'Book details', item: coverNeed.label, chosen: 'A plain placeholder cover was used. Add the real cover before publishing.', how: 'left' as const, where: coverNeed.where }]),
  ]
  const notesText = (o?: GateOverride) => reviewNotes({ file: epubFileName(meta!), kind: outputKind === 'standard-epub' ? 'Standard EPUB' : 'Accessible EPUB', notes: withLeft(rn.notes, leftNow()), missing: missingDetails(meta!), gate, override: o })
  /** Fix with AI at the end: the structure and the pictures are decided, then the file is built and checked again */
  const fixAll = async () => {
    rn.add(fixStructure().notes)
    const p = await fixPictures()
    if (!p) return
    rn.add(p.notes)
    await buildAnd(undefined, p.over)
  }
  const steps = [
    { title: 'Files', hint: wordBook ? 'Word manuscript and cover' : 'print PDF and cover', enabled: true, done: ready },
    { title: 'Book details', hint: 'title, ISBN, copyright', enabled: ready, done: !!meta && isbn13Valid(meta.eisbn) },
    { title: 'Structure', hint: 'chapters and pages', enabled: ready, done: !!result && step > 2 },
    { title: 'Pictures', hint: 'descriptions', enabled: !!result, done: !!result && todo.length === 0 },
    { title: 'Check & download', hint: 'quality report', enabled: !!result, done: !!report && !stale && errors === 0 },
  ]

  const draftPictures = (paths: string[]) =>
    run(paths.length === 1 ? 'Drafting a description…' : 'Drafting picture descriptions…', async () => {
      if (!result) return
      const { next, drafted } = await draftNext(paths)
      setAi(next)
      const failed = drafted.filter((d) => d.error)
      setNotice(failed[0]?.error ?? `Drafted ${drafted.filter((d) => d.alt || d.decorative).length} description(s). Each one needs approval.`)
      await rebuild(undefined, { ai: next })
    })

  const approve = (paths: string[]) => {
    if (!result) return
    const next = { ...ai }
    for (const id of paths) {
      const cur = next[id]
      const pic = result.pictures.find((p) => p.path === id)
      next[id] = { alt: cur?.alt || pic?.alt || '', longDesc: cur?.longDesc || pic?.longDesc, decorative: cur?.decorative ?? pic?.decorative, approved: true }
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
            <FileDrop label="Book_Details" hint="the client’s .xlsx: file names, epub:type and roles" accept=".xlsx" value={bookDetails} onPick={(b) => (setBookDetails(b), setStale(true))} />
          </div>
          <Help title="Word manuscript or print PDF?">
            <ul>
              <li><strong>Word</strong> — the chapters are the Heading 1 styles (Überschrift 1, Titre 1, and the same styles in other languages) that the book’s own contents list names. Lists, tables and page breaks are kept. A paragraph marked “run on”, or one that continues a sentence, joins the line above.</li>
              <li><strong>Print PDF</strong> — used when there is no Word file. Text, fonts, pictures and page numbers are read from the published pages. Attach it beside a Word file only to compare those pages afterwards.</li>
              <li><strong>Cover</strong> — a JPG or PNG. The manuscript does not include the final cover.</li>
            </ul>
            Nothing is uploaded: the files are read in this browser.
          </Help>
          <StepNav onNext={onAnalyse} next={docx ? 'Read the Word file' : 'Read the PDF'} nextDisabled={!!busy} needs={!pdf && !docx ? [{ id: 'file:source', label: 'Add the print PDF or the Word manuscript', group: 'source file', kind: 'choice' }] : []} />
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
          {outputProblems.length > 0 && (
            <ul className="review">
              {outputProblems.map((p) => (
                <li key={p.message} className={p.level}>{p.message}</li>
              ))}
            </ul>
          )}
          <StepNav
            onBack={() => setStep(0)}
            onNext={() => go(2)}
            next="Build the e-book"
            nextDisabled={!!busy}
            onMyself={!cover && buildNeeds.every((n) => n === coverNeed) ? () => setStep(0) : undefined}
            {...rn.choices('Book details', buildNeeds, fixBuild, (over) => go(2, over))}
          >
            {outputErrors.length ? 'Some settings do not fit this kind of e-book.' : !cover ? 'No cover yet: a plain one is used until you add it in step 1.' : ''}
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
          {structureReview && structureReview.items.length > 0 && (
            <section className="check-first" aria-label="Check these first">
              <h3>Check these first</h3>
              <ol>
                {structureReview.items.map((it) => (
                  <li key={it.id} id={targetId(it.id)}>
                    <span className={`flag ${it.confidence}`}>{it.confidence === 'low' ? 'not sure' : 'please look'}</span> <span className="muted small">{Math.round(it.score * 100)}%</span> <strong>{it.title}</strong>
                    <div className="muted small">{it.why}</div>
                  </li>
                ))}
              </ol>
            </section>
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
          <StepNav onBack={() => setStep(1)} onNext={() => setStep(3)} {...rn.choices('Structure', structureBlock, fixStructure, () => setStep(3))} />
        </section>
      )}

      {step === 3 && result && (
        <Pictures
          result={result}
          alt={alt}
          setAlt={(a) => (setAlt(a), setStale(true))}
          onBack={() => setStep(2)}
          onNext={() => buildAnd(4)}
          choices={rn.choices('Pictures', pictureNeeds, fixPictures, (over) => buildAnd(4, over))}
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
          <EpubcheckBox result={ec} />
          <AccessibilityBox result={a11y} />
          <CheckReportView report={report} review={result.review} epubcheckErrors={(ec?.errors.length ?? 0) + (a11y?.errors.length ?? 0)} />
          <div className="row">
            <GatedDownload gate={stale ? undefined : gate} data={result.epub} name={epubFileName(meta)} type="application/epub+zip" label="Download EPUB" notes={notesText} onFix={fixAll} busy={!!busy} ctx={{ client: meta.publisher, book: meta.eisbn || meta.title }} />
          </div>
          <ReviewSummary notes={withLeft(rn.notes, leftNow())} missing={missingDetails(meta)} build={{ file: epubFileName(meta), kind: 'EPUB' }} />
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

function Pictures({ result, alt, setAlt, onBack, onNext, choices, busy, todo, pending, visionOn, onDraft, onDraftOne, onApprove, onApproveAll, onSheet }: {
  result: PdfBuildResult
  alt: Record<string, string>
  setAlt: (a: Record<string, string>) => void
  onBack: () => void
  onNext: () => void
  /** Fix with AI / Continue anyway for the pictures that still need a description */
  choices: { needs: Need[]; onFix: () => void; onContinueAnyway: () => void }
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
  const urls = useObjectUrls(useMemo(() => result.pictures.map((p) => [p.path, result.files.get(`OEBPS/${p.path}`)!] as [string, Uint8Array]), [result]))
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
            <div key={p.path} id={targetId('alt:' + p.path)} className={`img-row ${needsPictureDescription(p, alt) ? 'todo' : ''} ${openDraft ? 'pending' : ''}`}>
              <img src={urls.get(p.path)} alt="" loading="lazy" />
              <div>
                <code>{p.path.replace('images/', '')}</code>
                {p.alt || p.decorative ? <span className={`src-badge ${p.source}${openDraft ? ' pending' : ''}`}>{ALT_SOURCE_LABEL[p.source]}{openDraft ? ' · needs approval' : ''}</span> : null}
                {p.caption && <div className="why">Caption: {p.caption}</div>}
                {p.longDesc && <div className="why">Long description: {p.longDesc}</div>}
                {p.decorative && !(alt[p.path] ?? '').trim() ? (
                  <div className="why">A screen reader skips this picture. Type a description below to treat it as content instead.</div>
                ) : null}
                <label className="alt">
                  <span>Description</span>
                  <textarea rows={2} value={shownDescription(p, alt)} placeholder={p.decorative ? '(decorative — leave empty)' : ''} onChange={(e) => setAlt({ ...alt, [p.path]: e.target.value })} />
                </label>
                {openDraft && <button onClick={() => onApprove(p.path)} disabled={busy}>Approve</button>}
                {visionOn && <button className="ghost" onClick={() => onDraftOne(p.path)} disabled={busy}>Draft again</button>}
              </div>
            </div>
          )
        })}
      </div>
      <StepNav onBack={onBack} onNext={onNext} next="Build and check" nextDisabled={busy} {...choices}>
        {todo ? `${todo} picture(s) still need a description.` : ''}
      </StepNav>
    </section>
  )
}
