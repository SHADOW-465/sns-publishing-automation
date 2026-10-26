import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import { ErrorBoundary } from './ui/ErrorBoundary.tsx'
import './styles.css'

// A new version published while this page is open removes the old page's code files, so the next build step cannot load.
// Say so plainly with one Reload button instead of failing the same step over and over.
window.addEventListener('vite:preloadError', (e) => {
  e.preventDefault()
  if (document.getElementById('app-updated')) return
  const bar = Object.assign(document.createElement('div'), { id: 'app-updated', role: 'alert', className: 'box err', textContent: 'A newer version of the app was published while this page was open. Reload the page to go on; you will need to add your files again. ' })
  Object.assign(bar.style, { position: 'fixed', top: '8px', left: '50%', transform: 'translateX(-50%)', zIndex: '9999', maxWidth: '640px' })
  const b = Object.assign(document.createElement('button'), { className: 'primary', textContent: 'Reload' })
  b.onclick = () => location.reload()
  bar.append(b)
  document.body.append(bar)
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
