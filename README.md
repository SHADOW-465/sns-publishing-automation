# Publishing Automation

Turns production source files into delivery files, following the house style shown by the
hand-finished samples in `../Automation/`. Everything runs in the browser, so files never
leave the machine: the same build works as a Vercel site now and as an offline desktop app later.

| Workflow | Status |
|---|---|
| InDesign EPUB export → accessible EPUB 3 | **working**: matches the reference EPUB; a second book with a different house style (*La cara oculta de Sheinbaum*) passes EPUBCheck and the built-in check with no findings |
| Word / print PDF → EPUB 3 | **working**: matches the reference EPUB |
| PDF → accessible PDF (PDF/UA-1) | **working**: built-in checks pass on both samples; PAC is the final manual check |
| Check any EPUB | **working**: built-in quality report (validity, accessibility, completeness, book details) |

## Run

```bash
npm install
npm run dev        # app on http://localhost:5173
npm test           # rules and spec tests (always) + regression tests against the Automation/ samples (skipped if absent)
npm run sample     # InDesign → EPUB on the Cambia tu mente sample, from the command line
npm run sample:pdf # print PDF → EPUB on the Contemporary Ceramics sample (~3 min)
node --import ./test/setup.ts test/run-ua-sample.ts simple out   # PDF/UA on a sample (medium|simple)
node test/read-tags.ts out/file.pdf 1 10                          # read tags back like a screen reader
npm run build      # static site in dist/
node --import ./test/setup.ts test/run-indd.ts export.epub [print.pdf] [cover.jpg] [outDir] [eisbn]  # any InDesign book
node --import ./test/setup.ts test/check-epub.ts book.epub [print.pdf]                               # quality check
```
On a machine with little memory, run the type-check single-threaded: `node_modules/.bin/tsc -p . --singleThreaded`.

**Vercel:** create a project with *Root Directory* `automation-app`. Vercel detects Vite and needs no other settings.
**Desktop (later):** `dist/` is fully static, uses relative paths (`base: './'`) and bundles the
pdf.js worker locally, so it can be wrapped as-is in Tauri or Electron and runs offline.

## The screens

A **Start** page explains the purpose and lets the operator pick by what they have. *InDesign to EPUB* has
six steps, in plain words with a “What is this?” help under each:

1. **Files**: what to add and why.
2. **Book details**: title, subtitle, author, publisher, ISBNs. Each field says where it was found
   (“from the copyright line”); doubtful values are shown in red.
3. **House style**: the client's spec (see *Client spec* below). Every rule, set for all the client's
   books or for this book only, then accepted (or not), with the decision recorded.
4. **Structure**: the book as a reader gets it: every part in order, labelled (half title, title
   page, copyright, dedication, contents, chapter…), with its printed pages, word count, pictures
   and notes, and a preview. The InDesign style table sits under *Advanced*; choices are saved per
   publisher.
5. **Pictures**: thumbnails with description fields and a “decorative” tick-box.
6. **Check & download**: which spec the book was built with and whether it was accepted, the built-in
   quality report and the automatic changes. The download button is held back while anything must be
   fixed (a second click downloads anyway, for testing).

*PDF or Word to EPUB* has five steps (no House style step yet; it builds with the house settings).
**Check an EPUB** runs the same report on any EPUB (a supplier's, an older one), optionally
against the print PDF.

## Client spec: the client sets the rules (`src/engine/spec/`)

Corrections used to arrive one at a time as screenshots, and each became a code change. Now every
rule is data the client sets himself, and his choices are kept as proof.

- **Rule registry** (`rules.ts`): each house rule has
  - an ID used in every conversation (`TBL-01`, `NOTE-03`);
  - a plain description and an example of the markup it produces;
  - the setting it controls, and the words people use for it in requirement documents;
  - a kind: *fixed* (needed for a valid EPUB; shown, never changed), *accessibility* (changes only
    with a waiver) or *your choice*.

  The Settings screen, the House style step and the Excel spec workbook are generated from this list.
  A new kind of client request becomes a new rule here (ID, setting, keywords, example, test), never a one-off fix.
- **Layers** (`layers.ts`): house defaults → client style (all books of that publisher) → series →
  this book. A later layer wins. Each value in effect shows who set it, and the file and row when it
  came from a client document.
- **Accessibility waivers**: an accessibility rule (TBL-01 table header cells, A11Y-01 picture
  descriptions) changes only after the client ticks *“Yes, I know this reduces accessibility, do it anyway.”*
  Until then the accessible value is used. The tick is recorded with his name and the time.
- **Acceptance**: the House style step ends with *Accept this spec and continue* or *Continue without
  accepting*. Both are recorded with:
  - his name and the time;
  - the spec fingerprint;
  - the full settings in effect;
  - any waivers.

  The Check step shows it next to the download.
- **Decision record** (`store.ts`): append-only (never edited or deleted). Today it is kept in the browser
  (`BrowserStore`) and can be backed up from Settings. For the desktop app, implement the `SpecStore`
  interface over SQLite with `docs/spec-schema.sql`; its triggers keep the decision table append-only.
- **Client requirement files** (`requirements.ts`, `office.ts`): in the House style step, load a Word,
  Excel, CSV or text file.
  - Each paragraph or row is matched to a rule by its words, and the value by the words for each choice.
  - The person confirms each suggestion, then applies it to the client style or to this book.
  - Unmatched requirements are *open questions*, downloadable as Excel to send back.
  - The spec workbook (downloaded from the step, one row per rule with drop-downs) imports back exactly.
- **AI matching** (`ai.ts`, optional): for free-form documents keywords miss, *Match with AI* sends the
  requirement text (never the book) to Groq's free API.
  - Model: `openai/gpt-oss-120b` or `gpt-oss-20b`, strict JSON-schema output.
  - Requirements go in batches of 20, which fits the free tier (about 30 requests and 8,000 tokens a minute).
  - Enter the key in Settings → AI; it stays in the browser and is never exported.
  - Suggestions are confirmed row by row like the keyword ones.

## Settings (`src/engine/settings.ts`, Settings tab)

The house defaults under every client's spec, one control per rule of the registry (with its ID),
saved in the browser and exportable as a JSON file. A file from an older version, or edited by hand,
is checked on loading: unknown or out-of-range values fall back to the default.
Also on this screen:
- the reader-facing words;
- the Groq AI key;
- every client style (Excel export each);
- the decision record, and a backup of all specs and records.

| Setting | Default | What it does |
|---|---|---|
| `roleHeading` | on | `role="heading"` + `aria-level` on each part's heading (the reference had `role="heading"` alone, which EPUBCheck 5.4 rejects) |
| `langWrapper` | on | `<div xml:lang>` inside every section |
| `seriesSmallCaps` | on | numbered heading series ("Hábito 1…12") all in small caps when some are |
| `verseLines` | on | a quotation broken into short lines is verse: `extract1` lines, `extract2` last line |
| `htmlLang` | `xml:lang` | language attribute(s) on `<html>`: `xml:lang` only (as the reference), `both`, or `lang` |
| `styleVariants` / `variantOn` | `own` / align, indent, face | a paragraph changed by hand in InDesign gets **one** class of its own (`Texto1`, never `Texto Texto1`) only when the change is of a ticked kind; size, font and spacing changes are typesetting noise by default |
| `tableHeaders` (TBL-01) | `th` | header cells for screen readers (`<thead>`, `<th scope="col">`), or `reference`: as the hand-finished EPUB (`<td>` with the InDesign cell style). `reference` needs the accessibility waiver in the client's spec |
| `footnoteRule` / `footnoteRuleWidth` | `short` / 30 % | line above the footnotes: short as in print, full width, or none |
| `cssFormat` | `vertical` | stylesheet one declaration per line with margins written out (as the reference), or `compact` |
| `maxSpaceEm` | 2 | largest space above/below a paragraph taken over from print |
| `blockSpaceEm` | 1 | space around indented blocks (`div.top`); a margin, so it overlaps the paragraphs' own space |
| `headingSpaceAboveEm` / `headingSpaceBelowEm` (HD-04/05) | 3 / 2 | least space above and below part, chapter and section titles |
| `headingScalePct` (HD-06) | 100 | scales every heading size taken from InDesign |
| `footnoteIndentEm` (NOTE-03) | 1.5 | first-line indent of footnotes |
| `tocEntryIndentEm` (NAV-01) | 0 | indent of chapter entries on the printed contents and list pages |
| `blockClass` (TXT-04) | `extract1` | class of indented blocks without an InDesign style |
| `altRequired` (A11Y-01) | `error` | a picture with no description stops delivery; `warn` needs the waiver |
| `houseCss` | empty | replaces the built-in house stylesheet (fixed classes `indent`, `extract1`, `toc_1`…) |
| `extraCss` | empty | appended to every e-book's stylesheet |
| `printOnly` | — | phrases of print-only lines removed from the copyright page |
| `labels` | — | reader-facing labels per language ("Portada", "Créditos"…) |
| `minCoverPx`, `lostWordsErrorPct` | 1400, 1 % | quality check thresholds |

Per-publisher choices (the role and CSS class of each InDesign style) are made in the Structure step
under *Advanced* and saved per publisher.

## Client feedback V3 (28-9-26, *Cambia tu mente*)

Each point is a rule now, covered by `test/house-style.test.ts` and `test/spec.test.ts` on a hand-written InDesign export
(`test/fixtures/indesign-export.ts`) that reproduces it, so it runs without the sample books:

| # | Comment | Rule |
|---|---|---|
| 5 | Duplicated language | `<html xml:lang="es-ES">` only (`htmlLang`) |
| 6 | "First style is dummy" (`Ladillo-2 Ladillo-2_1`) | one class per element; a class looks like most of its paragraphs; hand overrides of size, font or spacing no longer make a variant (`styleVariants`, `variantOn`) |
| 7 | CSS order vertical | vertical layout, margins written out in the reference order (`cssFormat`) |
| 9–10 | Page number placement (contents, list of exercises) | each marker stays where its printed page starts, between the entries — no longer piled up above the heading. The check reports markers with no text between them when the printed page has text |
| 11 | Table structure, extra tags | as the reference: cells with their cell style (`No-Table-Style`, header row `No-Table-Style1`), one element per line, column widths from InDesign adding up to 100 % (they could add up to 108 %) (TBL-01: the client chooses this in his spec with the accessibility waiver; header cells are the house default) |
| 12 | Style missing (Pregunta/Respuesta) | an indented block whose first line is still inset is `extract1`, not a hanging indent (`hang` only when the first line starts at the margin). The check reports classes with no rule in the stylesheet |
| 13–14 | Spacing and alignment | `div.top` spacing is a margin that overlaps the paragraphs' own (it was padding, which added up); print spacing is measured against the body size and capped (`maxSpaceEm`, `blockSpaceEm`). With the print PDF, the check compares each paragraph's indent with print (first-line indent, indented block, hanging indent) |
| 15 | Foot-line | a short line above the footnotes, as in print (`footnoteRule`) |
| 15 (again) | Foot-line should be reduced | short line, 30 % (NOTE-01, NOTE-02) |
| 16 | Top space missing (Conclusión) | at least 3em above and 2em below part, chapter and section titles (HD-04, HD-05) |
| 17 | Font size not as in the PDF (part page) | headings always state their size; before, a heading as large as the text had none and readers used their own 2em `h1`. The title is sized relative to its label (HD-06 scales all) |
| 18–19 | Contents alignment not as in the PDF | chapter entries flush left as in print (NAV-01); Conclusión, Glosario and Apéndice are `toc_1`, not indented chapter entries |
| 20 | Footnote indent missing | 1.5em first-line indent (NOTE-03) |

Also: a word split between faces over several spans no longer comes out as
`Ca<span class="small-caps">PÍTULO</span>`; the words of table cells count separately in the
completeness check; font sizes are measured against the body text style and rounded to 5 %
(`h3.Ladillo-2` comes out at 110 %, as in the reference); `tableHeaders` is only declared in the accessibility metadata when tables have
header cells.

## Accessible and Standard EPUB (client sheets, October 2026)

One export, two kinds of e-book (Settings → *Kind of e-book*, or the selector in each flow). The same text, different markup:

| Element | Standard | Accessible |
|---|---|---|
| Heading | `<p class="chapter">` | `<h1 class="chapter" role="heading">` |
| Bold, italic | `<b>`, `<i>` | `<span class="bold">`, `<span class="italic">` |
| Picture | `<div class="fig_group"><p class="image_Container"><img alt="imagen">` + caption `<p>` | `<figure class="fig_group"><img alt="description">` + `<figcaption>` |
| Lists | `<p>• item</p>`, `<p>1. item</p>` | `<ul><li>`, `<ol><li>` |
| Quote | `<div class="top">` | `<blockquote>` |
| Table | bare `<tr>` rows | `thead` / `tbody` / `tfoot`, `th` |
| Footnote | plain links | `epub:type="noteref"`, `doc-noteref`, `doc-footnote`, `doc-backlink` |
| Page number | `<a id="Page_1"/>` | `<span epub:type="pagebreak" role="doc-pagebreak" aria-label="página 1">` |
| Language | none on the page | `xml:lang` on `html` and on a `div` |
| Page title | the book title | the section ("Capítulo 1") |
| Wrapper | none | `<section epub:type="chapter" role="doc-chapter">` |

The Standard version is made from the accessible markup by `toStandard` (`src/engine/epub/package.ts`), so both always carry the same words.
The words for each language (page, chapter, contents, landmarks, cover, title page, default picture descriptions) are those of the client's language sheet (`src/engine/epub/locale.ts`).

### Changing how a book comes out (no code)

Every row above is a rule (`STD-01`…`STD-12` for the Standard EPUB; `TBL-01`, `NOTE-…` and the rest for both). Set it in **Settings** (all books), in the **Spec step** (a publisher, a series or one book), or from **Check these first** next to the part that looks wrong. A change made from there says whether it applies to this book only or to every book of the publisher. Style meanings you correct are remembered for that publisher.
`test/corpus.ts` shows, for every sample book, how many decisions the tool was unsure of: the number to bring down.

## Looks like the print book (`src/engine/check/look.ts`)

With the print PDF, each paragraph's alignment and indent in the e-book (from the stylesheet the reader
applies) is compared with how its lines sit in the printed text column (single or two-column pages, left and
right pages measured separately). Body text set right-aligned or centred where print is justified —
the fault in the first *La cara* delivery (45 paragraphs flagged) — is reported with page numbers;
cover, title, copyright and contents pages follow the house layout and are skipped. The Check step
also shows the printed page next to the same e-book page (**Compare with the print book**).
Measured: 0 differences on Cambia and *La cara*, 1 of 1,143 on Ceramics (shown as “Check”).

## Built-in quality check (`src/engine/check/epub.ts`)

Runs in the browser after every build, on the finished zip:
- **Valid EPUB file** (EPUBCheck's rules): zip layout, container, required and non-empty package
  metadata, manifest ↔ files, media types read from the bytes (a PNG named `.jpg`), unique ids,
  reading order, broken links and anchors, links to files outside the reading order, well-formed XML.
- **Accessibility** (Ace by DAISY's rules): page language, titles, picture descriptions (missing,
  empty, or a file name), empty or skipped headings, empty links, table headers, navigation menu
  (entries with only a number, sections missing), page list and landmarks, page markers (named,
  unique, in order), schema.org accessibility metadata and conformance.
- **House style**: classes used in the text that the stylesheet does not define, table column widths
  that do not add up to 100 %, page markers bunched together although the printed page has text.
- **Content complete**: every word of the source (InDesign export or print PDF) is in the e-book,
  apart from the lines deliberately removed; a page marker for every printed page with content;
  no empty chapters, empty paragraphs, contents entries without titles, or text repeated back to back.
- **Book details**: title not a file name or capitals, author not the title, publisher present,
  valid e-ISBN, cover size.

EPUBCheck and Ace stay the reference for delivery; the built-in check catches the common problems
first. On the first Vercel test (*La cara oculta*), it reports every fault the review found.

## How it works (InDesign → EPUB)

Code: `src/engine/` (no UI, also runs in Node), `src/ui/` (React), `test/`.

### General rules (any book, any house style)
Learned from the first samples and hardened on a second book whose layout and style names differ:
- **Front matter by content, not position or style names** (`front.ts`): the pages before the first
  chapter are sorted by what is on them. The line repeated on two display pages is the title; the
  page with the title alone is the half title, the richest one the title page; a page with ©/ISBN/
  edition/rights lines is the copyright page; short pages after it are the epigraph and dedication
  (split line by line: “Con amor para…”, “To my…” → dedication).
- **Book details from the book itself**: author = the person holding the © (“D. R. © 2026, Elena
  Chávez”), confirmed against the title page; publisher = the company on the © line (the imprint
  brand when several are named); title spelled as on the copyright page, or converted from
  capitals; file-name titles (“…presidenta_Grijalbo”) are never used.
- **Headings set in the chapter-title style** that are really *Contents*, *Prologue*,
  *Acknowledgements*… get their real type.
- **Contents repair**: entries whose title InDesign lost (“2.” linking nowhere) are rebuilt from the
  chapter heading; continuation lines are merged; chapters missing from the printed contents are reported.
- **Copyright page**: lines broken mid-sentence are joined; print-only lines (legal deposit,
  printer, paper and forest notices) are removed; the e-ISBN is written like the print ISBN.
- **Notes at the end of each chapter** (“Notas” + numbered paragraphs) are linked both ways from the
  superscript numbers in the text.
- **Acronyms typed in lowercase small caps** read as capitals in the navigation (“UNAM”).
- **Text extraction**: a line break is a space (“OCULTA DE”), soft hyphens vanish.
- **Page numbers from the PDF**: most folios agree on one offset; stray numbers (a “16” on a contents
  page) no longer shift the front matter; unnumbered pages before page 1 get roman numerals.
- **Files**: image types come from the bytes; an empty publisher is left out of the package; the
  landmarks never point at the navigation file.

Code: `src/engine/` (no UI, also runs in Node), `src/ui/` (React), `test/`.

## What the production team did by hand (now automated)

Deduced by diffing `Indesin-to-EPUB-Automation/Input` against `Output` paragraph by paragraph.
1,704 of 1,935 paragraphs matched as-is (ignoring case and spacing); the rest showed these edits:

**Structure**
- The single InDesign XHTML file is split into one file per section: `cover`, `halftitle`,
  `title`, `copyright`, `ded`, `toc`, `list`, `intro`, `partN`, `chapterNN`, `concl`, `glos`, `app`,
  `bib`, `ata`… Each gets `<section>` with the right `epub:type` and DPUB-ARIA role.
- A chapter's label and title (`Capítulo 1` + `¿Qué es…?`) become one heading:
  `<h2>Capítulo 1 <span class="Titulo_SUPER">…</span></h2>`. Parts become `<h1>`, and
  front/back-matter titles become `<h2>`.
- Subheads become `<h3>`. A line typed in bold by hand ("Qué necesitas") also becomes `<h3>`.
- Empty spacer paragraphs (`<p class="Titulo_SUPER"><br/><br/></p>`) are removed.
- Bulleted paragraphs (`•<tab>…`) become `<ul class="bull"><li>`, without the bullet character.
- Runs of indented blocks (exercises, extracts) are wrapped in `<div class="top">`.

**Inline formatting** ("remove unnecessary italic/bold")
- InDesign's font-only overrides (`CharOverride-6` etc.) are removed, and words split by
  ligatures ("recon|fi|gura") are joined back together.
- Real formatting becomes `span.italic`, `span.bold`, `span.bold-italic`. Precedence rule, checked
  against the print PDF's fonts: a "regular" override does **not** cancel a named Italic style,
  but a bold override does.
- Small caps are emulated as the house does it: `L<span class="small-caps">AS FRECUENCIAS</span>`.
  A word the typesetter split between two faces ("Ca|pítulo") gets one face.
- Uppercase styles are uppercased in the text. Drop caps become `span.dropcap`.
- Empty links (`href=""`) get their real URL. Bare URLs and e-mail addresses become links.
- Stray language tags that InDesign copies from Word (`lang="en-US"`/`ar-SA` on Spanish text) are removed.

**Front matter**
- The imprint (placed by InDesign at the very end) moves to `copyright.xhtml` after the title page.
  The print ISBN becomes the e-book ISBN, and print-only lines ("Depósito legal", "Impreso en…") are removed.
- The title page is built from the title, author and subtitle, plus the publisher logo with alt text.
- The InDesign cover is a blank placeholder, so the final cover is supplied separately and gets
  descriptive alt text.
- The printed TOC and "list of exercises" become linked entries without page numbers. Part
  label + title become one entry, and exercise entries link to the heading on that page.

**Notes and pages**
- InDesign's end-of-book footnotes move to the end of the chapter that cites them, as EPUB 3
  noteref/footnote/backlink.
- Page markers become `span[epub:type=pagebreak]` with an accessible name. Pages InDesign left out
  are added at the exact spot where the printed page starts, found in the print PDF. Markers for
  blank printed pages and the back cover are dropped.
- `nav.xhtml` (TOC, page list, landmarks), `toc.ncx`, and an OPF with accessibility metadata are
  generated. The embedded fonts and InDesign's CSS are removed; the house CSS is used, with rules
  generated for the book's own styles.

### Deliberately different from the reference
These follow accessibility checkers where the reference did not:
- No empty `<h1>`/`<h2>` on the cover or copyright page.
- `epub:type="contributors"` (the reference misspelled it).
- Table header rows can use `<th scope="col">` (Settings → Tables); the default follows the reference.
- The accessibility metadata no longer claims `index`/`ttsMarkup`, which the book doesn't have.

## Word / print PDF → EPUB

The sample's `.doc` turned out to be an RTF converted from the print PDF (every paragraph is "Normal",
broken lines, drop caps lost, and it covers only the first two chapters). The **print PDF is the source**;
the cover comes as an image or as the print cover-spread PDF, and the tool cuts the front panel out itself.

What the tool does (checked against `WORD-to-EPUB-Automation/Output`):
- **Page cleanup:** it reads every page with the real font names and strips the slug (`file.indd`, print
  date), running heads and folios. The printed page number is the PDF page plus the offset most folios agree on.
- **Font roles:** each font and size gets a role (body, chapter number, title, subhead, caption, drop cap).
  The operator confirms these in a table, and the choices are saved per publisher.
- **Reading order:** columns are read left to right, with full-width headings placed where they fall.
  Captions are attached to the nearest picture, below or beside it.
- **Paragraphs:**
  - A first-line indent gives `indent`, a flush start gives `noindent`.
  - When every line is indented, the text is an extract. Runs of extracts become
    `extract1` / `extractt` / `extractint0` / `extractint`, as the reference does.
  - The bibliography uses hanging indents.
  - Lines wrapped around a drop cap stay in one paragraph.
  - A word hyphenated at a line end is joined again, unless the book writes it hyphenated elsewhere.
- **Italic and bold** come from the font names (`WarnockPro-It` → `<em>`).
- **Pictures:**
  - Pictures are taken at their visible (clipped) size, long side ≤ 1900 px, as in the reference.
  - Files are named `pg-{page}-{n}.jpg`.
  - Each picture goes after the paragraph that crosses into its page.
  - Opener pictures on pages with no text go to the next section.
- **Tip boxes:** tinted panels become boxes, using the PDF's own colours (header bar plus panel).
- **Contents and index:**
  - The contents page is rebuilt with links; chapter numbers are kept.
  - Index page numbers link to the exact page marker.
- **Front and back matter:**
  - Half-title and title pages are page renders, with their text as alt text; full-page photos become picture pages.
  - The copyright page is the print imprint with the shared rules below. Crowood's e-book notice and rights
    statement are editable and saved per publisher.
  - Dedication and acknowledgements get their own files.
- **Page markers:** one for every printed page, exactly as in the reference (1–192).

Result on the sample: the same 33 files, text similarity 0.99–1.00 per chapter, the copyright page word for
word, identical index entries, and EPUBCheck 0 errors / 0 warnings. The reference had left out 3 pictures on
page 66; the tool keeps all 285.

Shared with InDesign → EPUB: `src/engine/epub/imprint.ts` handles print-only lines, the ISBN swap and the
e-book notices; `src/engine/pdf/` reads the PDF; `src/engine/epub/package.ts` handles packaging and navigation.

## PDF → accessible PDF (PDF/UA)

Inputs: the print PDF, and optionally a cover image, extra PDFs to append (plates) and the Word file
with picture descriptions. The PDF is **re-tagged from scratch**. Old tags are removed and every drawing
operation on every page is either tagged or marked as decoration.

Rules taken from the two samples and their hand-made outputs:

- **Merging:** the cover image becomes page 1 at the trimmed page size, and page labels shift so page 1 reads "Cover".
  Extra PDFs are appended in order.
- **Text:** layout lines are matched to the text operators by baseline. Anything outside the trim box is dropped:
  slug notes such as `[Page v]` and job info.
- **Headings:**
  - Heading styles used on 3+ pages are ranked by size into H1–H6, and levels are never skipped.
  - Each H1 opens a `Sect`.
  - Chapter labels ("Chapter 3") and big chapter numbers join their heading.
  - On title pages only the title is a heading; the subtitle and author are text.
- **Paragraphs:**
  - First-line indents, centred text and hanging indents (bibliographies, decided per page) are all detected.
  - A dash that wraps to the start of a line is prose, not a bullet.
- **Lists, notes, contents:**
  - Bullet and numbered lists become `L/LI/LBody`.
  - Small numbered text at the page bottom becomes `Note`.
  - The contents page becomes `TOC/TOCI`, one entry per right-aligned page number (arabic or roman), each linked
    to its heading.
- **Pictures:**
  - Placed images and vector charts (clusters of paths) become `Figure` with a `Caption`.
  - Alt text comes from the Word file, matched by label ("Abb. 3", "Alt-Text:") or in order.
  - Pictures inside page-sized form XObjects (placed logos) are found too.
  - Missing alt text is an error in the review.
- **Links and navigation:**
  - Web addresses become links.
  - Bookmarks come from headings plus Cover / Half Title / Title / Copyright.
  - Tab order follows the structure.
- **Metadata:**
  - The title comes from the document info, or from the title page when the info is a file name
    ("Microsoft Word – …").
  - The author comes from the names line.
  - The language comes from stop-word counts.
  - Also written: XMP `pdfuaid:part=1`, DisplayDocTitle, and CropBox = TrimBox.
- **File name:** the source file name plus `_ISBN` when an e-ISBN is entered (as in the samples).

Built-in checks after every build cover the machine-checkable parts of the Matterhorn protocol that PAC runs: tags,
language, title, XMP, untagged content, annotations and embedded fonts. Fonts that are not embedded can't be
fixed by tagging, so the PDF has to be re-exported.

Code is in `src/engine/pdfua/`. The regression test is `test/pdfua.test.ts`.

## QA tools

`tools/` (not in git) holds a portable Java 17 runtime and W3C EPUBCheck 5.4. The tests run EPUBCheck
automatically when it is present.

```bash
npm run epubcheck -- "path/to/book.epub"
```

## Next

- **Spec, phase 2:** a check that the finished EPUB follows the accepted spec, rule by rule, and a
  delivery report (spec version, waivers, EPUBCheck, Ace). Then learn a draft spec from a client's
  hand-made reference EPUB, and add the House style step to *PDF or Word to EPUB*.
- **Desktop app:** a `SpecStore` over SQLite (`docs/spec-schema.sql`).

- **PDF/UA tables:** tables (the Simple sample's chronology) are still tagged as paragraphs, not `Table/TR/TD`.
- **PDF/UA automated validation:** PAC is manual (Windows GUI). veraPDF could run the same checks in the tests.
- **Numbered subheads** (`1: Deseas…`) with a hanging number (`span.list`) aren't done yet; they stay as plain `h3`.
- **Alt text:** captions give a starting point, but pictures still need real descriptions by a person. A picture with no description is now an error, unless it is ticked as decorative.
- **Final QA outside the app:** DAISY Ace for accessibility (EPUBCheck already runs in the tests).
