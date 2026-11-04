// Any book language, not a fixed list: the Book_Details sheet first, then the language the source file declares (checked against
// its text), then the text itself. Each sample is a short, ordinary sentence in the language it names.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { bookLanguage, detectLanguage, languageFromBook, languageTag, confidentLanguage } from '../src/engine/lang.ts'

const SAMPLES: [string, string][] = [
  ['et', 'Ja see raamat on kirjutatud eesti keeles, aga ei ole kui mis oli. See on ning ka et ja on ei kui mis oli, ning või ka see on.'],
  ['lv', 'Un šī grāmata ir par to, ka tas ir ar mums un no visiem, bet nav uz kas par ko. Un tas ir, ir un ar no uz par.'],
  ['sk', 'Je to kniha, ktorá sa číta ľahko, a aj ja som ju čítal, lebo sú tu kapitoly, ktoré sa dajú pochopiť. Pre nás bolo to dobré a je to aj pre vás.'],
  ['sl', 'Ta knjiga je zelo dobra, ker so v njej tudi zgodbe, ki jih bomo prebrali. Vendar smo jo sta prebrala in bo tudi zelo lepo.'],
  ['is', 'Og það er bók sem er til við um að ekki var á en. Þetta er og sem ekki til við um var.'],
  ['ga', 'Is leabhar é seo agus tá sé ar na daoine le go bhfuil an ní ag go. Agus is an ar na le ní ach.'],
  ['cy', 'Mae y llyfr yn yma ac o’r ei ar gyda na ond i a. Yn y mae ac ei o ar na ond gyda.'],
  ['eu', 'Eta liburu hau da bat du izan zen ere baina ez dira. Da eta ez bat du izan zen hau baina ere dira.'],
  ['sq', 'Dhe ky libër është një për nga që në si ka janë me të. Është dhe me një për nga që ka.'],
  ['gl', 'Unha historia moi ben contada, e non é para os que teñen pouco tempo; aínda máis, as cousas polo coma se fan con calma.'],
  ['nl', 'Het boek is een van de beste die ik ooit heb gelezen en het was niet makkelijk maar wel de moeite waard.'],
]
const CYRILLIC: [string, string][] = [
  ['ru', 'Это книга о том, что мы делаем, и как это было для всех. Он был здесь, и его друг пришёл, который ещё ждал.'],
  ['uk', 'Це книга про те, що ми робимо, і як це було для всіх. Її автор є відомим, і його ім’я є у книзі.'],
  ['bg', 'Това е книгата, която се чете като всички други, също със приятелите. Той каза, че което е било, е било и ще бъде.'],
  ['sr', 'Ово је књига ћуне, ђаво љубав њива џак. Ћаво је дао ђевојци њено.'],
  ['mk', 'Ова е книга која ќе ја прочита ѓаволот и ѕвездата, и ќе се врати.'],
  ['be', 'Гэта кніга ў наступным годзе, ў горадзе ў сярэдзіне, і ў гэтым ёсць ўсё.'],
]
const SCRIPT: [string, string][] = [
  ['ar', 'هذا الكتاب في المكتبة من أجل الطلاب، وقد كان في الصف على إلى أن.'],
  ['fa', 'این کتاب در کتابخانه است و از آن برای دانشجویان که را به من داده شد؛ که بود و است.'],
  ['ur', 'یہ کتاب ہے اور اس کے ساتھ ہمارے لیے کیا گیا ہے۔ وہ ٹھیک ہے، ڈاکٹر نے کہا۔'],
  ['el', 'Αυτό είναι ένα βιβλίο που διαβάζουμε όλοι μαζί στο σχολείο.'],
  ['he', 'זהו ספר שאנחנו קוראים יחד בבית הספר והוא טוב מאוד.'],
  ['ja', 'これは本です。私は日本語を勉強しています。'],
  ['ko', '이것은 책입니다. 우리는 학교에서 함께 읽습니다.'],
  ['hy', 'Սա գիրքն է, որ մենք կարդում ենք հայերեն։'],
  ['ka', 'ეს არის წიგნი, რომელიც ჩვენ ვკითხულობთ.'],
  ['bn', 'এটি একটি বই যা আমরা পড়ি।'],
  ['ta', 'இது ஒரு புத்தகம், நாம் படிக்கிறோம்.'],
]
const ENGLISH = 'The book is about the history of the town and the people who lived in it, and it was written for those who want to know what was there.'

test('the language of each sample is found from its text (Latin-script languages from their common words)', () => {
  for (const [code, text] of SAMPLES) assert.equal(detectLanguage(text), code, `${code}: “${text.slice(0, 40)}…”`)
})

test('Cyrillic is split between Russian, Ukrainian, Bulgarian, Serbian, Macedonian and Belarusian, not all called Russian', () => {
  for (const [code, text] of CYRILLIC) assert.equal(detectLanguage(text), code, code)
})

test('scripts with their own letters: Arabic, Persian and Urdu share one script, and Armenian, Georgian, Bengali, Tamil are named', () => {
  for (const [code, text] of SCRIPT) assert.equal(detectLanguage(text), code, code)
})

test('text too short to trust is not called a language; a clear one is', () => {
  assert.equal(confidentLanguage('ok'), undefined)
  assert.equal(confidentLanguage(SAMPLES.find(([c]) => c === 'sk')![1]), 'sk')
})

test('the Book_Details sheet names the language in words or as a tag, for any language it knows', () => {
  assert.equal(languageTag('Estonian'), 'et')
  assert.equal(languageTag('Slovak'), 'sk')
  assert.equal(languageTag('Brazilian Portuguese'), 'pt-BR')
  assert.equal(languageTag('pt_PT'), 'pt-PT')
  assert.equal(languageTag('Klingon'), undefined, 'an unknown name is not a tag')
  assert.equal(languageTag(''), undefined)
})

test('bookLanguage: the sheet decides first, then the declared language (kept when the text agrees), then the text', () => {
  const slovak = SAMPLES.find(([c]) => c === 'sk')![1]
  const latvian = SAMPLES.find(([c]) => c === 'lv')![1]
  assert.equal(bookLanguage('Estonian', 'en', ENGLISH), 'et', 'a sheet language beats the file and the text')
  assert.equal(bookLanguage('sk-SK', 'en', ENGLISH), 'sk-SK', 'a sheet tag is kept as written')
  assert.equal(bookLanguage('Klingon', 'sv-SE', ''), 'sv-SE', 'an unknown sheet name falls through to the declared language')
  assert.equal(bookLanguage('', 'sv-SE', 'Det här är en bok och den är för alla som vill läsa den och det är bra att läsa.'), 'sv-SE', 'a declared Swedish tag agrees with Swedish text')
  assert.equal(bookLanguage('', 'en-US', slovak), 'sk', 'a file that still says English does not hide a Slovak book')
  assert.equal(bookLanguage('', '', latvian), 'lv', 'no sheet, no declaration: the text says Latvian')
  assert.equal(bookLanguage('', '', ''), 'en', 'nothing says anything: the last resort')
})

test('languageFromBook: a declared tag is kept for a short text (too short to overrule), and a declared tag for another script loses', () => {
  assert.equal(languageFromBook('de-DE', 'Hallo'), 'de-DE')
  assert.equal(languageFromBook('en', 'Это книга о том, что мы делаем, и как это было для всех.'), 'ru', 'a Russian text overrules an English declaration')
  assert.equal(languageFromBook('uk-UA', 'Це книга про те, що ми робимо, і як це було для всіх.'), 'uk-UA', 'a Ukrainian declared tag agrees with Ukrainian text')
})
