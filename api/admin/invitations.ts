// Admin-only: list, create and revoke Clerk invitations.
import { requireAdmin, json, asRole, bodyOf, EMAIL } from '../_auth.ts'

const FALLBACK_ORIGIN = 'https://sns-publishing-automation.vercel.app'

export async function GET(req: Request): Promise<Response> {
  const a = await requireAdmin(req)
  if (a instanceof Response) return a
  try {
    const { data } = await a.client.invitations.getInvitationList({ status: 'pending', limit: 100, orderBy: '-created_at' })
    return json(200, {
      invitations: data.map((i) => ({ id: i.id, email: i.emailAddress, role: asRole(i.publicMetadata?.role), createdAt: i.createdAt })),
    })
  } catch {
    return json(502, { error: 'could not list invitations' })
  }
}

export async function POST(req: Request): Promise<Response> {
  const a = await requireAdmin(req)
  if (a instanceof Response) return a
  const b = await bodyOf(req)
  const email = typeof b.email === 'string' ? b.email.trim() : ''
  if (!EMAIL.test(email) || email.length > 254) return json(400, { error: 'enter a valid email address' })
  const role = asRole(b.role)
  const origin = req.headers.get('origin') || FALLBACK_ORIGIN
  try {
    const i = await a.client.invitations.createInvitation({ emailAddress: email, publicMetadata: { role }, redirectUrl: origin, ignoreExisting: false })
    return json(200, { invitation: { id: i.id, email: i.emailAddress, role, createdAt: i.createdAt } })
  } catch (e) {
    const msg = (e as { errors?: { message?: string }[] })?.errors?.[0]?.message
    return json(422, { error: msg ?? 'could not create the invitation' })
  }
}

export async function DELETE(req: Request): Promise<Response> {
  const a = await requireAdmin(req)
  if (a instanceof Response) return a
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return json(400, { error: 'invitation id required' })
  try {
    await a.client.invitations.revokeInvitation(id)
    return json(200, { ok: true })
  } catch {
    return json(422, { error: 'could not revoke the invitation' })
  }
}
