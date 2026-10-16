# EPUB dynamic: status against `EPUB_DYNAMIC_DESIGN.md`

Branch `forge/epub-dynamic`. Nothing was pushed.

**Tests:** `npm test` was 88 passing before this work and is **104 passing, 0 failing, 0 skipped** after it (7 new in `test/detect.test.ts`). The 12 Tempelhofer points (`test/client-report.test.ts`) were green after every phase. They include the real-book test, which now runs through the BeBra JSON layer.

**EPUBCheck:** Java is present in `tools/` (`jdk-17.0.20.1+1-jre`, EPUBCheck 5.4.0). The system `java` is 1.8, so the tests use the bundled JRE. The Tempelhofer EPUB was regenerated after phase 3 with `test/run-indd.ts` into `corrections/_regen_dynamic/book.epub`. EPUBCheck reports **0 fatals, 0 errors, 0 warnings, 0 infos**. The synthetic review builds in the tests are also EPUBCheck-clean.

| Phase | State | What is done / what is missing |
|---|---|---|
| 0. Baseline harness | **Done** | `src/engine/check/refdiff.ts` compares a build with a reference EPUB (spine, menu labels, chapter headings, note markup, guide, cover title). The review build is checked with EPUBCheck and refdiff in the client-report test, next to the real-book EPUBCheck. **Missing:** no CI workflow file. The check runs inside `npm test` only. |
| 1. Validation gate | **Partial** | `check/gate.ts` runs structure, spec conformance (`check/conform.ts`), accessibility claims, EPUBCheck and the optional reference diff. The verdict is green, amber or red. Green needs EPUBCheck to have run. Without it the verdict is at most amber. A test breaks a heading and the gate goes red. The package claims now follow the facts: `accessModeSufficient` only when every non-decorative picture has a description, `visual` only with pictures, `dc:date` and `dc:description` only when given. The Check screen shows the verdict. **Missing:** the EPUBCheck/Ace service, because there is no hosting. `EpubValidator` is an interface with a `noValidator` stub and an `httpValidator(url)` client. The tests plug in local EPUBCheck. axe-core and Ace are not wired. The verdict is not on the build and download steps yet, only on Check. There is no red "download anyway" decision. |
| 2. Rules as data | **Partial** | `Layer` has `markup`, `styleMap` and `css`. `resolve()` merges them with provenance. BeBra is `src/clients/bebra.json`, loaded as data (`src/clients/index.ts`). `HD-07`/`HD-08` are gone from BeBra and replaced by the `chapter-title` template (`h2.chapter-b`). The note reference wrapper comes from the `noteref` template. `styleMap` decides a style's role before any guess. Saving a style for a client or a book is `saveStyleRule`. A second fake client with other classes builds with no code change (test). The house cover word is still Umschlag. BeBra's Abdeckung comes only from its JSON. **Missing:** `DEFAULT_SETTINGS` and `sanitize` are not generated from `RULES`. Importing `rules.ts` from `settings.ts` would be circular, and I did not untangle it. The new rules NOTE-04, NAV-05/06, FM-02 and PKG-02/03 are not added. There is no `renderAs()` for the PDF builder, and `toStandard` is not moved into templates. The localStorage profile is not migrated into `styleMap`. It still works beside it. Only two roles are templated: `chapter-title` and `noteref`. Client files are listed by hand in `src/clients/index.ts` (no `import.meta.glob`), so Node tests can load them. |
| 3. Unified detection | **Done, with limits** | Every style role is now decided by `structure/score.ts`: each signal (saved, nav, printed contents, tag, name, pattern, typography, position, rare) votes for a role and the votes combine. The old first-match result from `inferProfile` is kept as one `fallback` vote of 0.25. The InDesign and PDF readers both fill a `BlockFeatures` record (`structure/features.ts`, `indesign/features.ts`, `pdfepub/features.ts`) and the scorer reads only that record. The source's own nav and the printed contents count as one vote (one list shown in two places). Thresholds: 0.85 and up silent, 0.6 to 0.85 listed, under 0.6 blocks until decided. Notes (`structure/notes.ts`): InDesign footnote, InDesign endnote, typed endnote section (numbers matched per chapter) and PDF footnote (superscript plus numbered foot line on the same page); a reference without a note or a note without a reference is flagged at 0.4 to 0.5. Pictures (`indesign/placement.ts`): anchor, layout page marker, caption match against the print PDF; each picture records the signal that placed it and a confidence, and a picture nothing places lists the three closest printed pages. Added cross-checks: the contents lists N chapters but M were found, a chapter starts on a different page than the contents prints, chapter pages do not rise. **Limits:** the fourth picture signal (print-PDF image position by hash) is not built, because the build never decodes the print PDF's pictures. Typography gives every heading-like style h3, not a level by size rank (a rank would change the Cambia output against the hand-finished EPUB). No per-block exceptions: a block whose own signal disagrees with its style is not split off (the PDF reader still has its per-line `forced` headings). The dictionary has no entries for BU, Zitat, Kasten. PDF footnotes are detected and flagged but the PDF builder does not render them as notes. Weights are hand-set; the three reference PDFs and two InDesign books reproduce every old role. |
| 4. Review screen | **Mostly done** | The Structure step is one list sorted by confidence (`review/confidence.ts`): styles, sections, book details, notes, pictures, each with a percentage. Cross-check failures are a red banner above the list and are not list items. Next is disabled while any style, note or picture item is under 0.6 and not decided (a style by choosing its meaning, a note or picture by Accept as it is). Build messages such as a missing picture description do not block here; they are fixed on the Pictures step. The "Remember for this book / client" switch and client `styleMap` from phase 4 stay. **Missing:** the PDF flow shows the note findings only as a count; the scope switch does not offer series; the screen was type-checked and not clicked through in a browser. |
| 5. Spec sheet import v2 | **Partial** | The exported workbook has `Markup` and `Styles` sheets. `parseMarkupSample` turns an HTML sample into a template. The report's expected `<h2 class="chapter-b">` and `<sup><a epub:type="noteref">` reproduce `bebra.json`'s markup (test). The import screen has an "Apply markup and styles" button that writes to a chosen layer. **Missing:** the rows are applied as a block, not confirmed row by row with a source. Only the `chapter-title` and `noteref` roles parse. Importing the report's `.docx` directly is not done. It needs a Markup sheet. |
| 6. Remaining standard defaults | **Partial** | The landmarks now include the list of illustrations, bibliography, endnotes, index and acknowledgments when present. `dtb:depth` is the real depth. The subtitle is a refined `title-type` title, with `file-as` for creators and `belongs-to-collection` for a series. Added German section words (registers, sources, footnotes, list of figures). Tests cover all of this and EPUBCheck passes. **Missing:** `BookMeta.series` and `published` are not fed from the UI. The nav depth is not a rule (NAV-05). There are no extended descriptions for complex figures. The print-only list and the full abbreviation table are not shipped as a locale pack. `file-as` takes the last word as the surname and ignores particles (von, de la). |

## Phase 3 detection, before and after

Measured with `test/detect-report.ts` (InDesign books) and `test/detect-pdf.ts` (print PDFs) on the code before phase 3 and after it. The before numbers were saved first. Roles per style are identical in both books.

| Measure | Tempelhofer before | after | Cambia before | after |
|---|---|---|---|---|
| Chapters found | 10 | 10 | 11 | 11 |
| Sections | 22 | 22 | 26 | 26 |
| Headings h1 / h2 / h3 | 2 / 25 / 0 | 2 / 25 / 0 | 5 / 20 / 185 | 5 / 20 / 185 |
| Styles with a role (changed by phase 3) | 11 (0 changed) | 11 | 48 (0 changed) | 48 |
| Styles needing a person (under 0.6) | 0 | 0 | 7 | 0 |
| Styles listed (0.6 to 0.85) | not measured | 4 | not measured | 15 |
| Notes (refs in text, notes on the notes page) | 19 refs, 19 notes | 19 / 19, kind: InDesign endnote, 0 unmatched | 8 under chapters | same placement, kind: InDesign endnote 8/8, 0 unmatched |
| Pictures in the book / left out | 74 / 0 | 74 / 0 | 2 / 1 | 2 / 1 |
| Pictures moved by caption | 66 | 66 (67 placed by caption, 6 by layout page) | 0 | 0 |
| Picture still on the notes page | 1 | 1 (now blocked, confidence 0.3) | 0 | 0 |
| Review items: errors / warnings / info | 12 / 2 / 3 | 12 / 2 / 3 | 0 / 0 / 7 | 0 / 0 / 7 |
| Check list items under 0.6 / 0.6 or more | 15 / 2 | 16 / 10 | 7 / 0 | 0 / 16 |

The Tempelhofer check list grows mainly because pictures that only the layout page places (5) and four listed styles now appear as "please look" items; its one extra item under 0.6 is the picture on the notes page. Cambia's seven unsure styles are now decided with more than 0.6 (the bullet list, the contents lines and the two subheading styles gained a second signal).

| Print PDF | Styles | Roles changed | Styles flagged unsure before | after |
|---|---|---|---|---|
| Tempelhofer | 12 | 0 | 1 | 0 |
| Cambia | 22 | 0 | 5 | 0 |
| Contemporary Ceramics | 17 | 0 | 0 | 0 |

No PDF footnotes were found in these three PDFs (none has a superscript with a foot line on the same page).

## Notes

- Phase 5's first full `npm test` run had two failures, both because the new sheets changed the expected sheet list in `alt.test.ts` and `spec.test.ts`. I updated those expectations and re-ran the three affected test files. The full suite was green in the phase 6 run.
- The phase 1 commit missed several files because a `git add` failed on a wrong path. The next commit added them (`feat(check): add the gate, honest package claims…`). Both commits are in history.
- The Tempelhofer log still lists review items that need a person, not engine faults: AI-draft picture descriptions, two pictures with no description, three pages with no page marker (98/169/171), and one picture left on the notes page.
- Still open from the design: whether BeBra's "Abdeckung" is wanted (it is shipped in their JSON), where the EPUBCheck service runs, and whether clients can send a reference EPUB with each order.
