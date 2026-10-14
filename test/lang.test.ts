import { test } from 'node:test'
import assert from 'node:assert/strict'
import { detectLanguage, languageFromBook, pickLanguage } from '../src/engine/lang.ts'

const DE = 'Das Tempelhofer Feld und der Park ist nicht nur das Land von der Stadt. Die Leute gehen auch mit den Kindern zu dem Feld.'
const EN = 'The park is in the city and the people were there for the day with the children that was open.'

test('languageFromBook keeps a region tag when the text agrees and follows the text when it does not', () => {
  assert.equal(detectLanguage(DE), 'de')
  assert.equal(languageFromBook('de-DE', DE), 'de-DE')
  assert.equal(languageFromBook('de_DE', DE), 'de-DE')
  assert.equal(languageFromBook(undefined, DE), 'de')
  assert.equal(languageFromBook('en', DE), 'de', 'a wrong Info language does not hide the book')
  assert.equal(languageFromBook('en-US', EN), 'en-US')
  assert.equal(languageFromBook('en', 'ISBN 9783814803562'), 'en', 'too little text keeps the declaration')
  assert.equal(languageFromBook(undefined, ''), 'en')
  // InDesign still uses pickLanguage: a matching tag in the list wins, and this helper does not change that
  assert.equal(pickLanguage(['en-GB', 'en-US', 'es-ES'], 'El libro que los niños leen en la casa con una historia.'), 'es-ES')
})
