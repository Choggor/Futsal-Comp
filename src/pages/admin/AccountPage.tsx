import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'

export function AccountPage() {
  const { appUser, session } = useAuth()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setError(null); setDone(false)
    if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    if (password !== confirm) { setError('Passwords do not match'); return }
    setSaving(true)
    const { error } = await supabase.auth.updateUser({ password })
    setSaving(false)
    if (error) { setError(error.message); return }
    setPassword(''); setConfirm(''); setDone(true)
  }

  return (
    <div>
      <div className="page-header">
        <h1>Account</h1>
      </div>

      <div className="card" style={{ maxWidth: 460 }}>
        <div style={{ marginBottom: '1rem', fontSize: '0.875rem' }}>
          <div><span style={{ color: 'var(--color-muted)' }}>Signed in as</span> <strong>{appUser?.display_name ?? session?.user?.email}</strong></div>
          <div style={{ color: 'var(--color-muted)' }}>{session?.user?.email}</div>
        </div>

        <h2 style={{ fontSize: '1rem' }}>Change password</h2>
        <form onSubmit={save}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.5rem' }}>
            <label>
              New password
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Min 8 characters" autoComplete="new-password" required />
            </label>
            <label>
              Confirm new password
              <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)} autoComplete="new-password" required />
            </label>
          </div>
          {error && <div className="form-error" style={{ marginTop: '0.75rem' }}>{error}</div>}
          {done && (
            <div style={{ color: '#065f46', background: '#d1fae5', padding: '0.6rem 0.9rem', borderRadius: 'var(--radius)', fontSize: '0.875rem', marginTop: '0.75rem' }}>
              Password updated.
            </div>
          )}
          <div className="form-actions">
            <button type="submit" disabled={saving}>{saving ? 'Saving…' : 'Update password'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}
