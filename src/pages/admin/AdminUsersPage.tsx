import { useEffect, useState, useCallback } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'

interface AppUser {
  id: string
  auth_user_id: string
  display_name: string
  role: string
  created_at: string
  venues: { venue_id: string }[]
}

interface Venue { id: string; name: string }

export function AdminUsersPage() {
  const { session } = useAuth()
  const [users, setUsers] = useState<AppUser[]>([])
  const [venues, setVenues] = useState<Venue[]>([])
  const [loading, setLoading] = useState(true)

  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [role, setRole] = useState<'sub_admin' | 'super_admin'>('sub_admin')
  const [inviting, setInviting] = useState(false)
  const [inviteResult, setInviteResult] = useState<string | null>(null)
  const [inviteError, setInviteError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: u }, { data: v }] = await Promise.all([
      supabase
        .from('app_users')
        .select('id, auth_user_id, display_name, role, created_at, venues:admin_venue_access(venue_id)')
        .order('created_at'),
      supabase.from('venues').select('id, name').order('name'),
    ])
    setUsers((u ?? []) as AppUser[])
    setVenues(v ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function handleInvite(e: React.FormEvent) {
    e.preventDefault()
    setInviting(true)
    setInviteResult(null)
    setInviteError(null)

    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite-admin`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ email, display_name: displayName, role }),
      }
    )
    const json = await res.json()
    if (json.error) {
      setInviteError(json.error)
    } else {
      setInviteResult(`Invite sent to ${email}`)
      setEmail('')
      setDisplayName('')
      setRole('sub_admin')
      load()
    }
    setInviting(false)
  }

  async function toggleVenueAccess(userId: string, venueId: string, hasAccess: boolean) {
    if (hasAccess) {
      await supabase.from('admin_venue_access').delete()
        .eq('user_id', userId).eq('venue_id', venueId)
    } else {
      await supabase.from('admin_venue_access').insert({ user_id: userId, venue_id: venueId })
    }
    load()
  }

  async function removeUser(u: AppUser) {
    const label = u.role === 'super_admin' ? 'super admin' : 'venue admin'
    if (!confirm(`Remove this ${label}? They will lose all access.`)) return
    const { data: { session } } = await supabase.auth.getSession()
    const res = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite-admin`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ action: 'delete', app_user_id: u.id }),
      }
    )
    const json = await res.json()
    if (json.error) alert(json.error)
    else load()
  }

  const venueAdmins = users.filter(u => u.role === 'sub_admin')
  const superAdmins = users.filter(u => u.role === 'super_admin')

  return (
    <div>
      <div className="page-header">
        <h1>Admin Users</h1>
      </div>

      {/* Invite form */}
      <div className="card">
        <h2>Invite admin</h2>
        <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)', marginBottom: '1rem' }}>
          They'll receive an email with a link to set their password.
        </p>
        <form onSubmit={handleInvite}>
          <div className="form-grid">
            <label>
              Email address
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="admin@example.com"
                required
              />
            </label>
            <label>
              Display name
              <input
                type="text"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
                placeholder="Jane Smith"
              />
            </label>
            <label>
              Role
              <select value={role} onChange={e => setRole(e.target.value as any)}>
                <option value="sub_admin">Venue admin — scoped to assigned venues</option>
                <option value="super_admin">Super admin — full access</option>
              </select>
            </label>
          </div>
          {inviteError && <div className="form-error">{inviteError}</div>}
          {inviteResult && (
            <div style={{ color: '#065f46', background: '#d1fae5', padding: '0.6rem 0.9rem', borderRadius: 'var(--radius)', fontSize: '0.875rem', marginBottom: '0.75rem' }}>
              {inviteResult}
            </div>
          )}
          <div className="form-actions">
            <button type="submit" disabled={inviting}>
              {inviting ? 'Sending…' : 'Send invite'}
            </button>
          </div>
        </form>
      </div>

      {loading && <div className="loading">Loading…</div>}

      {/* Super admins */}
      {!loading && superAdmins.length > 0 && (
        <div className="card">
          <h2>Super admins ({superAdmins.length})</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {superAdmins.map(u => {
              const isSelf = u.auth_user_id === session?.user?.id
              return (
                <div key={u.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <span style={{ fontWeight: 600 }}>{u.display_name}</span>
                    {isSelf && <span style={{ fontSize: '0.78rem', color: 'var(--color-muted)' }}>(you)</span>}
                  </div>
                  {!isSelf && (
                    <button className="btn-sm btn-danger" onClick={() => removeUser(u)}>Remove</button>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Venue admins */}
      {!loading && (
        <div className="card">
          <h2>Venue admins {venueAdmins.length > 0 && `(${venueAdmins.length})`}</h2>
          {venueAdmins.length === 0 ? (
            <p style={{ color: 'var(--color-muted)', fontSize: '0.875rem' }}>No venue admins yet — invite one above.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {venueAdmins.map(u => {
                const assignedIds = new Set(u.venues.map(v => v.venue_id))
                return (
                  <div key={u.id} style={{ borderBottom: '1px solid var(--color-border)', paddingBottom: '1.25rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem', flexWrap: 'wrap', gap: '0.5rem' }}>
                      <div>
                        <span style={{ fontWeight: 600 }}>{u.display_name}</span>
                        <span style={{ marginLeft: '0.75rem', fontSize: '0.8rem', color: 'var(--color-muted)' }}>
                          {assignedIds.size} venue{assignedIds.size !== 1 ? 's' : ''}
                        </span>
                      </div>
                      <button className="btn-sm btn-danger" onClick={() => removeUser(u)}>Remove</button>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                      {venues.map(v => {
                        const has = assignedIds.has(v.id)
                        return (
                          <button
                            key={v.id}
                            className={has ? '' : 'btn-secondary'}
                            style={{ fontSize: '0.82rem', padding: '0.3rem 0.7rem' }}
                            onClick={() => toggleVenueAccess(u.id, v.id, has)}
                          >
                            {has ? '✓ ' : ''}{v.name}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

