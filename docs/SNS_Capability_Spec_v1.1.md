# SNS Capability Specification: changes in version 1.1

Version 1.1, 31 October 2026. This file holds the sections of `SNS_Capability_Spec` (v1.0, 27 October 2026, `EPUB_output/SNS_Capability_Spec.docx`, not in git) that v1.1 replaces: **§1.3 principle 1**, **§4.3**, and the prompts **P4, P5 and P9** in §6.3. Every other section of v1.0 stands. The design behind these changes is `EPUB_output/OPUS_DESIGN2.md` §b (Showmik's decision that the AI does change structure); the code is the authority, and `test/spec-v1-1.test.ts` fails when this file and the code disagree.

New rule IDs are `SPEC-AI-nn`. Each names the task that built it: **T12** (`src/engine/pdf/decision.ts`, the override layer that applies the ops) or **T13** (`src/engine/pdf/validate.ts`, the validator), and for the cache, rounds and audit trail **T15** (`page-cache.ts`), **T16** (`page-rounds.ts`) and **T18** (`review/decisions.ts`).

## 1.3 Design principles the agent must keep (principle 1 replaced)

1. **Same input, same output; the model proposes, the engine decides.** Tag tree, reading order, links, page markers, file names, classes and CSS are written by the engine and by nothing else. The model never writes a tag tree, CSS or XHTML. On a flagged PDF page it may return typed edit instructions (ops) on the engine's block IDs, the same edits staff make by hand in the tag tree: reorder, retag, split, merge, continue, group picture pieces, link a caption (SPEC-AI-01). The engine checks every op (SPEC-AI-02 to SPEC-AI-05), applies those that pass, rebuilds and re-validates, and records each op, applied or not (SPEC-AI-08). **No op changes a word** (SPEC-AI-03). The answer of a page is cached, so a rebuild gives the same output without asking again (SPEC-AI-07). Outside the page reader, AI is used only for judgement tasks: picture descriptions, decorative-or-meaningful suggestions, ambiguous style roles, and drafting the requirement mapping.

Principles 2 to 6 of v1.0 are unchanged. Principle 5 still holds: the client's files never mention AI; the audit trail below is for staff.

## 4.3 What AI may and may not decide (replaced)

| Task | AI? | Source |
|---|---|---|
| Validation verdicts | No. The validators are the authority | CORRECTIONS §3 |
| The words of the book (no op adds, removes or rewrites a character) | No, never | SPEC-AI-03 (T13) |
| Links, bookmarks, page markers, file names, classes, CSS, list/table/index structure, MCID grouping | No. Deterministic rules | CORRECTIONS §3 |
| Reading order of a flagged page | Proposes `order`; applied only if the guards pass, and a big change to a sure engine order needs a second opinion | SPEC-AI-01, SPEC-AI-05 (T12, T13) |
| Role of a block, heading level, caption, split, merge, continuation, picture grouping, caption link | Proposes ops on block IDs; the engine applies those that pass the guards | SPEC-AI-01, SPEC-AI-04 (T12, T13) |
| Heading levels across the book | Page answers propose roles; one deterministic pass gives one level per look; a 50/50 look gets one text-only call (P5), then a person | SPEC-AI-06 (T13) |
| Artifacts | Only in the top or bottom band, repeated on 3 pages or more, or ornaments; else a review item for a person | SPEC-AI-04 (T13) |
| Picture descriptions | Draft only; approval needed before any claim | IMG-003, A11M-006 |
| Decorative or meaningful | Suggest only; per-client default | PAR-004, OQ-12 |
| Ambiguous style role (InDesign, Word) | Suggest only (top-2 labels); the answer is remembered per client | CORRECTIONS §3 |
| Mapping a client requirement document to rule IDs | Optional, human-confirmed with its source row | spec/ai.ts |

A person's decision for a page always beats the model's, on the same page key, including on later rebuilds (SPEC-AI-07).

### Rules added by v1.1

**SPEC-AI-01 (T12, `src/engine/pdf/decision.ts`). Allowed ops.** The page answer is `{page, ops, confidence, reasons}`; each op is one of `order`, `role`, `split`, `merge`, `continues`, `figure`, `caption`, `none`, on block IDs `p<page>.<kind><n>` that do not change with the engine's order. Roles are `P`, `H1`, `H2`, `H3`, `H4`, `H5`, `H6`, `Caption`, `Note`, `Artifact`, `Aside`, `LI`, `TOCI`, `BlockQuote`. An op carries no field other than its own. The same ops are applied in PDF/UA and in PDF → EPUB; no decisions gives byte-identical output.

**SPEC-AI-02 (T13, `src/engine/pdf/validate.ts`). Reference checks.** Every ID exists on the page (`continues.from` may be on the page before). `order` lists every non-artifact block once, after the answer's splits, merges and artifacts. An op that fails is dropped on its own and listed with its reason in plain words; the reasons go back to the model on a retry.

**SPEC-AI-03 (T13). Conservation (hard).** After the ops are applied to a copy of the page, the characters of the output (whitespace normalised) equal the characters of the page. If not, the whole answer is dropped and the page keeps the engine version.

**SPEC-AI-04 (T13). Rule guards.** `Artifact` only for a block in the top or bottom 8% of the page, repeated on 3 pages or more, or an ornament; otherwise the op becomes a review item. A running head is always an artifact (`uaRunningHeads = artifact`). `H1` to `H6` is refused for a block over 25 words, a URL line, or a block inside a figure (PHD-005, PHD-007). `Caption` only within 3 em of a figure or on a figure label. `split` at a line boundary inside the block. `merge` only blocks adjacent in the page order and in the proposed order. `figure` pieces within the union box grown by 2 em, and no body-size prose among them. `order` keeps a caption after its figure (`captionIn = after`) and a note after the paragraph that holds its call.

**SPEC-AI-05 (T13). Geometry sanity.** If Kendall's tau between the proposed order and the engine order is under 0.5 and the engine's confidence was 0.85 or more, the order is applied only if a second opinion agrees (tau 0.8 or more). If not, the engine order stays and the page is listed as left.

**SPEC-AI-06 (T13). Headings are reconciled across the book.** Same look, same level (PHD-008); the majority of the page proposals wins; the instruction's `heading_map` beats the majority; levels never skip (PHD-004).

**SPEC-AI-07 (T15, `src/engine/pdf/page-cache.ts`; T16, `src/engine/pdf/page-rounds.ts`). Cache, retries and revert.** The page answer is stored at `cache/ai/<bookHash>/<pageKey>.json` under a key of the page, the model, the prompt and the rule set; `--replay` answers only from the cache and fails on a miss. A page is asked at most 3 times per round and a book has at most 3 rounds, with 60 seconds per ask. A page whose edits raise the book's error count, or lower a reference-score dimension, is reverted. A model server that is down means no edits: the build completes and the pages are listed as left.

**SPEC-AI-08 (T18, `src/engine/review/decisions.ts`). Audit.** Every op of the page reader is written once to REVIEW_NOTES, under "Structure corrected by the page reader", and once to `<epub-basename>_DECISIONS.jsonl` with its page, page key, model, op, before, after, validator result, rule ID and status (`applied`, `refused` or `reverted`). Both are for staff and are not sent to the client.

## 6.3 Per-tool judgement prompts (P4, P5 and P9 replaced)

The page reader's system prompt is generated (frame + the `prompt_text` of the rule cards that apply to the page's flags + worked examples, `src/engine/pdf/prompt.ts`); P4, P5 and P9 below are its starting frames. All three return the ops of SPEC-AI-01 on the engine's block IDs, or a level per look; none returns text.

### P4. Reading-order adjudicator (a flagged PDF page)

```
SYSTEM: You fix the reading order and the roles of one printed page. Reply with one JSON object that follows the schema, and nothing else.
USER: Page {page} of {book}. Layout JSON: {layout_json} (blocks with id, kind, bbox, role, style, lines, text, flags; engineOrder; engineConfidence). Page image attached. Rules that apply: {numbered rule lines}.
Return: {"page":n,"ops":[{"op":"order","ids":["block ids in reading order"]},{"op":"role","id":"...","role":"Artifact"},{"op":"split",...},{"op":"merge",...},{"op":"continues",...},{"op":"figure",...},{"op":"caption",...}],"confidence":0-1,"reasons":[{"op":i,"why":"...","rule":"PRO-001"}]}
Rules (SPEC-RO-01): columns top-to-bottom, left-to-right; a full-width heading, figure or table splits the columns; a figure comes before the first line below its top edge and its caption follows it; a side box follows the paragraph it is anchored to; footnotes follow the paragraph with the call; running heads, folios and slug lines are Artifact. List every block that is not an artifact exactly once in "order". Use only the IDs in the layout JSON. Never write, change or remove text. If the engine is right, return {"op":"none"} only.
```

### P5. Heading-level adjudicator (a look the pages split on)

```
SYSTEM: You settle heading levels for a whole book. Each cluster is one typographic look; its page proposals split between levels. Reply with one JSON object that follows the schema, and nothing else. You never write or change text.
USER: Clusters (key, font, size, weight, case, sample texts, pages, votes per level): {clusters}. Client layer: chapterLevel={1|2}, title H1 once.
Return: {"levels":[{"key":"cluster key","level":1-6}]}
Rules: choose, for each cluster, the one level it should have everywhere, among the levels it has votes for; same look = same level (PHD-008); a chapter label and its title share a level (PHD-002); levels never skip (PHD-004). URL lines, bio sentences and diagram labels are P, never headings (PHD-005, PHD-007).
```

The engine lays the answer on every block of the look as `role` ops (SPEC-AI-06). A look the call does not answer goes to a person, and the engine keeps its reading of it.

### P9. Table reconstruction checker

The op schema has no table op: a table is built by the engine (TBL-001 to TBL-007, SPEC-TBL-01), and the model can only fix what its blocks and lines say. P9 therefore returns ops for what an op can fix, and review items for the rest.

```
SYSTEM: You check a table rebuilt from a printed page. Reply with one JSON object that follows the schema, and nothing else.
USER: Page image crop attached. Layout JSON of the region: {layout_json}. Rebuilt HTML: {table_html}.
Return: {"ops":[{"op":"merge","ids":["block ids of one cell split in two"]},{"op":"split","id":"...","atLine":"...","roles":["P","P"]},{"op":"role","id":"...","role":"P"},{"op":"order","ids":[...]}],"review":[{"kind":"merged-cells|missing-row|missing-column|wrong-header|misaligned-number|rotated","where":"row r col c","why":"..."}],"confidence":0-1}
Rules: each number in its own cell; header rows are those set apart by weight, rule or font; spanning headers become colspan. Anything an op cannot fix goes in "review" for a person; the table is not changed for it. Use only the IDs in the layout JSON. Do not add or change any text (SPEC-AI-03, SPEC-TBL-01).
```
