# Client markups of 16/17 Oct 2026: status

Branch `forge/combined` (merge of `forge/epub-dynamic` and `forge/pdfua-fixes`). Nothing is pushed.
Status words: **fixed** (changed, tested, checked on the real book), **partial** (changed, with a stated gap), **not** (not done).

Commits: `d5a5519`, `e83582b`, `b628a35`, `a35b3ba` (earlier PDF/UA work), `31ae0f7` (this round: figures, index, image list), `d11459b` (Word to EPUB), `825929e` (merge).
Tests on the merged branch: **127 run, 127 pass, 0 skipped** (re-run after the Cambia change) (`npm test`, includes the Gladiators and Medium PDF builds and EPUBCheck 5.4.0 on the Word test book).

## What was and was not checked

- `pdf_a` and `pdf_b` are the same book (*Gladiators in the Greek World*): the five screenshots in `pdf_b` are repeats of `pdf_a` 1 to 5. Both were treated as one list.
- The tag tree below is read back with pdf.js (`test/read-tags.ts`), the way assistive technology reads it, from a fresh build of `Simple/Input` (361 pages). No Acrobat and no PAC run was done overnight, so the Acrobat tag panel and the PAC report are still to be looked at by a person.
- Cambia tu mente is an InDesign book; it was run on the real files (see its section). The Word engine has only synthetic tests, because no Word manuscript of it exists on this machine.

## PDF A and PDF B (Gladiators)

| # | Client markup | Status | Evidence |
|---|---|---|---|
| A1 | Alt missing | **fixed**, one input needed | All 30 Figures have alt (0 without). 28 come from the Word alt file. The two logos (p4 publisher, p5 FSC) have no text in the Word file: they get alt typed in the app, the sample runner fills a stand-in. Test `Simple: book + cover image + plates PDF` expects exactly pages 3 and 4 (0-based) without a drafted alt, and the build reports an error if any Figure ends without alt. |
| A2 | Reading order not proper (two H1 with the same title, picture before the title) | **fixed** | `e83582b`. Tags p2 to p4: `p2 P: Gladiators in the Greek World` (half title), `p4 H1: Gladiators in the Greek World`, `P: How A Roman Blood Sport…`, `P: Alexandra Sills`, then `Figure` (logo). One H1 in the book. Tests `one H1 for the book title…`, `Simple…` (`count(tags,'H1') == 1`). |
| A3 | Figure and caption not in order | **fixed** | Plates: every `Figure` is followed by its caption `P` (p354 to p361, 24 pairs, e.g. `Figure` then `P: Relief showing a gladiator fight… Ephesus.`). New in `31ae0f7`: a picture is placed where it stands on the page (before the first line below it; across the columns it splits them) instead of at the first paragraph break. Result: the p4 logo now comes after the author line, as in the hand-made file. Tests `a figure is read where it stands…`, `a figure beside its caption is read figure first…`. |
| A4 | Note not linked / Global: not linked to notes | **fixed** | `b628a35`. 485 `Link [Note n]` in the tree, each in `Reference`, each note number links back. p29: `Link [alt: Note 11]`, `Link [alt: Note 12]`. Test `end notes anywhere…`, and in `Simple…` `p29 … Link … : 12`. |
| A5 | "Link to image" and "Not linked to images at the end of the book (plate)" | **fixed** (a hidden fault was found and fixed) | The list of images (p16 to p17) has 24 entries as `L/LI/Lbl/LBody`, each with a `Link "Go to picture n"`. Before `31ae0f7` only entries 1 to 10 and 24 were read with their text; the rest landed on the right page only by position, and 24 pointed to p357. Fixed: entries are read top to bottom and matched to their plate by caption. Test `Simple…` reads the link annotations and checks that entry n lands on the page of the n-th plate (24 of 24). |
| A6 | Reading order not tagged correctly (note number 12 breaks the line, p29) | **fixed** | The call is a `Link` in `Reference`, in its own paragraph run (tree above), no longer plain text inside the `P`. |
| A7 | Not tagging figure (FSC logo, p5) | **fixed** (default changed) | `31ae0f7`. Logos are Figures by default (`logos: 'artifact'` stays available). `p5 Figure [alt: …]`. A chart big enough stays a chart (the Medium sample still has its 13). Test `a vector logo… is a figure…`. **Decision for you:** a decorative mark can still be set to decorative in the app. |
| A8 | Extra tags or path inside a figure | **fixed** | `b628a35`. Frames, rules and clipping paths are Artifacts: 0 path, clip or paint operators outside marked content in the whole book; maps p13 to p15 hold the picture only. Tests `frames, hairlines…`, `a clipping path outside any sequence…`. Not seen in Acrobat. |
| A9 | Chapter heading H2, sub-head H3 | **fixed** | `e83582b`. `p29 H2: Chapter 1 Arena`, `H3: The Greek Map`. Kept as one switch (`chapterLevel`) for a client that wants H1 chapters. Test `chapters take H2 and subheads H3…`. |
| A10 | List tag structure L / LI / Lbl / LBody | **fixed** | `e83582b`. 693 `Lbl` lines in the tree. p61: `Lbl: •`, `LBody: Lysimachos was a Thessalian general…`. Test `a list marker is split into Lbl…`. Also `31ae0f7`: a wrapped line that is flush with its paragraph no longer splits it (the "Front Cover: … Found / in Kibyra." note on p16 is one paragraph, p61 prose is no longer one P per line). |
| A11 | Index reading order not tagged properly (one P per entry) | **fixed** | `31ae0f7`. Left column, middle, right; one `P` per entry, turnover lines kept with their entry, sub-entries apart. p338: `P: Abdera, 55`, `P: Achaea (province), 60, 305n.129`, `P: Agora, 35–7, 45, 70, 183, 265`, `P: of Aphrodisias (south), 149`. Tests `an index: one paragraph per entry…`, `Simple…`. Index rule is limited to a section whose heading reads as an index. |

## Word to EPUB (Cambia tu mente, `word_epub.txt` / `img_word_epub`), checked on the real book

Correction to my earlier note: Cambia is an InDesign package, so the matching flow is InDesign to EPUB, not the Word engine. The real book (`Input/88228-02 Cambia tu mente.zip` + print PDF + cover, ISBN 9791388228261) was run with `test/run-indd.ts` and compared with the client's hand-finished `Output/Cambia tu mente.epub`. Result: **EPUBCheck 5.4.0, 0 fatals / 0 errors / 0 warnings / 0 infos**; in-app check 57,375 of 57,375 words present, 243 page markers. The Word engine work (`d11459b`) stays as a separate, synthetic-tested feature for real Word manuscripts.

| # | Client markup | Status | Evidence on the real book |
|---|---|---|---|
| W1 | File naming (`part1-3`, `chapterNN`, `intro`, `list`…) | **fixed** | File lists of our EPUB and the reference are identical (27 content files: `app ata bib chapter01-11 concl copyright cover ded glos halftitle intro list nav part1-3 title toc`). |
| W2 | Contents page | **fixed** (one difference removed) | `toc.xhtml` has every entry linked (`toc_1`, `toc_1a`, `toc_2`) as in the reference. One real difference: chapter titles with two small-caps runs were two `<span>`s with a space between (`DESPROGRAMAR</span> <span class="small-caps">LA MENTE`); now one span, as the reference. Change in `indesign/inline.ts` (small-caps runs join across one space). |
| W3 | Page marker inside a paragraph, no stray date text | **fixed** | `page-14` sits inside its list item in `intro.xhtml` as in the reference; no date or time text anywhere. |
| W4 | Bullets as a list | **fixed** | `intro.xhtml`: `<ul class="bull"><li>El 84 por ciento…</li>` ×7, the page marker inside the last `li`, as the reference. Difference left, by client setting: our note call is `<sup><a epub:type="noteref">*</a></sup>`, the reference has the bare `<a>` (the `sup` template is the BeBra client's requirement; Cambia has no client layer shipped). |
| W5 | Table on printed p160 | **fixed** | `chapter08.xhtml` after `page-160`: same 10/10/80 % `colgroup`, same five question rows and wording as the reference. Ours is better: the first row is a `<thead>` with `<th scope="col">` (the reference has `td`). Small differences left: empty cells are `<td></td>` (same meaning as `<td/>`), and two cells carry a variant class (`No-Table-Style2/3`). The two lines under the table ("Sí = 1 punto", "Suma tus puntuaciones:") are `p.indent` here, `p.table-txt`/`table-txt1` in the reference, and the answer list is a `blockquote` with `extract1` against a `div.top` with `extract`: they follow the print paragraph styles' class names, which only the client's own style map can give. |
| W6 | Printed page number 160 | **fixed** | `<span … id="page-160" role="doc-pagebreak" title="página 160"/>` before "Estas respuestas escritas…", same place as the reference. The in-app check notes only printed page 255 with no marker (a blank page). |
| W7 | Valid EPUB | **fixed** | EPUBCheck 0 errors, as above. |

Other differences against the reference seen in the line diff (not on the client's list, left alone): footnotes are wrapped in `div.footnotes` with an `hr` instead of `p.foot-line`; the first paragraph after the list is `Texto_BLANCA-ANTES`; the in-app check lists five paragraphs (p65, 168, 171, 183, 220) with a first-line indent that print does not have.

## Open decisions

1. FSC/publisher logos are now Figures with alt typed by the reviewer. If you prefer them as decoration by default, pass `logos: 'artifact'` in the client's `ua` options.
2. Chapters are H2 under a title H1 (the client's "global change"). A client that wants H1 chapters sets `chapterLevel: 1`.
3. Cambia's paragraph-style class names (`table-txt`, `div.top`, `extract`) and the bare note call need a client style map for Cambia, like the BeBra one; say if you want it written from the reference EPUB.
4. An Acrobat/PAC look at the Gladiators output is still needed for A8 (path tags) before you call it done.
