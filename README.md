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
npm test           # regression test against the Automation/ samples (skipped if absent)
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

A **Start** page explains the purpose and lets the operator pick by what they have. Each EPUB
workflow is five steps, in plain words with a “What is this?” help under each:

1. **Files** — what to add and why.
2. **Book details** — title, subtitle, author, publisher, ISBNs. Each field says where it was found
   (“from the copyright line”); doubtful values are shown in red.
3. **Structure** — the book as a reader gets it: every part in order, labelled (half title, title
   page, copyright, dedication, contents, chapter…), with its printed pages, word count, pictures
   and notes, and a preview. The InDesign style table sits under *Advanced*; choices are saved per
   publisher.
4. **Pictures** — thumbnails with description fields and a “decorative” tick-box.
5. **Check & download** — the built-in quality report and the automatic changes. The download
   button is held back while anything must be fixed (a second click downloads anyway, for testing).

**Check an EPUB** runs the same report on any EPUB (a supplier's, an older one), optionally
against the print PDF.

## Built-in quality check (`src/engine/check/epub.ts`)

Runs in the browser after every build, on the finished zip:
- **Valid EPUB file** (EPUBCheck's rules): zip layout, container, required and non-empty package
  metadata, manifest ↔ files, media types read from the bytes (a PNG named `.jpg`), unique ids,
  reading order, broken links and anchors, links to files outside the reading order, well-formed XML.
- **Accessibility** (Ace by DAISY's rules): page language, titles, picture descriptions (missing,
  empty, or a file name), empty or skipped headings, empty links, table headers, navigation menu
  (entries with only a number, sections missing), page list and landmarks, page markers (named,
  unique, in order), schema.org accessibility metadata and conformance.
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
- Table header rows use `<th scope="col">`.
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

- **PDF/UA tables:** tables (the Simple sample's chronology) are still tagged as paragraphs, not `Table/TR/TD`.
- **PDF/UA automated validation:** PAC is manual (Windows GUI). veraPDF could run the same checks in the tests.
- **Numbered subheads** (`1: Deseas…`) with a hanging number (`span.list`) aren't done yet; they stay as plain `h3`.
- **Alt text:** captions give a starting point, but pictures still need real descriptions by a person. A picture with no description is now an error, unless it is ticked as decorative.
- **Final QA outside the app:** DAISY Ace for accessibility (EPUBCheck already runs in the tests).
