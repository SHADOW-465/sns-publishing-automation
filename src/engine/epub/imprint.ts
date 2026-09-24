// Print imprint → e-book copyright page. Deduced from both reference books:
//  * print-only lines go (legal deposit, printer, typesetter)
//  * the print ISBN is replaced by the e-book ISBN, written in the same style as the print one
//  * English-language publishers add the standard e-book notice and rights statement
//    (Crowood reference); the Spanish reference keeps its print wording.

export const PRINT_ONLY =
  /dep[óo]sito legal|impreso en|printed (in|and bound)|gedruckt|imprim[ée] (en|au|par)|stampato|impresso (em|no)|printed by|typeset by|typesetting by|composici[óo]n|maquetaci[óo]n/i
export const ISBN_LINE = /\bi\.?\s?s\.?\s?b\.?\s?n\b/i
export const PRINT_RIGHTS = /all rights reserved\. no part of this (publication|book)|no part of this (publication|book) may be reproduced/i

export interface CopyrightRules {
  /** inserted before the rights statement, e.g. "This e-book first published in {year}" */
  ebookNotice: string
  /** inserted after the notice, e.g. "© {author} {year}" (skipped when the imprint already has one) */
  copyrightLine: string
  /** replaces the print "no part of this publication may be reproduced…" paragraph (empty = keep) */
  rightsStatement: string
}

export const DEFAULT_RULES: Record<string, CopyrightRules> = {
  en: {
    ebookNotice: 'This e-book first published in {year}',
    copyrightLine: '© {author} {year}',
    rightsStatement:
      'All rights reserved. This e-book is copyright material and must not be copied, reproduced, transferred, distributed, leased, licensed or publicly performed or used in any way except as specifically permitted in writing by the publishers, as allowed under the terms and conditions under which it was purchased or as strictly permitted by applicable copyright law. Any unauthorised distribution or use of this text may be a direct infringement of the author’s and publisher’s rights, and those responsible may be liable in law accordingly.',
  },
  none: { ebookNotice: '', copyrightLine: '', rightsStatement: '' },
}

export const rulesFor = (lang: string) => DEFAULT_RULES[lang.slice(0, 2)] ?? DEFAULT_RULES.none

/** Write `digits` with the same separators as `model` ("978 0 7198 4711 0" → "978 0 7198 4712 7"). */
export function formatLike(digits: string, model: string): string {
  const groups = model.match(/[\dXx]+/g)
  const d = digits.replace(/[^\dXx]/g, '')
  if (!groups || groups.join('').length !== d.length) return digits
  const sep = model.match(/\d([ -])\d/)?.[1] ?? '-'
  let i = 0
  return groups.map((g) => d.slice(i, (i += g.length))).join(sep)
}

export interface ImprintPara {
  html: string
  text: string
  /** vertical space before this paragraph in print */
  gap: boolean
}

export interface ImprintResult {
  paras: { html: string; cls: 'first' | 'tight' | 'spaced' }[]
  removed: string[]
  isbnReplaced: string | undefined
}

export function transformImprint(
  src: ImprintPara[],
  opt: { eisbn: string; eisbnLabel?: string; rules: CopyrightRules; author: string; year: string; esc: (s: string) => string },
): ImprintResult {
  const fill = (t: string) => t.replace(/\{year\}/g, opt.year).replace(/\{author\}/g, opt.author)
  const out: ImprintResult['paras'] = []
  const removed: string[] = []
  let isbnReplaced: string | undefined
  let noticeDone = false
  const addNotice = () => {
    if (noticeDone) return
    noticeDone = true
    if (opt.rules.ebookNotice) out.push({ html: opt.esc(fill(opt.rules.ebookNotice)), cls: 'spaced' })
    const hasCopy = src.some((p) => /^©|^copyright ©/i.test(p.text) && p.text.includes(opt.author))
    if (opt.rules.copyrightLine && !hasCopy) out.push({ html: opt.esc(fill(opt.rules.copyrightLine)), cls: 'spaced' })
  }
  for (const p of src) {
    if (PRINT_ONLY.test(p.text)) {
      removed.push(p.text)
      continue
    }
    if (ISBN_LINE.test(p.text) && /\d{3}/.test(p.text)) {
      if (!isbnReplaced && opt.eisbn) {
        const printNo = p.text.match(/[\d][\d -]{9,16}[\dxX]/)?.[0] ?? ''
        const shown = /[ -]/.test(opt.eisbn) ? opt.eisbn : formatLike(opt.eisbn, printNo)
        // keep the print label ("ISBN", "I.S.B.N.:") unless the language has an e-book label
        const line = opt.eisbnLabel ? `${opt.eisbnLabel}: ${shown}` : `${p.text.slice(0, p.text.indexOf(printNo)).trim() || 'ISBN'} ${shown}`
        out.push({ html: opt.esc(line), cls: p.gap ? 'spaced' : 'tight' })
        isbnReplaced = p.text
      }
      continue
    }
    if (PRINT_RIGHTS.test(p.text) && opt.rules.rightsStatement) {
      addNotice()
      out.push({ html: opt.esc(opt.rules.rightsStatement), cls: 'spaced' })
      continue
    }
    out.push({ html: p.html, cls: out.length === 0 ? 'first' : p.gap ? 'spaced' : 'tight' })
  }
  if (!noticeDone && (opt.rules.ebookNotice || opt.rules.copyrightLine)) {
    // no print rights paragraph to anchor on: notice goes after the address block
    const at = out.findIndex((p, i) => i > 0 && p.cls === 'spaced')
    const before = out.splice(at < 0 ? out.length : at)
    addNotice()
    out.push(...before)
  }
  if (!isbnReplaced && opt.eisbn) out.push({ html: opt.esc(`ISBN ${opt.eisbn}`), cls: 'spaced' })
  return { paras: out, removed, isbnReplaced }
}
