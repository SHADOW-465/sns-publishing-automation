# Client corrections of 23 Oct 2026: what they mean, what to build, what to ask

Written 2026-10-23 from `corrections/` (3 EPUB markup docs, the PDF/UA markup doc, `Book_Details.xlsx`, 2 WhatsApp images, `FORGE_STATUS.md`, `SPEC_COVERAGE.md`) and the code/history of three repos (read only):
this worktree (`forge/pdfua-fixes`, HEAD `31ae0f7`), `pdf-tagger-sns` (`forge/epub-next`, `4882726..402250b`) and `sns-publishing-automation` (`forge/epub-step4`, `a3bddae..abf16a0` + the uncommitted `indesign/build.ts` diff).

Nothing in this file was verified by running the tool: **none of the test books are on this machine** (T-C-E *The Reckoning*, *A Dark History of Birmingham*, *Alquimia de las nueve dimensiones*; a search found no copy, and `git grep` finds no fixture for them). "Status" below is from reading code and commit messages. Anything marked *repro needed* must be run on the client's file before it is called fixed.

Read first (things that explain why rounds never end):

1. **Three copies of one app.** `pdf-tagger-sns-pdfua`, `pdf-tagger-sns` and `sns-publishing-automation` all carry `automation-app`/`src/engine/*`. The two commit ranges you gave (`402250b`, `abf16a0`) are hardening fixes (style-name matching, HD-09 heading ranking, `%` in href, EPUBCheck "did not run", CSS-03 dropped). **None touches a 23 Oct correction.** The uncommitted `indesign/build.ts` diff makes end-note numbers wrapped in `<sup>`/`<span>` link back properly: related to "note linking", not to any item below. Pick one repo as the source of truth before fixing anything, or fixes land in the wrong copy.
2. **The test file names do not match the pictures.** Both Cambia docs say `Cambia tu mente-automated.epub`, dated 25-9-26, but every screenshot is *A Dark History of Birmingham* (Amberley). The 17 Oct checklist (`main:corrections/CLIENT_CHECKLIST_OCT17.md`) ran the real *Cambia tu mente* (Spanish, InDesign) and passed it. So the Birmingham comparison is a different book, from before 17 Oct. Ask which is current.
3. **The client's own materials disagree with each other** (see section 5: `<em>` vs `<i>`, `alt=""` vs `alt="decorative"`, `<p>` headings vs required headings). Part of the correction loop is us implementing the written sheet and the client then marking the output against a different hand-made sample.

---

## 1. The corrections in plain words

"Reference" = the client's hand-made output (left column "Input Automation Request"). "Tool" = what our tool produced (right column). IDs are used in sections 4 and 7.

### A. PDF/UA — `Automation testing correction_b6c129bb….docx` (book: *Gladiators in the Greek World*)

| ID | Client's words | What they mean |
|---|---|---|
| U1 | "Extra tags or path" (screenshot 1: FSC logo, a `<Figure>` holding ~15 `Path` children in the Acrobat tag tree) | A logo should be **one** Figure with no visible clutter under it. Today the logo is a Figure but its drawing shows up as many separate pieces. Cause (read from `pdfua/content.ts:rewrite`): a new marked-content sequence (MCID) is started at every `q/Q` and `BT/ET`, so a logo drawn as many graphics groups gets one MCID per group. The earlier "A8 fixed" in the 17 Oct checklist dealt with paths *outside* marked content, a different thing, and said "Not seen in Acrobat". |
| U2 | "Index link to page number" (screenshot 2: index, red marks on page numbers like `48–9, 193`) | In the index every page number should be a clickable link to that page. Nothing writes index links today (`pdfua/write.ts` links only contents entries, URLs, e-mails, image list, notes). |
| U3 | "N is the foot note" (screenshot 3: `301n.66`, `302n.76` boxed) | In the index, `301n.66` means "page 301, **n**ote 66". The client wants that reference tagged/linked as a note reference (to the note), not as plain text. Which target (page 301 or note 66 in the Notes section) is not said — ask. |
| U4 | "All are list not paragraph" (screenshot 4: end notes list, red line beside `<P>` entries that follow `<LI>` entries) | Every end note should be `L > LI > Lbl + LBody`. Some are left as `P` (first entries are LI, later ones P). Could also be read as "index entries should be lists too" (screenshot 2/3 show P per entry). **This reverses `31ae0f7`, which deliberately made the index "one P per entry".** Ask. |
| U5 | "N is the footnote" (same screenshot 3 again; the docx reuses image 3 for caption 5) | Probably a copy/paste: same picture, so same request as U3. Or it refers to screenshot 4 where the boxed items are the note numbers `99`, `100` (the `Lbl`): "the number is the footnote label". Ask. |
| U6 | "Bookmark add plate" (screenshot 5: bookmarks end with Notes, Index, red "Plate" arrow) | The plate section (the extra PDF appended at the end) needs its own bookmark. Today bookmarks come from headings plus Cover/Half Title/Title/Copyright (`pdfua/index.ts:frontPages`); plates have no heading, so no bookmark. |
| U7 | WhatsApp 2.54.03: spinner stuck on "Reading page 322 of 322…", **Analyse** greyed out, green circle drawn on the spinner | A bug report, not a style correction: with `AlNiDi ES pages V05.pdf` (22.3 MB) + `AlNuDi_cover.jpg` (3.6 MB) + extra PDF `Alquimia… eBoRI.pdf`, the progress reaches 322/322 and then never finishes. Reading is done; the hang is in the stage after it. The merged file (main + plates) is analysed in `analyzeUa`; progress is only reported while pages are read, so everything after (content-stream planning of every page, figure detection, structure, vector-figure thumbnails) runs silently on the main thread. *Repro needed*: it may be slow (minutes) rather than dead, or an exception path that never reaches `finally`. Either way the UI must show progress and a time-out. |
| U8 | WhatsApp 2.54.02 (no words): the cover of *Alquimia de las nueve dimensiones* (Spanish, 20th anniversary) | The cover file used in U7. No instruction attached. Assume it is the test input and ask whether anything about the cover is wrong (the tool inserts it as page 1 labelled "Cover"). |

### B. InDesign → EPUB (STD) — `EPUB(STD)-Automation-Update-Indesign….docx`

Test file named *Cambia tu mente*, pictures are *A Dark History of Birmingham*, 25-9-26.

| ID | Client's words | What they mean |
|---|---|---|
| I1 | "Title page should be taken as image" | The printed title page (title, author, publisher logo) is shipped as one picture, as in the reference; the tool rebuilt it as plain text. |
| I2 | "Center alignment and smallcaps missing" (copyright page) | Copyright lines are centred and the "ISBN" label is in small caps in print/reference; tool left-aligns, drops small caps, and writes "eISBN: …" instead of "ISBN … (ebook)". |
| I3 | "Link missing, No need for page number" (contents) | Contents entries must be links; printed page numbers must not appear. The pair of screenshots is in the opposite order to the comment (image 5 has numbers and no links, image 6 has links and no numbers), so it is unclear which is ours. The request itself is clear. |
| I4 | `<p class="chapter-title">Introduction</p>` | The chapter title is a paragraph with class `chapter-title` (not a heading element / other class). Sits next to the heading-space comment. |
| I5 | "Bottom space is large for all headings" (General note) | Gap between chapter heading and first paragraph is too big everywhere (pp. Introduction, Bibliography). |
| I6 | "Image placement missing" / "Images are miss placed below the bibliography page" (General note) | Pictures must appear where they are in print (the map in the Introduction). Tool dumps them after the last page (below the Bibliography). |
| I7 | "No spacing style and wrong text size" (poem, p. 12) | Verse/extract block needs its own spacing and smaller size (class `extracts`/`extracts-0` carried no style). |
| I8 | "Text size" (block quotes pp. 79, 86) | Block quotes render at body size; should be smaller and indented like print. |
| I9 | "Bottom space" (Bibliography, p. 96) | Same as I5 on the Bibliography heading. |

### C. PDF → EPUB (STD), Birmingham — `EPUB(STD)-Automation-Update-PDF….docx`

| ID | Client's words | What they mean |
|---|---|---|
| P1 | "Center alignment, smallcaps missing" | Same as I2, from the PDF path. |
| P2 | "Wrong font-family and wrong heading alignment" (Contents page) | Contents heading must be centred serif like print; tool gave left-aligned sans-serif. |
| P3 | "No need of page id" (`<a id="Page_4"/>` at top of Introduction) | In STD EPUB, do not emit a page anchor in front of the chapter heading. |
| P4 | "Image placement missing" (General note) | Pictures in print position, caption under the picture, text order kept. Tool puts both pictures above the paragraph they belong after. |
| P5 | "Wrong bodymatter alignment, it should be justify" | Body text justified, as print. |
| P6 | "No spacing style and wrong text size" (poem) | Same as I7. |
| P7 | "Wrong para style and size should be reduced" (p. 13, *How long is Noodledom…* ) | An indented/quoted passage came out as body paragraph with broken line indents; should be a reduced-size extract. |
| P8 | "Misplacement of image caption" (General note) | Caption text was merged into body text mid-sentence ("the, / Plan of Birmingham. (Courtesy…) Introduction / putrid…"): it must be its own caption paragraph under its picture. |
| P9 | "Images are miss placed below the bibliography page…", developer wrote "Fixed" | Same as I6, already claimed fixed by the developer: client has not confirmed. |
| P10 | `<p class="cover"><img alt="cover" class="cv" id="cimg" src="images/cover.jpg"/></p>` | Reference cover markup. Unclear whether this is "keep" or "wrong" (no comment). Ask. |
| P11 | `<title>…</title>`: "Title in header path merged with author name" (General note) | The `<title>` of the XHTML must be the book title only, not "A DARK HISTORY OF BIRMINGHAM Anthony Poulton-Smith". |
| P12 | "Title page is wrongly taken as halftitle including image. Image taken without been cropped" | Title page detected as half-title (so contents lists "Half Title" where the reference says "Title"); the title-page picture (publisher logo) is the full page, not cropped to the logo. |
| P13 | "Wrong heading alignment and font family" (General note) | Chapter headings must be centred, serif, as print. |

### D. PDF → EPUB (STD), *The Reckoning* — `EPUB(STD)-Automation-Update-V1….docx` (T-C-E-9781923514980(STD).epub, 21-10-26)

| ID | Client's words | What they mean |
|---|---|---|
| V1 | "Page id and chapter id should not need, chapter heading wont" (Pg-4) | Reference chapter opener is two plain paragraphs, `<p class="chnum">CHAPTER 1</p>` + `<p class="chtit">Murderous Marriages</p>`, with no `<a id="Page_4"/>`, no `id="chap1"`, and no `ch-head1` / `ch-num` / `ch2` spans. "chapter heading wont" is cut off; read as "won't be like that". |
| V2 | "Running letter should not need" (Pg-5) | The running head ("chapter 1") leaked into the text as a paragraph `<p class="noindent"><a id="Page_5"/>chapter 1</p>`. Delete it. |
| V3 | "Para merged" (Pg-6) | Two paragraphs (the second indented in print) were joined across a page break ("…sleep soundly again. `<a id="Page_6"/>`This trauma…"). A new indent = a new paragraph, even at the top of a page. |
| V4 | "Use table method" (Pg-9) | A two-column key/value block (Name / Date of Birth / Crime / Executed) must be a `<table>`; tool made one `<p>` per cell, labels separated from values. |
| V5 | "Image placement missing" (Pg-11, Page-19) | Picture + caption go between paragraphs, in the `div.img_cont > p.image_container > img` + `p.figcap` shape; tool put the picture in the middle of a sentence, split the paragraph, leaked a "chapter 1" running head next to it, and wrote `alt="decorative"` where the reference has `alt=""`. |
| V6 | "Para should be split" (Pg-14) | Verse in the reference is one `<p>` per line (`extract`, `extract1`…). Tool merged lines into running text (`extractt`, `extractint0`…) and kept only some line breaks. |
| V7 | "Italic missing" (Pg-15) | `<em>General Evening Post</em>` lost its italic. |

### E. `Book_Details_83341df0….xlsx` (no instruction attached)

A new input file for *Das Tempelhofer Feld* (BeBra): sheet 1 = title, author, publisher, page count, e-ISBN; sheet 2 = one row per file (`cover.xhtml`, `halftitle.xhtml`, `fm01.xhtml`, `chapter01.xhtml`…) with Level, Title, Start Page, End Page and a column "epub:type (Accessible EPUB only)". Rows 3–9 of the chapter list have no pages, `fm01`/`fm02` and the last three rows have no title or file name, the epub:type column is empty everywhere. The app has no importer for it (`grep` for "Start Page", "Chapter Name": nothing). Read as: the client wants to give us the file plan (names, levels, titles, page spans) instead of the tool guessing it, and wants the tool to fill/validate the epub:type values. Needs confirmation (Q10).

---

## 2. What the app should do, end to end

Common to all three: the user drops files, sees one plain review list (only real decisions), downloads a file, and gets a report that says pass/fail in words. No step may need EPUB/PDF vocabulary. Everything below the review list is deterministic.

**InDesign → EPUB (Standard or Accessible)**
- In: InDesign export package (XHTML/IDML export zip), print PDF (page numbers, check text), cover JPG/PNG, e-ISBN; optional: `Book_Details.xlsx`, client spec workbooks (Standard / Accessible / language), alt-text sheet.
- Do: read InDesign paragraph/character style names → map to the client's class names and elements per the STD/Accessible sheet; split into files by chapter (names/levels from `Book_Details.xlsx` if given, else from the book's own contents); keep pictures where they stand in print (by caption/page) and never at the end; contents as links without printed page numbers; page markers where the print has them (Accessible: always; STD: per client rule); copyright/title pages with the print alignment and small caps; verse/extract/quote blocks with their own spacing and size; apply the client layer (class names, CSS).
- Out: `.epub` (EPUB 3), a "changes made automatically" list, a check report (EPUBCheck, plus Ace for Accessible), and a side-by-side against the print PDF. Download blocked only on real errors.

**PDF → EPUB (Standard or Accessible)**
- In: print PDF (required), cover image, optional Word manuscript (`.docx`), alt-text sheet, `Book_Details.xlsx`.
- Do: read text with coordinates; drop running heads/folios/slug; rebuild paragraphs (a new indent or gap = new paragraph, also across a page break); detect chapters, front matter (title page ≠ half title), verse/extract, tables (ruled **and** label/value blocks), lists, notes; place pictures between paragraphs at their print position, caption separate; centre/serif/justify from print measurements; footnotes linked both ways; italics/bold from font names.
- Out: same as above.

**PDF → PDF/UA (accessible PDF)**
- In: print PDF, cover JPG/PNG (inserted as page 1), extra PDFs appended at the end (plates), alt-text `.docx`, options (chapter level, logos as figure or artifact).
- Do: re-tag every page: Title H1 once, chapters H2, subheads H3, P, L/LI/Lbl/LBody, Table/TR/TH/TD, Figure+Caption in reading order, Note + Reference + Link both ways, Link for contents/URL/e-mail/**index page numbers**; headers/footers/frames as Artifact; one Figure per logo/picture; `/Lang`, XMP, `DisplayDocTitle`; bookmarks for every chapter **and plates**; progress shown for every stage.
- Out: tagged `.pdf`, internal check (`pdfua/check.ts`) plus **veraPDF PDF/UA-1** result and a PAC-compatible tag listing, review list (missing alt, ambiguous index targets).

---

## 3. Where AI should and should not be used

| Task | Use AI? | Why |
|---|---|---|
| Tag tree, reading order, MCID/Figure grouping, list/table/index structure | **No** | Geometry and font rules; repeatable; must give identical output for the same file. An AI guess here is untestable. |
| Links (contents, index page numbers, notes, image list), bookmarks, page markers, file names, XHTML class names, CSS | **No** | Pure mapping rules from the client's sheet; the client marks these to the character. |
| Running-head / folio removal, paragraph merge/split, verse vs body, table detection | **No (rules + evidence scores, already in `detect`)** | Decidable from indents, gaps, repeats. Give each decision a confidence; send only low-confidence ones to the review list. |
| Validation (EPUBCheck, Ace, veraPDF, PAC) | **No** | Standards checkers are the authority; AI cannot certify. |
| Spelling out a Standard-vs-Accessible rule from a client sheet | **Optional, human-confirmed** | `spec/ai.ts` already does this with a key in `localStorage`; fine because every row is confirmed with its source. |
| Alt text for pictures | **Yes, as a draft only** | Needs looking at a picture (judgement). Already: typed > sheet > file metadata > decorative rule > unapproved AI draft; certification blocked while a draft is open. Keep it that way. |
| Deciding "decorative or meaningful" for a logo/rule | **Suggest only** | Judgement; the client changed their mind (U1/A7). Make it a per-client option, default from their ruling. |
| Ambiguous style role (is this a subhead or text?) when the evidence conflicts | **Suggest only, optional** | Show the page crop and the top two guesses; the reviewer decides; the answer is remembered per client (as the "remembered style name" in `e68f7e6`). |
| "Does our output look like the client's reference?" | **No: use golden files** | Compare normalised markup of our output to the client's reference EPUB/PDF tag list, per test book, in CI. This is what ends the correction rounds. |

Cost/risk note: the client is "old-school": do not mention AI in the deliverable, only "suggested description, please approve".

---

## 4. Correction → status

Status key: **Done** = handled by a commit, hash given (from reading; not re-run). **Partly** = some of it exists. **New** = nothing in code. **Conflict/unclear** = needs a client answer first. "Repro" = the same defect was claimed fixed earlier, but needs the client's file.

| ID | Status | Evidence / note |
|---|---|---|
| U1 logo extra Paths | **New** (looks like a regression of "A8 fixed") | `31ae0f7` makes logos Figures but `content.ts:rewrite` still closes the marked-content sequence at every `q/Q`. One MCID per graphics group. Repro in Acrobat/pdf.js tag reader. |
| U2 index links | **New** | No code. `b628a35` links notes only; contents/URL/image list in `write.ts`. |
| U3 `301n.66` as note | **New / unclear** | `b628a35` pairs small numbers in text with numbered end notes; `301n.66` is a different pattern. Target unclear (Q3). |
| U4 all LI not P | **Partly + Conflict** | `e83582b` Lbl/LBody; `31ae0f7` made index "one P per entry" (opposite). Notes page: first entries LI, later P (hanging/page-break case). Q2. |
| U5 | **Unclear** | Duplicate of U3 or note-label request. Q3. |
| U6 plate bookmark | **New** | `pdfua/index.ts:frontPages` and `write.ts` §5 only front pages + headings. |
| U7 hang at 322/322 | **New (repro needed)** | `analyzeUa` stages after reading have no progress, `PdfUaFlow.tsx:60` only reports reading. |
| U8 cover picture | **Unclear** | No instruction. Q9. |
| I1 title page as image | **New + Conflict** | Section 5. |
| I2/P1 centre + small caps on copyright | **Partly** | Small caps in headings/runs: `a3e8108` (on main, not in this branch), earlier `inline.ts:smallCaps`. Page-level alignment on copyright page: no commit. |
| I3 contents links, no page numbers | **Done for BeBra, repro for this book** | `77f5b50` + `c7100c7` (client contents markup, page numbers test) on the Tempelhofer client layer; the Birmingham book has no client layer. |
| I4 `chapter-title` class | **New** (needs class map) | Per-client class mapping; same need as the Cambia style map (Q8). |
| I5/I9/P13 heading space & alignment & font | **Partly** | V3 rows 16–20 rule exist (`rules.test.ts`), not validated on Birmingham. |
| I6/P4/P9/V5/V8 image placement | **Partly (repro)** | InDesign: pictures moved to caption's page for Tempelhofer (FORGE_STATUS); PDF path: `238b0bb` "picture placement evidence". Birmingham InDesign and PDF still show the images wrong or at the end; P9 "Fixed" is unconfirmed. |
| I7/P6/V6 verse/extract | **Partly** | Extract handling exists (`pdfepub/build.ts` extract/extractt/extractint classes; InDesign `extracts` classes). Line-per-paragraph and the CSS (spacing/size) are what the client says is missing. |
| I8/P7 quote size | **New** | |
| P2 contents font/alignment | **New** | |
| P3/V1 page and chapter id | **Partly (config)** | `epub/package.ts` rule `stdPageMarks` ('anchor' default, 'none' exists); chapter id `id="chap1"` + `ch-head1` spans come from `pdfepub/build.ts:661` and the heading template; need the `chnum`/`chtit` template. |
| P5 justify | **New** (CSS rule) | |
| P8 caption merged into text | **New (repro)** | |
| P10 cover markup | **Unclear** | Q7. |
| P11 `<title>` book title only | **New** | |
| P12 title page vs half title, logo crop | **New** | |
| V2 running head leaked | **Partly (repro)** | `pdf/pages.ts:104` drops a head only if it repeats on ≥3 pages after the folio is stripped; "chapter 1" is lowercase (small caps extracted as lowercase?) and leaks. |
| V3 para merged over page break | **New (repro)** | |
| V4 table | **Partly** | Ruled tables via `pdf/tables.ts`; the reference table is un-ruled label/value pairs. |
| V7 italic missing | **New (repro)** | Inline font-name italic exists; this sample fails. Also `<em>` vs `<i>` conflict (section 5). |
| Book_Details.xlsx | **New** | No importer. |

---

## 5. Where the client's ask conflicts with the standards

| Client ask | Standard | Verdict and what to do |
|---|---|---|
| STD chapter heading is `<p class="chnum">` + `<p class="chtit">`, headings as paragraphs (V1, I4; also `STD-` "headings are classed paragraphs") | EPUB Accessibility 1.1 requires conformance to WCAG 2.x A/AA; WCAG 1.3.1 (info and relationships), 2.4.1/2.4.6 need real headings | Valid EPUB 3 but **not accessible**. Fine only if the file is sold/labelled "Standard", and **must not** carry accessibility metadata (`schema:accessMode…`, `conformsTo`). Keep the Accessible profile on `h1–h6`. State this in the Standard profile's help text. |
| STD `alt="decorative"` / `alt="image"` as default (the client's language sheet; `package.ts` `stdAlt: generic`) vs the client's reference `alt=""` (V5) | WCAG 1.1.1; EPUB A11y 1.1; a decorative image should be `alt=""` (+`role="presentation"`), a meaningful one a real description. A screen reader reads "decorative"/"image" aloud. | Their sheet and their sample disagree. Recommend: `alt=""` for decorative, real text for meaningful, **never** the words "image"/"decorative". Needs client sign-off on changing their sheet (Q5). |
| Bold/italic as `<b>`/`<i>` (sheet, `stdEmphasis: 'bi'`) vs `<em>`/`<strong>` (client reference, V7 and `<p class="subt"><strong>`) | HTML: `em`/`strong` carry meaning that assistive tech can announce; `i`/`b` are presentational. Both valid. | Not a violation; a contradiction. Reference sample wins for the marking; ask (Q6). |
| Title page as one image (I1) | WCAG 1.4.5 (images of text), 1.1.1; EPUB A11y 1.1 | Allowed only if `alt` repeats the title/author/publisher text. Prefer real text styled to match print. Offer a per-client switch; default text. Cover image is fine as an image. |
| Contents without page numbers, only links (I3) | EPUB Accessibility 1.1: print page numbers belong in `page-list`, not in the contents | **Consistent.** Do it: hide numbers in the visible contents, keep the `page-list` nav in Accessible. |
| No page ids in STD (P3, V1) | Accessible EPUB with print source: page markers/page-list are a requirement for "pageBreakMarkup" conformance claims | Fine for STD, **wrong for Accessible**. Keep it a STD-only rule. |
| Justified body text (P5) | WCAG 1.4.8 (AAA) advises against justified text; reading systems let users override | Not an AA failure. Do it as publisher style; use relative sizes (`em`/`%`), not fixed `pt`/`px` ("text size wrong" I8, P7) so zoom works (WCAG 1.4.4). |
| `<title>` = book title only on every content file (P11) | WCAG 2.4.2 (page titled) expects a title that describes that document; EPUBCheck only needs it present | Valid. Slightly less helpful for navigation: the client's call; do it. |
| PDF/UA index as `L`/`LI` (U4) vs `P` | ISO 14289-1 (PDF/UA-1) / ISO 32000-1 §14.8.4: `L`/`LI`/`Lbl`/`LBody` and `Index` are standard types; `P` is also allowed | Both conform. `L` may only contain `LI`; `LI` only `Lbl`/`LBody`. Client preference wins: decide (Q2). Link annotations must be inside a `Link` element with `/Contents` and an OBJR; already done for other links. |
| One Figure per logo, no "Path" children (U1) | ISO 14289-1 §7.3: Figure needs `/Alt`; marked content for one Figure may legally be several MCIDs | Not a conformance failure: a cleanliness request. Merging to one MCID is allowed if sequences nest properly with `q/Q`/`BT/ET`; PAC rejects crossing nesting, so wrap at the outermost `q…Q`, not across it. If the logo is decorative, an Artifact is simpler and conformant (client reversed this once; confirm). |
| Plate bookmark (U6) | Bookmarks are not mandated by PDF/UA-1 for all documents but are the main navigation (WCAG 2.4.5, multiple ways) | Safe; add. |
| Notes: `301n.66` linked as footnote (U3) | PDF/UA: `Note` + `Reference` + `Link` is correct; a link needs a real destination | Safe, but only once the target is defined (Q3). |

Nothing the client asks is *illegal* under EPUB 3 or PDF/UA-1. The real risk is the Standard profile being sold as accessible: say so on screen.

---

## 6. Questions for the client

Keep them yes/no or "pick A/B"; send them as one list.

1. **Which book is current for the EPUB markups?** The files say *Cambia tu mente*, the pictures are *A Dark History of Birmingham* (dated 25 Sep). Is Birmingham the test book now, and can you send the input + your finished EPUB for it?
2. **Index and end notes (U4):** should *every* index entry and *every* end note be a list item (`L/LI`), replacing the "one paragraph per entry" you asked for on 17 Oct? Or only end notes?
3. **`301n.66` (U3/U5):** when this is clicked, should it go to page 301, or to note 66 in the Notes section? Is the whole token the link? Is "N is the footnote" the same remark twice (the document repeats one screenshot)?
4. **Index page numbers (U2):** a range `48–9` goes to the first page — OK? Page numbers that name notes (`317n.409`) follow Q3?
5. **Picture descriptions in Standard EPUB:** your language sheet says default `image`/`decorative`; your samples use `alt=""`. Which? We recommend empty for decoration and a real description otherwise.
6. **Bold/italic:** `<em>/<strong>` (your samples) or `<i>/<b>` (your sheet)?
7. **Cover markup (P10):** is `<p class="cover"><img alt="cover" class="cv" id="cimg" …/>` what you want, or is it an error?
8. **Class names:** can you send, per book, the list "InDesign style → CSS class" (for example your `chnum`, `chtit`, `noindent`, `indent`, `extract`, `figcap`, `img_cont`, `chapter-title`)? We can't guess them from one sample. Same for Cambia.
9. **Cover picture (WhatsApp 1):** is anything wrong with how the *Alquimia* cover is used, or was it only the test input?
10. **Book Details workbook:** should the tool *read* it (file names, levels, titles, pages, epub:type) and treat it as the plan? Who fills the empty rows and the epub:type column, you or the tool?
11. **Title page as picture (I1):** really an image (then we write the text into its description), or real text styled like print?
12. **Logos (FSC, publisher mark):** Figure with description (what you asked on 17 Oct) or decoration? Per book or always?
13. **Standard EPUB:** may we label it "Standard (not accessible)" in the file's metadata and in our screen?
14. **How do you decide a file is right?** Can you give, for each pipeline, 2 books with the input and the finished reference file? We will test against those, so you do not have to mark screenshots again.
15. **The stuck screen (U7):** the full path/size of the extra PDF, and does it also happen without the cover or without the extra PDF?

---

## 7. Fix plan (ordered) with acceptance criteria

Order = cheapest unblock first, biggest client-visible win next, risky last. Each item ends with a test that stays in the suite.

0. **Housekeeping (½ day).** Choose one repo (suggest `pdf-tagger-sns`, `main`) and cherry-pick: `a3e8108`/`5bc7629` from main into pdfua; the uncommitted `linkNotes` diff from `sns-publishing-automation`. *Accept:* `git log` shows one line of history, `npm test` green, same count as the 17 Oct checklist (127).
1. **Get the test files + client answers Q1, Q8, Q14.** Put the 3 books and their reference outputs in `samples-local/` (git-ignored). *Accept:* each pipeline has a golden test comparing normalised markup (EPUB) / tag listing (PDF) with the reference.
2. **U7 progress and hang (½–1 day).** Report progress and allow cancel for every stage of `analyzeUa`; add a time-out message. *Accept:* with the 322-page *Alquimia* file the screen never shows a frozen spinner for more than 5 seconds without a new status line, finishes or shows an error, and **Analyse** re-enables.
3. **U1 one MCID per logo/picture (1 day).** In `content.ts:rewrite`, open the Figure's sequence at the outermost `q` and close at its matching `Q`. *Accept:* in the Gladiators p5 FSC logo: Figure has ≤ 2 children in the pdf.js tag reader; PAC shows 0 errors on that page; existing `pdfua*.test.ts` still pass.
4. **U6 plate bookmark (½ day).** Bookmark for the first page of each appended PDF ("Plates"/localised label), named in `labelsFor`. *Accept:* Gladiators output bookmarks end `…Notes, Index, Plates`, and Plates jumps to the first plate page.
5. **U2 + U3 index links (2 days).** In the index section, detect page-number tokens (with ranges and `NNNnMM` note refs), map printed page → PDF page (`book.numbers`), write `Link` annotations inside `Reference/Link` structure elements, like notes. Behaviour of `n` per Q3. *Accept:* Gladiators index p323: every page number is a Link with `/Dest`; click `193` lands on printed p193; 100 % of tokens in a sample of 20 entries linked; PAC "Link" rules 0 errors.
6. **U4 lists (1 day).** After Q2: put every end-note entry (including wrapped and page-start entries) in `LI`; if the client says index too, switch `P` → `LI` under an `L` per column block. *Accept:* the Notes section contains 0 `P` under `Sect` except the heading; numbering `Lbl` = the printed number.
7. **STD EPUB template pass (3 days) — one profile, from the client reference, not from our guess.** After Q5, Q6, Q8: chapter opener `chnum`/`chtit`, no page anchors and no chapter ids in STD, `alt` rule, `em/strong`, `<title>` = book title, `figcap`/`img_cont` markup, copyright/title/contents CSS (centre, serif, small caps, justify, relative sizes, reduced extract/quote size, heading bottom space). *Accept:* the golden diff against `T-C-E…(STD).epub` and the Birmingham reference has 0 structural differences in the cited pages (4, 5, 6, 9, 11, 14, 15, 19; Introduction; Contents; Copyright; Bibliography).
8. **PDF→EPUB logic fixes (3 days), each with a unit test from the cited page:** running head leak (V2), paragraph merge across page break (V3), label/value block → table (V4), caption not merged into text (P8), picture between paragraphs not mid-sentence (V5/P4), verse one `<p>` per line (V6), italic (V7), title page vs half title and logo crop (P12). *Accept:* the T-C-E pages above equal the reference; no paragraph that ends a sentence is split by an image; 0 leaked running heads in the whole book (text diff vs the PDF).
9. **InDesign→EPUB fixes (2 days):** pictures never after the last page (I6), heading spacing, extract/quote classes with CSS, title page text-or-image switch (Q11). *Accept:* in Birmingham the map sits in the Introduction after "…continues.", caption below; EPUBCheck 0 errors.
10. **Book Details workbook importer (1–2 days), only after Q10.** Read sheet 1 into metadata, sheet 2 into the file plan; show missing rows as review items. *Accept:* loading the Tempelhofer sheet gives the same ten chapters as the automatic run and reports the 12 rows without pages as "check".
11. **Validation (1 day).** Install veraPDF (Java 11+, the machine has Java 8) and run the PDF/UA-1 profile + PAC on our *own* output; EPUBCheck (+ Ace for Accessible) already in the desktop build. *Accept:* a one-page "PASS/FAIL, N items" per file, shown in the app and saved next to the download. Without this, "done" cannot be claimed.
12. **Reply package to the client.** One sheet per pipeline: "your comment → what we did → where to look in the file" with the page numbers; the questions in section 6 up front. *Accept:* client confirms by ticking rows, not by sending new screenshots.

Estimated total: about 15–17 working days, of which 4 days wait on client answers (Q2, Q3, Q5, Q6, Q8, Q10, Q11).

---

### Summary (15 lines)

1. 24 new client points in five documents; the corrections are marked-up screenshots, many with unclear target or order.
2. Only two WhatsApp images: the *Alquimia* cover (no words) and a bug screenshot of "Reading page 322 of 322" stuck with Analyse disabled.
3. The two commit ranges you gave (`402250b`, `abf16a0`) are hardening fixes and fix **none** of these corrections.
4. Three repos carry the same engine: pick one source of truth first.
5. The Cambia/Birmingham test book is mismatched (names say Cambia, pictures say Birmingham, dated 25 Sep): ask which is current.
6. PDF/UA: 5 real asks (logo extra paths, index links, `n` note, list not P, plate bookmark) plus the hang; logo paths look like an un-fixed "A8" (MCID per `q/Q`).
7. PDF→EPUB (T-C-E): running head leak, merged paragraph, table, image mid-sentence, verse lines, italic, no page/chapter id: all need the client's own class map.
8. InDesign→EPUB: title page image, copyright alignment/small caps, contents links, heading space, image placement, verse/quote sizes.
9. `Book_Details.xlsx` has no importer and no stated instruction: ask.
10. Client materials contradict each other (`<em>` vs `<i>`, `alt=""` vs `alt="decorative"`, headings as `<p>`): resolve before building.
11. Nothing asked is illegal under EPUB 3 / PDF/UA-1, but the Standard (heading-as-`<p>`, generic alt) profile is not accessible and must not claim to be.
12. AI only for alt-text drafts and optional suggestions with human approval; everything else deterministic and tested against the client's reference files.
13. Nothing was run: none of the test books exist on this machine; items marked "repro" need the real file.
14. Fix plan: 12 ordered steps (progress hang → logo MCID → plate bookmark → index links → lists → STD template → PDF/EPUB logic → InDesign → importer → veraPDF/PAC), about 15–17 days, 4 waiting on answers.
15. Written to `docs/CORRECTIONS_2026-10-23.md`; no other file or repo was changed.
