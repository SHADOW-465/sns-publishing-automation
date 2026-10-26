// The "what this step needs" rule: Next never goes silently grey. Logic (needs.ts) and the dialog (NeedsDialog.ts) in jsdom.
import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { needsSummary, needsHeadline, structureNeeds, targetId, type Need } from '../src/ui/needs.ts'
import { acceptable, blockingItems } from '../src/engine/review/confidence.ts'

const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true })
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, Node: dom.window.Node, IS_REACT_ACT_ENVIRONMENT: true })
const { createElement: h, act } = await import('react')
const { createRoot } = await import('react-dom/client')
const { NeedsDialog, NeedsLine } = await import('../src/ui/NeedsDialog.ts')

const items = [
  ...Array.from({ length: 3 }, (_, i) => ({ id: `picture:OEBPS/image/${i}.jpg`, area: 'picture' as const, score: 0, title: `Picture ${i}.jpg` })),
  { id: 'section:4', area: 'section' as const, score: 0.4, title: '“Cambia” is an unknown kind of section' },
  { id: 'style:tital', area: 'style' as const, score: 0.55, title: 'Style “tital” (1×) is read as: section-title' },
  { id: 'meta:publisher', area: 'meta' as const, score: 0.3, title: 'Publisher not found' },
]
const needs = structureNeeds(blockingItems(items, new Set()), acceptable)

test('blocking reasons: grouped in plain words for the status line', () => {
  assert.equal(needs.length, 6)
  assert.equal(needsSummary(needs), '3 pictures, 1 section, 1 style, publisher name')
  assert.equal(needsSummary(needs.filter((n) => n.kind === 'choice')), '1 style, publisher name')
  assert.equal(needsHeadline(needs.slice(4)), '2 things are unsure. How do you want to go on?')
  assert.equal(needsHeadline(needs.slice(5)), '1 thing is unsure. How do you want to go on?')
  assert.deepEqual(needs.map((n) => n.kind), ['acceptable', 'acceptable', 'acceptable', 'acceptable', 'choice', 'choice'])
  assert.equal(targetId('picture:OEBPS/image/1.jpg'), 'check-picture_OEBPS_image_1_jpg')
  assert.equal(needsSummary([]), '')
})

async function render(el: unknown) {
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(el as never))
  return { host, root }
}
const press = async (el: Element, key: string) => act(async () => void el.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key, bubbles: true })))
const click = async (el: Element) => act(async () => void (el as HTMLElement).click())

test('dialog: labelled modal, focus inside on the one-click fix, Esc closes', async () => {
  let closed = 0
  let accepted = 0
  const { host, root } = await render(h(NeedsDialog, { needs, onClose: () => closed++, onAcceptAll: () => accepted++ }))
  const dlg = host.querySelector('[role="dialog"]')!
  assert.equal(dlg.getAttribute('aria-modal'), 'true')
  assert.equal(document.getElementById(dlg.getAttribute('aria-labelledby')!)!.textContent, '6 things are unsure. How do you want to go on?')
  assert.ok(document.getElementById(dlg.getAttribute('aria-describedby')!))
  assert.equal(document.activeElement?.textContent, 'Accept all 4 as they are')
  assert.ok(dlg.contains(document.activeElement))
  const goTos = [...dlg.querySelectorAll('button')].filter((b) => b.textContent === 'Go to it')
  assert.equal(goTos.length, 2, 'the must-choose items are listed with Go to it')
  assert.ok([...dlg.querySelectorAll('button')].some((b) => b.textContent === 'I’ll fix it myself'))
  await press(dlg, 'Escape')
  assert.equal(closed, 1)
  await click(document.activeElement!)
  assert.equal(accepted, 1)
  await act(async () => root.unmount())
  host.remove()
})

test('dialog: Go to it closes and scrolls to the item, highlighting it', async () => {
  const target = document.createElement('li')
  target.id = needs[4].target!
  target.innerHTML = '<select><option>x</option></select>'
  document.body.append(target)
  let closed = 0
  const { host, root } = await render(h(NeedsDialog, { needs, onClose: () => closed++ }))
  assert.ok(![...host.querySelectorAll('button')].some((b) => /Accept all/.test(b.textContent ?? '')), 'no bulk button without a fix')
  const go = [...host.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === `Go to it: ${needs[4].label}`)!
  await click(go)
  await act(async () => void (await new Promise((r) => setTimeout(r, 5))))
  assert.equal(closed, 1)
  assert.ok(target.classList.contains('need-highlight'))
  assert.equal(document.activeElement?.tagName, 'SELECT')
  await act(async () => root.unmount())
  host.remove()
  target.remove()
})

test('status line: amber and calm, says what is needed, absent when nothing is', async () => {
  const { host, root } = await render(h('div', null, h(NeedsLine, { needs: needs.slice(4) as Need[] }), h(NeedsLine, { needs: [] })))
  const lines = host.querySelectorAll('[data-testid="needs-line"]')
  assert.equal(lines.length, 1)
  assert.equal(lines[0].textContent, 'Needs your choice: 1 style, publisher name')
  assert.equal(lines[0].getAttribute('role'), 'status')
  assert.ok(!/err/.test(lines[0].className))
  await act(async () => root.unmount())
  host.remove()
})

test('a style the tool was unsure of can be kept as read: same role, a reviewer reason (no pick-another-and-back loop)', async () => {
  const { keepStylePatch } = await import('../src/ui/needs.ts')
  assert.deepEqual(keepStylePatch('h3'), { role: 'h3', reason: 'kept as read by the reviewer' })
  const src = (await import('node:fs')).readFileSync(new URL('../src/ui/CheckFirst.tsx', import.meta.url), 'utf8')
  const styleBlock = src.slice(src.indexOf("it.area === 'style'"), src.indexOf("it.area === 'section'"))
  assert.match(styleBlock, /keepStylePatch\(s\.role\)/)
  assert.match(styleBlock, /Keep as it is/)
})
