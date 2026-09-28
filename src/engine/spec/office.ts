// Reading and writing the Office files clients send: Excel (.xlsx) and Word (.docx) are zip files of
// XML, so fflate (already used for EPUBs) and the platform XML parser are enough — no extra library,
// and nothing leaves the machine.
import { zipSync } from 'fflate'
import { unzip, text, bytes } from '../zip.ts'

const xe = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const xml = (s: string) => new DOMParser().parseFromString(s, 'application/xml')
const byTag = (el: Document | Element, name: string) => Array.from(el.getElementsByTagName(name))

// ---------------------------------------------------------------------------------------------
// Excel
// ---------------------------------------------------------------------------------------------

export interface Sheet {
  name: string
  rows: string[][]
  /** column widths in characters */
  widths?: number[]
  /** drop-down lists: cell range (e.g. "F2") → allowed values */
  lists?: { ref: string; values: string[] }[]
}

const colName = (i: number): string => (i < 26 ? String.fromCharCode(65 + i) : colName(Math.floor(i / 26) - 1) + String.fromCharCode(65 + (i % 26)))
const colIndex = (ref: string) => [...ref.replace(/\d+$/, '')].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1

/** A workbook with plain text cells, a bold header row, and drop-down lists where given. */
export function writeXlsx(sheets: Sheet[]): Uint8Array {
  const files: Record<string, Uint8Array> = {}
  const put = (p: string, s: string) => (files[p] = bytes(s))
  put('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`)
  put('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`)
  put('xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${xe(s.name.slice(0, 31))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>`)
  put('xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`)
  put('xl/styles.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="3"><xf/><xf fontId="1" applyFont="1"/><xf applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf></cellXfs></styleSheet>`)
  sheets.forEach((s, i) => {
    const rows = s.rows.map((r, ri) =>
      `<row r="${ri + 1}">${r.map((v, ci) => (v === '' ? '' : `<c r="${colName(ci)}${ri + 1}" t="inlineStr" s="${ri === 0 ? 1 : 2}"><is><t xml:space="preserve">${xe(v)}</t></is></c>`)).join('')}</row>`).join('')
    const cols = s.widths?.length ? `<cols>${s.widths.map((w, ci) => `<col min="${ci + 1}" max="${ci + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : ''
    // Excel caps a drop-down list at 255 characters; longer lists are left as free text
    const lists = (s.lists ?? []).filter((l) => l.values.join(',').length < 250 && !l.values.some((v) => v.includes(',')))
    const dv = lists.length ? `<dataValidations count="${lists.length}">${lists.map((l) => `<dataValidation type="list" allowBlank="1" showErrorMessage="1" sqref="${l.ref}"><formula1>"${xe(l.values.join(','))}"</formula1></dataValidation>`).join('')}</dataValidations>` : ''
    put(`xl/worksheets/sheet${i + 1}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${cols}<sheetData>${rows}</sheetData>${dv}</worksheet>`)
  })
  return zipSync(files)
}

/** Every sheet of a workbook as rows of text (numbers and dates as Excel shows their raw value). */
export function readXlsx(data: Uint8Array): Sheet[] {
  const files = unzip(data)
  const wb = files.get('xl/workbook.xml')
  if (!wb) throw new Error('This is not an Excel workbook (.xlsx).')
  const shared = files.get('xl/sharedStrings.xml') ? byTag(xml(text(files.get('xl/sharedStrings.xml')!)), 'si').map((si) => byTag(si, 't').map((t) => t.textContent ?? '').join('')) : []
  const rels = new Map(byTag(xml(text(files.get('xl/_rels/workbook.xml.rels') ?? bytes('<x/>'))), 'Relationship').map((r) => [r.getAttribute('Id') ?? '', r.getAttribute('Target') ?? '']))
  return byTag(xml(text(wb)), 'sheet').map((sh) => {
    const rid = sh.getAttribute('r:id') ?? sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') ?? ''
    const target = (rels.get(rid) ?? '').replace(/^\/?(xl\/)?/, '')
    const doc = files.get(`xl/${target}`)
    const rows: string[][] = []
    if (doc) {
      for (const row of byTag(xml(text(doc)), 'row')) {
        const r = Number(row.getAttribute('r') ?? rows.length + 1) - 1
        const cells: string[] = []
        for (const c of byTag(row, 'c')) {
          const ref = c.getAttribute('r')
          const ci = ref ? colIndex(ref) : cells.length
          const t = c.getAttribute('t')
          const v = byTag(c, 'v')[0]?.textContent ?? ''
          cells[ci] = t === 's' ? (shared[Number(v)] ?? '') : t === 'inlineStr' ? byTag(c, 't').map((x) => x.textContent ?? '').join('') : v
        }
        rows[r] = Array.from(cells, (x) => x ?? '')
      }
    }
    return { name: sh.getAttribute('name') ?? '', rows: Array.from(rows, (x) => x ?? []) }
  })
}

// ---------------------------------------------------------------------------------------------
// Word
// ---------------------------------------------------------------------------------------------

export interface DocBlock {
  text: string
  where: string // "paragraph 4", "table 1, row 3"
  /** table rows: the cells separately */
  cells?: string[]
}

/** Paragraphs and table rows of a .docx, in order, as plain text. */
export function readDocx(data: Uint8Array): DocBlock[] {
  const files = unzip(data)
  const doc = files.get('word/document.xml')
  if (!doc) throw new Error('This is not a Word document (.docx).')
  const body = xml(text(doc)).getElementsByTagName('w:body')[0]
  const out: DocBlock[] = []
  const paraText = (p: Element) => byTag(p, 'w:t').map((t) => t.textContent ?? '').join('').replace(/\s+/g, ' ').trim()
  let pn = 0
  let tn = 0
  for (const el of Array.from(body?.children ?? [])) {
    if (el.tagName === 'w:p') {
      pn++
      const t = paraText(el)
      if (t) out.push({ text: t, where: `paragraph ${pn}` })
    } else if (el.tagName === 'w:tbl') {
      tn++
      byTag(el, 'w:tr').forEach((tr, ri) => {
        const cells = byTag(tr, 'w:tc').map((tc) => byTag(tc, 'w:p').map(paraText).filter(Boolean).join(' '))
        if (cells.some(Boolean)) out.push({ text: cells.filter(Boolean).join(' | '), where: `table ${tn}, row ${ri + 1}`, cells })
      })
    }
  }
  return out
}
