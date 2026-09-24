// Language of a text from its most common short words — enough to tell the book languages
// apart, and to catch a package that declares the wrong one.

const STOP: Record<string, string[]> = {
  de: ['der', 'die', 'und', 'das', 'ist', 'nicht', 'mit', 'von', 'zu', 'den', 'sich', 'auch'],
  en: ['the', 'and', 'of', 'to', 'is', 'in', 'that', 'was', 'for', 'with', 'as', 'were'],
  es: ['el', 'la', 'que', 'los', 'las', 'y', 'en', 'del', 'por', 'una', 'con', 'se'],
  fr: ['le', 'la', 'les', 'et', 'des', 'est', 'que', 'une', 'dans', 'pour', 'qui', 'sur'],
  it: ['il', 'che', 'di', 'la', 'e', 'per', 'una', 'sono', 'della', 'del', 'con', 'non'],
  pt: ['que', 'não', 'uma', 'os', 'as', 'do', 'da', 'em', 'para', 'com', 'se', 'por'],
  ca: ['el', 'la', 'que', 'els', 'les', 'i', 'amb', 'del', 'per', 'una', 'és', 'als'],
}

export function detectLanguage(text: string): string {
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? []
  const count = new Map<string, number>()
  for (const w of words.slice(0, 20000)) count.set(w, (count.get(w) ?? 0) + 1)
  return Object.entries(STOP).map(([lang, ws]) => [lang, ws.reduce((n, w) => n + (count.get(w) ?? 0), 0)] as const).sort((a, b) => b[1] - a[1])[0][0]
}

/** Of the language codes a file declares, the one matching its text ("en-GB, en-US, es-ES" + Spanish text → es-ES). */
export function pickLanguage(declared: string[], text: string): string {
  const found = detectLanguage(text)
  return declared.find((d) => d.slice(0, 2).toLowerCase() === found) ?? declared.find(Boolean) ?? found
}
