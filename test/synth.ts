// A tiny InDesign-style export built in memory, so features can be tested without the client's books.
import { bytes, type Files } from '../src/engine/zip.ts'

/** `body` is the XHTML inside <body>; `css` the idGeneratedStyles.css text. Blocks come out in the order written. */
export function synthExport(body: string, css: string, lang = 'en-GB'): Files {
  const f: Files = new Map()
  f.set('mimetype', bytes('application/epub+zip'))
  f.set('META-INF/container.xml', bytes('<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'))
  f.set('OEBPS/content.opf', bytes(`<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid" xml:lang="${lang}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Sample</dc:title><dc:language>${lang}</dc:language><dc:identifier id="uid">x</dc:identifier></metadata>
<manifest><item id="c" href="css/s.css" media-type="text/css"/><item id="t" href="book.xhtml" media-type="application/xhtml+xml"/></manifest>
<spine><itemref idref="t"/></spine></package>`))
  f.set('OEBPS/css/s.css', bytes(css))
  f.set('OEBPS/book.xhtml', bytes(`<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Sample</title><link rel="stylesheet" href="css/s.css"/></head><body>
${body}
</body></html>`))
  return f
}

export const SYNTH_CSS = `
p.Cuerpo { font-size:1em; text-align:justify; text-indent:17px; margin-top:0; margin-bottom:0; margin-left:0; margin-right:0; font-family:"Serif", serif; }
p.Titulo { font-size:2em; text-align:center; margin-top:0; margin-bottom:0; font-family:"Sans", sans-serif; }
p.Etiqueta { font-size:1.5em; text-align:center; margin-top:0; margin-bottom:0; font-family:"Sans", sans-serif; }
p.Sub { font-size:1.1em; text-align:left; font-weight:bold; margin-top:30px; margin-bottom:15px; font-family:"Sans", sans-serif; }
`

/** A book long enough for the style guesser: chapters with a label, a title and body text. */
export function synthBook(chapters: number, inner: (n: number) => string): string {
  let out = '<p class="Cuerpo">Sample front line to keep the front matter alive. </p>\n'
  for (let n = 1; n <= chapters; n++) {
    out += `<p class="Etiqueta">Chapter ${n}</p>\n<p class="Titulo">Title of chapter ${n}</p>\n${inner(n)}\n`
  }
  return out
}
