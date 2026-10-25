import { Component, type ReactNode } from 'react'

/** Any crash while rendering shows a plain message and a way back, never a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  componentDidCatch(error: Error) {
    console.error('App error:', error)
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <main className="card" role="alert" style={{ maxWidth: 640, margin: '3rem auto' }}>
        <h1>Something went wrong</h1>
        <p>This file could not be shown. Your other work is safe. Please reload the page and try again; if it happens again, send us the file name and this note:</p>
        <p className="muted"><code>{this.state.error.message}</code></p>
        <button type="button" onClick={() => location.reload()}>Reload</button>
      </main>
    )
  }
}
