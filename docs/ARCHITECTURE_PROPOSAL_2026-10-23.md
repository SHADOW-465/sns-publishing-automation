# Architecture proposal: a settings-driven app, with AI only where judgement is needed

Written 2026-10-23. Read-only study: no code, commit or config was changed; this is the only file written.
Evidence: `docs/CORRECTIONS_2026-10-23.md`, `corrections/FORGE_STATUS.md`, `corrections/SPEC_COVERAGE.md`, and the code of the three copies of the engine:

| Short name | Folder | Branch / state |
|---|---|---|
| **A** | `pdf-tagger-sns-pdfua` (a git *worktree* of B, same `.git`) | `forge/pdfua-fixes` @ `31ae0f7`, clean except untracked `docs/`, `out-verify/` |
| **B** | `pdf-tagger-sns` (GitHub `SHADOW-465/pdf-tagger-sns`) | `forge/epub-next` @ `402250b`; engine lives in `automation-app/src/`; the repo root is the *older* PDF-tagger Vite app |
| **C** | `sns-publishing-automation` (GitHub `SHADOW-465/sns-publishing-automation`) | `forge/epub-step4` @ `abf16a0` + 2 uncommitted files (`indesign/build.ts`, `test/indesign.test.ts`); the app is at the repo root |

Not verified by running anything: none of the three 23 Oct test books are on this machine. "Done/exists" below means "present in code and described in a commit or status file".

---

## 0. The short answer to "why not let AI do everything?"

Showmik's original idea (one standard app, every rule a setting, chosen at upload) was right, and **most of it is already built**: a rule/settings layer (`house → client → series → book`), about 44 rules, client files as JSON, a spec-sheet importer, a confidence-scored detector, a validation gate. What went wrong is not the idea. Three things went wrong:

1. **The settings cover the EPUB markup but not the typography, the chapter-opener shape, the PDF/UA choices, or the file plan**, so a client correction that touches them has nowhere to go but code.
2. **There are three copies of the engine** (A, B, C), so fixes land in the wrong place and nobody can say which one is "the app".
3. **There is no automatic comparison with the client's own finished file.** The client is the test, so every defect is found by them, in a screenshot, one round at a time.

AI "doing everything" fixes none of these. It would make the third worse: the output would differ from run to run, and nobody could say whether a correction was fixed or just happened not to recur. AI is useful for a *narrow* band of judgement. The rest of this document defines that band.

---

## 1. How the app should work, in plain words (for a non-expert)

Think of a print shop with a very fussy customer.

1. **Pick the customer and the kind of book.** At upload you choose: *who is this for* (the client), *what goes in* (InDesign export, print PDF, or Word) and *what comes out* (Standard e-book, Accessible e-book, or Accessible PDF). The app loads that customer's **style sheet** (we call it a *profile*): a list of choices such as "chapter titles look like this", "italics use this tag", "notes are a list", "the title page is a picture".
2. **Drop the files.** The book, the cover, optionally the customer's spreadsheet of file names (`Book_Details.xlsx`) and picture descriptions.
3. **The app reads the book and works out its structure by fixed rules**: which lines are headings, which are page numbers or running heads to throw away, where paragraphs start, where the pictures belong. Every decision carries a *confidence* number.
4. **It shows you only the doubtful decisions.** One plain list: "this line might be a poem or a caption: which?" with a picture of the page. Everything it is sure about is not shown. Your answer can be *remembered* for this customer.
5. **It builds the file** strictly from the profile. The same book plus the same profile always gives the same file. Nothing "creative" happens here.
6. **It checks the file with the official checkers** (EPUBCheck, Ace for e-books; veraPDF/PAC for accessible PDF) and **compares it with the customer's own finished example** if we have one. The report says, in words: "passed", or "3 differences from your example on pages 4, 9 and 14".
7. **You download it.** The report travels with it.

Where does AI fit? In step 4 only, as a *helper that looks at the page picture and suggests an answer* ("looks like a caption, 80 % sure"), and for **drafting picture descriptions** that a person must approve. It never builds the file and never decides alone.

When the customer says "make the italic tag `<em>` not `<i>`", that is a **profile edit** (one value changed, no programmer needed). When the customer says "the page number leaked into the text", that is a **bug**: no profile can fix it, a programmer fixes it once and a test makes sure it never returns. The honest line between the two is the main idea of this document.

---

## 2. What exists today vs what is hard-coded

### 2.1 Same engine, three homes

- **A is stale.** `git diff --stat main forge/pdfua-fixes` = 71 files, 766 insertions, 7,258 deletions: A lacks everything after `31ae0f7` on `main`/`forge/epub-next` (57 commits it does not have). A has no `structure/` scorer, no `check/gate.ts`, no `check/refdiff.ts`, no `epub/markup.ts`/`spec/markup.ts` (client markup templates), no `indesign/placement.ts`, no `notes.ts`. A has ~15.6k lines of TS in `automation-app/src`, B 17.6k, C 17.6k.
- **B and C are the same 27 commits twice.** Both branches are 27 commits ahead of their `main`; the `engine/structure` and `engine/pdfua` trees are almost identical (`diff -rq`: 0 and 1 differing files; the 1 is `pdfua/altdocx.ts`, a whole-file difference that looks like line endings). `pdfepub`, `spec`, `check` differ by 1 file each. The hashes differ because the work was replayed into C. C additionally has two uncommitted files (the end-note `<sup>` back-link fix noted in the corrections doc).
- **All three contain the PDF/UA work up to `31ae0f7`.** Only B and C contain the "dynamic EPUB" work (phases 0–6 in `sns-publishing-automation/docs/EPUB_DYNAMIC_STATUS.md`).
- B/C `automation-app` also carry the desktop shell (`desktop/main.mjs`), the EPUBCheck/Ace local services (`server/epubcheck-service.mjs`, `ace-service.mjs`), the pinned tools list (`scripts/tools.lock.json`: JRE 17 + EPUBCheck 5.4.0) and a `samples-local/` folder with real books (`cambia`, `cc`, `lc`, `export.zip`). None of the 23 Oct books are there.

### 2.2 What is already data-driven (keep, do not rebuild)

| Capability | Where |
|---|---|
| Plain settings generated from one schema table; `DEFAULT_SETTINGS`/`sanitize` derived from it | B/C `engine/settings.ts` (`SCHEMA`, line ~90) |
| ~44 named rules (`HD-`, `NAV-`, `NOTE-`, `STD-`, `TBL-`, `FM-`, `CSS-`, `DOC-`, `PKG-`, `QA-`, `TXT-`, `FIG-`), each with a plain-language label, options, effect sample | `engine/spec/rules.ts` |
| Layers: house → client → series → book, with "later layer wins" | `engine/spec/layers.ts` (`resolve`) |
| Client files as JSON: Arkano (Cambia) and BeBra (Tempelhofer) | `src/clients/arkano.json`, `bebra.json`, loaded by `clients/index.ts` |
| Client markup templates for `chapter-title`, `part-title`, `noteref`, `figure`, with `aria-*`/`data-*` read from a sample | `engine/epub/markup.ts`, `engine/spec/markup.ts` |
| Importers: three Excel spec sheets, the client's `.docx` report (sample HTML in a row becomes a template), language-label sheet | `engine/spec/requirements.ts`, `office.ts`, `session.ts` |
| Confidence-scored structure detection shared by InDesign and PDF readers (signals vote; ≥0.85 silent, 0.6–0.85 listed, <0.6 blocks) | `engine/structure/score.ts`, `features.ts`, `dict.ts`; `review/confidence.ts` |
| Picture-description chain: typed > spec sheet > file metadata > decorative rule > unapproved AI draft; certification blocked while a draft is open | `engine/epub/alt.ts`, `alt-ai.ts` |
| Validation: EPUBCheck (bundled JRE), axe-core, optional Ace, a gate; a reference-EPUB diff of 25 lines | `check/gate.ts`, `check/epub.ts`, `check/axe.ts`, `check/refdiff.ts`, `server/*` |
| PDF/UA internal checker | `engine/pdfua/check.ts` (veraPDF and PAC **not** run on our own output) |

### 2.3 What is hard-coded (the reason corrections turn into code)

| Hard-coded thing | File | Why it hurts |
|---|---|---|
| Chapter opener markup in the PDF→EPUB builder: `id="chap{n}"`, `ch-head1`, `<span class="ch-num">`, `<span class="ch2">` | `pdfepub/build.ts:661-667` (the `chapter-title` template exists but only partly replaces this) | V1 asks for `<p class="chnum">`+`<p class="chtit">` with no id |
| Extract class ladder `extract1/extractt/extractint0/extractint`, merged into one run | `pdfepub/build.ts:804-815` | V6 wants one `<p>` per verse line with the client's names |
| Page anchors `<a id="Page_n"/>` emitted before the chapter heading in STD | `epub/package.ts` rule `stdPageMarks` (`anchor` default), but the *position* is code | P3 |
| STD conversion done by **regex over the finished XHTML** (`toStandard`) | `epub/package.ts:35`, called at `:182` | Every STD tweak is a new regex; `EPUB_DYNAMIC_STATUS` lists this as "Left" |
| Emphasis, alt and page-mark options are two-value enums with a *fixed* sample | `settings.ts` (`stdEmphasis: ['bi','span']`, `stdAlt: ['generic','keep']`) | No `em/strong`, no `alt=""` option, so V5/V7 conflict can't be expressed |
| No CSS for alignment/font/size/spacing per role as profile data | `epub/css.ts`, `indesign/css.ts`, `pdfepub/css.ts` (three CSS generators) | P2, P5, P13, I5, I7–I9 are all "CSS per role" |
| Title page: rebuilt text (FM-02) with no "as image" mode | `indesign/front.ts`, rule `FM-02` | I1 |
| Logo/artifact choice is one flag `logos: 'artifact'|'figure'` and a size heuristic `c.n >= 8 && w >= 12 …` | `pdfua/figures.ts:48-51`; MCID boundaries at every `q/Q`, `BT/ET` in `pdfua/content.ts` (rewrite) | U1 is a core bug, not a setting |
| Index = one `P` per entry; notes = `L/LI`; no index links; no plate bookmark | `pdfua/structure.ts:499-501` (`inIndex`), `pdfua/write.ts`, `pdfua/index.ts:155` (`frontPages`) | U2, U3, U4, U6 |
| PDF/UA options are `chapter level` and `logos` only | `pdfua/index.ts:26,98` | No place for any other choice |
| Hand-set thresholds (running head must repeat on ≥3 pages; paragraph-merge across pages; label/value → table only if ruled) | `pdf/pages.ts:104`, `pdf/layout.ts`, `pdf/tables.ts` | V2, V3, V4 |
| Progress is reported only while reading pages | `ui/PdfUaFlow.tsx:60`; `analyzeUa` stages after reading are silent | U7 |
| AI keys in `localStorage`; Groq URL and model names in code | `spec/ai.ts:13-17`, `epub/alt-ai.ts:10-12` | Fine for now; models retire (see §7) |
| Three places where the client "profile" can live: `localStorage` (older), the client JSON, the book | `ui/IndesignFlow.tsx` + `clients/*.json` (migration `migrateProfile` exists) | Partly cleaned up in B/C |

So the diagnosis in `EPUB_DYNAMIC_DESIGN.md` (16 Oct) was correct and has been **half executed**: the rules are data, but the *vocabulary of data* is still too small, and the PDF/UA side never got a profile at all.

---

## 3. Target architecture

```
 upload screen:  client ▸ input kind ▸ output kind ▸ files
        │
        ▼
 ┌──────────────────────────────────────────────────────────────┐
 │ PROFILE (one JSON document, layered house▸client▸series▸book) │
 │  markup templates · class map · typography · notes · front     │
 │  matter · alt policy · PDF/UA choices · file plan · AI policy  │
 └───────────────┬──────────────────────────────────────────────┘
                 │ read-only input to every stage below
 1 READ    deterministic: pdf.js text+geometry, InDesign XHTML, DOCX
 2 DETECT  deterministic signals → role + confidence per block  (structure/score.ts)
 2b ASSIST optional, only blocks < 0.85: page crop + top-2 labels from AI
           → written as a *vote* with weight ≤ 0.3, never a decision
 3 REVIEW  one list, sorted by confidence; answers remembered into the profile
 4 BUILD   deterministic: profile → templates → XHTML / tagged PDF
 5 CHECK   EPUBCheck · Ace/axe · veraPDF+PAC · profile-conformance · diff vs reference
 6 REPORT  plain words; "changed automatically"; "needs a person"; download
```

Design rules (each is testable):

1. **One profile document, one schema.** Every output decision is a typed value in the profile. The profile has a version number and is saved *inside* the output's report so a file can always be reproduced.
2. **Closed vocabulary.** A setting is an enum or a template with named holes (`{number}`, `{title}`, `{style}`), never free code. Each enum value has a test. This is the honest answer to "make everything customisable": unlimited customisation is a programming language. The vocabulary grows by *adding a value plus a test*, which is a half-day job, not by editing the builder.
3. **Builders are pure functions of (parsed source, profile).** No `if (clientName)`; no hard-coded class names; CSS is generated from profile typography rows (one generator, not three).
4. **Detection returns evidence, AI adds a vote.** The scorer already combines signals; the AI vote is one more signal with a capped weight, logged with its source (`structure/score.ts` takes a `vote` record). Turning AI off must still give a valid file.
5. **Golden files are the definition of done.** For each client and pipeline, the client's finished example is stored; CI diffs normalised markup (EPUB) or tag listing (PDF) against it for named pages. A correction is closed when its row in the diff turns green, not when the client stops complaining.
6. **Conflicts in the client's own materials are detected, not silently resolved.** The corrections doc found three (`<em>`/`<i>`, `alt=""`/`"decorative"`, heading-as-`<p>` vs accessibility). The importer should flag "your sheet says X, your sample says Y" and refuse to guess.
7. **Standard EPUB never claims to be accessible.** The Standard profile omits accessibility metadata; the report says "Standard (not accessible)".
8. **Learn the profile from the client's reference file, deterministically.** Arkano's layer was already "made from the reference EPUB". Generalise it: `import reference EPUB → proposed profile rows (class map, templates, CSS per role, alignment, emphasis tags, title page shape)`, each row confirmed by a person. This replaces 80 % of the weeks of screenshot ping-pong and needs no AI.

---

## 4. Settings profile contents

Existing keys are marked `(exists)`; everything else is new. Names are proposals.

| Group | Setting | Values | Status |
|---|---|---|---|
| **Kind** | `output.kind` | `epub-standard` · `epub-accessible` · `pdf-ua` | exists as `DOC-00` |
| | `source.kind` | `indesign` · `pdf` · `word` | exists (three flows) |
| **Metadata/labels** | language, series, date, labels per language | free + per-language table | exists (`epub/locale.ts`, `labelsFromWorkbook`) |
| **Class & style map** | InDesign style → role/class; content rules (pattern, layout, inset) | rows | exists (`styleMap`, content rules) |
| **Markup templates** | `chapter-title`, `part-title`, `noteref`, `figure` | HTML sample with holes | exists; **add** `chapter-opener-split` (num+title as 2 `<p>`), `caption`, `cover`, `contents-entry`, `extract-line`, `quote`, `copyright-line`, `table-kv` |
| **Emphasis** | `emphasis.tags` | `em/strong` · `i/b` · `span class` | **extend** `stdEmphasis` |
| **Alt policy** | `alt.decorative` | `empty` (`alt=""`) · `word` (client's word) | **extend** `stdAlt` |
| | `alt.meaningful` | `real` (description required) · `generic` | exists |
| | `alt.ai` | `off` · `draft-needs-approval` | exists |
| **Page markers** | `page.markers` | `none` · `anchor` · `accessible` · `pagelist-only`; `position` (before heading / in text) | exists as `stdPageMarks`; **add** position |
| | `ids.chapter` | `none` · `chapN` | **new** |
| **Typography per role** (heading, chapter number, chapter title, body, extract, quote, caption, copyright, title page, contents, index, notes) | `align` (left/center/right/justify, or "as print"), `font` (serif/sans/inherit/"as print"), `size` (relative `em`/%, or "as print"), `smallcaps`, `space-before`, `space-after`, `indent`, `line-gap` | **new** (this is the missing half) |
| **Front matter** | `title-page.mode` | `text` · `image` · `rebuilt` (FM-02) · `as-exported`; `image.alt`=text repeat | **extend** FM-02 |
| | `halftitle vs title detection hint`, `copyright.align/smallcaps/isbn-format` | | **new** |
| **Cover** | markup template, `linear` | | partly exists (`PKG-02`) |
| **`<title>` rule** | `html.title` | `book-title` · `chapter-title` · `"Chapter N"` | **new** (accessible default is the localized label today) |
| **Contents** | `nav.pagenumbers` (show/hide), `nav.links`, depth, front/back matter, subtitle | | exists (`NAV-02…06`) |
| **Notes** | placement, numbering, separator, backlink, `<sup>` | | exists (`NOTE-01…05`); PDF/UA: `notes.as-list` (**new**) |
| **Images** | `placement` (`as-print` · `after-caption-page`), `caption.position`, wrapper template, `extended-description` | | exists in part (`placement.ts`, `FIG-02`); **add** `never-after-last-page` as a check |
| **Verse/extract** | `verse.mode` (`line-per-p` · `block-with-br`), class ladder | | **new** |
| **Tables** | ruled → table (exists); `table.kv-blocks` (label/value → table) | on/off + minimum rows | **new** |
| **Headings** | HD-01…09 | | exists |
| **PDF/UA** | `ua.title` (`h1-once`), `ua.chapter-level` | | exists in code, not as profile |
| | `ua.logos` | `figure-one` · `artifact` | **extend** (`logos` flag) |
| | `ua.index` | `p-per-entry` · `list` ; `index.links` (on/off, range→first page) ; `index.note-refs` (`301n.66` target: page / note) | **new** |
| | `ua.notes` | `list-LI-Lbl-LBody` ; `notes.link-both-ways` | partly |
| | `ua.bookmarks` | chapters · front pages · `plates` (label) | **extend** `frontPages` |
| | `ua.extra-pdfs` | `append` + label | exists (extra PDF), label **new** |
| **File plan** | from `Book_Details.xlsx`: file names, levels, titles, page spans, `epub:type` | rows | **new importer** |
| **Validation** | gate: which checkers, severity → blocks download? | | exists (decision: warn, don't block) |
| **Reference** | path to client's finished file(s) for golden diff | | **new** (`refdiff.ts` is 25 lines) |
| **AI policy** | `ai.assist` (off / suggest), provider, model, `send-page-images` (yes/no), `ai.alt-drafts` | | partly exists |

### 4.1 Every 23 Oct correction mapped to profile / AI / core

IDs are those of `docs/CORRECTIONS_2026-10-23.md`. "Profile" = pure setting change once the setting exists. "AI" = a judgement step that may help. "Core" = code that must be fixed regardless. Where more than one applies, the **first column filled is what closes it**.

| ID | Profile setting | AI step | Core fix |
|---|---|---|---|
| **U1** logo extra Paths | `ua.logos = figure-one` (artifact option as fallback) | none | **Core:** in `pdfua/content.ts` open the Figure's marked-content at the outermost `q`, close at its matching `Q`; one MCID per logo. A test on the FSC logo. |
| **U2** index page numbers as links | `ua.index.links = on`, range→first page | none | **Core:** detect page tokens, map printed→PDF page (`book.numbers`), write `Link` annotations inside structure elements (as for notes in `pdfua/write.ts`). |
| **U3** `301n.66` is a note ref | `ua.index.note-refs = page|note` (client picks target) | none | **Core:** parse `NNNnMM`, link to chosen target. *Blocked on Decision 6.* |
| **U4** "all are lists not paragraph" | `ua.notes = list`, `ua.index = list|p-per-entry` | none | **Core:** notes: put wrapped/page-start entries in `LI` too (first LI, later P defect); index: only if the client says so. *Reverses `31ae0f7` for the index.* |
| **U5** "N is the footnote" (dup of U3 or label) | same as U3 / `notes.Lbl` | none | Same as U3/U4 after the client answers. |
| **U6** plate bookmark | `ua.bookmarks.plates = on`, label | none | **Core:** one bookmark at the first appended page (`pdfua/index.ts:frontPages`). |
| **U7** hang at 322/322 | none | none | **Core:** progress and cancel for every `analyzeUa` stage, time-out message, `finally` re-enables Analyse. Needs the real file. |
| **U8** cover picture, no instruction | `cover.insert` (page 1, label) | none | none until the client answers. |
| **I1** title page as image | `title-page.mode = image` (alt repeats title/author/publisher) | none | **Core:** add the mode (crop print title page to picture, write alt). |
| **I2** copyright centre + small caps, "ISBN" format | `copyright.align=center`, `copyright.smallcaps`, `copyright.isbn-format` | none | **Core:** page-level alignment from print geometry (or from profile); ISBN label template. |
| **I3** contents links, no page numbers | `nav.pagenumbers=hide`, `nav.links=on` (exist) | none | Verify on the Birmingham book (golden diff). |
| **I4** `<p class="chapter-title">` | `markup.chapter-title` template (exists) / class map | none | none if the template is given; needs the class list (Decision 5). |
| **I5** heading bottom space too large | `typography.heading.space-after` | none | Core only to generate the CSS from the profile (one generator). |
| **I6** images misplaced below bibliography | `images.placement = as-print` | optional: tie-break picture→page when caption match fails | **Core:** `indesign/placement.ts` falls back to the three closest pages; add a *check* "no picture after last text page" that fails the build. Repro needed. |
| **I7** verse spacing and size | `typography.extract.*`, `verse.mode` | none | CSS generation (core, once). |
| **I8** block quote size | `typography.quote.size` (relative) | none | same |
| **I9** bibliography heading space | `typography.heading.space-after` | none | same as I5 |
| **P1** = I2 from PDF | as I2 | none | as I2 |
| **P2** contents heading font/alignment | `typography.contents.heading.align/font` | none | **Core:** PDF path reads alignment/font from print geometry when profile says "as print". |
| **P3** no page id before chapter heading | `page.markers = none` (STD) + `position` | none | **Core:** make the STD page-mark position a rule, not a regex (`toStandard`). |
| **P4** images between paragraphs, caption under | `images.placement=as-print`, `caption.position=below` | AI optional for ambiguous placement | **Core:** `pdfepub/build.ts` places by y-position between paragraphs; never mid-sentence. |
| **P5** justify body | `typography.body.align = justify` | none | CSS generation. |
| **P6** poem spacing/size | as I7 | none | as I7 |
| **P7** indented passage = extract, smaller | `typography.extract.*` | **AI (suggest):** is this block an extract or body? Only when evidence is mixed | **Core:** indent/size evidence for `extract` in the detector. |
| **P8** caption merged into body | `caption` template | **AI (suggest)** for a doubtful caption block | **Core:** caption detection by font/size/position and "Plan of …" cues; its own paragraph. Repro needed. |
| **P9** images below bibliography (claimed "Fixed") | `images.placement` | none | Golden-diff on the real book; same as I6. Do not call it fixed until the client's book passes. |
| **P10** cover markup `<p class="cover"><img …>` | `markup.cover` template | none | none; needs the client's yes/no (Decision 5). |
| **P11** `<title>` = book title only | `html.title = book-title` | none | **Core:** one setting read by the package writer. |
| **P12** title page vs half title; logo not cropped | `title-page.mode`, hint | **AI (suggest):** half title vs title page when the page has a logo and an author line; crop box for the logo | **Core:** distinguish by content (author present + logo) and crop to picture bounds (`pdfepub/cover.ts`). |
| **P13** chapter heading alignment/font | `typography.chapter-title.align/font` | none | CSS generation. |
| **V1** page/chapter id off; `chnum`/`chtit` | `ids.chapter=none`, `page.markers=none`, `markup.chapter-opener-split` | none | **Core:** replace hard-coded `ch-head1/ch-num/ch2` (`pdfepub/build.ts:661-667`) with the template. |
| **V2** running head leaked | none | none (rule + evidence) | **Core:** `pdf/pages.ts:104` heading-repeat rule fails for lowercase/small-caps heads; add "same text near top on ≥2 consecutive pages with page-number change" and an "isolated short line equal to the chapter label" test. Repro needed. |
| **V3** paragraph merged over page break | none | AI (suggest) only if indent evidence is ambiguous | **Core:** a new indent at the top of a page starts a paragraph (`pdf/layout.ts`). |
| **V4** two-column key/value → table | `table.kv-blocks = on` | AI (suggest) for non-obvious blocks | **Core:** `pdf/tables.ts` detects aligned label/value lines without rules. |
| **V5** image between paragraphs, `img_cont` shape, `alt=""` | `markup.figure`, `alt.decorative=empty` | AI alt draft (existing) | **Core:** same as P4; the "chapter 1" running-head leak beside the picture is V2. |
| **V6** verse one `<p>` per line | `verse.mode = line-per-p`, class ladder | AI (suggest) verse vs body | **Core:** keep line breaks; stop merging extract lines (`pdfepub/build.ts:804`). |
| **V7** italic missing | `emphasis.tags = em/strong` | none | **Core:** italic from font-name/synthetic-slant in this PDF (`<em>General Evening Post</em>`). Repro needed. |
| **E1** `Book_Details.xlsx` | `file-plan` source | none | **Core:** importer; show the 12 empty rows as review items. *Needs Decision 8.* |

**Rough count (38 items, my reading, not measured):** about 12 are closed by a profile value once the vocabulary exists (I3, I4, I5, I7, I8, I9, P5, P6, P10, P11, P13, and I2/P1 if alignment is set by profile). About 15 need a core fix regardless (U1, U2, U3, U4, U6, U7, V2, V3, V4, V6, V7, P7, P8, P12, E1). The rest are mixed (profile value plus a core change to read it) or waiting on a client answer (U5, U8, I1, I6, P2, P3, P4, P9, V1, V5). Only **P7, P8, P12, V3, V4, V6** have any plausible AI role, and in all of them AI only supplies a tie-break vote. **So the claim "client corrections become profile edits, not code" is true for about half of them, not all.** The other half are real bugs that need tests.

---

## 5. Which repo should be the single home

**Recommendation: `sns-publishing-automation` (C) as the single home**, after one migration step, and archive the `automation-app` folder in `pdf-tagger-sns` (B).

Why C:
- The app **is** the repo root: `package.json`, `desktop/`, `server/`, `tools/`, `scripts/`, `test/` at the top. B nests the same app one level down (`automation-app/`) inside a repo whose root is a different, older application (the original PDF tagger: `src/`, `index.html`, `dist/`, `pdf-tagger-sns-overview.pdf`). Two apps in one repo with two `package.json` files is how fixes land in the wrong folder.
- C was created to be standalone (`7bc7707 docs: standalone repo notes`), and its history starts from the automation-app commits, so it is not polluted by the other app.
- C's docs (`EPUB_DYNAMIC_DESIGN/STATUS`, `CLIENT_CHECKLIST_OCT17`) are already the design record.

Why not B (what the corrections doc suggested): its advantage is only history depth (121 vs 101 commits) and that the Vercel deployment may be wired to it. Both are solvable: history is not needed to run the app, and a Vercel project can be re-pointed. **But if the Vercel site and GitHub Actions workflow (`.github/workflows` exists in B, not in C — check) are what the client uses today, say so (Decision 1) and I would pick B with `automation-app` promoted to the root instead.** Either way the rule is the same: exactly one app, one `package.json`, one test suite.

Migration step (zero feature work, ½–1 day):
1. In C: commit or stash-review the two uncommitted files, delete `hs_err_pid*.log`/`replay_pid*.log` and add them to `.gitignore`.
2. Merge `forge/epub-step4` into C's `main`.
3. Port from B: `.github/workflows/automation-app.yml` and anything B has that C lacks (B's `main` has `5bc7629`/`a3e8108`, C's `main` has the same under other hashes; verify with a tree diff, ignoring line endings, until `diff -r` is empty).
4. Bring the A branch's 15 PDF/UA commits only if the tree diff shows they are missing (the checks above say `pdfua/` is equal between B and C, and A is *older*, so none should be).
5. Make B's `automation-app` read-only (README pointer). Delete worktree A once its docs/`out-verify` are copied.
6. Normalise line endings (`.gitattributes`) so `diff` is meaningful.

---

## 6. Migration plan (small ordered phases)

Durations are working days for one developer who knows the code; add waiting time for client answers. Total ≈ **26–32 days**, of which ~6 are waiting on the client, versus ~15–17 days in the corrections doc, because this plan includes the profile vocabulary and golden tests that make later rounds cheap.

| # | Phase | Acceptance criteria | Duration |
|---|---|---|---|
| 0 | **One home** (§5) | `git ls-files | grep automation-app` shows one app; `npm test` green with the count recorded (B/C: 150 incl. Ace, 149 without); CI green on Windows | 1 |
| 1 | **Test assets + golden harness.** Put the 3 books and their client reference outputs in git-ignored `samples-local/`; extend `check/refdiff.ts` from 25 lines to a normalised-markup diff (EPUB) and a tag-listing diff (PDF); `npm run golden` | Running it on today's output prints a numbered list of differences for the cited pages (T-C-E pp. 4,5,6,9,11,14,15,19; Birmingham Intro/Contents/Copyright/Bibliography; Gladiators p5, index p323). Baseline saved. | 3 (needs the files; Q1/Q14) |
| 2 | **Fix the three PDF/UA core bugs that need no answers:** U7 progress/cancel/time-out, U1 one MCID per logo, U6 plate bookmark | Acceptance as in corrections doc §7 items 2–4: no silent stage >5 s, FSC logo Figure ≤2 children in a tag reader, bookmarks end with Plates; existing `pdfua*.test.ts` green | 2.5 |
| 3 | **Profile vocabulary v1 for the EPUB side.** Add: typography per role (+ one CSS generator replacing three), emphasis tags, alt decorative policy, `html.title`, `ids.chapter`, page-marker position, copyright/title-page/cover settings, chapter-opener-split, verse mode, kv-table switch. Replace `toStandard` regexes with templates. | Each new value has a test; `rules.test.ts` + `standard.test.ts` green; default values reproduce today's output byte-for-byte on Cambia/Tempelhofer; STD profile for T-C-E and Birmingham differ only by data (two JSON files), no new `if` | 5 |
| 4 | **Profile from a reference EPUB** ("learn client style"): derive class map, templates, per-role CSS, alignment, emphasis, title-page shape; each row confirmed by a person | Feeding the T-C-E reference EPUB yields a profile that, applied to the T-C-E input, brings the golden diff for STD-profile rows (V1, V5-markup, V7-tag, P5, P11, P13) to 0; the importer reports the em/i and alt conflicts instead of picking | 4 |
| 5 | **PDF→EPUB core logic fixes**, each from the cited page with a unit test: V2, V3, V4, V6, V7, P8, P4/V5 placement, P7, P12 | Golden diff on T-C-E pages equals reference; 0 leaked running heads (text diff vs PDF over the whole book); no sentence-ending paragraph split by an image | 6 |
| 6 | **InDesign→EPUB:** I1 title-page image mode, I2 copyright, I6/P9 placement + "no picture after last text page" gate, I5/I7–I9 via profile | Birmingham: map in Introduction after its paragraph, caption below; EPUBCheck 0 errors; golden diff 0 on cited pages | 3 |
| 7 | **PDF/UA profile + index/notes work:** U2, U3, U4 (after Decisions 4,6), profile keys `ua.*`, tests | Gladiators p323: every index page number is a Link with `/Dest`; Notes section 0 `P` under `Sect` except heading; internal `check.ts` green | 4 |
| 8 | **Real validators on our own output:** veraPDF PDF/UA-1 (needs Java 11+; the machine's system Java is 1.8, but `tools/` already ships JRE 17 for EPUBCheck, so reuse it), PAC run manually once | One-page PASS/FAIL per file in the app and saved beside the download; Gladiators output validated | 1.5 |
| 9 | **AI assist (stage 2b) behind the profile, opt-in, with logging.** Page-crop + top-2 labels for blocks <0.85, as a capped vote; keep alt-text drafting. Provider pluggable (see §7). | With AI off, output unchanged. With AI on, on a 20-page labelled sample (captions/verse/running heads) the AI-assisted vote must improve label accuracy over rules-only by a measured margin, otherwise leave it off. Every AI answer stored in the decision log with prompt hash, model id, and the human decision | 4 |
| 10 | **Book_Details importer** (after Decision 8) | Tempelhofer sheet gives the same 10 chapters as the automatic run and flags the 12 rows without pages | 1.5 |
| 11 | **Reply package to the client:** one sheet per pipeline, "comment → what we did → where to look", plus the questions | Client ticks rows; no new screenshots needed | 1 |

Ordering logic: 0 and 1 first (otherwise no fix can be shown to work), then bugs that need no answers (2), then the vocabulary (3,4) because it turns later STD corrections into data, then the independent logic fixes (5–7). AI comes last because it needs the golden set to prove it helps.

---

## 7. Free-tier AI providers: what to use, cost, risk

Figures below come from web searches on 2026-10-23, mostly third-party summaries that **disagree with each other**; free tiers change monthly. Treat every number as "to confirm in the provider console before building on it". Nothing here has been run.

| Provider | Free offer (reported) | Best use for us | Risks |
|---|---|---|---|
| **Google Gemini API** (AI Studio key) | Free tier is now Flash/Flash-Lite only; Pro models are paid-only (April 2026 change). Reported quotas conflict (about 10–15 requests/min and anywhere from ~20–50 to 1,500 requests/day). Google no longer publishes one fixed table; read the live quota in AI Studio. | Best **vision** model for page crops and picture descriptions; long context for a whole chapter | **Free-tier inputs may be used by Google to improve models and read by reviewers; one source says the free tier excludes commercial use.** Unpublished manuscripts of paying clients must not go through it. Models retire (2.0 Flash-Lite shut 1 Jun 2026; 3.6 Flash launched 21 Jul 2026). Use paid tier when client files are involved. |
| **Groq** | Free plan, rate limits per organisation, per model; reported ~30 requests/min and ~1,000 requests/day for some models, with tokens-per-minute as the real cap; no vision-specific figure found. | Very fast text classification of block labels (JSON); current code already defaults to Groq (`epub/alt-ai.ts`: `qwen/qwen3.6-27b`; `spec/ai.ts`) | Model list churns (verify the default model id still exists; the code hard-codes it); vision support on free models is uncertain; data-use terms on free tier should be read; shared limits mean one big book can exhaust the day |
| **OpenRouter** | Models with ids ending `:free`: 20 requests/min; 50/day, or 1,000/day after buying ≥10 credits (official docs). | A **gateway**: one OpenAI-compatible API to many models, with fallback when one is rate-limited; the code already accepts any OpenAI-compatible base URL | Free models are provided by third parties, change or vanish, and may log prompts; negative balance gives 402 even on free models; quality varies by model |
| **Hugging Face Inference Providers** | Free accounts get about $0.10/month of credit, then stop; PRO $9/month gets $2 credit and pay-as-you-go. | Experiments with specific open models (layout classifiers, small vision models); or **self-host** a model in the desktop app later | Free credit is exhausted by a few hundred page-image calls; not a production path on free; queueing on cold models |

Recommended use, in order:
1. **Default OFF.** Client files never leave the machine unless a person turns AI on for that job and the client has agreed. The corrections doc also says the client is "old-school": the deliverable never mentions AI, only "suggested description, please approve".
2. **Alt-text drafts and block labelling:** a vision model through the existing OpenAI-compatible adapter. Start with Gemini Flash (paid tier, a few dollars a month at this volume) *or* Groq/OpenRouter free for non-confidential test books. The adapter takes any base URL and model, so the provider can change without code.
3. **Pin and test the model id.** Add a startup check that the configured model answers a canned image; when it doesn't, say "AI helper unavailable" and continue rules-only. Today a retired model would surface as an error in the middle of a job.
4. **Cost expectation:** with AI only on blocks <0.85 and only alt drafts for pictures, a 300-page book is on the order of tens to a few hundred calls, which fits a free daily quota for testing and costs cents on a paid tier. Do not send every page.
5. **Do not use HF free credit** as a core dependency.

---

## 8. Where I disagree with Forge

Forge is right on the main point (deterministic core, profile, AI as helper, validation). I disagree, or would sharpen, on seven things:

1. **"Add a per-job settings profile" is not new; it's the thing already built, and the gap is its vocabulary.** B/C have layers, ~44 rules, client JSON and an importer. The right move is to extend what exists (typography per role, chapter-opener template, `ua.*`), not to design a new profile system. Building a second one is how a fourth copy of the engine would appear.
2. **Not all corrections become profile edits.** From the table in §4.1: about half do. The other half (U1, U7, V2, V3, V4, V6, V7, P8, P12…) are real defects. Telling Showmik "now corrections are only settings" will repeat the original disappointment. Say "settings for style, tests for defects".
3. **AI classification of blocks: smaller role than Forge suggests.** Running head, folio, paragraph merge, italic, verse, key/value tables are *decidable from geometry and fonts*; they failed because thresholds were wrong (e.g. `pdf/pages.ts:104`), not because rules can't do it. Use AI only for the leftover, under 0.85 confidence, as a capped vote. If it does not measurably improve accuracy on a labelled sample, leave it off.
4. **"Visual compare against client reference" should be a deterministic diff first.** Normalised markup and tag-listing diffs (extend `refdiff.ts`) catch exactly what the client marks. A vision model comparing screenshots would be slower, non-repeatable, and blind to attributes like `class`, `alt`, `id`. AI may *explain* a diff, never *judge* it.
5. **Learn the profile from the client's reference file** (deterministically). Forge doesn't mention this and it is the largest single saver: the client's hand-made samples are the spec.
6. **Privacy and licence are bigger risks than accuracy for the free tiers.** Free Gemini terms allow training/human review of inputs and one source excludes commercial use; unpublished manuscripts are the client's property. Forge lists the providers as neutral; they aren't.
7. **veraPDF "needs Java 11+" is solved by tooling already in the repo** (JRE 17 in `tools/`), so it is not a blocker to schedule around. Also: veraPDF and PAC are not the same authority (veraPDF = PDF/UA-1 machine rules; PAC checks additional reading-order aspects); run both once, automate veraPDF.

I also disagree mildly with the corrections doc: it recommended `pdf-tagger-sns` main as home. I prefer C because its root is the app (see §5), but this depends on Decision 1.

And with the original goal itself: "every output rule customisable" cannot be literally true. Limit it to a **closed list of options**, each tested. A client asking for something outside the list is a feature request (half a day), not a setting.

---

## 9. Decisions Showmik must make

1. **Which repo is the home?** Recommended: `sns-publishing-automation`. Alternative: `pdf-tagger-sns` with `automation-app/` moved to the root. What is wired to Vercel/GitHub Actions today, and which one does the client's team see?
2. **May we stop adding hard-coded rules and agree the rule: "style = profile edit; defect = test + code"?** And accept that about half of client corrections will still be code.
3. **Is the golden-file approach the definition of done?** That means asking the client for, per pipeline, 2 books with input **and** their finished reference file (Corrections Q14, Q1). Without this, nothing changes.
4. **Index and end notes as lists (U4)**: both, or only notes? (reverses `31ae0f7` for the index).
5. **Client style data:** can the client send the "InDesign style → class" list and approve the cover markup (P10), `chnum/chtit` shape, `chapter-title` class? Or may we learn it from the reference EPUB and ask them to confirm?
6. **`301n.66` target:** page 301 or note 66? Is "N is the footnote" the same remark as the previous one?
7. **Standard EPUB rules:** `em/strong` or `i/b`; `alt=""` or `alt="decorative"`; title page as image or text; and may we label Standard files "not accessible"?
8. **Book_Details.xlsx:** is it the file plan we must obey, and who fills the empty rows and the `epub:type` column?
9. **AI policy:** off by default, on per job; which provider (Gemini paid / Groq / OpenRouter / local), and is the client's consent needed before page images leave the machine?
10. **Budget for AI and for waiting:** is a paid tier of a few dollars a month acceptable, and who owns the key?
11. **Scope order:** do we fix the PDF/UA core bugs (U1, U6, U7) first because they need no client answers, then the profile vocabulary, or wait for answers and do EPUB first?
12. **Logos:** Figure with description (the 17 Oct ask) or decoration (artifact), per book or always?
