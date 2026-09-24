import { unzipSync, zipSync, strFromU8, strToU8 } from 'fflate'

export type Files = Map<string, Uint8Array>

export function unzip(data: Uint8Array): Files {
  const out: Files = new Map()
  for (const [name, bytes] of Object.entries(unzipSync(data))) {
    if (!name.endsWith('/') && !name.startsWith('__MACOSX/')) out.set(name, bytes)
  }
  return out
}

export const text = (b: Uint8Array) => strFromU8(b).replace(/^﻿/, '')
export const bytes = (s: string) => strToU8(s)

/** EPUB OCF zip: `mimetype` first and stored uncompressed, everything else deflated. */
export function zipEpub(files: Files): Uint8Array {
  const entries: Record<string, [Uint8Array, { level: 0 | 9 }]> = {
    mimetype: [bytes('application/epub+zip'), { level: 0 }],
  }
  for (const [name, data] of files) {
    if (name !== 'mimetype') entries[name] = [data, { level: /\.(jpe?g|png|gif)$/i.test(name) ? 0 : 9 }]
  }
  return zipSync(entries)
}
