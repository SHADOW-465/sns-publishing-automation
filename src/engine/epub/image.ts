/** Width/height from PNG/JPEG/GIF headers (no decoding). 0×0 when unknown. */
export function imageSize(b: Uint8Array): { width: number; height: number } {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength)
  if (b[0] === 0x89 && b[1] === 0x50) return { width: dv.getUint32(16), height: dv.getUint32(20) }
  if (b[0] === 0x47 && b[1] === 0x49) return { width: dv.getUint16(6, true), height: dv.getUint16(8, true) }
  if (b[0] === 0xff && b[1] === 0xd8) {
    let i = 2
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) return { width: 0, height: 0 }
      const marker = b[i + 1]
      const len = dv.getUint16(i + 2)
      // SOF0..SOF15 except DHT(C4), JPG(C8), DAC(CC)
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
        return { width: dv.getUint16(i + 7), height: dv.getUint16(i + 5) }
      i += 2 + len
    }
  }
  return { width: 0, height: 0 }
}

export const mediaType = (path: string) =>
  /\.png$/i.test(path) ? 'image/png' : /\.gif$/i.test(path) ? 'image/gif' : /\.svg$/i.test(path) ? 'image/svg+xml' : /\.webp$/i.test(path) ? 'image/webp' : 'image/jpeg'

/** File extension from the bytes, not the name: a PNG uploaded as "cover.jpg" must be stored as .png. */
export function extOf(b: Uint8Array): 'png' | 'gif' | 'jpg' | 'svg' | 'webp' | '' {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png'
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg'
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'gif'
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return 'webp'
  const head = new TextDecoder().decode(b.subarray(0, 300))
  if (/<svg[\s>]|<\?xml/.test(head)) return 'svg'
  return ''
}

/** Same path with the extension that matches the bytes. */
export const withRealExt = (path: string, data: Uint8Array) => {
  const e = extOf(data)
  return e ? path.replace(/(\.[a-z0-9]+)?$/i, '.' + e) : path
}
