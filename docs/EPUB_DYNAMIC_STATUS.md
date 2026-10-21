# EPUB dynamic: status against `EPUB_DYNAMIC_DESIGN.md`

Phases 0 to 6 were built on branch `forge/epub-dynamic`; the follow-up work is on `forge/epub-next` (see the last section). Nothing was pushed. The table below is the state on `forge/epub-next` as of 21 Oct 2026.

**Tests:** `npm test` was 88 passing before this work and is **114 passing, 0 failing, 0 skipped** after it. The 12 Tempelhofer points (`test/client-report.test.ts`) were green after every phase. They include the real-book test, which now runs through the BeBra JSON layer.

**EPUBCheck:** Java is present in `tools/` (`jdk-17.0.20.1+1-jre`, EPUBCheck 5.4.0). The system `java` is 1.8, so the tests use the bundled JRE. The Tempelhofer EPUB was regenerated after phases 1 to 6 with `test/run-indd.ts` into `corrections/_regen_dynamic/book.epub`. EPUBCheck reports **0 fatals, 0 errors, 0 warnings, 0 infos**. The synthetic review builds in the tests are also EPUBCheck-clean.

| Phase | State | What is done / what is missing |
|---|---|---|
| 0. Baseline harness | **Done** | `src/engine/check/refdiff.ts` compares a build with a reference EPUB (spine, menu labels, chapter headings, note markup, guide, cover title). The review build is checked with EPUBCheck and refdiff in the client-report test, next to the real-book EPUBCheck. **Missing:** no CI workflow file. The check runs inside `npm test`. `.github/workflows/automation-app.yml` runs the type check, `npm run tools` and `npm test` on every push (on Windows, because the pinned JRE is the Windows x64 build; sample-based tests skip there). |
| 1. Validation gate | **Done for the desktop/local app** | Decision (Showmik): EPUBCheck is bundled with the app with its own JRE, so it works offline, and an error warns but never blocks the download. `server/epubcheck-service.ts` runs the bundled JRE and `epubcheck.jar` from `tools/` (or `EPUBCHECK_HOME`) and serves it at `POST /api/epubcheck` in `vite dev` and `vite preview` (checked by hand against the regenerated Tempelhofer book: `{errors:[],warnings:[]}`). The gate, the Check screen and the build flows call it through `httpValidator`; a test runs the gate against a real local server. The build screens show an EPUBCheck box: no errors, or the list of errors with "you can still download the file". `DeliverButton` now downloads directly and states the problems beside the button (the old two-step confirm is gone). If the service is missing (the static Vercel copy) the box says EPUBCheck did not run and the verdict stays amber, never green. Stage 3 now runs axe-core (Ace's own build, `@daisy/axe-core-for-ace`) on every page: in a hidden iframe in the browser, in jsdom in the tests (`check/axe.ts`), next to the built-in page rules (`pageRules`). Stage 5 is the full Ace by DAISY at `POST /api/ace` (`server/ace-service.mjs`), for accessible books only. **Ace is optional and not bundled:** `npm run tools:ace` installs the pinned `@daisy/ace` into `tools/ace` (about 450 MB with its headless Chrome); the installer packs only the JRE and EPUBCheck. When Ace is missing or writes no report, the service answers 503 and the app falls back to axe-core, and says so; Ace is never needed for green, and when it ran axe-core is not run a second time. **Left:** the static web copy has no EPUBCheck and no Ace (axe-core only). The red verdict does not block the download. The desktop installer does not offer to download Ace. |
| 2. Rules as data | **Mostly done** | Plain settings come from one schema table in `settings.ts` (`SCHEMA`): `DEFAULT_SETTINGS` and `sanitize` are generated from it, so a new plain setting is one row plus its rule (the circular import with `rules.ts` is avoided because the schema lives in `settings.ts`; the rules still point at it by key). New rules with engine effect and tests: NOTE-04 note placement (as the source has them / under each chapter / all on the notes page), NAV-05 menu depth, NAV-06 front and back matter in the menu, FM-02 title page order (as printed / as exported), PKG-02 cover `linear`, PKG-03 write the guide. All defaults reproduce the old output. `src/clients/index.ts` also bundles every `*.json` in the folder (`import.meta.glob`; Node tests still import BeBra by name). The style profile an older version kept in the browser moves into the client layer's `styleMap` once (`migrateProfile`), and the browser copy is emptied. `noteRef` lives in `epub/markup.ts` and both builders use it. Since then: the `HouseSettings` type is generated from the schema table; four roles are templated (`chapter-title`, `part-title`, `noteref`, `figure`), and the PDF builder writes chapter headings through the `chapter-title` template too; NOTE-05 (note numbers as the source has them, through the book, or per chapter) and FM-02 "rebuilt" (author, title, subtitle, publisher in the house classes, missing lines from Book details) are rules; the client `styleMap` is applied in `build()`, and a client's **content rules** (a text pattern, a layout and a least inset for one-off override styles such as `ParaOverride-21`) give classes whatever number the export used. A style the person changed on the Structure step keeps their choice at build, and a style remembered for the book beats the client's rule. **Left:** `toStandard` is still regex code, not templates. |
| 3. Unified detection | **Done, with limits** | Every style role is now decided by `structure/score.ts`: each signal (saved, nav, printed contents, tag, name, pattern, typography, position, rare) votes for a role and the votes combine. The old first-match result from `inferProfile` is kept as one `fallback` vote of 0.25. The InDesign and PDF readers both fill a `BlockFeatures` record (`structure/features.ts`, `indesign/features.ts`, `pdfepub/features.ts`) and the scorer reads only that record. The source's own nav and the printed contents count as one vote (one list shown in two places). Thresholds: 0.85 and up silent, 0.6 to 0.85 listed, under 0.6 blocks until decided. Notes (`structure/notes.ts`): InDesign footnote, InDesign endnote, typed endnote section (numbers matched per chapter) and PDF footnote (superscript plus numbered foot line on the same page); a reference without a note or a note without a reference is flagged at 0.4 to 0.5. Pictures (`indesign/placement.ts`): anchor, layout page marker, caption match against the print PDF; each picture records the signal that placed it and a confidence, and a picture nothing places lists the three closest printed pages. Added cross-checks: the contents lists N chapters but M were found, a chapter starts on a different page than the contents prints, chapter pages do not rise. **Limits:** the fourth picture signal (print-PDF image position by hash) is not built, because the build never decodes the print PDF's pictures. Typography gives every heading-like style h3 by default; rule HD-09 "by size" gives h3/h4/h5 by size rank instead (not the default, because it would change the Cambia output against the hand-finished EPUB). No per-block exceptions: a block whose own signal disagrees with its style is not split off (the PDF reader still has its per-line `forced` headings). The dictionary now has the German style-name table (BU, BN, Zitat, Motto, Widmung, FN, Anm, Kasten, Marginalie, Initial, Grundtext, Vorspann); those names are text (`p`) with their own class, never headings. PDF footnotes that have a raised number and a numbered foot line on the same page are now rendered as real notes under their section (`extractFootnotes`); an unmatched number stays as it is and is flagged. Weights are hand-set; the three reference PDFs and two InDesign books reproduce every old role. |
| 4. Review screen | **Mostly done** | The Structure step (InDesign) and the PDF review are each one list sorted by confidence (`review/confidence.ts`): styles, sections, book details, notes, pictures, each with a percentage. Cross-check failures are a red banner above the list and are not list items. Next is disabled while any style, note or picture item is under 0.6 and not decided (a style by choosing its meaning, a note or picture by Accept as it is). Build messages such as a missing picture description do not block here; they are fixed on the Pictures step. The "Remember for this book / client" switch and client `styleMap` from phase 4 stay. **Missing:** the scope switch does not offer series; the screen was type-checked and not clicked through in a browser. |
| 5. Spec sheet import v2 | **Done, with limits** | The import screen lists every markup template and style meaning with a checkbox, what it was read as and its source (sheet and row, or report table and row); only the confirmed rows are written to the chosen layer (`selectLayerData`). The client's own report (`.docx`) now imports directly: a table row whose first cell is an expected HTML sample becomes a template (`layerDataFromReport`; the real report gives `h2.chapter-b` and the `sup` note reference, tested). Now `chapter-title`, `part-title`, `noteref` and `figure` samples parse, and extra attributes in a sample (aria-*, data-*) are read into the template and written by the build. The **Styles sheet** of the exported workbook carries the client's content rules in three more columns (text pattern, layout `block`/`hanging` as a drop-down, least inset in px) and reads them back; a row with a pattern but no class, a pattern that does not compile or an unknown layout is left out, and older three-column sheets still read. **Left:** a report row with no HTML sample stays a plain requirement. |
| 6. Remaining standard defaults | **Mostly done** | Added to the earlier work: series, series number and publication date can be typed in Book details (they feed `belongs-to-collection` and `dc:date`); `file-as` keeps particles with the given names (Humboldt, Alexander von); NAV-05 is now a rule. Earlier items stay: landmarks, real nav depth, subtitle as a refined title, German section words. Since then: German and Dutch printer lines join the print-only rules; the German style-name table is in `structure/dict.ts`; FIG-02 writes the extended description of a complex figure as a paragraph or a collapsed `<details>` with a localised summary, linked by `aria-describedby` in all three builders. **Left:** the print-only list and the style-name table are built-in code, not a separate locale pack per language. |

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

## Offline EPUBCheck proof (20 Oct 2026)

The `tools` folder of `release/win-unpacked/resources` was copied to a temp folder and run with `PATH` reduced to `System32`, no `JAVA_HOME`, and the Java HTTP proxy pointed at a dead port (127.0.0.1:9), so any network use would have failed. The bundled JRE (Temurin 17.0.20.1) ran the bundled `epubcheck.jar` 5.4.0 on `corrections/_regen_dynamic/book.epub` (Tempelhofer Feld):

```
Validating using EPUB version 3.4 rules.
No errors or warnings detected.
Messages: 0 fatals / 0 errors / 0 warnings / 0 infos
EPUBCheck completed   (exit 0)
```

The temp copy was deleted afterwards. The installer `.exe` itself was not unpacked; `win-unpacked` is what it installs.

## PDF footnotes (20 Oct 2026)

A raised number that pdf.js reads as a line of its own now counts as a note reference and moves back into its line (`notes.ts`, test in `detect.test.ts`). The three reference PDFs have no footnotes, so the real-book check is the unit test only. There is no screenshot tool for the flow in the repo, so no screenshot was taken. The review list now blocks on any item under 0.6 except build messages (`note:`) and untitled parts (`nav:`); an earlier draft of that filter dropped book-detail and section items by mistake (and/or precedence) and was rewritten.

## Branch forge/epub-next (21 Oct 2026)

What the branch adds on top of `main`, by phase:

- **Phase 0:** a GitHub Actions workflow runs the type check, `npm run tools` and the tests on every push. It runs on Windows: the first version used Ubuntu, where the pinned Windows JRE unpacked but `bin/java` was missing, so it could never pass (fixed in the review below).
- **Phase 1:** gate stage 3 reads the common axe/Ace findings straight from the XHTML (`pageRules`: empty links, repeated ids, headerless tables, skipped heading levels) and runs axe-core on every page. Stage 5 is the full Ace by DAISY through a local service. Ace is an **optional download** (`npm run tools:ace`, pinned in `scripts/tools.lock.json`, reinstalled only when the pin changes); without it, or when it fails to write a report, the app falls back to axe-core and says so. How to set it up is in the README under *QA tools*.
- **Phase 2:** `HouseSettings` is generated from the schema table. NOTE-05 note numbers and FM-02 "rebuilt" title page are rules. The PDF builder writes chapter headings through the client's `chapter-title` template. The client `styleMap` is applied in `build()`. Arkano Books (Cambia) is a client file made from the reference EPUB; its one-off paragraph styles are **content rules** (text pattern, layout, least inset), so no `ParaOverride-N` number is in the client file.
- **Phase 5:** `part-title` and `figure` are templated roles beside `chapter-title` and `noteref`; extra attributes (aria-*, data-*) in a sample are read and written. The spec workbook's Styles sheet now carries the content rules too (three more columns) and reads them back.
- **Phase 6:** German and Dutch printer lines join the print-only rules; the German style-name table; FIG-02 extended descriptions (paragraph or collapsed `<details>`).
- **Heading levels:** rule HD-09 (`one` = all h3, as before; `size` = h3/h4/h5 by size rank).
- **PDF footnotes:** an in-memory PDF with 16 footnotes goes through the whole PDF to EPUB build (links both ways, foot lines out of the page text, EPUBCheck clean).

### Review of the branch (21 Oct 2026)

Every commit since the branch left `main` was read again. Five bugs were found and fixed; the first four have tests (the CI change can only be checked on GitHub):

| Bug | Effect | Fix |
|---|---|---|
| `build()` applied the client's `styleMap` over every style | A role or class the reviewer chose on the Structure step for a style the client also names was silently replaced at build | The `styleMap` applies only to styles still as the analysis gave them |
| The first matching `styleMap` rule won | A style remembered "for this book" lost to the client's pattern for the same style | One lookup (`styleRuleFor`): an exact name beats a pattern, and the later layer (book) beats the earlier (client) |
| The gate ran axe-core and the full Ace together | Check & download listed each page finding twice (Ace already runs axe-core) | axe-core runs only when Ace did not |
| `{style}` in a PDF chapter-title template class | Written out literally as `class="{style} …"` | Replaced with the PDF builder's own class, as the InDesign build does |
| CI on Ubuntu | The pinned Windows JRE cannot run there; the job always failed | The job runs on Windows |

Also tightened while doing step 4, not bugs in the earlier commits: the Ace service no longer reports "Ace could not read this file" as an accessibility error when Ace itself failed to start (no headless Chrome, a crash, the time limit); it answers 503 so the app falls back to axe-core. A crash while reading Ace's report no longer leaves the request hanging.

Not changed, noted for later: the PDF builder uses the `chapter-title` template's class on numbered chapters too, while the InDesign builder uses it only on chapters without a label; with STD-03 `div` figures, a figure template with its own class does not get the `image_Container` paragraph the default class gets.

### Checks

On `307bddd` (the last code commit): `npm test` **150 passing, 0 failing, 0 skipped** (772 s; the real Ace by DAISY run took part because `tools/ace` is installed on this machine; without it that one test skips). `npx tsc -p . --noEmit` is clean. The tests added in step 4: content rules round-trip through the Styles sheet (and bad rows are left out); Ace missing or failing falls back to axe-core and never turns the verdict red; axe-core does not run again after Ace; the styleMap keeps the person's choice and the book layer's rule; `{style}` in a PDF chapter template.
