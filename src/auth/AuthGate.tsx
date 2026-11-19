import { useEffect, useState, type ReactNode } from 'react'
import { Show, SignIn, SignUp, useAuth } from '@clerk/react'
import { App } from '../App.tsx'
import { Icon } from '../ui/icons.tsx'
import { setTokenGetter } from './token.ts'

// The offline Electron build loads dist/ over file://, where Clerk cannot run, so sign-in is skipped and the app opens as before.
export function clerkSkipped(): boolean {
  return location.protocol === 'file:'
}

/** Web page with no publishable key: fail closed. A configured web page renders children (ClerkProvider in main.tsx). */
export function AuthGate({ children }: { children: ReactNode }) {
  if (clerkSkipped()) return <App />
  if (!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY) {
    return (
      <div className="auth-screen">
        <p className="auth-missing">Sign-in is not configured</p>
      </div>
    )
  }
  return children
}

/** Inside ClerkProvider. Signed out shows only the auth screen, so workflows are not mounted. */
export function ClerkSession() {
  return (
    <>
      <Show when="signed-out">
        <AuthScreen />
      </Show>
      <Show when="signed-in">
        <SignedInApp />
      </Show>
    </>
  )
}

function SignedInApp() {
  const { getToken } = useAuth()
  setTokenGetter(() => getToken())
  useEffect(() => () => setTokenGetter(null), [])
  return <App />
}

function AuthScreen() {
  const [hash, setHash] = useState(() => location.hash)
  useEffect(() => {
    const onHash = () => setHash(location.hash)
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])
  const signUp = hash.startsWith('#/sign-up')
  return (
    <div className="auth-screen">
      <div className="brand auth-brand">
        <span className="brand-mark" aria-hidden="true">
          <Icon name="book" size={18} />
        </span>
        <span>
          <strong>Publishing Automation</strong>
          <small>Print book to accessible e-book</small>
        </span>
      </div>
      {signUp ? (
        <SignUp routing="hash" signInUrl="#/sign-in" />
      ) : (
        <SignIn routing="hash" signUpUrl="#/sign-up" signInUrl="#/sign-in" />
      )}
    </div>
  )
}
