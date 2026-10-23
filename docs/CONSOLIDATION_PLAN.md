# Consolidation plan

This repository, branch `forge/consolidate`, is the home of the EPUB and accessible-PDF app. The other two copies were read and not modified: `pdf-tagger-sns` on `forge/epub-next`, and `pdf-tagger-sns-pdfua` on `forge/pdfua-fixes` (tip `31ae0f7`). The client’s finished books are inventoried in `docs/REFERENCE_INVENTORY.md`. They win when they disagree with a correction sheet.

## Provenance

| Source | Commit | What it does | Status here |
| --- | --- | --- | --- |
| pdf-tagger-sns | `4882726` | A chapter-title template deeper than h1 (BeBra’s h2) puts subheads one level under the chapter, not beside it. | Already present as `085bc98`. |
| pdf-tagger-sns | `e68f7e6` | A remembered style name matches that style only, not a substring such as “Sub” inside “Subtitle”. | Already present as `984ea6d`. |
| pdf-tagger-sns | `402250b` | HD-09 ranks sizes only among styles that are still h3, so a style decided as text does not push every subhead down. | Already present as `94da9db`. |
| pdf-tagger-sns | `307bddd` | CI typecheck and tests on Windows. | Already present as `27417cd`, adapted to this repo root. |
| pdf-tagger-sns-pdfua | `31ae0f7` and the PDF/UA fixes beneath it (figures where they stand, one P per index entry, image-list link order, FSC logos as figures, notes, lists, columns, title H1). | Tagging behaviour the PAC reports depend on. | Already present in this tree before this plan. Not copied again. |
| this repo | `3c087ab` | A bold or superscript note number keeps the paragraph well-formed. | Phase 0. Left as it is. |
| this repo | `2587301` | Reference-diff harness and the before scores. | Kept. The navigation document is now read from the manifest even when it is not in the spine. |

Later commits on this branch (chapter-opener settings, output-type check, JSON and Supabase store, PDF/UA stage progress, one figure across graphics state, the Plate bookmark, index page links, post-build guards, the start screen) are listed with their hashes in `docs/CONSOLIDATION_REPORT.md`.

## Hard-coded output decisions

These were fixed choices in the builders. Each is now a setting, or it was left because it is not a client choice.

| Spot | Decision | What happens now |
| --- | --- | --- |
| PDF to EPUB chapter opening | Number and title markup, and the classes on them. | Settings `chapterOpener`, `pdfChapterClass`, `pdfChapterNumClass`, `pdfChapterTitleClass`. Default matches the ceramics file: one heading, `ch-head1`, `ch-num`, `ch2`. |
| Title page as a picture of text | Some correction sheets asked for an image. | Accessible EPUB and accessible PDF refuse a chapter title that is not real text. The title-page guard warns when an accessible package’s title page is only a picture. |
| Heading element versus a classed paragraph | Standard EPUB may use paragraphs. | Already the standard-profile switch (`stdHeadings`). Not applied on an accessible build, so the checker does not flag it there. |
| `epub/package.ts` particle list | “von”, “de la”, and the same words used when sorting a name. | Left. It is linguistic file-as sorting, not a publisher’s layout choice. |
| Running-head detection (`pdf/pages.ts`, short line repeated often) | How a repeated header is recognised. | Left. It is a detection threshold, not a choice of what the reader sees. |
| Logo size thresholds in `pdfua/figures.ts` | When many paths count as one logo. | Already gated by the logo option (`figure` or `artifact`). |
| Typography per role, verse and quote size, heading space | Print spacing. | Already settings (`headingSpaceAboveEm`, `headingSpaceBelowEm`, `headingScalePct`, block class). Defaults were not changed, because the ceramics file’s 2em below a chapter was not checked against Cambia’s score. |

Missing values fall back by output type. The three types and the plain-language defaults are `OUTPUT_KINDS` and `OUTPUT_DEFAULTS` in `src/engine/output/standards.ts`.

- Standard EPUB: EPUB 3.3. Chapter titles may be classed paragraphs. Page numbers are anchors. The ceramics file is the client example.
- Accessible EPUB: EPUB Accessibility 1.1 and WCAG 2.2 AA. Real headings, a page list, text rather than a picture of text, alt text, language, accessibility metadata.
- Accessible PDF: PDF/UA-1 and the Matterhorn protocol. Tags in reading order, document language, one figure for a multi-path logo, bookmark `Plate` for an appended plates PDF.

`outputViolations` refuses a combination that breaks the chosen type, in plain language. An error blocks the build. A warning does not.

## 23 October corrections

| Item | Class | Guard |
| --- | --- | --- |
| U7. Analyse stays grey on “Reading page 322 of 322”. | Defect. | Each stage reports its own progress. Planning the tags yields and stops after eight minutes with a message that Analyse is available again. The button is enabled when the run finishes or fails. |
| U1. FSC logo split into many pieces. | Defect. | One owner keeps one marked-content sequence across `q`/`Q`. A post-build check is the existing figure clustering, still behind the logo option. |
| U2. Index page numbers are not links. | Defect. | Locators after a comma become links. The link covers the first number of a range only. `305n.129` links page 305. |
| U3 and U5. Should `n.129` jump to the note? | Needs a client answer. | Not changed. |
| U4. Index as a list. | Setting, and the reference disagrees. | Index entries stay paragraphs, as in the Gladiators file. |
| U6. Appended plates bookmark. | Defect. | Bookmark title is `Plate`. |
| U8. Cover with no instruction. | Needs a client answer. | Not changed. |
| V1. Split chapter number and title into `chnum` / `chtit`. | Setting. The ceramics file uses one heading. | Default stays one heading. Accessible EPUB rejects the split. |
| P13. Centre chapter headings. | Setting. Ceramics is left-aligned. | Not applied. |
| I5 / I9. Larger space under headings. | Setting. Ceramics uses about 2em under `.ch-head1`. | House default stays 3em until a client layer sets it. |
| I1. Title page as an image. | Setting for a book we do not have. Cambia and ceramics use text. | Accessible builds reject a picture used as the only title. |
| I6 / P9. Pictures dumped at the end. | Already matching. Cambia picture score 100 before this work. | Not reworked. |
| P10. Cover markup. | Needs a client answer. | Not changed. |
| P12. Half-title versus title, uncropped logo. | Needs a client answer. | Not changed. |
| Q10. Import `Book_Details.xlsx` as a profile. | Needs a client answer on the sheet’s columns. | Not built. |
| Running heads and page numbers leaking into the EPUB. | Defect class. | Post-build warning when the same short opening line repeats in three or more chapters. |
| Paragraphs merged or split on the ceramics PDF. | Defect class, but a blind merge would move the score without a checked rule. | Reported by the reference harness (merged, split, missing, extra). Not “fixed” by force. |
| Italics lost. | Defect class. | The harness scores emphasis. No new rewrite of the PDF extractor. |
| Contents links that point nowhere. | Defect class. | Post-build warning when a `toc.xhtml` href is not a file in the book. |
| Page title equal to the book title. | Setting (`stdTitle`). | Unchanged default. |

## Supabase

Tables, policies, and the fallback are in `docs/SUPABASE_SETUP.md` and `supabase/migrations/20261023180000_clients_books.sql`. The migration is not applied.

## UX

The start screen asks, in order: client, output type (one line each), then which files the operator has. The chosen output sets the EPUB profile for the InDesign and PDF-or-Word flows. Accessible PDF opens only that workflow. The spec step already shows which layer set each value. Before the EPUB build, real output-type errors are listed in plain language and block the build. Warnings do not. The check screen already says what passed and what needs a person.

## Scores

`docs/reference-scores/before.json` is the earlier run on this branch: Cambia 97.5, ceramics 89.4, Gladiators 54, Evers 77.9. An older ceramics figure of 90 was taken before the scorer read a page list that is not in the spine. `docs/reference-scores/after.json` is the run after the typography, title-page, picture-description and client-layer work. The consolidation report has both. Run:

```
node --import ./test/setup.ts test/reference-score.ts after
```
