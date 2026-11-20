import type { ReactNode } from 'react'
import { useUser } from '@clerk/react'

/** Renders children only for a signed-in admin. UX only: the /api/admin routes check the role again on the server.
 *  Uses a Clerk hook, so render it only when location.protocol !== 'file:' (the Electron build has no ClerkProvider). */
export function AdminOnly({ children }: { children: ReactNode }) {
  const { user } = useUser()
  return user?.publicMetadata?.role === 'admin' ? <>{children}</> : null
}
