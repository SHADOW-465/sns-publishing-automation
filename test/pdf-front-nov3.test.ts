// Nov 3 client book (Sistemas Partidários, PDF flow): the labelled copyright lines ("Título:", "Autor:"), the publisher among credit
// lines and handles, and the title page chosen by the title the copyright page gives (not the fullest page, a publisher's blurb).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { imprintAuthors, imprintTitle, readFront, type FrontPage } from '../src/engine/pdfepub/front.ts'
import { imprintPublisher, titleCase } from '../src/engine/pdfepub/analyze.ts'

const imprint = [
  'www.gradiva.pt', '@gradivapublicacoes', 'gradiva.publicacoes',
  'Título: Sistemas Partidários: Reflexões teóricas e casos práticos', 'Autor: Conceição Pequito Teixeira',
  '© Autora e Gradiva Publicações, S. A., 2026', 'Reservados todos os direitos', 'Editor: Manuel S. Fonseca',
  'Coordenação editorial: Maria José Batista', 'Acompanhamento editorial e revisão: Elisabete Lucas', 'ISBN: 978-989-785-502-3',
]
const page = (index: number, rows: [number, string][]): FrontPage => ({ index, lines: rows.map(([size, text], i) => ({ text, size, y: 100 + i * 20 })) })

test('labelled title and author lines on the copyright page', () => {
  assert.equal(imprintTitle(imprint), 'Sistemas Partidários: Reflexões teóricas e casos práticos')
  assert.equal(imprintAuthors(imprint)[0], 'Conceição Pequito Teixeira')
  assert.equal(imprintTitle(['Título original: The Book', 'Tradução: X']), '')
})

test('publisher: the house in the copyright line, not a credit line, a handle or "Autora e"', () => {
  assert.equal(imprintPublisher(imprint), 'Gradiva Publicações')
  assert.equal(imprintPublisher(['Publisher: Guerra e Paz', 'Coordenação editorial: Ana']), 'Guerra e Paz')
  assert.equal(imprintPublisher(['Edited by Jane Doe', '© 2020 the author and Big Books Ltd']), 'Big Books')
  assert.equal(imprintPublisher(['Coordenação editorial: Maria José Batista', 'www.editora.pt']), '')
})

test('the title page is the one the "Título:" line names, not the fuller blurb page', () => {
  const blurb = page(0, [[10, 'gradiva'], ...Array.from({ length: 12 }, (_, i) => [7, `Editora portuguesa linha ${i}`] as [number, string])])
  const copy = page(1, imprint.map((t) => [8, t] as [number, string]))
  const title = page(2, [[67.9, 'Sistemas'], [67.9, 'Partidários'], [18.3, 'Reflexões teóricas e casos práticos']])
  const fr = readFront([blurb, copy, title], imprint, { title: '', author: '' }, titleCase, 'pt')
  assert.equal(fr.titlePage, 2)
  assert.equal(fr.title, 'Sistemas Partidários')
  assert.equal(fr.subtitle, 'Reflexões teóricas e casos práticos')
  assert.equal(fr.author, 'Conceição Pequito Teixeira')
})

test('author name set over several title-page lines is the author, not part of the title', () => {
  const title = page(2, [[60, 'Sistemas'], [60, 'Partidários'], [35, 'Conceição'], [35, 'Pequito'], [35, 'Teixeira']])
  const fr = readFront([title], imprint, { title: '', author: '' }, titleCase, 'pt')
  assert.equal(fr.author, 'Conceição Pequito Teixeira')
  assert.ok(!/Conceição/.test(fr.title), fr.title)
})

test('an all-capitals title is title-cased with the small words of the book’s language, and the first word after a number or colon is capitalised', () => {
  assert.equal(titleCase('2. EL CRECIMIENTO DEL FEDERALISMO COERCITIVO EN ESTADOS UNIDOS: EL PAPEL DE LOS PARTIDOS'), '2. El Crecimiento del Federalismo Coercitivo en Estados Unidos: El Papel de los Partidos')
  assert.equal(titleCase('ESTUDO DOS SISTEMAS PARTIDÁRIOS E DAS SUAS ABORDAGENS'), 'Estudo dos Sistemas Partidários e das Suas Abordagens')
  assert.equal(titleCase('THE BLESSING AND THE CURSE'), 'The Blessing and the Curse')
  assert.equal(titleCase('PART II'), 'Part II')
  assert.equal(titleCase('Already Mixed case'), 'Already Mixed case')
})
