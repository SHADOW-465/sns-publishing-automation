// Session check for Vercel functions. Not a route (the file name starts with _). Never logs or returns tokens or keys.
import { createClerkClient } from '@clerk/backend'

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })

/** A response when the caller must stop, or null when the Clerk session is valid. */
export async function requireUser(req: Request): Promise<Response | null> {
  const secretKey = process.env.CLERK_SECRET_KEY
  if (!secretKey) return json(503, { fallback: true, error: 'sign-in is not configured' })
  const publishableKey = process.env.CLERK_PUBLISHABLE_KEY ?? process.env.VITE_CLERK_PUBLISHABLE_KEY
  const authorizedParties = process.env.CLERK_AUTHORIZED_PARTIES?.split(',').map((s) => s.trim()).filter(Boolean)
  try {
    const client = createClerkClient({ secretKey, publishableKey })
    const state = await client.authenticateRequest(req, authorizedParties?.length ? { authorizedParties } : {})
    if (!state.isAuthenticated) return json(401, { fallback: true, error: 'sign in required' })
    return null
  } catch {
    return json(401, { fallback: true, error: 'sign in required' })
  }
}
