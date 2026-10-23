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

## Hard-coding removed

Chapter openings from a PDF are no longer a fixed string in the builder. They come from `chapterOpener`, `pdfChapterClass`, `pdfChapterNumClass`, and `pdfChapterTitleClass`, with a plain-language default per output type in `src/engine/output/standards.ts`.

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

Recorded by `test/reference-score.ts`. Before is commit `2587301`. After is this tree.

| Book | Before | After |
| --- | --- | --- |
| Cambia tu mente (accessible EPUB) | 97.5 | 97.5 |
| Contemporary Ceramics (standard EPUB) | 90 | 89.4 |

Cambia’s section scores did not move (sections 99.9, headings 100, paragraphs 99.9, classes 89.2, emphasis 98.9, notes 100, contents 100, pictures 100, pages 100, metadata 76.9, stylesheet 71.6).

Ceramics moved on one line only: printed page numbers 100 to 90. The scorer now reads the navigation document when it is not in the spine. The ceramics file has a page list there. The standard build uses anchors and does not add that list, which is the standard-EPUB default. The other ceramics scores are unchanged (sections 100, headings 99.1, paragraphs 87.9, classes 93.1, emphasis 93.9, contents 88, index 100, pictures 72, metadata 62.5, stylesheet 67.5).

There is no numeric before/after score for the accessible PDFs. `reference-score-pdf.ts` does not exist. The Gladiators test passed after the figure fix: 361 pages, the FSC mark is one Figure, index lines stay paragraphs, image-list links resolve. The German medium sample passed: 13 figures, 16 notes.

## Tests, lint, build

There is no separate lint script. Typecheck is part of the build.

`npm test`: 166 tests, 161 passed, 0 failed, 5 skipped, about 7.3 minutes. `npm run build` succeeded (tsc and Vite). One earlier run failed the Gladiators title page, because a marked-content sequence was allowed to cross a text object. Text objects now close at `BT` and `ET`, and that test passed in the full run (41 seconds).

Five tests skip when a sample or Ace is missing. That is expected.

## Still needs a client answer

- U3 and U5. Should `305n.129` jump to the note, or to page 305? The link goes to the page.
- U8. Cover with no instruction.
- P10. Cover markup.
- P12. Half-title versus title, and the uncropped logo.
- Q10. Whether `Book_Details.xlsx` should become a settings layer, and which columns.
- The corrections document’s Birmingham versus Cambia filename mismatch.
- Whether the house space under a heading should drop from 3em to the ceramics 2em. It stays 3em until someone sets the client layer.

## Supabase, waiting for approval

Showmik still has to create the project, apply `supabase/migrations/20261023180000_clients_books.sql`, create a private bucket `reference-files`, and set `SUPABASE_URL` and `SUPABASE_ANON_KEY` where the tool should use them. Names only. The values stay out of git. Until then the browser keeps settings in localStorage, and a script can use `SNS_STORE`. Details are in `docs/SUPABASE_SETUP.md`.
