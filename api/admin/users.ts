// Admin-only: list users with their role, promote or demote. Users are never deleted.
import { requireAdmin, json, asRole, bodyOf } from '../_auth.ts'

export async function GET(req: Request): Promise<Response> {
  const a = await requireAdmin(req)
  if (a instanceof Response) return a
  try {
    const { data } = await a.client.users.getUserList({ limit: 100, orderBy: '-created_at' })
    return json(200, {
      you: a.userId,
      users: data.map((u) => ({
        id: u.id,
        email: u.emailAddresses.find((e) => e.id === u.primaryEmailAddressId)?.emailAddress ?? u.emailAddresses[0]?.emailAddress ?? '',
        role: asRole(u.publicMetadata?.role),
      })),
    })
  } catch {
    return json(502, { error: 'could not list users' })
  }
}

export async function PATCH(req: Request): Promise<Response> {
  const a = await requireAdmin(req)
  if (a instanceof Response) return a
  const b = await bodyOf(req)
  if (typeof b.id !== 'string' || !b.id) return json(400, { error: 'user id required' })
  if (b.role !== 'admin' && b.role !== 'member') return json(400, { error: 'role must be member or admin' })
  if (b.id === a.userId && b.role !== 'admin') return json(403, { error: 'you cannot demote yourself' })
  try {
    await a.client.users.updateUserMetadata(b.id, { publicMetadata: { role: b.role } })
    return json(200, { ok: true, role: b.role })
  } catch {
    return json(422, { error: 'could not change the role' })
  }
}
