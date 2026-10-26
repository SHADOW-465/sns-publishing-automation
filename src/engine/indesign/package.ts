// The InDesign export as the client sends it: the .epub, the same unzipped (a folder), or a .zip of either, with or without a
// Links folder beside it. Whatever the shape, the engine reads one structure: container.xml, the package and its files at the
// root, everything else (the Links folder) kept at its own relative path.
import { zipSync } from 'fflate'
import { unzip, type Files } from '../zip.ts'

/** Files of the system that are not part of the book. */
const JUNK = /(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini|__MACOSX)(\/|$)|(^|\/)\._[^/]*$/i

const CONTAINER = 'META-INF/container.xml'

/**
 * A folder, read in memory, as the Files the .epub path reads. `path` is relative to the chosen folder (a browser gives the
 * folder's own name first: it is dropped when everything sits in it). Directories and system files are left out.
 */
export function packFolder(entries: { path: string; data: Uint8Array }[]): Files {
  const clean = entries.map((e) => ({ ...e, path: e.path.replace(/\\/g, '/').replace(/^\/+/, '') })).filter((e) => e.path && !e.path.endsWith('/') && !JUNK.test(e.path))
  const first = new Set(clean.map((e) => e.path.split('/')[0]))
  const strip = first.size === 1 && clean.every((e) => e.path.includes('/'))
  return new Map(clean.map((e) => [strip ? e.path.slice(e.path.indexOf('/') + 1) : e.path, e.data]))
}

/** The same files as one zip held in memory (stored, not compressed: it is read again at once), for the slot that takes a file. */
export const zipFiles = (files: Files): Uint8Array => zipSync(Object.fromEntries(files), { level: 0 })

/**
 * Bring the export to the root. A zip made on a Mac holds the export inside a folder; a package may hold the .epub itself
 * beside its Links folder. The export's own files win over anything outside it that has the same path.
 */
export function rootExport(files: Files): Files {
  const container = [...files.keys()].filter((k) => k === CONTAINER || k.endsWith('/' + CONTAINER)).sort((a, b) => a.length - b.length)[0]
  if (container === CONTAINER) return files
  if (container) {
    const prefix = container.slice(0, container.length - CONTAINER.length)
    const out: Files = new Map()
    for (const [k, v] of files) if (!k.startsWith(prefix)) out.set(k, v)
    for (const [k, v] of files) if (k.startsWith(prefix)) out.set(k.slice(prefix.length), v)
    return out
  }
  const epub = [...files].filter(([k]) => /\.epub$/i.test(k)).sort((a, b) => b[1].length - a[1].length)[0]
  if (!epub) return files
  const out: Files = new Map([...files].filter(([k]) => k !== epub[0]))
  for (const [k, v] of unzip(epub[1])) out.set(k, v)
  return out
}
