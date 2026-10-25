// The "what this step still needs" dialog and the status line beside Next. Written with createElement (no JSX) so the
// Node tests can render it in jsdom without a build step.
import { createElement as h, useEffect, useRef, type ReactNode } from 'react'
import { acceptableNeeds, choiceNeeds, needsHeadline, needsSummary, type Need } from './needs.ts'

/** Scrolls to an item and flashes it, so "Go to it" lands where the eye can see. */
export function goToNeed(target?: string) {
  if (!target || typeof document === 'undefined') return
  const el = document.getElementById(target)
  if (!el) return
  el.scrollIntoView?.({ behavior: 'smooth', block: 'center' })
  el.classList.add('need-highlight')
  setTimeout(() => el.classList.remove('need-highlight'), 2400)
  const focusable = el.querySelector<HTMLElement>('select, button, input, a[href]')
  focusable?.focus({ preventScroll: true })
}

/** Neutral, amber status line next to Next: "Needs your choice: 1 style, publisher name". Never error red. */
export function NeedsLine({ needs }: { needs: Need[] }) {
  if (!needs.length) return null
  return h('span', { className: 'needs-line', role: 'status', 'data-testid': 'needs-line' }, h('span', { 'aria-hidden': true, className: 'needs-dot' }), `Needs your choice: ${needsSummary(needs)}`)
}

export interface NeedsDialogProps {
  needs: Need[]
  onClose: () => void
  /** the one-click fix for every acceptable item ("Accept all N as they are") */
  onAcceptAll?: () => void
  /** what Next does when the person wants to go on without a choice (where the step allows it) */
  onContinueAnyway?: () => void
  intro?: ReactNode
}

/** Modal with focus moved inside, Esc to close, Tab kept inside, labelled by its heading. */
export function NeedsDialog({ needs, onClose, onAcceptAll, onContinueAnyway, intro }: NeedsDialogProps) {
  const box = useRef<HTMLDivElement>(null)
  const ok = acceptableNeeds(needs)
  const choose = choiceNeeds(needs)
  const first = needs[0]
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null
    box.current?.querySelector<HTMLElement>('button')?.focus()
    return () => before?.focus?.()
  }, [])
  const onKey = (e: { key: string; shiftKey: boolean; preventDefault: () => void; stopPropagation: () => void }) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose()
      return
    }
    if (e.key !== 'Tab' || !box.current) return
    const f = [...box.current.querySelectorAll<HTMLElement>('button')]
    if (!f.length) return
    const i = f.indexOf(document.activeElement as HTMLElement)
    if (e.shiftKey && i <= 0) (e.preventDefault(), f[f.length - 1].focus())
    else if (!e.shiftKey && i === f.length - 1) (e.preventDefault(), f[0].focus())
  }
  const go = (n: Need) => (onClose(), setTimeout(() => goToNeed(n.target), 0))
  const item = (n: Need) => h('li', { key: n.id }, h('span', null, n.label), h('button', { type: 'button', className: 'ghost small', onClick: () => go(n), 'aria-label': `Go to it: ${n.label}` }, 'Go to it'))
  return h('div', { className: 'needs-backdrop', onMouseDown: (e: { target: unknown; currentTarget: unknown }) => e.target === e.currentTarget && onClose() },
    h('div', { ref: box, className: 'needs-dialog', role: 'dialog', 'aria-modal': true, 'aria-labelledby': 'needs-title', 'aria-describedby': 'needs-desc', onKeyDown: onKey, 'data-testid': 'needs-dialog' },
      h('h2', { id: 'needs-title' }, needsHeadline(needs)),
      h('p', { id: 'needs-desc', className: 'muted' }, intro ?? 'Nothing is wrong with the book. The tool could not decide these on its own, so it asks you before it goes on.'),
      ok.length > 0 && h('div', { className: 'needs-group' },
        h('h3', null, `${ok.length} can be accepted as they are`),
        h('p', { className: 'muted small' }, `${needsSummary(ok)}: the tool's choice is usually right. You can still change any of them later.`),
        onAcceptAll && h('button', { type: 'button', className: 'primary', onClick: () => (onAcceptAll(), onClose()) }, `Accept all ${ok.length} as they are`),
      ),
      choose.length > 0 && h('div', { className: 'needs-group' },
        h('h3', null, choose.length === 1 ? '1 needs your choice' : `${choose.length} need your choice`),
        h('ul', { className: 'needs-list' }, choose.slice(0, 8).map(item)),
        choose.length > 8 && h('p', { className: 'muted small' }, `…and ${choose.length - 8} more in the list on the page.`),
      ),
      h('div', { className: 'needs-actions' },
        first && h('button', { type: 'button', onClick: () => go(first) }, 'Review one by one'),
        onContinueAnyway && h('button', { type: 'button', className: 'ghost', onClick: () => (onClose(), onContinueAnyway()) }, 'Continue anyway'),
        h('button', { type: 'button', className: 'ghost', onClick: onClose }, 'Close'),
      ),
    ),
  )
}
