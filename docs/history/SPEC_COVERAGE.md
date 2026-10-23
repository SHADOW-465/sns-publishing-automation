# Spec coverage

Every requirement in the client spec materials, mapped to **done / partly / missing**, with the
file:function where it lives (or why it is missing). Code paths are under `automation-app/src/`.

Spec materials read for this map (all in `corrections/`):

- `Accesible(EPUB)_Language_Automation_Specification_*.xlsx` — accessibility labels per language
- `Standard(EPUB)_Automation_Specification_*.xlsx` — Standard-EPUB tag templates per content element
- `Standard-Vs-Accesible(EPUB)_Tag-Differences_*.xlsx` — what the accessible profile adds
- `EPUB-Automation-Update_*.docx` and `EPUB-Automation-Update-V3_*.docx` — InDesign→EPUB defect list
- `Word-EPUB-Automation-Update-V1_*.docx` — Word(.docx)→EPUB defect list
- `Accessible-PDF-Automation_Updates_V1_*.docx` + both `*_PAC_UA_Report_*.pdf` — PDF/UA defect list
- `FORGE_STATUS.md`, `forge_task.md` — prior work log (`ux_report.md` not present)

Legend: **done** = implemented and tested; **partly** = present but incomplete or not wired the way
the task asks; **missing** = not implemented.

---

## A. Accessible-EPUB language spec (localized a11y labels)

| Requirement | Status | Location / why |
|---|---|---|
| `xml:lang` on `<html>`, no duplicate `lang`+`xml:lang` | done | `engine/settings.ts:htmlLangAttrs` (default mode emits only `xml:lang`); used `epub/package.ts`, `epub/xml.ts` |
| `dc:language` in OPF | done | `epub/package.ts` (`<dc:language>`) |
| Page marker `<span epub:type="pagebreak" role="doc-pagebreak" id="page-N" aria-label title>` | done | `indesign/build.ts:pageSpan`; PDF path `pdfepub/build.ts:marker` |
| `<title>` = localized "Chapter N" | done | section title render, `epub/locale.ts:TABLE` (`chapter`) |
| Nav `<title>` = localized "Table of Contents" | done | `epub/package.ts` nav build + `locale.ts` (`navTitle`) |
| Landmarks nav (Cover / Title Page / Start Reading), localized | done | `epub/package.ts` (`epub:type="landmarks"`) + `locale.ts` (`cover`/`title`/`startReading`) |
| aria-label on Title / Author / Publisher | done | front-matter render, `indesign/front.ts` + locale labels |
| `img alt` default + decorative label per language | done | `epub/locale.ts` (`imageAlt`/`decorativeAlt`); applied in alt settle |
| Label table for de/fr/es/it/pt (+ more) | done | `epub/locale.ts:TABLE` (de/fr/es/it/pt/en/nl/pl/sv/da/tr/ru/el/ar/he) |
| Localized labels tunable per client (layered rule) | done | `spec/requirements.ts:labelsFromWorkbook` → `spec/session.ts:applyLabels` → `Layer.labels` in `spec/layers.ts:resolve` → `epub/locale.ts:labelsFor`. A second region stays on its own tag (`es-mx`), so the Spanish column does not replace the Mexican cover and title-page words |

## B. Standard-EPUB tag templates

| Element | Status | Location |
|---|---|---|
| html prolog / namespaces | done | `epub/xml.ts` |
| Headings (`<h1 class="chapter">`) | done | `indesign/build.ts:renderHeading` |
| Bold/italic `<b>`/`<i>` | done | `indesign/inline.ts` |
| Figure + caption (`fig_group`) | done | `indesign/build.ts:pictureHtml` (sibling caption); PDF path uses `<figure><figcaption>` `pdfepub/build.ts` |
| Unordered / ordered list | done | `STD-04`, list render |
| Quote / extract | done | `STD-05`; extract classes `indesign/build.ts` |
| Table | done | `STD-06`, `TBL-01/02` |
| External link | done | inline anchor render |
| Footnote (`<sup class="super"><a>`) | done | `NOTE-01/02/03`, `STD-07` |
| Page break | done | see A |
| Per-element Standard vs Accessible switch (STD-01…12) | done | `spec/rules.ts` STD-01…STD-12, tested `standard.test.ts` |

## C. Standard vs Accessible differences (accessible profile additions)

| Difference | Status | Location |
|---|---|---|
| `role="heading"` + `aria-level` on headings | done | `indesign/build.ts:renderHeading` (rules `HD-01`/`HD-02`) |
| `<section epub:type role="doc-chapter" aria-labelledby>` | done | `indesign/build.ts`; type/role table `epub/locale.ts:SECTION_META` |
| Inner `<div xml:lang>` language wrapper | done | `epub/package.ts:langDiv` (rules `DOC-01`/`DOC-02`/`STD-11`) |
| Accessibility metadata (schema:accessMode etc.) in OPF | done | `epub/package.ts` a11y block (driven by profile `DOC-00`) |
| section / epub:type exposed as a client rule | partly | only via `DOC-00` profile + `STD-10`; no dedicated epub:type rule |
| a11y metadata exposed as a client rule | partly | emitted by profile, not a tunable rule |

## D. InDesign→EPUB defect list (EPUB-Automation-Update, V3)

| Defect (client comment) | Status | Location |
|---|---|---|
| `role="heading"` missing | done | `indesign/build.ts:renderHeading` |
| Small-caps style missing in heading | done | `indesign/build.ts` seriesCaps + `inline.ts:smallCaps` |
| Extract/quote paragraph class missing | done | `indesign/build.ts` extract classes, `STD-05` |
| `xml:lang` div missing | done | `epub/package.ts:langDiv` |
| Duplicated language should be removed | done | `settings.ts:htmlLangAttrs` default `xml:lang` only |
| Heading top/bottom space & size, TOC indent, footnote indent | done | V3 rows 16–20 rules, tested `rules.test.ts` ("V3 rows 16–20") |
| Order by vertical / page-number placement | done | reading order `indesign/build.ts`; page markers in spine order |
| Table structure / extra tags | done | `TBL-02` (clean widths), table render |

## E. Word(.docx)→EPUB defect list (Word-EPUB-Automation-Update)

| Requirement | Status | Location / why |
|---|---|---|
| Chapter splitting matches book TOC | done | `wordepub/read.ts:readWordBook` (Heading/Überschrift/outline level) and `wordepub/build.ts:buildWordEpub` (a level-1 heading starts a chapter only when the manuscript’s own contents list names it; otherwise it stays an h2) |
| TOC/Nav/NCX matches sample | done | chapter titles become `Section.nav`; `epub/package.ts:packageEpub` writes `nav.xhtml` and `toc.ncx`. Contents-styled paragraphs are not a second contents list |
| Page-break spans placed correctly | done | `wordepub/read.ts:inlinesOf` — `w:br` page, `w:lastRenderedPageBreak`, and `w:pageBreakBefore` become an inline `pagebreak` span. A PAGE field supplies the number. DATE and TIME field results are dropped |
| Run-on paragraphs merged with previous line | done | `wordepub/read.ts` (`run on` / `noindent` / a lowercase continuation) and `wordepub/build.ts` joins that paragraph onto the previous line |
| Lists converted | done | `w:numPr` plus `numbering.xml` → `ul` / `ol` in `wordepub/build.ts` |
| Tables converted | done | `w:tbl` → `table`/`thead`/`th` in `wordepub/build.ts` (header row from `w:tblHeader` or a bold first row) |

> A `.docx` on the PDF or Word screen is the manuscript (`ui/PdfFlow.tsx`). `spec/office.ts:readDocx` is
> still the plain-text reader for a requirements file, not the manuscript.

## F. Accessible-PDF (PDF/UA) defect list + PAC reports

| Requirement | Status | Location / why |
|---|---|---|
| Real tagged PDF (`/StructTreeRoot`, `/MarkInfo /Marked true`) | done | `pdfua/write.ts:writeUa` |
| Structure elements P, H1–H6, Figure, L/LI, Note, TOC, Caption | done | `pdfua/structure.ts:buildStructure` |
| Table/TR/TD/TH structure | done | `pdf/tables.ts:detectTables`; header cells are TH with `/Scope` (and RowSpan/ColSpan when the cell spans) in `pdfua/write.ts` |
| Reading order | done | `pdfua/structure.ts` (columns, XY-cut) + MCID assignment `write.ts` |
| Alt text on figures (`/Alt`), missing-alt blocks export | done | `pdfua/write.ts`; alt from `pdfua/altdocx.ts:matchAlt` + reviewer/AI |
| Alt via the same layered system as InDesign | done | `pdfua/index.ts:figureChoice` — typed, then spec sheet, then file text, then a decorative mark, then an unapproved AI draft |
| Document `/Lang` + XMP dc:language | done | `pdfua/write.ts` (`setLanguage`, XMP) |
| Per-element `/Lang` | done | `pdfua/write.ts` sets `/Lang` when `lang.ts:confidentLanguage` differs from the document’s two-letter language |
| Bookmarks / `/Outlines` + `PageMode UseOutlines` | done | `pdfua/write.ts` outline build |
| Title in docinfo + XMP + `DisplayDocTitle true` | done | `pdfua/write.ts`; verified `pdfua/check.ts` |
| Artifacts for headers/footers/page numbers/slug | done | `pdfua/write.ts` (untagged margin content, slug→null owner) |
| Figure + caption in order | done | `pdfua/structure.ts` figure/caption pairing |
| Notes linked to their reference marks | done | `pdfua/write.ts` — Reference > Link on the note number, Dest to the note, back-link, Note `/ID` `note-{page}-{id}` |
| Decorative image → `/Artifact` | done | `pdfua/index.ts` drops the Figure and clears line ownership; unowned paints are `/Artifact BMC` in `pdfua/content.ts` |
| Internal Matterhorn-style checker | done | `pdfua/check.ts:checkUa` |
| Validate with veraPDF / open checker | missing | veraPDF is not installed (Java 8 is). The two PAC reports are one-page summaries, not Matterhorn line items. Manual conversion passes PDF/UA-1; the tool-converted file fails (2,643 PDF-syntax failures, 1 structure element, 2 metadata). PAC was not re-run on a file this tool wrote. |

## G. Quality checker (honest) — shared by both EPUB flows

| Check | Status | Location |
|---|---|---|
| Fails when no headings | done | `check/epub.ts` (~:319) |
| Fails when TOC lacks chapters | done | `check/epub.ts` (~:335) |
| Fails on empty `urn:isbn` / empty dc metadata | done | `check/epub.ts` (~:126) + ISBN-13 validity |
| Fails on placeholder/missing alt (`Bild`, `Beschreibung von KI generiert`, `[Fehler`) | done | `check/epub.ts:BAD_ALT`/`altLevel` + `epub/alt.ts:isPlaceholderAlt` |
| Fails when manifest image never placed | done | `check/epub.ts` (~:443) |
| Fails when printed ISBN dropped | done | `check/epub.ts` (~:438) |
| epubcheck validation | partly | runs in tests only (`test/epubcheck.ts`, JRE+jar in `tools/`); runtime re-implements checks in `check/epub.ts` |
| PDF→EPUB output runs the same checker | done | `ui/PdfFlow.tsx` calls `checkEpub` |

## H. Rule system / spec import (layered, not hardcoded)

| Capability | Status | Location |
|---|---|---|
| client→series→book layers (house baseline) | done | `spec/layers.ts:resolve`, levels `house/client/series/book` |
| Accessibility waivers | done | `spec/layers.ts` (unwaived a11y change not applied), `spec/session.ts:giveWaiver` |
| Decision log (who/what/when) | done | `spec/store.ts:addDecision`, `spec/session.ts:log` |
| Spec workbook export + round-trip import | done | `spec/requirements.ts:specWorkbook` / `fromSpecWorkbook` |
| Client file (xlsx/docx/csv/txt) → rules by keywords | done | `spec/requirements.ts:matchByKeywords`/`valueFromText` |
| AI-assisted matching (key in localStorage only) | done | `spec/ai.ts:matchWithAi` |
| ~41 rules (DOC/PG/HD/TXT/TBL/NOTE/NAV/CSS/FM/A11Y/QA/STD) | done | `spec/rules.ts:RULES` |

---

## Gaps mapped to the task steps

**Step 1 — InDesign→EPUB language sheet (reviewed):**
- The client's language workbook (`Major-Languages-Naming`) loads as layered label overrides.
  Concepts on that sheet (page, chapter, contents, landmarks, cover, title page, start reading,
  title/author/publisher, image, decorative) map onto `locale.ts`. `es-ES` fills `es`; `es-MX` is
  stored as `es-mx` and wins for a Mexican book. The tag-sample sheet is not mistaken for the matrix.
- epub:type/section and a11y metadata are still profile-driven, not their own tunable rules (rows C "partly").

**Step 2 — PDF/Word→EPUB:**
- PDF→EPUB language is read from the text (`lang.ts:languageFromBook`, used in `pdfepub/analyze.ts`).
  A region tag in the PDF Info dictionary is kept when the text agrees (the Weigel print PDF's Info
  language is `de-DE`). A tag that clearly disagrees with the text is not kept. XMP `dc:language` is
  not read; this file has none.
- PDF→EPUB alt text uses `pdfepub/build.ts:pdfPictureAlt` (typed, then spec row, then image-file
  metadata, then a decorative rule). A caption is not reused. Decorative pictures get an empty alt
  and `role="presentation"`. A long description is written with `aria-describedby`, including on a
  front-matter picture. The picture step shows the source and does not store a resolved description
  as if the reviewer had typed it.
- The PDF screen drafts missing descriptions with the same vision model as InDesign
  (`epub/alt-ai.ts:draftPictureAlts`, key only from Settings). A draft stays unapproved until the
  reviewer accepts it (`pdfepub/build.ts:pdfPictureAlt`). “Load picture descriptions” reads the spec
  sheet (`spec/requirements.ts:pictureAltsFromWorkbook`). Typed text still wins, then the sheet.
  An open draft blocks the certification fields and is stripped from the package.
- A Word manuscript is built by `wordepub/build.ts:buildWordEpub` (row E). The print PDF remains the
  source when no `.docx` is attached.
- The PDF build and the Word build both run the same checker (`checkEpub`), including `pendingAi`.

**Step 3 — PDF/UA (implemented; not PAC-certified):**
- Tables, per-element `/Lang`, note reference links, and decorative `/Artifact` are written.
  Covered by `test/pdfua-a11y.test.ts`.
- veraPDF is not on this machine, so no PDF/UA profile run. The client PAC summaries stay the
  target: the manual Gladiators file passes; the tool-converted file fails, mostly on PDF syntax.
  Those reports do not list Matterhorn checkpoint ids, and PAC has not been run on this tool’s output.

**Step 4 — UX bugs (fixed):** picture thumbnails take their MIME from the bytes, and a zip entry is
copied before it becomes a blob, so a PNG stored as `.jpg` paints. At 1280 and 1366 the Structure
Next button and “Accept this spec and continue” sit inside the viewport, and the page does not
scroll sideways. Checked in a browser on the InDesign flow, including with rule examples open.

**Needs a client answer (cannot resolve from samples):**
- Which localized labels / a11y-metadata values the client wants client-tunable vs fixed (Step 1 scope).
- Exact Word manuscript style names the client uses for headings/lists/extracts (Step 2) — the sample
  set has no `.docx` manuscript, only the `Cambia tu mente` defect table; detection must fall back to
  Word's built-in `Heading 1/2` styles and outline levels.
