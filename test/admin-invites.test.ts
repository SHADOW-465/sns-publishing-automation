import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { deps } from '../api/_auth.ts'
import * as inv from '../api/admin/invitations.ts'
import * as usr from '../api/admin/users.ts'

type Role = string | undefined
const calls: { fn: string; args: unknown[] }[] = []
let session: { authed: boolean; userId: string | null } = { authed: true, userId: 'u_admin' }
let roles: Record<string, Role> = {}
const rec = (fn: string, ret: unknown) => async (...args: unknown[]) => (calls.push({ fn, args }), ret)

const fake = {
  authenticateRequest: async () => ({ isAuthenticated: session.authed, toAuth: () => (session.authed ? { userId: session.userId } : null) }),
  users: {
    getUser: async (id: string) => ({ id, publicMetadata: { role: roles[id] } }),
    getUserList: rec('getUserList', { data: [{ id: 'u_admin', primaryEmailAddressId: 'e1', emailAddresses: [{ id: 'e1', emailAddress: 'a@x.com' }], publicMetadata: { role: 'admin' } }, { id: 'u_m', primaryEmailAddressId: 'e2', emailAddresses: [{ id: 'e2', emailAddress: 'm@x.com' }], publicMetadata: {} }] }),
    updateUserMetadata: rec('updateUserMetadata', {}),
  },
  invitations: {
    getInvitationList: rec('getInvitationList', { data: [{ id: 'inv_1', emailAddress: 'p@x.com', publicMetadata: { role: 'admin' }, createdAt: 1 }] }),
    createInvitation: async (p: { emailAddress: string }) => (calls.push({ fn: 'createInvitation', args: [p] }), { id: 'inv_2', emailAddress: p.emailAddress, createdAt: 1 }),
    revokeInvitation: rec('revokeInvitation', {}),
  },
}

const realCreate = deps.createClient
const oldKey = process.env.CLERK_SECRET_KEY
beforeEach(() => {
  calls.length = 0
  session = { authed: true, userId: 'u_admin' }
  roles = { u_admin: 'admin', u_m: undefined }
  process.env.CLERK_SECRET_KEY = 'sk_test_fake'
  deps.createClient = (() => fake) as unknown as typeof deps.createClient
})
afterEach(() => {
  deps.createClient = realCreate
  if (oldKey === undefined) delete process.env.CLERK_SECRET_KEY
  else process.env.CLERK_SECRET_KEY = oldKey
})

const req = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) =>
  new Request('https://app.test' + path, { method, headers: { ...headers, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
const routes = [
  () => inv.GET(req('GET', '/api/admin/invitations')),
  () => usr.GET(req('GET', '/api/admin/users')),
]

test('missing secret -> 503 with the requireUser shape', async () => {
  delete process.env.CLERK_SECRET_KEY
  for (const run of routes) {
    const r = await run()
    assert.equal(r.status, 503)
    assert.deepEqual(await r.json(), { fallback: true, error: 'sign-in is not configured' })
    assert.equal(r.headers.get('cache-control'), 'no-store')
  }
})

test('unauthenticated -> 401, and nothing is called', async () => {
  session = { authed: false, userId: null }
  for (const run of routes) assert.equal((await run()).status, 401)
  assert.equal((await inv.POST(req('POST', '/api/admin/invitations', { email: 'a@b.co' }))).status, 401)
  assert.equal(calls.length, 0)
})

test('authenticated without a user id -> 401', async () => {
  session = { authed: true, userId: null }
  assert.equal((await usr.GET(req('GET', '/api/admin/users'))).status, 401)
})

test('authenticated non-admin -> 403 on every route and method, nothing mutated', async () => {
  session = { authed: true, userId: 'u_m' }
  const all = [
    await inv.GET(req('GET', '/api/admin/invitations')),
    await inv.POST(req('POST', '/api/admin/invitations', { email: 'a@b.co' })),
    await inv.DELETE(req('DELETE', '/api/admin/invitations?id=inv_1')),
    await usr.GET(req('GET', '/api/admin/users')),
    await usr.PATCH(req('PATCH', '/api/admin/users', { id: 'u_m', role: 'admin' })),
  ]
  for (const r of all) assert.equal(r.status, 403)
  assert.equal(calls.length, 0)
})

test('a client-supplied role header, body or claim never makes the caller admin', async () => {
  session = { authed: true, userId: 'u_m' }
  const h = { 'x-role': 'admin', 'x-user-role': 'admin' }
  assert.equal((await usr.GET(req('GET', '/api/admin/users', undefined, h))).status, 403)
  assert.equal((await usr.PATCH(req('PATCH', '/api/admin/users', { id: 'u_m', role: 'admin', callerRole: 'admin', publicMetadata: { role: 'admin' } }, h))).status, 403)
  assert.equal(calls.filter((c) => c.fn === 'updateUserMetadata').length, 0)
})

test('admin creates an invitation: role validated, redirectUrl from Origin, email validated', async () => {
  type P = { emailAddress: string; publicMetadata: { role: string }; redirectUrl: string }
  let r = await inv.POST(req('POST', '/api/admin/invitations', { email: ' New@X.com ', role: 'admin' }, { origin: 'https://preview.example' }))
  assert.equal(r.status, 200)
  let p = calls.find((c) => c.fn === 'createInvitation')!.args[0] as P
  assert.equal(p.emailAddress, 'New@X.com')
  assert.equal(p.publicMetadata.role, 'admin')
  assert.equal(p.redirectUrl, 'https://preview.example')

  calls.length = 0
  r = await inv.POST(req('POST', '/api/admin/invitations', { email: 'b@x.com', role: 'superuser' }))
  assert.equal(r.status, 200)
  p = calls[0].args[0] as P
  assert.equal(p.publicMetadata.role, 'member')
  assert.equal(p.redirectUrl, 'https://sns-publishing-automation.vercel.app')

  calls.length = 0
  assert.equal((await inv.POST(req('POST', '/api/admin/invitations', { email: 'not-an-email' }))).status, 400)
  assert.equal(calls.length, 0)
})

test('admin lists pending invitations and revokes one', async () => {
  const r = await inv.GET(req('GET', '/api/admin/invitations'))
  assert.deepEqual((await r.json()).invitations, [{ id: 'inv_1', email: 'p@x.com', role: 'admin', createdAt: 1 }])
  assert.equal((calls.find((c) => c.fn === 'getInvitationList')!.args[0] as { status: string }).status, 'pending')
  assert.equal((await inv.DELETE(req('DELETE', '/api/admin/invitations?id=inv_1'))).status, 200)
  assert.deepEqual(calls.at(-1), { fn: 'revokeInvitation', args: ['inv_1'] })
  assert.equal((await inv.DELETE(req('DELETE', '/api/admin/invitations'))).status, 400)
})

test('admin lists users (missing role reads as member) and changes a role', async () => {
  const body = await (await usr.GET(req('GET', '/api/admin/users'))).json()
  assert.equal(body.you, 'u_admin')
  assert.deepEqual(body.users.map((u: { email: string; role: string }) => [u.email, u.role]), [['a@x.com', 'admin'], ['m@x.com', 'member']])
  const r = await usr.PATCH(req('PATCH', '/api/admin/users', { id: 'u_m', role: 'admin' }))
  assert.equal(r.status, 200)
  assert.deepEqual(calls.at(-1), { fn: 'updateUserMetadata', args: ['u_m', { publicMetadata: { role: 'admin' } }] })
  assert.equal((await usr.PATCH(req('PATCH', '/api/admin/users', { id: 'u_m', role: 'owner' }))).status, 400)
})

test('an admin cannot demote themselves (403) and nothing is written', async () => {
  const r = await usr.PATCH(req('PATCH', '/api/admin/users', { id: 'u_admin', role: 'member' }))
  assert.equal(r.status, 403)
  assert.equal(calls.filter((c) => c.fn === 'updateUserMetadata').length, 0)
})

test('responses never contain the secret key', async () => {
  const text = await (await usr.GET(req('GET', '/api/admin/users'))).text()
  assert.ok(!text.includes('sk_test_fake'))
})
