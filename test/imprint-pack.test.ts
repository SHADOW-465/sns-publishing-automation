import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PRINT_ONLY } from '../src/engine/epub/imprint.ts'

test('print-only imprint lines: the German and Dutch printer lines are recognised, ordinary sentences are not', () => {
  for (const t of ['Satz: Fotosatz Müller, Berlin', 'Druck und Bindung: CPI books GmbH, Leck', 'Gesamtherstellung: Beispiel Druck', 'Gedruckt auf säurefreiem Papier', 'Printed in Germany', 'Gedrukt door Drukkerij Beispiel'])
    assert.match(t, PRINT_ONLY, t)
  for (const t of ['Der Satz des Pythagoras ist einfach.', 'Er sprach vom Druck der Verhältnisse und vom Satz: Alles fließt.'])
    assert.doesNotMatch(t, PRINT_ONLY, t)
})
