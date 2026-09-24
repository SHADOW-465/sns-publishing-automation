import { PDFDocument, PDFName, PDFArray, PDFDict, PDFRef, PDFStream } from 'pdf-lib'
import { tokenize, isPaint } from './content.ts'
import { pageContent, latin1, streamBytes } from './pages.ts'
import type { ReviewItem } from '../epub/package.ts'

// Machine checks from the Matterhorn protocol that PAC runs, re-done on the written file so the
// reviewer sees failures before opening PAC. (PAC itself stays the final, manual check.)

export async function checkUa(pdf: Uint8Array): Promise<ReviewItem[]> {
  const out: ReviewItem[] = []
  const doc = await PDFDocument.load(pdf, { updateMetadata: false })
  const cat = doc.catalog
  const err = (msg: string) => out.push({ level: 'error', msg })
  if (!cat.get(PDFName.of('StructTreeRoot'))) err('No structure tree (untagged PDF).')
  if (cat.lookupMaybe(PDFName.of('MarkInfo'), PDFDict)?.get(PDFName.of('Marked'))?.toString() !== 'true') err('MarkInfo /Marked is not true.')
  if (!cat.get(PDFName.of('Lang'))) err('Document language (/Lang) is missing.')
  if (cat.lookupMaybe(PDFName.of('ViewerPreferences'), PDFDict)?.get(PDFName.of('DisplayDocTitle'))?.toString() !== 'true') err('DisplayDocTitle is not set.')
  if (!doc.getTitle()) err('Document title is missing.')
  const meta = cat.lookupMaybe(PDFName.of('Metadata'), PDFStream)
  const xmp = meta ? latin1(streamBytes(doc, meta)) : ''
  if (!/pdfuaid:part>1</.test(xmp)) err('XMP metadata lacks the PDF/UA identifier (pdfuaid:part).')
  if (!/dc:title/.test(xmp)) err('XMP metadata lacks dc:title.')

  let untagged = 0
  const unembedded = new Set<string>()
  doc.getPages().forEach((page, i) => {
    const src = pageContent(doc, page)
    let depth = 0
    for (const o of tokenize(src)) {
      if (o.op === 'BDC' || o.op === 'BMC') depth++
      else if (o.op === 'EMC') depth--
      else if (isPaint(o.op) && depth <= 0) untagged++
    }
    if (page.node.get(PDFName.of('StructParents')) === undefined) err(`Page ${i + 1} has no StructParents entry.`)
    const annots = page.node.lookupMaybe(PDFName.of('Annots'), PDFArray)
    if (annots?.size() && page.node.get(PDFName.of('Tabs'))?.toString() !== '/S') err(`Page ${i + 1}: tab order is not /S.`)
    for (const a of annots?.asArray() ?? []) {
      const d = a instanceof PDFRef ? doc.context.lookup(a, PDFDict) : (a as PDFDict)
      const sub = d.get(PDFName.of('Subtype'))?.toString()
      if (sub === '/Popup') continue
      if (d.get(PDFName.of('StructParent')) === undefined) err(`Page ${i + 1}: ${sub} annotation is not tagged.`)
      if (sub === '/Link' && !d.get(PDFName.of('Contents'))) err(`Page ${i + 1}: link without a description (/Contents).`)
    }
    // fonts must be embedded
    const fonts = page.node.Resources()?.lookupMaybe(PDFName.of('Font'), PDFDict)
    for (const [name, ref] of fonts?.entries() ?? []) {
      const f = ref instanceof PDFRef ? doc.context.lookup(ref, PDFDict) : (ref as PDFDict)
      const sub = f.get(PDFName.of('Subtype'))?.toString()
      if (sub === '/Type3') continue
      const desc = sub === '/Type0'
        ? (doc.context.lookup(f.lookup(PDFName.of('DescendantFonts'), PDFArray).get(0), PDFDict) as PDFDict).lookupMaybe(PDFName.of('FontDescriptor'), PDFDict)
        : f.lookupMaybe(PDFName.of('FontDescriptor'), PDFDict)
      const embedded = desc && ['FontFile', 'FontFile2', 'FontFile3'].some((k) => desc.get(PDFName.of(k)))
      if (!embedded) unembedded.add(f.get(PDFName.of('BaseFont'))?.toString() ?? name.toString())
    }
  })
  if (untagged) err(`${untagged} drawing operation(s) are neither tagged nor marked as artifacts.`)
  if (unembedded.size) err(`Fonts not embedded (cannot be fixed by tagging — re-export the PDF): ${[...unembedded].join(', ')}`)
  if (!out.length) out.push({ level: 'info', msg: 'Built-in PDF/UA checks passed (tagging, language, title, metadata, annotations, fonts). Run PAC for the final report.' })
  return out
}
