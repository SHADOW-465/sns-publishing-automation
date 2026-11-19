// Session token for /api/ai-fix. The signed-in gate registers Clerk's getToken; callers only see a header.
type TokenGetter = () => Promise<string | null>

let getter: TokenGetter | null = null

export function setTokenGetter(fn: TokenGetter | null) {
  getter = fn
}

/** `{ authorization: 'Bearer <token>' }` when a getter is set and returns a token, otherwise `{}`. */
export async function authHeaders(): Promise<Record<string, string>> {
  const token = getter ? await getter() : null
  return token ? { authorization: `Bearer ${token}` } : {}
}
