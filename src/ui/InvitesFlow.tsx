import { useCallback, useEffect, useState } from 'react'
import { authHeaders } from '../auth/token.ts'

type Role = 'member' | 'admin'
type Invitation = { id: string; email: string; role: Role; createdAt?: number; expiresAt?: number | null }
type User = { id: string; email: string; role: Role }

async function api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: { ...(await authHeaders()), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `request failed (${res.status})`)
  return data as T
}

const day = (t?: number) => (t ? new Date(t).toLocaleDateString() : '—')

/** Admin page. No Clerk hooks here; App only mounts it inside AdminOnly on the web build. */
export function InvitesFlow() {
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Role>('member')
  const [invites, setInvites] = useState<Invitation[]>([])
  const [users, setUsers] = useState<User[]>([])
  const [you, setYou] = useState('')
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const [i, u] = await Promise.all([api<{ invitations: Invitation[] }>('/api/admin/invitations'), api<{ users: User[]; you: string }>('/api/admin/users')])
      setInvites(i.invitations)
      setUsers(u.users)
      setYou(u.you)
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    }
  }, [])
  useEffect(() => {
    void load()
  }, [load])

  const run = async (done: string, fn: () => Promise<unknown>) => {
    setBusy(true)
    setMsg(null)
    try {
      await fn()
      setMsg({ ok: true, text: done })
      await load()
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flow">
      <section className="card">
        <h2>Invite someone</h2>
        <p className="muted">They get an email with a sign-up link. Sign-up is closed to everyone else.</p>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault()
            void run(`Invitation sent to ${email.trim()}`, async () => {
              await api('/api/admin/invitations', 'POST', { email, role })
              setEmail('')
            })
          }}
        >
          <input type="email" required placeholder="name@example.com" aria-label="Email address" value={email} onChange={(e) => setEmail(e.target.value)} style={{ maxWidth: 320 }} />
          <select aria-label="Role" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
          <button className="primary" disabled={busy}>Send invitation</button>
        </form>
        {msg && (
          <p className={msg.ok ? 'note' : 'err'} role={msg.ok ? 'status' : 'alert'} style={{ marginTop: 10 }}>
            {msg.text}
          </p>
        )}
      </section>

      <section className="card">
        <h2>Pending invitations</h2>
        {invites.length === 0 ? (
          <p className="muted">No pending invitations.</p>
        ) : (
          <div className="table-wrap">
            <table className="styles">
              <thead>
                <tr><th>Email</th><th>Role</th><th>Sent</th><th /></tr>
              </thead>
              <tbody>
                {invites.map((i) => (
                  <tr key={i.id}>
                    <td>{i.email}</td>
                    <td>{i.role}</td>
                    <td>{day(i.createdAt)}</td>
                    <td><button disabled={busy} onClick={() => void run(`Revoked ${i.email}`, () => api(`/api/admin/invitations?id=${encodeURIComponent(i.id)}`, 'DELETE'))}>Revoke</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Users</h2>
        <div className="table-wrap">
          <table className="styles">
            <thead>
              <tr><th>Email</th><th>Role</th><th /></tr>
            </thead>
            <tbody>
              {users.map((u) => {
                const next: Role = u.role === 'admin' ? 'member' : 'admin'
                const self = u.id === you
                return (
                  <tr key={u.id}>
                    <td>{u.email}{self ? ' (you)' : ''}</td>
                    <td>{u.role}</td>
                    <td>
                      <button disabled={busy || (self && next === 'member')} title={self && next === 'member' ? 'You cannot demote yourself' : undefined} onClick={() => void run(`${u.email} is now ${next}`, () => api('/api/admin/users', 'PATCH', { id: u.id, role: next }))}>
                        {next === 'admin' ? 'Make admin' : 'Make member'}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  )
}
