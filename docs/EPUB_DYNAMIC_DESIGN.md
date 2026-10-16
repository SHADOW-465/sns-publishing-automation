I didn't change any code. The design document is below and is also saved at `C:\Users\acer\.claude\plans\read-only-design-review-of-vivid-seahorse.md`, ready to copy to `docs/EPUB_DYNAMIC_DESIGN.md`.

---

# EPUB generator: making it dynamic (design review)

Read-only review of `automation-app` on branch `forge/pdf-word-a11y` (HEAD `7a3883c`), 2026-10-16.
Evidence used: `src/engine/{indesign,epub,pdfepub,spec}`, `settings.ts`, `check/epub.ts`, `review/confidence.ts`, the Spec/Settings UI, the client report `corrections/EPUB-Automation-Report_*.docx` (text plus `_report_media`), the reviewed tool output (`corrections/_tool_x`), the InDesign input (`corrections/_ref_x`), `_diag_styles.txt` and the three spec workbooks.

**The goal:** every standard EPUB default is built in, the tool reads the source's own styles and structure, any client's styles can be added as data, and the output is a valid EPUB with no errors.

**Summary.** The engine is better than the Tempelhofer output suggests. The structure fixes that came after the report (`bba80a8`) are generic, and the rule layers (house ΓåÆ client ΓåÆ series ΓåÆ book) are a good base. What doesn't scale is the way the review was answered. Every client comment became a new rule ID, a new `HouseSettings` key, a new `sanitize` line and a new `if` in the engine, and BeBra's preferences went into a TypeScript file. The style profile (what each source style means) sits in localStorage, outside the layers. Detection is two separate rule-of-thumb pipelines (InDesign and PDF) with a yes/no "unsure" flag instead of scored evidence. EPUBCheck and Ace run only in tests, never before a download. The plan below fixes those four things in that order.

---

## 1. Current logic, and why Tempelhofer Feld failed

### 1.1 How it works today

| Concern | InDesign ΓåÆ EPUB | PDF ΓåÆ EPUB | Shared output |
|---|---|---|---|
| **Reading the source** | `readExport` (`indesign/read.ts:33`) flattens the XHTML into `Block`s (`p`/`pb`/`img`/`table`/`list`). It collects footnotes and endnotes by `epub:type`/`_idFootnotes` and keys each paragraph by `styleKey` (`read.ts:148`), the first class that isn't an override. | `analyzePdf` (`pdfepub/analyze.ts:117`) groups text lines by `styleKey` = font family + bold + size (`analyze.ts:85`). | ΓÇö |
| **What a style means** | `inferProfile` (`read.ts:250`) gives each style one `Role` (`ROLES`, `read.ts:157`). It tries these in order and the first match wins: (1) the element is already `<h1>`ΓÇô`<h6>` (`headingRoleOfTag`); (2) the style name matches `NAMED_HEAD`, `TOC_NAME` or `IMPRINT_NAME`; (3) a short centred line is always followed by a big title (label/title pair); (4) **only if no chapter style was found yet**, the lines match entries on the printed contents page (pass 1b); (5) typography: `display()` (centred, ΓëÑ1.15├ù size), `isHeading()` (bold/small caps/sans with space around it), bullet/TOC/imprint text patterns. The output is `unsure: boolean` plus a reason. | Roles come from size relative to `bodySize` (`analyze.ts:197`). Then `readContents` + `matchHeadings` (`pdfepub/contents.ts:126`, `:182`) override them: a body line that matches a contents entry is forced to `chapter-number`/`title`. It uses a different role list (`PDF_ROLES`, `analyze.ts:18`). | Two separate detectors with two role lists. |
| **Chapter splitting** | `build()` step 2a (`indesign/build.ts:228-325`) walks the blocks. It opens a new `Sec` at a part label, chapter label, chapter title or section title, or at a subheading whose text is a section keyword and is listed in the contents (`listed`, `:243`). `bodyStart` (`front.ts:61`) decides where front matter ends, and `classifyFront` (`front.ts:118`) types the front pages by their content. `sectionTypeOf` (`epub/locale.ts:279`) types a section from its heading keywords. Step 2c names the files `chapterNN`, `partN`, `fmN`/`bmN` (`:363-394`). | `buildPdfEpub` (`pdfepub/build.ts:147`) splits on forced chapter lines. | `SECTION_META` (`locale.ts:283`) maps each section type to its `epub:type`, DPUB-ARIA role and file stem. |
| **Headings** | `renderHeading` (`build.ts:1009`): parts and source-`h1` chapters become `h1`, everything else `h2`. HD-07 (`chapterTag`) forces `h2`, and HD-08 (`chapterHeadingClass`) sets `chapter-b` on a chapter that has no label. Subheads h2ΓÇôh5 come from their roles. HD-01 adds `role="heading"`/`aria-level`. | Size rank ΓåÆ h1/h2/h3. | `validateEpub` warns when a page has no heading. |
| **Notes** | The note-reference callback (`build.ts:673-691`) works like this. If the book has a `notes` section (`collectEndnotes`, `:521`) and the note is an InDesign endnote, the note goes to `notes.xhtml` behind `<sup><a ΓÇª href="notes.xhtml#fn-N">`. Otherwise it goes into a `<div class="footnotes">` at the end of the chapter. `linkNotes` (`:1075`) links a "Notes" subheading followed by numbered paragraphs. `renderFootnote` (`:1136`) writes the backlinks. | Notes come from small numbered lines plus superscript references. | STD-07 plain links vs note roles. NOTE-01/02/03 control the separator line and indent. |
| **Images** | `analyze()` guesses each picture's placement (`build.ts:116`), and `textAround` (`:154`) takes the caption. InDesign dumps pictures far from their page. `build.ts:534-602` moves a picture to the print-PDF page whose text contains its caption (**this needs the print PDF**), then puts it in place with `insertAtMarker` (`epub/insert.ts`). Alt text comes through `epub/alt.ts`/`alt-ai.ts`. | Picture boxes are rasterized. `pdfPictureAlt` (`pdfepub/build.ts:111`). | STD-03 chooses `<figure>` or `<div class="fig_group">`. |
| **Contents and navigation** | Step 2d (`build.ts:404-497`) rebuilds the printed contents page. Each entry is linked by normalized text to a section, then to a subheading, then by page number. Unmatched entries become review items. NAV-02 keeps page numbers, NAV-03 adds the subtitle to the menu. | `readContents` gives the structure. | `packageEpub` (`epub/package.ts:216-356`) writes `nav.xhtml`, `toc.ncx`, the page-list, landmarks (cover, titlepage, toc, bodymatter) and the guide. Depth is at most 2 (part ΓåÆ chapter). |
| **Rules** | `RULES` (`spec/rules.ts:52`), `HouseSettings`/`DEFAULT_SETTINGS`/`sanitize` (`settings.ts`), layers via `resolve` (`spec/layers.ts:57`), shipped client layers in `spec/clients.ts`, style profile in `localStorage` (`remember('profile', publisher)`, `ui/IndesignFlow.tsx:71`). | Same settings. | ΓÇö |
| **Checks** | `validateEpub` (`epub/validate.ts`) runs a light in-app check. `checkEpub` (`check/epub.ts:85`) is a thorough structural, accessibility and completeness check. EPUBCheck runs only in tests (`test/epubcheck.ts`, Java in `tools/`). Ace never runs. | Same. | ΓÇö |

### 1.2 The 12 points of the client report

The reviewed output (`corrections/_tool_x`) had **0 chapter files**. It had 32 `bm*.xhtml` back-matter pages, two copyright pages (`copyright2.xhtml` held *Luftfahrt* onward), and a navigation menu listing only Umschlag, Schmutztitel, Titelseite and Impressum ├ù2. Point 1 is the root cause, and points 3, 4 and part of 6 follow from it.

| # | Client comment | What the tool did | Root cause | State now | Generic? |
|---|---|---|---|---|---|
| 1 | Nav, NCX, TOC: chapter splitting (global) | No chapters. Every heading-looking block became generic back matter (`bm1ΓÇªbm32`). | The chapter titles were `<h1 class="h1">` with **no CSS** (`_diag_styles.txt`: font-size undefined), so the typography rules had nothing to measure. The tag and the style name weren't signals yet. The contents lines (`ihv1`, "Natur11", page number in a span) weren't recognised as contents, so the contents fallback found nothing. The InDesign export also wraps text in `div`s, and the old reader didn't walk into them. | Fixed in `bba80a8`: tag, style name and `ihv`/`seitenzahl` signals, walking into nested divs, contents matching. | **Yes.** But the contents match still runs only when nothing else found a chapter (pass 1b). It never cross-checks a typography guess. |
| 2 | Title page: alignment, author at the bottom, wrong font | The title page was rebuilt in export order (frame creation order) with a serif face. | `renderFront` rebuilds the page. InDesign's export order isn't the visual order. | `inPrintOrder` (`build.ts:1320`) reorders the lines from the print PDF, but only if **every** line is found. `isSansLine` guesses the font. | Partly. Without a print PDF the export order stays. |
| 3 | TOC mistake | Contents page without page numbers, subtitles lost. | NAV defaults stripped the numbers, and `ihv2` subtitles weren't linked. | NAV-02 `show` + `toc_1s`, set in the BeBra layer. | The values are generic, but each one is its own hand-written rule. |
| 4 | `<h2 class="chapter-b">` expected, tool `<p class="h1">` | Chapter titles were paragraphs. | Follows from #1. | HD-07 = `h2` and HD-08 = `chapter-b`. **`chapter-b` is a client class name written into the rule's code.** | **No.** The next client's class needs another code change. |
| 5 | `<sup>` missing around the note reference | `<a epub:type="noteref" href="#fn-01">` with no `<sup>`. | Hard-coded markup. | `<sup>` is now always written (`build.ts:685/690`). | **No.** It's hard-coded the other way now, and a client who wants no `<sup>` needs code. |
| 6 | Wrong image position and spacing | Pictures sat where InDesign dumped them. | The export order of anchored and floating frames. | Moved by caption text against the print PDF (`9590c15`). 3 pictures still unplaced (pp. 98/169/171). | Partly. Depends on the print PDF and captions of 24+ characters. The InDesign layout `div`s and page markers aren't used as evidence. |
| 7 | Duplicate language in the header | `lang` + `xml:lang` on `<html>`. | House default. | DOC-01 default `xml:lang`. Note that DOC-02 still repeats the language on a `<div xml:lang>` in every page. | Yes (a rule value). |
| 8 | aria-label missing | Navigation lists and pages had no accessible name. | Not emitted. | Every page is named (`13a1b55`). The nav label position is NAV-04 (`section` or `nav`). | Yes. The code says EPUBCheck 5.4 rejects `aria-labelledby` on `<nav>`; recheck this with the EPUBCheck version the gate pins. |
| 9 | `xmlns:opf` missing on `<metadata>` | `<metadata xmlns:dc=ΓÇª>` only. | Not emitted. | Now hard-coded (`package.ts:329`). | It's a fixed string. Harmless, so fine. |
| 10 | Cover `<title>`: tool "Umschlag", client "Abdeckung" | `Umschlag` from the built-in German labels. | The client's reference uses a different word. | Label override `coverTitle: 'Abdeckung'` in the BeBra layer (`clients.ts:34`). | Yes as a mechanism, but it lives in code. *"Abdeckung" is a literal machine translation of "cover"; standard German is "Umschlag" or "Cover". Confirm with BeBra before treating it as house style.* |
| 11 | `<reference type="toc">` missing from the guide | Guide had the cover only. | Not emitted. | Added (`package.ts:354`). | Yes. |
| 12 | Notes placed at the end of each chapter | Endnotes rendered per chapter. | Notes always went to the chapter. | Collected into `notes.xhtml` **when the book has a notes section** (`collectEndnotes`). | Not a rule. It's an implicit side effect of how the sections were detected. |

**The pattern behind it.** The tool had **no gate** and **no reference comparison**, so each point was found by the client, not by us. Every fix after that was either a code branch or a rule written for one client. Each comment in the report is a markup sample ("expected X, got Y"), so the client is already handing us data. The design below takes that data in directly.

---

## 2. The standard defaults to build in

These are always on, or are the house default in the house layer. Items marked **(locked)** can't be changed by any layer, because changing them breaks EPUB 3.3 validity.

### 2.1 EPUB 3.3 (validity)
- **(locked)** OCF: `mimetype` is the first zip entry, stored uncompressed, with no extra field. `META-INF/container.xml` is present. Already done, and checked in `check/epub.ts:69-73`.
- **(locked)** Package: `version="3.0"` (EPUB 3.3 still uses `3.0`). `unique-identifier` points to `dc:identifier` (`urn:isbn:` of the e-ISBN, or a `urn:uuid` if there is no ISBN). `dc:title`, `dc:language` (BCP 47) and `dcterms:modified` (`CCYY-MM-DDThh:mm:ssZ`) are present. Every file is in the manifest and every manifest item exists. Media types match the file bytes. Manifest `properties` are set where needed (`nav`, `cover-image`, `mathml`, `svg`, `scripted`, `remote-resources`).
- **(locked)** XHTML content documents are well-formed and declare `xmlns` + `xmlns:epub`. Ids are unique within a file. No broken links or anchors. Every linked document is in the spine.
- **(locked)** The navigation document has `nav epub:type="toc"` with an `<ol>` and non-empty labels.
- Recommended and on by default: an EPUB 2 `toc.ncx` (older readers; the spine `toc="ncx"`) and a `<guide>` with cover, toc and text. The guide is deprecated in EPUB 3.3 but some clients' pipelines still read it. Standard dates: `dc:date` is the publication date, **not** the build date as now (`package.ts:337`).
- The cover is `cover.xhtml` first in the spine. **The `linear` attribute is a rule** (the InDesign reference uses `linear="no"`, stores vary). `<meta name="cover">` is written for EPUB 2 readers.
- Only fixed-layout books need the `rendition:*` properties. They are reflowable by default, out of scope.

### 2.2 EPUB Accessibility 1.1 / WCAG 2.2 AA (accessible profile)
- `lang`/`xml:lang` on every `<html>`. A passage in another language gets its own `xml:lang` (the PDF/UA path already detects these, `FORGE_STATUS` step 3; reuse that for EPUB).
- A real heading hierarchy (`h1`ΓÇô`h6`) with no skipped levels (checked, `check/epub.ts:250`). Each section is named by its heading or by `aria-label`/`aria-labelledby`.
- `epub:type` paired with DPUB-ARIA `role` from `SECTION_META`. `role` only goes on elements that allow it: no `doc-chapter` on `<body>`, and `doc-pagebreak` on an empty `<span>`.
- **Page navigation.** Page breaks are `<span epub:type="pagebreak" role="doc-pagebreak" id="page-N" aria-label="Seite N"/>`. There is a `page-list` nav, and `pageBreakSource` points to the print ISBN.
- **Pictures.** Every `img` has an `alt`. A decorative picture gets `alt=""` and `role="presentation"`. A caption is never copied into the alt. Complex figures get an extended description (`aria-describedby`, or `<details>`).
- **Notes.** `<a epub:type="noteref" role="doc-noteref">` points to an `<aside epub:type="footnote" role="doc-footnote">` or to `<li>` endnotes in `<section epub:type="endnotes" role="doc-endnotes">`, with a backlink `role="doc-backlink"`.
- **Tables** have `<th scope>` (TBL-01 advisory).
- **Package metadata.** It must be **derived from the gate results, not typed in.** `schema:accessMode` (textual, plus visual when there are pictures) and `accessModeSufficient`. `textual` alone is claimed **only if** every non-decorative picture has a real alt. Today it's always claimed (`package.ts:303`). `accessibilityFeature` is already derived (`package.ts:288`). `accessibilityHazard` and `accessibilitySummary`: write the summary from the facts, in the book's language. `dcterms:conformsTo` = `EPUB Accessibility 1.1 - WCAG 2.2 Level AA` is set **only** after the gate passes and a person certifies. `a11y:certifiedBy` and an optional `a11y:certifierReport` complete it.
- Display: no fixed font sizes in `px` for body text, no `!important` on colour or size, contrast at least 4.5:1 for coloured text. The look checker `check/look.ts` covers part of this.

### 2.3 German publisher conventions (de-DE default locale pack)
- **Labels:** Umschlag (or Cover), Schmutztitel, Titelseite (Titelei for the front-matter group), Impressum, Inhalt / Inhaltsverzeichnis, Widmung, Motto, Vorwort, Einleitung, Kapitel, Teil, Nachwort, Anhang, **Anmerkungen** (endnotes), Fu├ƒnoten, Literatur / Literaturverzeichnis, Quellen, **Bildnachweis**, Register (Personen-, Orts-, Sachregister), Glossar, Zeittafel / Chronik, Danksagung, Der Autor / ├£ber den Autor, Seite (page). Most of these already exist in `locale.ts`. Check them against the client's language sheet and add the missing ones.
- **InDesign style-name abbreviations** that German typesetters use. Ship these as a built-in dictionary, as data:

  | Abbreviation | Means | Role |
  |---|---|---|
  | `BU` | Bildunterschrift | caption |
  | `BN`, `Bildnachweis` | picture credit | credit |
  | `KT`, `Kolumnentitel`, `Pagina` | running head, folio | drop |
  | `ihv`, `Inhalt` | contents entry (number = level) | toc |
  | `ZT`, `Z├£`, `Zwischentitel` | subheading | h3 |
  | `Kapitelzahl`, `KapNr` | chapter label | chapter-label |
  | `Kapitel├╝berschrift`, `K├£`, `h1` | chapter title | chapter-title |
  | `Grundtext`, `Lauftext`, `Flie├ƒtext`, `GT` | body text | p |
  | `Vorspann`, `Lead` | lead paragraph | p.lead |
  | `Zitat` | quotation | blockquote |
  | `Motto` | epigraph | epigraph |
  | `Widmung` | dedication | dedication |
  | `FN`, `Fu├ƒnote` | footnote | footnote |
  | `Anm`, `Anmerkung` | endnote | endnote |
  | `Kasten`, `Info` | box | aside |
  | `Marginalie` | margin note | aside |
  | `Initial` | drop cap | dropcap |
  | `Impressum` | imprint | imprint |

  Tempelhofer used `KT`, `BU`, `ihv1/ihv2`, `h1/h2` and `impressum` (`_diag_styles.txt`).
- **Impressum.** Keep "Bibliografische Information der Deutschen Nationalbibliothek", the ┬⌐ line, "Alle Rechte vorbehalten" and the **GPSR product-safety contact** (EU 2023/988, required since Dec 2024; the Tempelhofer Impressum has it). Replace the print ISBN line with the e-book ISBN and keep the print ISBN in `dc:source`. Drop print-only lines: Druck und Bindung, Printed in Germany, FSC/paper notices. This is FM-01 plus a built-in German list.
- **TDM reservation** (┬º 44b UrhG): offered as PKG-01, off by default. Only the publisher can decide.
- **Typography.** Keep ΓÇ₧ΓÇªΓÇ£ and ┬╗ΓÇª┬½ exactly as set, keep soft hyphens, set `hyphens: auto` with `lang="de"`, and keep en dashes (Halbgeviert) and em dashes (Geviert).
- **Market.** The European Accessibility Act, in force in Germany as the BFSG since 28 June 2025, makes the accessible profile the right default for trade e-books sold in the EU. ONIX/VLB export is out of scope, but the a11y metadata should map to ONIX codelist 196 one-to-one.

### 2.4 Navigation
- `nav.xhtml`:
  - `toc`: the full hierarchy, every part, chapter and section that has a heading, depth set by a rule (default 2, max 3). Labels come from the printed contents text when it matches, or else from the heading.
  - `page-list`: hidden.
  - `landmarks`: hidden, with cover, titlepage, toc, bodymatter, and **when present** loi (list of illustrations), bibliography, endnotes, index, acknowledgments. Today only the first four are written.
- `toc.ncx`: a mirror of the nav `toc` (same labels and order), plus `pageList` and `dtb:uid` = package identifier. A generated test already compares the two; keep it.
- Both lists come from **one** section tree (today `tree`, `package.ts:217`). The printed contents page is rebuilt from the same tree with the printed page numbers (NAV-02).

### 2.5 Notes
- **Placement is a rule** (new NOTE-04), not a side effect:
  - `source` (default): footnotes per chapter, endnotes where the book puts them.
  - `chapter-end`: notes at the end of each chapter.
  - `book-end`: everything in `notes.xhtml`, grouped under each chapter's title as an `h3`. This is the German "Anmerkungen" convention, and what BeBra asked for.
- Markup comes from a template (┬º4): reference `<sup><a epub:type="noteref" role="doc-noteref" href id>N</a></sup>`, a note body with a backlink, numbering `source`/`per-chapter`/`continuous`.

### 2.6 Figures
- The default is `<figure>` with `<img alt>` + `<figcaption>`. The picture credit (Bildnachweis) is kept as `<small class="credit">` or moved to the credits page, set by a rule.
- The figure never goes inside a `<p>`, and it sits next to the page marker of the printed page it was on.
- A full-page picture is its own block, not its own spine item, unless the rule says so.
- Size: `max-width: 100%`, never upscaled, and big images capped at about 4 MP (store limits).

### 2.7 Metadata
- `dc:identifier` (e-ISBN), `dc:title` plus `meta refines` title-type for the subtitle (instead of joining them with ". "), `dc:creator` with `role` (`aut`, `trl`, `ill`, `edt`) and `file-as` ("Weigel, Bjoern"), `dc:publisher`, `dc:language`, `dc:date` (publication date), `dc:rights`, `dc:source` (print ISBN), `dc:subject` (optional, Thema/BISAC), `dc:description` (the blurb if given; today it's the title repeated, `package.ts:336`), `dcterms:modified`, `belongs-to-collection` for the series (the series layer already knows the name).

---

## 3. Automatic detection design

### 3.1 One model for every source
Replace the two role lists (`ROLES` in `read.ts:157`, `PDF_ROLES` in `analyze.ts:18`) with **one** `Feature` record per block. The InDesign, PDF and Word readers each fill it in. Classification, review and rendering then share one code path.

```ts
interface BlockFeatures {
  styleKey: string            // InDesign paragraph style / PDF font+size key / Word style
  styleName?: string          // human name when known ("Kapitel├╝berschrift", "BU")
  tag?: string                // source element (h1, p, liΓÇª), InDesign only
  fontFamily?: string; sizeRatio?: number; bold?: boolean; italic?: boolean; caps?: boolean
  align?: 'left' | 'center' | 'right' | 'justify'
  spaceAbove?: number; spaceBelow?: number      // em
  page?: string; yFrac?: number                 // position on the printed page (PDF / print-PDF match)
  firstOnPage?: boolean; afterPageBreak?: boolean
  textLen: number; endsWithPunct: boolean
  pattern?: 'chapterWord' | 'partWord' | 'numberOnly' | 'roman' | 'bullet' | 'tocLine' | 'imprint' | 'sectionKeyword'
  contentsMatch?: { level: number; entry: string }   // matched an entry of the printed contents / source nav
  styleFreq: number           // how often this style occurs
}
```

### 3.2 Evidence scoring instead of first-match
Each signal adds weighted votes for one or more roles. Classify per **style** first, because a style means one thing in nearly all books. Then allow **per-block** exceptions only where a strong per-block signal (a contents match, a tag) disagrees with the style's role.

| Signal (strongest first) | Votes | Weight |
|---|---|---|
| Saved decision for this style (client/book layer `styleMap`) | that role | final (skips scoring) |
| Matches an entry of the **source's own nav/NCX** (InDesign exports one if the TOC style was set) | chapter/part/section at that level | 0.9 |
| Matches an entry of the **printed contents page** (`readContents`/`tocEntryText`) | chapter-title (level 1), h2/h3 (level 2+) | 0.8 |
| Source element is `h1`ΓÇô`h6` | heading at that level | 0.7 |
| Style name in the dictionary (`NAMED_HEAD` + the German table in ┬º2.3, as data) | that role | 0.6 |
| Text pattern ("Kapitel 3", "Teil II", a lone number at ΓëÑ3├ù size) | label roles | 0.5 |
| Typography rank: size ratio cluster, bold, caps, sans vs body, space above | heading level from size rank | 0.4 |
| Position: first on page, after a page break, top 40% of page | chapter start | 0.3 |
| Style is rare (Γëñ chapters ├ù 2) and short | heading | 0.2 |

`confidence = topScore / (sum of scores)`, scaled by the agreement between the signals.

**Book-level cross-checks** can lower the confidence of every style involved:
- The number of chapters found equals the number of level-1 contents entries.
- Chapter start pages rise in step with the contents page numbers.
- No chapter has fewer than about 150 words.
- No section is longer than about 40% of the book.
- The copyright page has fewer than about 400 words. This would have caught the *Luftfahrt* as Impressum case.

**Thresholds:** ΓëÑ 0.85 apply silently (counted). 0.6ΓÇô0.85 apply, but list it under "Check these first". < 0.6 **don't apply**: keep the safe fallback (body paragraph) and require a decision before export.

This replaces the `unsure: boolean` in `StyleInfo` (`read.ts:187`) and feeds the existing `reviewList` (`review/confidence.ts:45`), which already has the `low`/`medium` levels and the "which control fixes it" link.

### 3.3 Front and back matter
- Keep the page-level classifier `classifyFront` (`front.ts:118`) and move its keyword lists into the locale data. It scores: title page (matches the metadata title, author), copyright (ISBN, ┬⌐, DNB, GPSR address), dedication (short, centred, "F├╝r ΓÇª"), epigraph (quote plus attribution), contents.
- Back matter: `sectionTypeOf` keywords per language (Anmerkungen, Literatur, Bildnachweis, Register, Dank, Der Autor) plus the contents match. A heading after the last chapter that isn't listed is a "probable back matter" review item, not a silent `bmN`.
- An imprint found at the **end** of the book (Tempelhofer p. 208) moves to the copyright page in front. That is the current behaviour; keep it.

### 3.4 Notes
Detect the **kind** by evidence:
- an InDesign footnote (`epub:type=footnote`, `_idFootnotes`)
- an InDesign endnote frame
- a typed endnote section: a heading "Anmerkungen", then numbered paragraphs, often under chapter sub-headings
- a PDF footnote: a superscript number in the body and a small numbered line at the bottom of the same page

Match each reference to its note by number within its scope (chapter or book). Then render per the NOTE-04 placement rule. If any reference has no note, or any note has no reference, flag it with low confidence. Today an unreferenced note is dropped with a warning (`build.ts:950`).

### 3.5 Images
Place each picture using evidence, in this order:
1. The InDesign anchored position (inside the paragraph).
2. The page marker of the layout `div` that holds the frame.
3. A caption-text match against the print PDF (today's method).
4. The print-PDF image-box position, matched by perceptual hash.

The confidence comes from whichever signal placed it. Each picture is also classified: decorative (tiny, a rule, a repeat), logo, full-page, inline, cover. Caption, credit and alt are kept apart. A picture with no placement evidence is shown on the review screen with the three candidate pages.

### 3.6 Review screen
The "Structure" step (`ui/IndesignFlow.tsx`, step 3) becomes one list sorted by confidence. Each row shows:

- the item ("Style **ihv2**, 8 paragraphs"), with samples
- the proposed role, with the **evidence chips** that produced it ("listed in contents, level 2", "sans 0.75├ù", "always after ihv1")
- a confidence bar
- a role dropdown, and a "for this client / this book only" scope switch. The scope writes to the matching layer's `styleMap` (┬º4), so the decision is reused on the next book.

Book-level cross-check failures appear at the top ("Contents lists 10 chapters, found 0"). Next and Export are disabled while any item is below 0.6, and the disabled button says why. This is already done for other blockers (`FORGE_STATUS` fix 5).

> ponytail: weighted votes with hand-set weights, no ML. Tune the weights against the test corpus (`test/corpus.ts`). Add learning only if the corpus shows the hand weights failing.

---

## 4. Rule layers that handle any client as data

### 4.1 What's wrong now
- Adding a rule touches **four places**: the `HouseSettings` type, `DEFAULT_SETTINGS`, `sanitize` (`settings.ts:153`, one line per key) and `RULES`. Then an `if` goes in the engine.
- Several rules carry one client's literal values: HD-08 `chapter-b`, NAV-04 `nav`. The next client's class names need a release.
- The style profile (style ΓåÆ role/class) lives in `localStorage` (`remember('profile', ΓÇª)`). It's outside the layers, has no provenance, isn't in the spec workbook and isn't shared across machines.
- Shipped client styles are TypeScript (`spec/clients.ts`).

### 4.2 Four kinds of data on every layer
`Layer` (`spec/layers.ts:33`) gets three optional maps next to `values` and `labels`. `resolve()` merges each one by key, later layers win, and every entry keeps its provenance in `from`, as values do today.

```ts
interface Layer {
  values: Record<RuleId, RuleValue>            // existing: structural / house options
  labels?: Record<Lang, Record<LabelKey, string>> // existing: reader-facing words
  styleMap?: Record<string, StyleRule>         // NEW: source style ΓåÆ meaning
  markup?: Partial<Record<Role, MarkupTemplate>> // NEW: meaning ΓåÆ output element
  css?: string                                  // NEW: client CSS appended after house CSS (today only house extraCss)
}
interface StyleRule {
  match: { name?: string; nameRe?: string; tag?: string } // "BU", "^ihv(\\d)$", "h1"
  role: Role                                               // caption, toc, chapter-title, dropΓÇª
  level?: number                                           // for toc / headings ("$1" from the regex)
  class?: string                                           // output class override for this style only
}
interface MarkupTemplate {
  tag: string                       // h2, p, aside, figure, sup>a ΓÇª
  class?: string                    // "chapter-b" | "{style}" (source style name) | "{role}"
  attrs?: Record<string, string>    // role, aria-*, epub:type; "{level}" placeholders
  wrap?: string                     // "sup" for noteref, "div.footnotes" for a note block
}
```

**How the Tempelhofer points become data:**

| Point | Data |
|---|---|
| 4 | `markup['chapter-title'] = { tag: 'h2', class: 'chapter-b' }`. HD-07 and HD-08 go away. |
| 5 | `markup.noteref = { tag: 'a', wrap: 'sup', attrs: { 'epub:type': 'noteref', role: 'doc-noteref' } }`. |
| 10 | `labels.de.coverTitle = 'Abdeckung'` (already a layer label). |
| 12 | `values['NOTE-04'] = 'book-end'`. |
| 3 | `values['NAV-02'] = 'show'`. |
| styles | `styleMap`: `KT ΓåÆ drop`, `BU ΓåÆ caption`, `ihv(\d) ΓåÆ toc level $1`. |

The engine renders every element through **one** function, `renderAs(role, inner, ctx)`. It reads the resolved template and fills the `{style}`/`{level}` placeholders. Then the accessible/standard profile adds or strips roles. `toStandard` (`package.ts:35`) already works this way through a regex. Move that into the templates.

**Locked parts stay locked.** A template can't remove an `id` the links need, can't add a `role` that isn't allowed on the element (validated against a small allow-list), and can't remove `aria-level` from `role="heading"` (HD-02). The `advisory` and waiver logic applies to accessibility attributes in templates, as it does to values.

### 4.3 Generic settings from the registry
- Each `Rule` declares `default` itself. `DEFAULT_SETTINGS` = `Object.fromEntries(RULES.map(r => [r.key, r.default]))`, and `sanitize` = `coerce(rule, raw) ?? rule.default` for every rule. `coerce` already exists in `rules.ts:362`. This deletes about 40 hand-written lines in `settings.ts:153-192`, and adding a rule becomes one registry entry plus, only if it's a *new behaviour*, its use in the engine.
- **Structural options** are the finite set of engine knobs, each a rule:

  | Rule | Option |
  |---|---|
  | `SPLIT-01` | split level: part / chapter / h2 |
  | `NAV-05` | nav depth 1ΓÇô3 |
  | `NAV-06` | front/back matter in nav: all / named / none |
  | `NOTE-04` | note placement |
  | `NOTE-05` | numbering |
  | `FIG-01` | credit placement |
  | `FM-02` | title page: rebuilt / source order / print order |
  | `PKG-02` | cover `linear` |
  | `PKG-03` | write the guide |

  New client wishes usually land in `markup`, `labels` or `styleMap`, so they need no new rule.

### 4.4 Client styles are files, not code
- Move `CLIENT_STYLES` (`spec/clients.ts:21`) to `src/clients/*.json`, one file per publisher in the `Layer` shape, bundled with Vite's `import.meta.glob`, plus any that the user imports.
- The store layer (`store().getLayer`) still wins over the bundled one, as now.
- The `styleMap` replaces the localStorage profile. On first load, migrate any saved `profile` into the client layer's `styleMap`.

### 4.5 Rules screen
`SpecEditor.tsx`/`SpecStep.tsx` already list the rules with layer, source and waiver. Add three tabs over the same layer:
1. **Rules** (today's list).
2. **Styles**: the book's detected styles with role, evidence and confidence, editable, with a scope switch for client or book. This is the ┬º3.6 list filtered to styles.
3. **Markup and words**: one row per role, showing the template and a live preview of the element (the existing `example()` pattern), and one row per label key per language with the built-in default greyed out.

Every edit is a `setRule`-style call that logs a `Decision` (`spec/session.ts`), so provenance and the spec hash keep working.

### 4.6 Importing a client spec sheet
`readRequirements` (`spec/requirements.ts:34`) already reads our own workbook exactly, matches free text by keywords or AI, and reads the language sheet (`labelsFromWorkbook`). Extend the **exported** spec workbook (`specWorkbook`, `:110`) with two sheets. That makes the template we hand clients round-trip:

- **Styles**: `Source style | Means (role) | Level | Output class`.
- **Markup**: `Element (role) | Expected HTML sample`. On import, parse the sample with `DOMParser` into a `MarkupTemplate`: tag, class, attributes, wrapping parent. `<sup><a epub:type="noteref" ΓÇª>1</a></sup>` becomes noteref with `wrap: 'sup'`.

The client's existing sheets (Standard vs Accessible, Automation-Summary) are already "element, then sample HTML" tables, and so is the 12-point report. With this parser, the "Expected" column of a report imports straight into the client layer. Each imported row lands as a suggestion with its `Source` (file, row, text) and is confirmed row by row in `RequirementsImport.tsx`, as now. A row that doesn't parse becomes an open question, as now.

> ponytail: templates are tag + class + attrs + one wrapper, not a template language. Add nesting only when a client sample needs two wrappers.

---

## 5. Validation gate before export

A single `gate(files, resolved, sourceStats) ΓåÆ GateReport` runs on every build, and the download button follows its verdict.

| Stage | What | Where it runs | Blocks download on |
|---|---|---|---|
| 1. Our structure checks | `checkEpub` (`check/epub.ts:85`): container, OPF, ids, links, spine, nav vs chapters, page markers, empty headings, words missing from the source | browser (today) | `error` findings |
| 2. **Spec conformance (new)** | For each resolved rule, template and styleMap entry, a check that the **output** obeys it. Every chapter's first heading matches `markup['chapter-title']`. Every noteref has the template wrapper. Notes are in `notes.xhtml` when NOTE-04 = book-end. `<html>` language attributes match DOC-01. The cover `<title>` equals `labels.coverTitle`. The guide has toc when PKG-03 is on. Every `styleMap: drop` style is absent. Rules get an optional `check(files, value)`, and templates are checked generically by selector. | browser | any mismatch (it's our bug, never the client's) |
| 3. Accessibility | `axe-core` (the engine inside Ace) on each XHTML in a sandboxed iframe, plus Ace's EPUB-level checks written out again (a11y metadata present and consistent, page-list with `pageBreakSource`, `accessModeSufficient` matches the alt coverage). | browser | axe critical/serious; claims that don't match the facts |
| 4. **EPUBCheck** (pinned version, e.g. 5.x) | The real validator. | **server or desktop**: the browser can't run Java. Use a small container endpoint (Cloud Run/Fly) taking the EPUB and returning JSON (`--json`), or the bundled JRE in the planned desktop app. The test runner already has the invocation (`test/epubcheck.ts`). | any ERROR/FATAL |
| 5. **Ace by DAISY** (full) | `@daisy/ace` for the certification report. | same server/desktop, optional for standard EPUB | violations at "serious" or worse, accessible profile only |
| 6. **Reference diff (when the client gave a hand-finished EPUB)** | Structure diff against it: spine count, nav labels, heading tag/class per chapter, note placement, figure markup, package metadata. | browser | shown as "differs from your reference", warn only |

Stage 6 alone would have produced all 12 points of the Tempelhofer report before the client did.

**Verdict and claims.**
- **Green**: stages 1ΓÇô4 pass (and 5 for the accessible profile). Download allowed, and `conformsTo` may be written once a person certifies (already gated, `2bad15b`).
- **Amber**: only warnings. Download allowed after the explicit confirm that exists today.
- **Red**: download only through "Download anyway (not for delivery)", which writes a `Decision` with the reason.
- If stages 4ΓÇô5 couldn't run (offline web app), the report says so plainly, and the verdict can't be Green for delivery.
- The `GateReport` is saved inside the decision record, and as `META-INF/`-free JSON next to the EPUB, so the client gets a report with each delivery.

---

## 6. Phased implementation plan

The estimates assume an AI coding agent working in focused sessions with the existing tests (`npm test`, 73 passing) and the Tempelhofer headless runner (`test/run-indd.ts`). One agent-day is about one long session plus a human review.

| Phase | Work | Key files | Done when | Effort |
|---|---|---|---|---|
| **0. Baseline harness** (do first) | Pin EPUBCheck, run it on the Tempelhofer output in CI. Add the **reference-diff** test helper (┬º5 stage 6) and use the 12 report rows as fixtures. | `test/epubcheck.ts`, new `test/refdiff.ts`, `test/client-report.test.ts` | CI fails on any EPUBCheck error and on any of the 12 points regressing | 0.5 day |
| **1. Validation gate** | `gate()` wrapping `checkEpub`, spec-conformance checks per rule, axe-core in an iframe, a11y claims derived from the facts (fix `accessModeSufficient`, `dc:date`, `dc:description`). Red/amber/green UI on Check & download. EPUBCheck/Ace endpoint as a separate small service. | `check/epub.ts`, new `check/gate.ts`, `check/conform.ts`, `epub/package.ts:288-307`, `ui/CheckFlow.tsx` | No download is Green unless EPUBCheck passed. Conformance catches a deliberately broken template. | 2 days, plus 1 day for the EPUBCheck/Ace service |
| **2. Rules as data** | Generate defaults and `sanitize` from `RULES` (with `default`). `Layer.styleMap/markup/css` plus their merge in `resolve`. `renderAs(role)` in the InDesign and PDF builders, with HD-07/HD-08, `<sup>` and `toStandard` moved into templates. Client layers as JSON. Migrate the localStorage profile into `styleMap`. Add NOTE-04, NAV-05/06, FM-02, PKG-02/03. | `settings.ts`, `spec/rules.ts`, `spec/layers.ts`, `spec/clients.ts` ΓåÆ `src/clients/bebra.json`, `indesign/build.ts` (heading, noteref and figure render sites), `epub/package.ts:35` | BeBra's whole review is a JSON file. A second fake client with different classes builds with **no code change** (test). | 3 days |
| **3. Unified detection with confidence** | `BlockFeatures` filled by the InDesign and PDF readers. Evidence scorer with the ┬º3.2 weights. Style-name dictionary (English, Spanish, German, plus the ┬º2.3 table) as data. Book cross-checks. Note-kind detection. Image placement evidence chain. | `indesign/read.ts:250` (`inferProfile` ΓåÆ scorer), `pdfepub/analyze.ts:197`, new `engine/structure/{features,score,dict}.ts`, `indesign/build.ts:534-602` | Tempelhofer and every corpus book: chapters equal contents entries, no regressions. Each decision carries evidence and a score. | 4ΓÇô5 days |
| **4. Review screen** | Confidence-sorted list with evidence chips, a scope switch writing to the client or book `styleMap`, cross-check banner, blocking below 0.6. | `ui/IndesignFlow.tsx` (Structure step), `ui/PdfFlow.tsx`, `review/confidence.ts` | Fixing a style once for "this client" applies on the next book with no review item. | 2 days |
| **5. Spec sheet import v2** | Styles and Markup sheets in the exported workbook, the HTML-sample ΓåÆ `MarkupTemplate` parser, and import of a report's "Expected" column. | `spec/requirements.ts`, `ui/RequirementsImport.tsx` | Importing the Tempelhofer report rows reproduces `bebra.json`. | 1.5 days |
| **6. Remaining standard defaults** | Full landmarks (loi, bibliography, endnotes, index). Nav depth 3. Subtitle as title-type `meta refines`. `file-as`. Series `belongs-to-collection`. German locale pack (labels, print-only list, abbreviation dictionary). Extended descriptions for complex figures. | `epub/package.ts`, `epub/locale.ts`, `epub/imprint.ts` | EPUBCheck clean, and Ace has no serious violations on the corpus | 1.5 days |
| **7. Desktop packaging of the gate** (later, with the planned desktop app) | Bundled JRE + EPUBCheck + Ace, so stage 4ΓÇô5 runs offline. | desktop shell | Green verdict offline | 2 days |

**Order and why:**
- Phases 0ΓÇô1 first. Nothing should reach a client without EPUBCheck and the conformance check, and they turn every later phase into a measurable change.
- Phase 2 next. It stops the one-client-one-release cycle and is the foundation that phases 3ΓÇô5 write into.
- Phase 3 is the largest and riskiest, so it comes after the gate exists to catch regressions.
- Phases 4ΓÇô6 are mostly UI and data on top.

**Total:** about 14ΓÇô16 agent-days through Phase 6, plus 2 for Phase 7.

**Left out on purpose:**
- ML-based classification (hand weights first, ┬º3.6).
- A full template language (┬º4.6).
- Fixed-layout EPUB.
- ONIX export.

Add each one when a real book or client needs it.

**Open questions for the owner:**
1. Should BeBra's "Abdeckung" stay? (┬º1.2 #10)
2. Where should the EPUBCheck/Ace service run before the desktop app exists? This needs hosting with Java; Vercel functions aren't a good fit.
3. Can clients send their hand-finished reference EPUB with each order? It enables stage 6, the cheapest way to catch what this report caught.
