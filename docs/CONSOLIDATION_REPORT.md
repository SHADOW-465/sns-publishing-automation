# Consolidation report

This repository, branch `forge/consolidate`, is the home of the EPUB and accessible-PDF app. The other two copies were read and not changed. Nothing was pushed, deployed, or migrated. The Supabase migration is a file only.

## File inventory

The client’s files are listed in `docs/REFERENCE_INVENTORY.md`. In short:

- InDesign to accessible EPUB: `88228-02 Cambia tu mente.zip` and the print PDF, finished as `Cambia tu mente.epub` (Arkano).
- Print PDF to standard EPUB: `Contemporary_Ceramics_Final.pdf`, the Word file, and the cover spread, finished as `9780719847127.epub` (Crowood).
- Accessible PDF, simple: Gladiators in the Greek World, plus cover, alt-text Word file, and plates PDF, finished as the tagged PDF and a PAC report.
- Accessible PDF, medium: `DD_Evers-Woelk_2124-6.pdf` and `AltTexte MEW.docx`, finished as the tagged PDF and a PAC report.
- Input only, not scored: `La cara oculta de la presidenta_Grijalbo.zip`.

## Excluded file

`Indesin-to-EPUB-Automation/Input/OEBPS/88228-02_Cambia_tu_mente.xhtml` is excluded. It is a loose extract dated 23 September 2026. The same chapter inside the zip, and the files beside the loose one, are dated 2 September 2026. The loose file is shorter and its chapter 8 heading is broken (`E` plus a `small` span). The zip member is intact. The harness uses the zip.

`9780719847127.rar` is a later, slightly larger pack of the ceramics EPUB. It was not opened. The EPUB from 22 August 2026 is the ground truth.

## Conclusions drawn from the finished files

- Accessible EPUB (Cambia) uses real headings, a page list, a text title page, language, and accessibility metadata.
- Standard EPUB (ceramics) puts the chapter number and title inside one heading, classes `ch-head1`, `ch-num`, and `ch2`. The heading is left-aligned. It is not split into two plain paragraphs and it is not centred.
- The ceramics chapter heading has about 2em under it. The house default stays 3em, because lowering it was not checked against Cambia.
- Gladiators bookmarks the appended plates as `Plate`.
- Index entries stay paragraphs. A page number after a comma is the locator. `305n.129` points at page 305.
- A logo drawn from many paths is one figure.

Where a correction sheet from 23 October disagrees with these files, the files win.

## Conflicts with the 23 October sheets

| Sheet | What the sheet asked | What the finished file does |
| --- | --- | --- |
| V1 | Split the chapter number and title into two paragraphs (`chnum`, `chtit`). | Ceramics uses one heading. That is the default. Accessible EPUB refuses the split. |
| P13 | Centre chapter headings. | Ceramics is left-aligned serif. Not applied. |
| I5 / I9 | More space under headings. | Ceramics uses about 2em under `.ch-head1`. The house default stays 3em until a client layer sets it. |
| U4 | Tag the index as a list. | Gladiators keeps one paragraph per entry. |
| I1 | Title page as a picture of text. | Cambia and ceramics use text. An accessible build refuses a title that is only a picture. |

## What was already here

| Source | Commit | What it does | Here |
| --- | --- | --- | --- |
| pdf-tagger-sns | `4882726` | Subheads sit under a chapter title that is deeper than h1. | `085bc98` |
| pdf-tagger-sns | `e68f7e6` | A remembered style name matches that style only. | `984ea6d` |
| pdf-tagger-sns | `402250b` | HD-09 ranks sizes only among styles still marked h3. | `94da9db` |
| pdf-tagger-sns | `307bddd` | CI typecheck and tests on Windows. | `27417cd` |
| pdf-tagger-sns-pdfua | `31ae0f7` and the PDF/UA fixes under it | Figures, index paragraphs, image-list order, notes, lists, columns, one title H1. | Already in this tree. Not copied again. |
| this repo | `3c087ab` | A bold or superscript note number keeps the paragraph well-formed. | Left as it is. |
| this repo | `2587301` | Reference-diff harness and the before scores. | Kept. |

## What this session added

| Commit | What changed |
| --- | --- |
| `8e60f1e` | The contents list is read from the manifest even when that file is not in the spine. |
| `328d534` | Chapter shape and classes are settings. The default matches ceramics. `outputViolations` refuses an accessible EPUB whose chapter titles are not headings. |
| `640a721` | JSON settings file and a Supabase client. Migration written, not applied. `docs/SUPABASE_SETUP.md`. |
| `c23f09d` | One figure stays one marked-content sequence across `q` and `Q`. Text objects still close at `BT` and `ET`. |
| `7cb9483` | Analyse names each stage and stops a stage after eight minutes, then the button works again. Bookmark `Plate`. Index page numbers link to those pages. |
| `5484fab` | Post-build warnings for a repeated opening line, bare index numbers, a contents link to a missing file, and a picture-only title page. |
| `c317709` | Start screen: client, output type, then the files for that output. Real standard breaks block the build. |
| `03c1c97` | Tests for those checks. |
| `bd3251e` | Plan, reference inventory, Supabase steps. |
| `ce728a3` | This report, and the scores then on hand. |
| `2c267ea` | A marked-content sequence ends at the `q` depth where it began, so a logo of several graphics groups stays one sequence. |
| `b35cb8d` | Each output type has its own defaults, with a reason and a source. |
| `fbf25b4` | A link to a printed page follows the anchor’s new name. Anchor name, place, emphasis and decorative alt are settings. |
| `24a7d17` | An undescribed picture keeps the generic word. Only a picture marked as decoration is decorative. A Standard EPUB does not write `pageBreakSource`. |
| `c9ad94d` | PDF typography follows the settings. “As the printed page” is read from the lines. A title page set to text is rebuilt as text. |
| `03e8c83` | The reference build uses the output type and the client layer (Crowood Standard EPUB, Arkano Accessible EPUB, Pen & Sword Accessible PDF). |

## Hard-coding removed

Chapter openings from a PDF are no longer a fixed string in the builder. They come from `chapterOpener`, `pdfChapterClass`, `pdfChapterNumClass`, and `pdfChapterTitleClass`, with a plain-language default per output type in `src/engine/output/standards.ts`.

Body alignment, chapter-title alignment and typeface, the contents heading, the copyright page and the extract size come from `bodyAlign`, `chapterTitleAlign`, `chapterTitleFont`, `contentsHeadingAlign`, `contentsHeadingFont`, `copyrightAlign` and `extractSizePct`. “As the printed page” is measured from the lines (`src/engine/pdfepub/align.ts`): full lines that end on the right edge are justified, a short line that sits on the middle is centred. The Crowood layer sets these to left, serif and sans-serif, which is what the ceramics file does.

A title or half-title page is a picture of the printed page, or real text, from `titlePageAs`. Standard EPUB defaults to the picture, as in the ceramics file. Accessible EPUB defaults to text. An undescribed picture is not treated as decoration: only `role="presentation"` takes the decorative description. A Standard EPUB names the print edition in `dc:source` and does not add `pageBreakSource`.

Left on purpose:

- The name-particle list in the package is how a surname is sorted, not a layout choice.
- The running-head detector’s length and count are how a repeated header is recognised, not what the reader is shown.
- Logo size thresholds were already behind the logo option.

Heading space, verse and quote size, and the standard-EPUB heading style were already settings. Their defaults were not changed.

## Defects fixed

| Correction | Commit | What a person sees now |
| --- | --- | --- |
| U7. Stuck on “Reading page 322 of 322”, Analyse greyed out. | `7cb9483` | The label names the stage (reading, planning the tags, finding pictures, reading order, tagging). A stage that runs past eight minutes stops with a plain message, and Analyse can be pressed again. |
| U1. FSC logo in many pieces. | `c23f09d` | Paths of one figure stay in one marked-content sequence across graphics groups. The Gladiators test still finds the FSC mark as one Figure. |
| U2. Index page numbers are not links. | `7cb9483` | Numbers after the entry name link to those pages. `World War 2, 14` links 14. `305n.129` links page 305. |
| U6. Appended plates need a bookmark. | `7cb9483` | The bookmark is `Plate`. |

Paragraphs that the ceramics PDF merges or splits were not rewritten. Forcing a merge would move the score without a rule that was checked. The harness still reports them: 20 merged, 59 split.

## Guards

- `outputViolations` blocks a build that would break the chosen output type. Warnings do not block.
- `postBuildGuards` adds a warning to the package review for the four classes above.
- `test/reference-score.ts` scores a build against the client’s finished EPUB. Scores are in `docs/reference-scores/`.

## UX

The start screen is six steps in plain language: client, output type, files, where each setting came from (the spec step already shows the layer), problems that block, then the result. Standard EPUB, Accessible EPUB, and Accessible PDF each have a one-line explanation. Accessible PDF opens only that workflow.

The new screen was not clicked in a browser. There is no browser tool in this session. The check was `npm run build` (typecheck and the Vite production build), which succeeded, and the unit tests. The spec step, the check report, and the file-type labels were already in the app.

## Match scores

Recorded by `test/reference-score.ts` into `docs/reference-scores/`. Before is `before.json`. After is `after.json`, from this tree, with each book’s output type and client layer applied. The loose file `88228-02_Cambia_tu_mente.xhtml` is not part of either run.

| Book | Before | After |
| --- | --- | --- |
| Cambia tu mente (accessible EPUB) | 97.5 | 97.5 |
| Contemporary Ceramics (standard EPUB) | 89.4 | 91 |
| Gladiators in the Greek World (accessible PDF) | 54 | 76.1 |
| Evers-Wölk report (accessible PDF) | 77.9 | 75.8 |

An earlier ceramics run, before the scorer looked at a page list outside the spine, was 90. That run is the “before” quoted in the first draft of this report. `before.json` already includes the page-list comparison, so its ceramics number is 89.4.

Cambia’s section scores did not move (sections 99.9, headings 100, paragraphs 99.9, classes 89.2, emphasis 98.9, notes 100, contents 100, pictures 100, pages 100, metadata 76.9, stylesheet 71.6).

Ceramics went from 89.4 to 91 on two lines. Contents 88 to 97.5: the Crowood layer names page anchors `pg_{n}`, so links in the contents and the index land on those anchors. One contents entry, “title”, is still worded differently. Metadata 62.5 to 75: a Standard EPUB no longer writes `pageBreakSource`. The title is still short of the subtitle (“Twenty Key Themes”) and the language is `en-GB` where the file says `en`. Pictures stayed at 72 (3 real descriptions, 283 times the generic word, 2 empty, against the file’s 284 generic and 1 empty). An intermediate run that treated every undescribed picture as decoration scored pictures at 52.1; that file was `try.json` and it is not kept. Printed page numbers stayed at 90. The ceramics file has a page list in the navigation document. The Standard EPUB build uses anchors and does not add that list. Sections 100, headings 99.1, paragraphs 87.9, classes 93.1, emphasis 93.9, index 100, stylesheet 67.5 are unchanged. Paragraphs are still 20 merged and 59 split. Those were not forced together.

Gladiators went from 54 to 76.1 because the Pen & Sword layer is applied: chapters stay H1 (headings 43.6 to 99.5) and bookmarks stop at the chapter level, with the plates bookmark (bookmarks 38.1 to 98.1). The bookmark “title” in the file is “gladiators in the greek world” in the build. The document title still splits “Bloodsport” into “Blood Sport”. Figures went from 73.2 to 66.1. The count is unchanged (30 against 33, two without a description). The biggest figure is no longer reported as 116 pieces against the file’s 34, because the pieces are no longer more than one and a half times the file. The scorer still compares the piece counts, so a tighter figure scores lower. Lists, the missing table, the 1022 internal links against 29, and the 1035 note references against 44 are unchanged.

Evers went from 77.9 to 75.8. The only move is figures, 96.2 to 82.7, with no difference the scorer prints: the counts match and every figure has a description, and the piece-count comparison is what changed. Bookmarks 61.8, headings 68.2 (13 H1 against the file’s one H1, and no H5 against the file’s 50), lists 69.6, links 78.8 and notes 84.3 are unchanged.

## Tests, lint, build

There is no separate lint script. Typecheck is part of the build.

`npm test`: 184 tests, 179 passed, 0 failed, 5 skipped, about 8.2 minutes. `npm run build` succeeded (tsc and Vite). One earlier run failed the Gladiators title page, because a marked-content sequence was allowed to cross a text object. Text objects now close at `BT` and `ET`, and that test passed in the full run.

Five tests skip when a sample or Ace is missing. That is expected.

## Still needs a client answer

- U3 and U5. Should `305n.129` jump to the note, or to page 305? The link goes to the page.
- U8. Cover with no instruction.
- P10. Cover markup.
- P12. Half-title versus title, and the uncropped logo.
- Q10. Whether `Book_Details.xlsx` should become a settings layer, and which columns.
- The corrections document’s Birmingham versus Cambia filename mismatch.
- Whether the house space under a heading should drop from 3em to the ceramics 2em. It stays 3em until someone sets the client layer. The PDF stylesheet for a chapter heading is still the ceramics 2em, because that file was the source of those classes.
- Whether a Standard EPUB should grow a page list. The ceramics file has one, and the pages score stays at 90 without it. The Standard EPUB default is anchors only, which is what the build does.
- Ceramics package title and language. The build has “Contemporary Ceramics” and `en-GB`. The file has “Contemporary Ceramics: Twenty Key Themes” and `en`.
- Gladiators document title. The build says “Blood Sport”. The file says “Bloodsport”.
- Evers heading levels. The build has 13 H1s and no H5. The file has one H1 and 50 H5s. The Accessible PDF default is one H1, and it applies only once a title heading is found.

## Supabase, waiting for approval

Showmik still has to create the project, apply `supabase/migrations/20261023180000_clients_books.sql`, create a private bucket `reference-files`, and set `SUPABASE_URL` and `SUPABASE_ANON_KEY` where the tool should use them. Names only. The values stay out of git. Until then the browser keeps settings in localStorage, and a script can use `SNS_STORE`. Details are in `docs/SUPABASE_SETUP.md`.
