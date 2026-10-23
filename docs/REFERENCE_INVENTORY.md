# Reference inventory

The client’s real example inputs and finished outputs live in `pdf-tagger-sns/Automation`. That folder is read-only. A copy used by the scorer sits in `fixtures/reference/Automation`, which is listed in `.gitignore`, so the client files never enter git. If `SNS_AUTOMATION` is set, the scorer reads that path instead.

## Excluded file

`Indesin-to-EPUB-Automation/Input/OEBPS/88228-02_Cambia_tu_mente.xhtml` is excluded.

It is a loose extract beside the InDesign zip, dated 23 September 2026. The same file inside `88228-02 Cambia tu mente.zip`, and the other files extracted next to it, are dated 2 September 2026. The loose file is 529,354 bytes; the zip member is 529,365 bytes. They differ in the chapter 8 heading: the zip has a well-formed span (`Equilibra tu cuenta bancaria de energía`), and the loose file has broken markup (`E` plus a `small` span and `De energía`). That is the file edited while testing. The harness uses the zip.

Two other copies were checked and kept:

- `9780719847127.rar` (23 September 2026, 223,588,595 bytes) is a later pack of the ceramics EPUB. The `.epub` and the inner zip are both 22 August 2026 and 223,588,413 bytes. The rar was not opened. The EPUB is the ground truth.
- The loose `OEBPS` at the Automation root is the unpacked `La cara oculta de la presidenta_Grijalbo.zip` and matches that zip. It is an input with no finished output, so it is not a scored pair.
- `Output/New folder` under the Cambia job matches `Cambia tu mente.epub` on the files that were compared (chapter 2, package, nav, ncx, copyright). The EPUB is the scored output.

## Pairs

### InDesign to accessible EPUB

| Role | File |
| --- | --- |
| Input | `Indesin-to-EPUB-Automation/Input/88228-02 Cambia tu mente.zip` |
| Input | `Indesin-to-EPUB-Automation/Input/88228-02 Cambia tu mente.pdf` (printed pages) |
| Output | `Indesin-to-EPUB-Automation/Output/Cambia tu mente.epub` |

Publisher Arkano. Output type Accessible EPUB. ISBN used by the scorer: 979-13-88228-26-1.

`La cara oculta de la presidenta_Grijalbo.zip` at the Automation root is an InDesign export with no finished EPUB beside it. It is not scored.

### Print PDF to standard EPUB

| Role | File |
| --- | --- |
| Input | `WORD-to-EPUB-Automation/Input/Contemporary_Ceramics_Final.pdf` |
| Input | `WORD-to-EPUB-Automation/Input/Contemporary_Ceramics_Final.doc` (not used by the PDF pipeline) |
| Input | `WORD-to-EPUB-Automation/Input/9780719847110_Contemporary Ceramics_FAW.pdf` (cover spread) |
| Output | `WORD-to-EPUB-Automation/Output/9780719847127.epub` |

Publisher Crowood. Output type Standard EPUB. The unpacked `9780719847127/` tree is the same book as the EPUB.

### Accessible PDF, simple

| Role | File |
| --- | --- |
| Input | `Accessible-PDF-Automation/Simple/Input/Gladiators in the Greek World.pdf` |
| Input | `Accessible-PDF-Automation/Simple/Input/cover.jpg` |
| Input | `Accessible-PDF-Automation/Simple/Input/Gladiators in the Greek World alt text.docx` |
| Input | `Accessible-PDF-Automation/Simple/Input/Gladiators in the Greek World_Plates.pdf` |
| Output | `Accessible-PDF-Automation/Simple/Output/Gladiators in the Greek World_9781036130527.pdf` |
| Check | the PAC report beside that PDF |

### Accessible PDF, medium

| Role | File |
| --- | --- |
| Input | `Accessible-PDF-Automation/Medium/Input/DD_Evers-Woelk_2124-6.pdf` |
| Input | `Accessible-PDF-Automation/Medium/Input/AltTexte MEW.docx` |
| Output | `Accessible-PDF-Automation/Medium/Output/DD_Evers-Woelk_2124-6.pdf` |
| Check | the PAC report beside that PDF |

There is no structural EPUB score for these two. The existing PDF/UA tests in `test/pdfua.test.ts` assert the behaviours those outputs show (page count, one FSC figure, index lines kept as paragraphs, image-list links).

## What the finished files decide

- Cambia (accessible) uses real headings, a page list, text on the title page, language, and accessibility metadata in the package.
- Ceramics (standard) writes a chapter as one heading, class `ch-head1`, with `ch-num` and `ch2` inside it. The heading is left-aligned serif, not centred, and not split into two plain paragraphs.
- Ceramics chapter headings use about 2em of space below. The house default stays 3em until a client layer sets otherwise, because shrinking it was not checked against Cambia.
- Gladiators bookmarks the appended plates as `Plate` (one word, singular).
- Index entries in the accessible PDF stay paragraphs. Page numbers are locators after a comma. `305n.129` points at page 305. Whether `n.129` should jump to the note is still a client question.
- A logo drawn from many paths is one figure.

Where a 23 October correction sheet disagrees with these files, the files win. The conflicts are listed in `docs/CONSOLIDATION_REPORT.md`.
