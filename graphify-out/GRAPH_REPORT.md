# Graph Report - src  (2026-10-09)

## Corpus Check
- 62 files · ~78,326 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 377 nodes · 1107 edges · 13 communities
- Extraction: 85% EXTRACTED · 15% INFERRED · 0% AMBIGUOUS · INFERRED: 166 edges (avg confidence: 0.8)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- [[_COMMUNITY_Community 0|Community 0]]
- [[_COMMUNITY_Community 1|Community 1]]
- [[_COMMUNITY_Community 2|Community 2]]
- [[_COMMUNITY_Community 3|Community 3]]
- [[_COMMUNITY_Community 4|Community 4]]
- [[_COMMUNITY_Community 5|Community 5]]
- [[_COMMUNITY_Community 6|Community 6]]
- [[_COMMUNITY_Community 7|Community 7]]
- [[_COMMUNITY_Community 8|Community 8]]
- [[_COMMUNITY_Community 9|Community 9]]
- [[_COMMUNITY_Community 10|Community 10]]
- [[_COMMUNITY_Community 11|Community 11]]

## God Nodes (most connected - your core abstractions)
1. `build()` - 27 edges
2. `settings()` - 19 edges
3. `text()` - 19 edges
4. `checkEpub()` - 18 edges
5. `buildPdfEpub()` - 17 edges
6. `packageEpub()` - 16 edges
7. `analyzePdf()` - 15 edges
8. `esc()` - 14 edges
9. `epubType()` - 13 edges
10. `sectionTypeOf()` - 13 edges

## Surprising Connections (you probably didn't know these)
- `onCheck()` --calls--> `unzip()`  [INFERRED]
  ui/CheckFlow.tsx → engine/zip.ts
- `onCheck()` --calls--> `checkEpubBytes()`  [INFERRED]
  ui/CheckFlow.tsx → engine/check/epub.ts
- `update()` --calls--> `houseSettings()`  [INFERRED]
  ui/SettingsFlow.tsx → engine/settings.ts
- `loadSettings()` --calls--> `setHouseSettings()`  [INFERRED]
  ui/SettingsFlow.tsx → engine/settings.ts
- `update()` --calls--> `setHouseSettings()`  [INFERRED]
  ui/SettingsFlow.tsx → engine/settings.ts

## Communities (13 total, 0 thin omitted)

### Community 0 - "Community 0"
Cohesion: 0.09
Nodes (50): classesOf(), epubType(), esc(), pageBreakOf(), parseXml(), resolvePath(), tag(), textOf() (+42 more)

### Community 1 - "Community 1"
Cohesion: 0.1
Nodes (38): detectLanguage(), pickLanguage(), titleCase(), key(), matchAlt(), readAltDocx(), checkUa(), isPaint() (+30 more)

### Community 2 - "Community 2"
Cohesion: 0.12
Nodes (33): houseSettings(), setHouseSettings(), setSettings(), variantProps(), builtInLabels(), emptyLayer(), layerFromSettings(), resolve() (+25 more)

### Community 3 - "Community 3"
Cohesion: 0.09
Nodes (33): isHousePrintOnly(), formatLike(), transformImprint(), sectionTypeOf(), apply(), bboxOf(), isBoldFont(), mul() (+25 more)

### Community 4 - "Community 4"
Cohesion: 0.14
Nodes (21): bytes(), text(), unzip(), aiConfig(), matchWithAi(), saveAiConfig(), byTag(), readDocx() (+13 more)

### Community 5 - "Community 5"
Cohesion: 0.12
Nodes (24): checkEpub(), checkEpubBytes(), coverDoc(), dedupe(), emptyStats(), group(), recount(), report() (+16 more)

### Community 6 - "Community 6"
Cohesion: 0.12
Nodes (14): rulesFor(), toRGBA(), FileDrop(), Icon(), go(), onAnalyse(), rebuild(), run() (+6 more)

### Community 7 - "Community 7"
Cohesion: 0.15
Nodes (24): htmlLangAttrs(), settings(), zipEpub(), bodyPx(), buildCss(), cellDecls(), emStr(), formatCss() (+16 more)

### Community 8 - "Community 8"
Cohesion: 0.21
Nodes (10): fillMissingPages(), index(), markerRe(), norm1(), fillNumbers(), pageLines(), readPrintPages(), shape() (+2 more)

### Community 9 - "Community 9"
Cohesion: 0.3
Nodes (12): bodyStart(), classifyFront(), detectMeta(), displayPage(), isCaps(), isImprintPage(), linesOf(), nameCase() (+4 more)

### Community 10 - "Community 10"
Cohesion: 0.19
Nodes (4): BrowserStore, layerKey(), MemoryStore, newId()

### Community 11 - "Community 11"
Cohesion: 0.33
Nodes (4): applyFace(), isBold(), isItalic(), StyleSheet

## Knowledge Gaps
- **1 isolated node(s):** `XmlError`
  These have ≤1 connection - possible missing edges or undocumented components.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `text()` connect `Community 4` to `Community 0`, `Community 1`, `Community 5`, `Community 6`?**
  _High betweenness centrality (0.031) - this node is a cross-community bridge._
- **Why does `StyleSheet` connect `Community 11` to `Community 0`?**
  _High betweenness centrality (0.024) - this node is a cross-community bridge._
- **Why does `MemoryStore` connect `Community 10` to `Community 2`?**
  _High betweenness centrality (0.023) - this node is a cross-community bridge._
- **Are the 14 inferred relationships involving `build()` (e.g. with `labelsFor()` and `bodyStart()`) actually correct?**
  _`build()` has 14 INFERRED edges - model-reasoned connections that need verification._
- **Are the 10 inferred relationships involving `settings()` (e.g. with `checkEpub()` and `houseDecls()`) actually correct?**
  _`settings()` has 10 INFERRED edges - model-reasoned connections that need verification._
- **Are the 8 inferred relationships involving `text()` (e.g. with `checkEpub()` and `compareLook()`) actually correct?**
  _`text()` has 8 INFERRED edges - model-reasoned connections that need verification._
- **Are the 8 inferred relationships involving `checkEpub()` (e.g. with `text()` and `extOf()`) actually correct?**
  _`checkEpub()` has 8 INFERRED edges - model-reasoned connections that need verification._