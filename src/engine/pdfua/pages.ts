import { PDFDocument, PDFName, PDFArray, PDFDict, PDFRawStream, PDFStream, PDFRef, decodePDFRawStream, PDFNumber, type PDFPage } from 'pdf-lib'
import type { Resources } from './content.ts'

// pdf-lib helpers: read a page's full content (all streams, decoded, as latin1) and its XObjects.

export const latin1 = (b: Uint8Array) => {
  let s = ''
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000))
  return s
}
export const fromLatin1 = (s: string) => {
  const b = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i) & 0xff
  return b
}

export function streamBytes(doc: PDFDocument, s: PDFStream | PDFRef | undefined): Uint8Array {
  const obj = s instanceof PDFRef ? doc.context.lookup(s) : s
  if (obj instanceof PDFRawStream) return decodePDFRawStream(obj).decode()
  if (obj instanceof PDFStream) return (obj as PDFStream & { getContents(): Uint8Array }).getContents()
  return new Uint8Array()
}

export function pageContent(doc: PDFDocument, page: PDFPage): string {
  const c = page.node.get(PDFName.of('Contents'))
  const resolved = c instanceof PDFRef ? doc.context.lookup(c) : c
  if (resolved instanceof PDFArray) return resolved.asArray().map((r) => latin1(streamBytes(doc, r as PDFRef))).join('\n')
  return latin1(streamBytes(doc, resolved as PDFStream))
}

export function pageResources(doc: PDFDocument, page: PDFPage): Resources {
  const res = page.node.Resources()
  const xo = res?.lookupMaybe(PDFName.of('XObject'), PDFDict)
  return {
    xobject(name) {
      const s = xo?.lookup(PDFName.of(name))
      if (!(s instanceof PDFStream)) return undefined
      const sub = s.dict.get(PDFName.of('Subtype'))?.toString()
      const nums = (k: string) => s.dict.lookupMaybe(PDFName.of(k), PDFArray)?.asArray().map((x) => (x instanceof PDFNumber ? x.asNumber() : 0))
      return sub === '/Form' ? { kind: 'form', bbox: nums('BBox'), matrix: nums('Matrix'), text: /BT/.test(latin1(streamBytes(doc, s))) } : { kind: 'image' }
    },
  }
}

/** The trim box in layout coordinates (origin top-left of the crop box); anything outside is slug/bleed. */
export function trimOf(page: PDFPage): { x0: number; x1: number; top: number; bottom: number } {
  const t = page.getTrimBox()
  const c = page.getCropBox()
  const top = c.y + c.height - (t.y + t.height)
  return { x0: t.x - c.x, x1: t.x - c.x + t.width, top, bottom: top + t.height }
}
