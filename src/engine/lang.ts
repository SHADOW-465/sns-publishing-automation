// Language of a text from its most common short words — enough to tell the book languages
// apart, and to catch a package that declares the wrong one. Scripts that name their language
// on their own (Greek, Hebrew, Han…) are read from the letters; the Cyrillic and Arabic scripts
// are shared by several languages, so their letters and common words decide between them.

const STOP: Record<string, string[]> = {
  de: ['der', 'die', 'und', 'das', 'ist', 'nicht', 'mit', 'von', 'zu', 'den', 'sich', 'auch'],
  en: ['the', 'and', 'of', 'to', 'is', 'in', 'that', 'was', 'for', 'with', 'as', 'were'],
  es: ['el', 'la', 'que', 'los', 'las', 'y', 'en', 'del', 'por', 'una', 'con', 'se'],
  fr: ['le', 'la', 'les', 'et', 'des', 'est', 'que', 'une', 'dans', 'pour', 'qui', 'sur'],
  it: ['il', 'che', 'di', 'la', 'e', 'per', 'una', 'sono', 'della', 'del', 'con', 'non'],
  pt: ['que', 'não', 'uma', 'os', 'as', 'do', 'da', 'em', 'para', 'com', 'se', 'por'],
  ca: ['el', 'la', 'que', 'els', 'les', 'i', 'amb', 'del', 'per', 'una', 'és', 'als'],
  gl: ['unha', 'non', 'moi', 'teñen', 'cousas', 'aínda', 'máis', 'polo', 'coma', 'ben'], // Galician-only words: the Portuguese ones would count for Portuguese books
  nl: ['de', 'het', 'een', 'en', 'van', 'dat', 'niet', 'met', 'zijn', 'voor', 'ook', 'maar'],
  sv: ['och', 'att', 'det', 'som', 'en', 'på', 'är', 'inte', 'med', 'för', 'av', 'den'],
  da: ['og', 'at', 'det', 'som', 'en', 'på', 'er', 'ikke', 'med', 'for', 'af', 'den'],
  pl: ['nie', 'się', 'na', 'że', 'to', 'jest', 'w', 'z', 'do', 'jak', 'ale', 'po'],
  tr: ['bir', 've', 'bu', 'için', 'ile', 'de', 'da', 'çok', 'daha', 'ne', 'gibi', 'ama'],
  ro: ['și', 'de', 'în', 'la', 'nu', 'cu', 'este', 'un', 'o', 'pe', 'că', 'care'],
  cs: ['a', 'je', 'se', 'na', 'to', 'že', 'v', 's', 'do', 'jako', 'ale', 'pro'],
  sk: ['sa', 'sú', 'aj', 'ktorá', 'ktorý', 'ktoré', 'môže', 'bolo', 'pre', 'však'], // Slovak-only forms; the words Czech shares (je, že, ale) would count for Czech
  sl: ['tudi', 'ker', 'vendar', 'zelo', 'smo', 'sta', 'bo', 'ki', 'so', 'njej'], // Slovene-only forms; the words Croatian shares (je, ne, za) would count for Croatian
  no: ['og', 'i', 'det', 'som', 'er', 'en', 'på', 'med', 'til', 'ikke', 'for', 'av', 'den', 'et', 'har'],
  fi: ['ja', 'on', 'että', 'se', 'oli', 'ovat', 'mutta', 'kuin', 'myös', 'tai', 'hän', 'sekä', 'ei', 'joka'],
  et: ['ja', 'on', 'ei', 'see', 'et', 'oli', 'kui', 'mis', 'ka', 'aga', 'ning', 'või'],
  hu: ['és', 'a', 'az', 'hogy', 'nem', 'egy', 'is', 'de', 'van', 'meg', 'már', 'csak', 'mint', 'még'],
  hr: ['i', 'je', 'u', 'se', 'na', 'da', 'za', 'su', 'koji', 'ne', 'od', 'sa', 'što', 'će'],
  lv: ['ir', 'uz', 'kas', 'bet', 'nav', 'tas', 'ko', 'ka', 'šī', 'grāmata'],
  lt: ['ir', 'yra', 'kad', 'su', 'bet', 'tai', 'į', 'ne', 'kaip', 'bei', 'iš', 'nuo', 'jis', 'ji'],
  is: ['og', 'sem', 'ekki', 'til', 'við', 'var', 'með', 'að', 'íslenska', 'þetta'],
  ga: ['agus', 'le', 'sé', 'ní', 'ag', 'go', 'ach', 'tá', 'bhfuil', 'seo'],
  cy: ['yn', 'ac', 'ei', 'mae', 'gyda', 'ond', 'wedi', 'hefyd', 'ydy'],
  eu: ['eta', 'ez', 'bat', 'du', 'izan', 'hau', 'dira', 'zen', 'ere', 'baina', 'zuen'],
  sq: ['dhe', 'të', 'një', 'për', 'nga', 'që', 'është', 'në', 'ka', 'janë'],
  id: ['yang', 'dan', 'di', 'itu', 'ini', 'dengan', 'untuk', 'dari', 'tidak', 'akan', 'ada', 'ke', 'dalam', 'oleh'],
  vi: ['và', 'của', 'là', 'có', 'không', 'được', 'cho', 'này', 'các', 'những', 'trong', 'với', 'người', 'một'],
}

/** Language names a Book_Details sheet may write instead of a tag ("Portuguese", "Portugal – Portuguese"). Keys are lower case. */
export const LANG_NAMES: Record<string, string> = {
  english: 'en', 'british english': 'en-GB', 'american english': 'en-US', german: 'de-DE', french: 'fr-FR', spanish: 'es-ES', italian: 'it-IT', portuguese: 'pt-PT',
  'european portuguese': 'pt-PT', 'brazilian portuguese': 'pt-BR', 'portugal – portuguese': 'pt-PT', 'portugal - portuguese': 'pt-PT',
  'mexico – spanish': 'es-MX', 'mexico - spanish': 'es-MX',
  catalan: 'ca', galician: 'gl', dutch: 'nl', swedish: 'sv', danish: 'da', norwegian: 'no', finnish: 'fi', estonian: 'et', latvian: 'lv', lithuanian: 'lt',
  polish: 'pl', czech: 'cs', slovak: 'sk', slovene: 'sl', slovenian: 'sl', hungarian: 'hu', croatian: 'hr', bosnian: 'bs', serbian: 'sr', bulgarian: 'bg',
  macedonian: 'mk', ukrainian: 'uk', belarusian: 'be', russian: 'ru', romanian: 'ro', greek: 'el', albanian: 'sq', turkish: 'tr', icelandic: 'is',
  irish: 'ga', welsh: 'cy', basque: 'eu', indonesian: 'id', malay: 'ms', vietnamese: 'vi', afrikaans: 'af', swahili: 'sw',
  arabic: 'ar', persian: 'fa', farsi: 'fa', urdu: 'ur', hebrew: 'he', armenian: 'hy', georgian: 'ka', bengali: 'bn', tamil: 'ta', hindi: 'hi',
  thai: 'th', japanese: 'ja', korean: 'ko', chinese: 'zh',
}

/** A language tag as a sheet or a file writes it ("pt_PT" → "pt-PT"), or a language named in words; undefined when it is neither. */
export function languageTag(s: string | undefined): string | undefined {
  const t = (s ?? '').trim().replace(/_/g, '-')
  if (!t) return undefined
  return LANG_NAMES[t.toLowerCase()] ?? (/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/i.test(t) ? t : undefined)
}

/** Cyrillic: the letters only one of these languages has, then the common words of Russian against Bulgarian (the rest is Russian). */
// ў is Belarusian only; Belarusian also has і, so it is checked before the Ukrainian letters
const CYRILLIC_LETTERS: [string, RegExp][] = [['be', /ў/g], ['uk', /[іїєґ]/g], ['mk', /[ѓќѕ]/g], ['sr', /[ђћљњџ]/g]]
const RU_WORDS = ['что', 'это', 'как', 'его', 'был', 'который', 'ещё', 'для']
const BG_WORDS = ['което', 'като', 'също', 'със', 'това', 'които', 'той', 'при']

function cyrillicLanguage(sample: string): string {
  const lower = sample.toLowerCase()
  for (const [code, re] of CYRILLIC_LETTERS) if ((lower.match(re) ?? []).length >= 2) return code
  const words = lower.match(/\p{L}+/gu) ?? []
  const n = (ws: string[]) => words.filter((w) => ws.includes(w)).length
  return n(BG_WORDS) > n(RU_WORDS) ? 'bg' : 'ru'
}

/** Arabic script: Urdu and Persian have letters of their own; the rest is Arabic. */
function arabicLanguage(sample: string): string {
  const n = (re: RegExp) => (sample.match(re) ?? []).length
  if (n(/[ٹڈڑںےھ]/g) >= 2) return 'ur'
  if (n(/[پچژگکی]/g) >= 2) return 'fa'
  return 'ar'
}

/** Scripts that name their language on their own (share of all letters). */
const SCRIPTS: [string, RegExp][] = [
  ['ar', /\p{Script=Arabic}/gu], ['he', /\p{Script=Hebrew}/gu], ['ru', /\p{Script=Cyrillic}/gu], ['el', /\p{Script=Greek}/gu],
  ['ja', /[\p{Script=Hiragana}\p{Script=Katakana}]/gu], ['ko', /\p{Script=Hangul}/gu], ['zh', /\p{Script=Han}/gu],
  ['hi', /\p{Script=Devanagari}/gu], ['th', /\p{Script=Thai}/gu], ['hy', /\p{Script=Armenian}/gu], ['ka', /\p{Script=Georgian}/gu],
  ['bn', /\p{Script=Bengali}/gu], ['ta', /\p{Script=Tamil}/gu],
]

function scriptOf(text: string): string | undefined {
  const sample = text.slice(0, 40000)
  const letters = (sample.match(/\p{L}/gu) ?? []).length
  if (!letters) return undefined
  for (const [code, re] of SCRIPTS)
    if ((sample.match(re) ?? []).length / letters > 0.3) return code === 'ru' ? cyrillicLanguage(sample) : code === 'ar' ? arabicLanguage(sample) : code
  return undefined
}

function stopScores(text: string): { lang: string; score: number }[] {
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? []
  const count = new Map<string, number>()
  for (const w of words.slice(0, 20000)) count.set(w, (count.get(w) ?? 0) + 1)
  return Object.entries(STOP)
    .map(([lang, ws]) => ({ lang, score: ws.reduce((n, w) => n + (count.get(w) ?? 0), 0) }))
    .sort((a, b) => b.score - a.score)
}

/** The language of a text. English only when no language's common words occur at all (the last resort, never a guess). */
export function detectLanguage(text: string): string {
  const [top] = stopScores(text)
  return scriptOf(text) ?? (top.score ? top.lang : 'en')
}

/** A language the text clearly is. Undefined when the sample is too short to trust. */
export function confidentLanguage(text: string): string | undefined {
  const script = scriptOf(text)
  if (script) return script
  const [top, second] = stopScores(text)
  if (!top || top.score < 4 || top.score < (second?.score ?? 0) + 3) return undefined
  return top.lang
}

/** Of the language codes a file declares, the one matching its text ("en-GB, en-US, es-ES" + Spanish text → es-ES). */
export function pickLanguage(declared: string[], text: string, used?: Map<string, number>): string {
  const found = detectLanguage(text)
  // InDesign declares every language of the document (en-GB, pt-BR, pt-PT): of the tags for the language the text is in,
  // the one most paragraphs and spans are tagged with is the book's (a Portuguese book can still carry the pt-BR default)
  const matching = declared.filter((d) => d.slice(0, 2).toLowerCase() === found)
  if (used && matching.length > 1) {
    const n = (d: string) => used.get(d) ?? used.get(d.toLowerCase()) ?? 0
    const best = [...matching].sort((a, b) => n(b) - n(a))[0]
    if (n(best) > n(matching[0])) return best
  }
  return matching[0] ?? declared.find(Boolean) ?? found
}

/**
 * Language of a print PDF. The text decides when it is clearly a language, so a file that still
 * says "en" does not hide a German book. A declared tag is kept when it agrees ("de-DE" over "de")
 * or when the text is too short to overrule it. No letters at all keeps the declaration, or "en".
 */
export function languageFromBook(declared: string | undefined, text: string): string {
  const tag = (declared ?? '').trim().replace(/_/g, '-')
  if (!/\p{L}/u.test(text)) return tag || 'en'
  const script = scriptOf(text)
  if (script) return tag.slice(0, 2).toLowerCase() === script ? tag : script
  const [top, second] = stopScores(text)
  const confident = top.score >= 4 && top.score >= (second?.score ?? 0) + 3
  if (tag && (tag.slice(0, 2).toLowerCase() === top.lang || !confident)) return tag
  return top.score ? top.lang : 'en'
}

/**
 * The language of a book, in this order: the Book_Details sheet's language (the client's word), then the language the file
 * declares (checked against its text, see languageFromBook), then the text itself. "en" only when none of them says anything.
 */
export function bookLanguage(sheet: string | undefined, declared: string | undefined, text: string): string {
  return languageTag(sheet) ?? languageFromBook(declared, text)
}
