// A small InDesign "Export > EPUB (reflowable)" package, written by hand, that reproduces every case of
// the client's corrections on Cambia tu mente (V2 25-9-26, V3 28-9-26) — so the rules are tested
// without the confidential sample books. Each case is labelled with its row in the V3 document.
import { bytes, type Files } from '../../src/engine/zip.ts'

/** 10×10 PNG header: enough for the image-size reader */
export const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 7, 0xd0, 0, 0, 0x0b, 0xb8])
export const EISBN = '979-13-88228-26-1'

const CSS = `
p.Texto { font-family:"Minion Pro", serif; font-size:0.917em; text-align:justify; text-indent:18px; margin-top:0; margin-bottom:0; }
p.Texto_BLANCA { font-family:"Minion Pro", serif; font-size:0.917em; text-align:justify; text-indent:0px; margin-top:0; }
p.ParaOverride-5 { text-indent:18px; }
p.Texto_BLANCA-BLANCA { font-family:"Minion Pro", serif; font-size:0.917em; text-align:justify; text-indent:18px; margin-top:18px; margin-bottom:18px; }
p.ParaOverride-3 { font-family:"Minion Pro", serif; font-size:0.917em; text-align:left; margin-left:36px; text-indent:-18px; }
p.Antetitulo_SUPER { font-family:"Myriad Pro", sans-serif; font-size:1em; text-align:center; margin-top:60px; }
p.Titulo_SUPER { font-family:"Myriad Pro", sans-serif; font-size:1.667em; text-align:center; margin-bottom:36px; }
p.Antetitulo_PP { font-family:"Myriad Pro", sans-serif; font-size:1.5em; text-align:center; margin-bottom:24px; }
p.Ladillo-2 { font-family:"Myriad Pro", sans-serif; font-size:1em; font-weight:bold; font-variant:small-caps; text-align:left; margin-top:18px; margin-bottom:12px; page-break-after:avoid; }
p.ParaOverride-7 { font-size:1.1em; font-variant:normal; }
p.toc { font-family:"Minion Pro", serif; font-size:0.917em; text-align:left; }
p.Titulo-libro { font-family:"Minion Pro", serif; font-size:2em; text-align:center; }
p.Autor { font-family:"Minion Pro", serif; font-size:1.2em; text-align:center; }
p.Creditos { font-family:"Minion Pro", serif; font-size:0.75em; text-align:left; }
p.Nota { font-family:"Minion Pro", serif; font-size:0.75em; text-align:justify; }
p.Tabla-cabecera { font-family:"Myriad Pro", sans-serif; font-weight:bold; text-align:left; }
p.Tabla-texto { font-family:"Myriad Pro", sans-serif; text-align:left; }
span.Italic { font-style:italic; }
td.No-Table-Style { vertical-align:top; padding-top:4px; }
td.CellOverride-1 { background-color:#d9d9d9; }
col._idGenTableRowColumn-1 { width:40px; }
col._idGenTableRowColumn-2 { width:320px; }
`

const pb = (n: number) => `<span aria-label="${n}" epub:type="pagebreak" id="page_${n}" role="doc-pagebreak"/>`
const LONG = 'Cuando observas tu mente con atención descubres que la mayoría de tus pensamientos se repiten cada día sin que te des cuenta de ello'
const row = (cells: string[], head = false) =>
  `<tr>${cells.map((c) => `<td class="No-Table-Style${head ? ' CellOverride-1' : ''}"><p class="${head ? 'Tabla-cabecera' : 'Tabla-texto'}">${c}</p></td>`).join('')}</tr>`

const BODY = `
<div>
${pb(1)}
<p class="Titulo-libro">Cambia tu mente</p>
${pb(3)}
<p class="Titulo-libro">Cambia tu mente</p>
<p class="Autor">RJ Spina</p>
${pb(4)}
<p class="Creditos">© 2026, RJ Spina</p>
<p class="Creditos">ISBN: 979-13-88228-02-5</p>
<p class="Creditos">Todos los derechos reservados.</p>
${pb(9)}
<p class="Antetitulo_PP">Índice</p>
<p class="toc">Lista de ejercicios\t11</p>
<p class="toc">Capítulo 1. Qué es tu mente\t13</p>
<p class="toc">Capítulo 2. Hábitos del falso Yo\t17</p>
${pb(10)}
<p class="toc">Capítulo 3. Tu Yo auténtico\t19</p>
${pb(11)}
<p class="Antetitulo_PP">Lista de ejercicios</p>
<p class="toc">Ejercicio: el cepillo\t14</p>
${pb(12)}
<p class="toc">Ejercicio: llorar\t18</p>
${pb(13)}
<p class="Antetitulo_SUPER">Capítulo 1</p>
<p class="Titulo_SUPER">Qué es tu mente</p>
<p class="Texto">${LONG}, y ese es el primer paso para cambiar.<a class="_idFootnoteLink _idGenColorInherit" href="#footnote-001" id="footnote-001-backlink">*</a></p>
<p class="Ladillo-2">Hábito 1: Ser</p>
<p class="Texto">${LONG}, y así empieza el trabajo interior.</p>
${pb(14)}
<p class="Ladillo-2">Ejercicio: el cepillo</p>
<p class="Texto">En primer lugar, escribe tu acción o conducta. ${LONG}.</p>
<p class="ParaOverride-3"><span class="Italic">Pregunta</span>: ¿Por qué me estoy cepillando el pelo?</p>
<p class="ParaOverride-3"><span class="Italic">Respuesta</span>: Para que tenga buen aspecto.</p>
<p class="Texto_BLANCA-BLANCA">La primera respuesta será una justificación, no la motivación nuclear. ${LONG}.</p>
<table class="No-Table-Style" id="table009">
<colgroup><col class="_idGenTableRowColumn-1"/><col class="_idGenTableRowColumn-1"/><col class="_idGenTableRowColumn-2"/></colgroup>
<tbody>
${row(['Sí', 'No', 'Pregunta'], true)}
${row(['', '', '¿Me siento vacío/cansado/agotado?'])}
${row(['', '', '¿Me siento bajo de ánimo o deprimido?'])}
</tbody>
</table>
${pb(15)}
<p class="Texto">${LONG}, y termina el capítulo.</p>
${pb(17)}
<p class="Antetitulo_SUPER">Capítulo 2</p>
<p class="Titulo_SUPER">Hábitos del falso Yo</p>
<p class="Texto">${LONG}, dice el maestro.</p>
<p class="Texto">«Mi poder y mi independencia se elevan,</p>
<p class="Texto">Mi <span class="Versalita">yo soy</span> ruge: “¡Se acabaron los disfraces!”».</p>
<p class="Ladillo-2">Hábito 2: Tener</p>
<p class="Texto_BLANCA ParaOverride-5">Se volvió hacia mí y sonrió mientras los perros ladraban y jugaban en el agua. ${LONG}.</p>
<p class="Texto_BLANCA ParaOverride-5">Y luego me mostró otra sección. ${LONG}.</p>
<p class="Texto_BLANCA">—Asombroso, Gary. ${LONG}.</p>
<p class="Texto_BLANCA ParaOverride-5">Otra vez la misma idea. ${LONG}.</p>
${pb(18)}
<p class="Ladillo-2 ParaOverride-7">Hábito 5: Buscar seguridad</p>
<p class="Ladillo-2">Ejercicio: llorar</p>
<p class="Texto">${LONG}, y ahí termina.</p>
${pb(19)}
<p class="Antetitulo_SUPER">Capítulo 3</p>
<p class="Titulo_SUPER">Tu Yo auténtico</p>
<p class="Texto">${LONG}, fin del libro.</p>
</div>
<div class="_idFootnotes">
<aside class="_idFootnote" epub:type="footnote" id="footnote-001"><p class="Nota"><a class="_idFootnoteAnchor _idGenColorInherit" href="#footnote-001-backlink">*</a> Este capítulo está tomado de una conferencia que realicé en vivo.</p></aside>
</div>`

const CSS_EXTRA = `span.Versalita { font-variant:small-caps; }\n`

export function indesignExport(): Files {
  const xhtml = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="es-ES" lang="es-ES">
<head><title>Cambia tu mente</title><link href="../Styles/idGeneratedStyles.css" rel="stylesheet" type="text/css"/></head>
<body id="book">${BODY}</body>
</html>`
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" xml:lang="es-ES" unique-identifier="bookid">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>88228-02 Cambia tu mente</dc:title><dc:language>es-ES</dc:language><dc:identifier id="bookid">urn:uuid:1</dc:identifier></metadata>
<manifest>
<item id="css" href="Styles/idGeneratedStyles.css" media-type="text/css"/>
<item id="text" href="Text/book.xhtml" media-type="application/xhtml+xml"/>
</manifest>
<spine><itemref idref="text"/></spine>
</package>`
  return new Map([
    ['mimetype', bytes('application/epub+zip')],
    ['META-INF/container.xml', bytes('<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>')],
    ['OEBPS/content.opf', bytes(opf)],
    ['OEBPS/Styles/idGeneratedStyles.css', bytes(CSS + CSS_EXTRA)],
    ['OEBPS/Text/book.xhtml', bytes(xhtml)],
  ])
}
