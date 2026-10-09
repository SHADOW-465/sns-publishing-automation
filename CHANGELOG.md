# Changelog — Publishing Automation (`automation-app/`)

Newest first. Each entry says what changed for the people using the tool, and which client
feedback it answers. Keep this file up to date with every change.

## 2026-10-09 — Standard EPUB builder, language sheet, *Cartografías del poder*

Answers the client's three new sheets (Standard vs Accessible tag differences, Standard specification, Accessible language specification) and the new test book.

**Standard EPUB** (Settings → Kind of e-book, or per book) now follows the sheet row by row:
- headings are classed paragraphs; bold and italic are `<b>` and `<i>`; a figure is a `<div class="fig_group">` with the picture in `<p class="image_Container">` and a caption paragraph;
- lists are paragraphs with the bullet or number typed in (`• First item`, `1. First item`);
- quotes are `<div class="top">`; tables have bare rows (no `thead`/`tbody`/`tfoot`, header cells are plain cells, still bold);
- notes, links and page numbers carry no roles: page numbers are `<a id="Page_1"/>`;
- no `section` or language wrapper, no language on `<html>`, `<link>` before `<title>`, and every page titled with the book's title;
- picture descriptions read "imagen" (or "decorativa" for a decorative picture); the stylesheet selects `p` where it selected headings.

**Accessible EPUB** gets the matching rows: quotes are `<blockquote>`, pictures `<figure class="fig_group">`, title-page lines carry `aria-label` (Título, Autor, Editorial), landmarks `role="navigation"`.

**Language sheet**: German, French, Spanish, Italian, Portuguese and Mexican Spanish words are exactly those of the sheet (page, chapter, contents, landmarks, cover, title page, start reading, title / author / publisher, default picture descriptions).

**The built-in check** knows a standard EPUB: it no longer asks for page language, headings, landmarks, `th` cells or link-less anchors there, and it counts `Page_1` markers.

**Cartografías del poder** (one-line chapter heads, no "Chapter 1" label):
- the contents page names the chapters, so the styles of the paragraphs that repeat those names become chapter heads (8 chapters, Presentación and Prefacio as front matter);
- title, authors (a run of name lines), publisher (El Colegio de México) and a lowercase subtitle after a full stop are read correctly;
- a paragraph style set in capitals in print keeps natural text with `text-transform: uppercase`, so contents labels are not shouted.

## 2026-10-01 — Feedback round 3: standard EPUB, Word/PDF → EPUB structure, PAC-clean accessible PDF

**InDesign → EPUB** (client: "80% done, language, specification and complex EPUB testing pending")
- **Kind of e-book**: *Accessible* (roles, `aria`, page list, accessibility metadata) or *Standard* (none of those). Default in Settings.
- Real lists (`ul`/`ol`, nested), MathML, right-to-left books (`dir="rtl"`, spine direction), more languages.

**Word / print PDF → EPUB** (client: chapter splitting, toc/ncx/nav level, run-on paragraphs, lists, tables)
- The printed contents page now drives the structure: parts, chapters, appendices, and two-level contents (second level = subheads). The file list, `toc.xhtml`, `nav.xhtml` and `toc.ncx` agree.
- Spread PDFs (two printed pages side by side) are split into single pages.
- A paragraph that runs across a page break is one paragraph (the page marker sits inside it).
- Bullet lists become `ul.bull`; ruled grids become real `<table>` (header row as `th` unless Settings says otherwise).
- "List of exercises/figures" pages name subheads inside the chapters.

**Accessible PDF** (client: PAC shows errors; alt text missing; reading order; figure/caption order; notes and image links)
- PAC "PDF Syntax" failures: tag markers no longer start or end inside a drawn path, and operators written without a space (`lS`, `ref`) are separated.
- PAC "Metadata" failures: the XMP packet is written as real UTF-8.
- Captions are paired with the nearest picture (beside, above or below); each picture is followed by its caption; pictures are read in column order like the hand-tagged file.
- Alt texts from the Word file follow the order of the book's image list, matched by caption.
- Links sit in `Reference > Link` (as in the hand-tagged file); e-mail addresses become `mailto:` links; each image-list entry links to its picture.
- New fast test `test/pdfua-content.test.ts`.

## 2026-09-28 — Client spec, rule layers and waivers (Phase 1); feedback V3 rows 15–20

The client no longer sends corrections one by one for a developer to code: he sets every rule
himself in the tool, and his choices are kept as proof.

**Client spec**
- **Rule registry** (`src/engine/spec/rules.ts`). Every house rule has:
  - a stable ID (`TBL-01`, `NOTE-03`…);
  - a plain description and an example of the markup it produces;
  - a kind: *fixed* (needed for a valid EPUB), *accessibility* (changes need a waiver) or *your choice*.

  The Settings screen, the new House style step and the Excel spec workbook are all generated from it.
- **Rule layers** (`layers.ts`): house defaults, then the client's style (all his books), then a series, then this book. Each value shows who set it, and the file and row when it came from a requirements document.
- **House style step** in *InDesign to EPUB* (step 3).
  - The client sets any rule for all his books or for this book only, with a search box and examples.
  - He then clicks **Accept this spec and continue** or **Continue without accepting**. Both are recorded with his name, the time, a fingerprint of the rules and the full settings.
  - The Check step shows which spec the book was built with, and whether it was accepted.
- **Accessibility waivers**: an accessibility rule (table header cells, required picture descriptions) changes only after the client ticks *"Yes, I know this reduces accessibility, do it anyway."* Until then the accessible value stays in effect. The waiver is recorded with name and time.
- **Decision record** (`store.ts`): append-only; every change, waiver, import and acceptance is kept.
  - Kept in this browser for now, and can be backed up to a file from Settings.
  - `docs/spec-schema.sql` is the SQLite schema for the desktop app (the store interface is ready to swap).
- **Client requirement files** (Word `.docx`, Excel `.xlsx`, CSV, text).
  - Each requirement is matched to a rule by its words (Spanish and English keywords per rule), and the value from the words for each choice.
  - The person confirms each row before it applies. Requirements that match nothing become *open questions*, downloadable as Excel to send back.
  - The downloaded **spec workbook** (drop-downs for each rule) imports back exactly.
- **AI matching (optional, Groq free API)**: `openai/gpt-oss-120b` (or `gpt-oss-20b`) with strict JSON-schema output matches free-form requirements that keywords miss.
  - Off until a Groq key is entered in Settings → AI.
  - Only requirement text is sent, never the book.
  - Suggestions are still confirmed row by row.
- **Settings** screen rebuilt from the registry: house defaults for every rule, the AI key, the list of client styles (Excel export each), the decision record, and a backup of all specs.
- House settings and build-time settings are now separate (`houseSettings()` vs `settings()`), so a client's spec never leaks into another workflow.
- **Accessible defaults**: table header cells (`TBL-01 = th`) are the house default again. A client who wants plain cells (the Cambia manual EPUB) chooses it in his spec with the waiver.

**Feedback V3 rows 15–20 (Cambia tu mente)**
- Row 15, footnote line: short, 30% (already in the previous round; now rules NOTE-01 and NOTE-02).
- Row 16, top space missing: part, chapter and section titles (`h1`/`h2`) get at least 3em above and 2em below (HD-04, HD-05).
- Row 17, font size not as in the PDF: headings always state their size. Before, a heading as large as the body text had none, so readers used their own `h1` = 2em. The title inside a heading is sized relative to its label. HD-06 scales all headings.
- Rows 18–19, contents alignment: chapter entries on the contents and exercise-list pages are flush left as in print (NAV-01). Back matter (Conclusión, Glosario, Apéndice) uses `toc_1`, no longer indented as a chapter.
- Row 20, footnote indent missing: footnotes have a 1.5em first-line indent (NOTE-03).
- New rules: TXT-04 (class of indented blocks) and A11Y-01 (a missing picture description blocks delivery or only warns).

**Tests**: `test/spec.test.ts` covers:
- the registry is complete;
- layer precedence and waivers;
- the decision record;
- the Excel round trip;
- Word requirement matching;
- AI matching against a stubbed Groq;
- rows 16–20.

The suite is now 21 tests passing; 5 sample-book tests are skipped without the samples.

## 2026-09-28 — Feedback V3 rows 1–14 (Cambia tu mente)

- `<html xml:lang>` only, no duplicated `lang` (row 5).
- One class per element, never `Ladillo-2 Ladillo-2_1`. A class takes the look most of its paragraphs have; small hand overrides no longer create variants (row 6).
- Stylesheet laid out vertically with margins written out, as the reference (row 7).
- Page markers on the contents and list pages stay where their page starts (rows 9–10).
- Tables as the reference: cell-style classes, header row with its own class, one element per line, widths from InDesign that add up to 100% (row 11).
- Indented question/answer lines are `extract1`, not hanging indents (row 12).
- Space around `div.top` blocks is a margin that overlaps the paragraphs' own space. Spacing and font sizes are measured against the body text (rows 13–14).
- Short line above footnotes (row 15).
- Also:
  - small caps no longer split mid-word ("Ca<span>PÍTULO");
  - table cell words count separately in the completeness check;
  - `tableHeaders` is claimed in the accessibility metadata only when tables have header cells.
- Quality check additions:
  - page markers bunched together although the printed page has text;
  - classes with no CSS rule;
  - table widths not adding to 100%;
  - with the print PDF, paragraph indents that differ from print.
- Settings for each rule; `test/house-style.test.ts` with a hand-written InDesign export fixture, so tests run without the confidential samples.

## 2026-09-26 — Redesigned interface

Sidebar layout, paper-and-ink theme, icons, clearer file drops.

## 2026-09-26 — Client feedback V2, Settings page, print comparison

- `role="heading"` + `aria-level`, `<div xml:lang>` in every section, numbered heading series in small caps, verse as `extract1`/`extract2`.
- Settings page (print-only phrases, reader labels, extra CSS, check thresholds).
- The check compares each paragraph's alignment with the print PDF and shows print and e-book pages side by side.
- Style CSS from the style's own definition; one-off overrides only where used.
- Drop-cap page markers, hyphen joins, box headings, editable section types.

## 2026-09-25 — Content-based front matter, EPUB quality checker, step-by-step screens

## 2026-09-24 — First version

InDesign → EPUB, PDF/Word → EPUB, PDF → PDF/UA, and Check an EPUB.
