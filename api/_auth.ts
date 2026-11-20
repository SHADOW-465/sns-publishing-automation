// Session check for Vercel functions. Not a route (the file name starts with _). Never logs or returns tokens or keys.
import { createClerkClient } from '@clerk/backend'

export type Client = ReturnType<typeof createClerkClient>
// tests swap the client factory so the live Clerk API is never called
export const deps = { createClient: createClerkClient as (o: { secretKey: string; publishableKey?: string }) => Client }

export const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })

type Session = { denied: Response } | { denied: null; client: Client; userId: string | null }

async function session(req: Request): Promise<Session> {
  const secretKey = process.env.CLERK_SECRET_KEY
  if (!secretKey) return { denied: json(503, { fallback: true, error: 'sign-in is not configured' }) }
  const publishableKey = process.env.CLERK_PUBLISHABLE_KEY ?? process.env.VITE_CLERK_PUBLISHABLE_KEY
  const authorizedParties = process.env.CLERK_AUTHORIZED_PARTIES?.split(',').map((s) => s.trim()).filter(Boolean)
  try {
    const client = deps.createClient({ secretKey, publishableKey })
    const state = await client.authenticateRequest(req, authorizedParties?.length ? { authorizedParties } : {})
    if (!state.isAuthenticated) return { denied: json(401, { fallback: true, error: 'sign in required' }) }
    return { denied: null, client, userId: state.toAuth()?.userId ?? null }
  } catch {
    return { denied: json(401, { fallback: true, error: 'sign in required' }) }
  }
}

/** A response when the caller must stop, or null when the Clerk session is valid. */
export async function requireUser(req: Request): Promise<Response | null> {
  return (await session(req)).denied
}

/** A response when the caller must stop, or the Clerk client and caller id when the caller is an admin.
 *  The role is read from Clerk for the session's user id; nothing from the request is trusted. */
export async function requireAdmin(req: Request): Promise<Response | { client: Client; userId: string }> {
  const s = await session(req)
  if (s.denied) return s.denied
  if (!s.userId) return json(401, { fallback: true, error: 'sign in required' })
  try {
    const user = await s.client.users.getUser(s.userId)
    if (user.publicMetadata?.role !== 'admin') return json(403, { error: 'admin only' })
    return { client: s.client, userId: s.userId }
  } catch {
    return json(403, { error: 'admin only' })
  }
}

export type Role = 'member' | 'admin'
export const asRole = (v: unknown): Role => (v === 'admin' ? 'admin' : 'member')
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function bodyOf(req: Request): Promise<Record<string, unknown>> {
  try {
    const b = await req.json()
    return b && typeof b === 'object' ? (b as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}
