import { PDFDocument, PDFName, PDFArray, PDFDict, PDFRawStream, PDFStream, PDFRef, decodePDFRawStream, PDFNumber, type PDFPage } from 'pdf-lib'
import { tokenize, type Box, type Op, type Resources } from './content.ts'

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

/** A form XObject read once: its operators and whether it draws text. Forms repeat on every page (a page-sized wrapper), so they are cached. */
export type FormCache = Map<PDFStream, { ops: Op[]; text: boolean }>

export function pageResources(doc: PDFDocument, page: PDFPage, cache: FormCache = new Map()): Resources {
  return resourcesOf(doc, page.node.Resources(), cache)
}

function resourcesOf(doc: PDFDocument, res: PDFDict | undefined, cache: FormCache, parent?: PDFDict): Resources {
  const xo = (res ?? parent)?.lookupMaybe(PDFName.of('XObject'), PDFDict)
  const formOf = (s: PDFStream) => {
    let f = cache.get(s)
    if (!f) {
      const src = latin1(streamBytes(doc, s))
      f = { ops: tokenize(src), text: /BT/.test(src) }
      cache.set(s, f)
    }
    return f
  }
  return {
    xobject(name) {
      const s = xo?.lookup(PDFName.of(name))
      if (!(s instanceof PDFStream)) return undefined
      const sub = s.dict.get(PDFName.of('Subtype'))?.toString()
      const nums = (k: string) => s.dict.lookupMaybe(PDFName.of(k), PDFArray)?.asArray().map((x) => (x instanceof PDFNumber ? x.asNumber() : 0))
      return sub === '/Form' ? { kind: 'form', bbox: nums('BBox'), matrix: nums('Matrix'), text: formOf(s).text } : { kind: 'image' }
    },
    form(name) {
      const s = xo?.lookup(PDFName.of(name))
      if (!(s instanceof PDFStream) || s.dict.get(PDFName.of('Subtype'))?.toString() !== '/Form') return undefined
      return { ops: formOf(s).ops, res: resourcesOf(doc, s.dict.lookupMaybe(PDFName.of('Resources'), PDFDict), cache, res ?? parent) }
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

/** The trim box in PDF user space, where the paint boxes of the content stream are (the layout's trim is relative to the crop box). */
export const trimBoxOf = (page: PDFPage): Box => {
  const t = page.getTrimBox()
  return { x0: t.x, y0: t.y, x1: t.x + t.width, y1: t.y + t.height }
}

/** True when the middle of the box lies inside the area (user space). */
export function insideBox(box: Box, area: Box, pad = 2): boolean {
  const cx = (box.x0 + box.x1) / 2
  const cy = (box.y0 + box.y1) / 2
  return cx >= area.x0 - pad && cx <= area.x1 + pad && cy >= area.y0 - pad && cy <= area.y1 + pad
}
