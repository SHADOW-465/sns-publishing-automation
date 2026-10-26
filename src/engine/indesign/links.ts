// Linked originals: an InDesign package (a folder or a zip) may hold the pictures themselves in a Links folder.
// They are the sharpest source there is, so a picture of the export is looked up there first, by its base name, ignoring
// case and file type (Foo.JPG, foo.tif, foo.jpeg), and only then taken from the print PDF.
import type { Files } from '../zip.ts'
import { extOf } from '../epub/image.ts'
import { normaliseEpubImage } from '../epub/image-spec.ts'

export interface LinksUsed {
  /** export picture path → the Links file it was taken from */
  used: Map<string, string>
  /** export picture path → a Links file of that name this tool cannot read (TIFF, PSD, AI, EPS, PDF): the picture comes from the print PDF instead */
  unreadable: Map<string, string>
}

const norm = (p: string) => p.replace(/\\/g, '/')
const stemOf = (p: string) => (norm(p).split('/').pop() ?? p).replace(/\.[a-z0-9]+$/i, '')
/** "Ha Giang 6" and "Ha_Giang_6" are one name: InDesign turns spaces and marks into underscores when it exports */
const key = (p: string) => stemOf(p).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
const IS_LINK = /(^|\/)links\/[^/].*\.(jpe?g|png|gif|tiff?|psd|ai|eps|pdf|bmp|webp)$/i

/** The files of every Links folder in the package, at any depth, by name. AppleDouble and system files are not pictures. */
export function linkFiles(files: Files): Map<string, { path: string; data: Uint8Array }[]> {
  const out = new Map<string, { path: string; data: Uint8Array }[]>()
  for (const [path, data] of files) {
    const p = norm(path)
    if (!IS_LINK.test(p) || /(^|\/)(\._|\.DS_Store|Thumbs\.db)/i.test(p) || /(^|\/)__MACOSX\//.test(p) || !data.length) continue
    const k = key(p)
    out.set(k, [...(out.get(k) ?? []), { path, data }])
  }
  return out
}

/**
 * Replace the pictures of `images` by their originals from the package's Links folder: long side capped, RGB JPEG
 * (the picture spec). Files this tool cannot decode are listed so their pictures are taken from the print PDF and the
 * person is told. Changes `images`; returns what was done.
 */
export function adoptLinks(files: Files, images: Map<string, Uint8Array>, except?: string): LinksUsed {
  const res: LinksUsed = { used: new Map(), unreadable: new Map() }
  const index = linkFiles(files)
  if (!index.size) return res
  for (const src of images.keys()) {
    if (src === except) continue
    const found = index.get(key(src))
    if (!found) continue
    const readable = found.filter((f) => ['jpg', 'png'].includes(extOf(f.data))).sort((a, b) => b.data.length - a.data.length)
    if (readable.length) {
      images.set(src, normaliseEpubImage(readable[0].data))
      res.used.set(src, readable[0].path)
    } else res.unreadable.set(src, found[0].path)
  }
  return res
}
