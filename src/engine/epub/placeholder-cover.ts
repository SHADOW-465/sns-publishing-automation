// A plain cover for a book built before its real cover was added. The build needs a cover image; a missing one must not stop the
// export. The review notes say a placeholder was used.
import UPNG from 'upng-js'

export const PLACEHOLDER_COVER_NAME = 'cover-placeholder.png'

/** A solid dark-blue PNG, 600×900. */
export function placeholderCover(w = 600, h = 900): { name: string; data: Uint8Array } {
  const rgba = new Uint8Array(w * h * 4)
  for (let i = 0; i < rgba.length; i += 4) rgba.set([0x2b, 0x3a, 0x55, 0xff], i)
  return { name: PLACEHOLDER_COVER_NAME, data: new Uint8Array(UPNG.encode([rgba.buffer], w, h, 0)) }
}
