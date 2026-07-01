import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'

interface Venue {
  id: string
  name: string
  address: string | null
  latitude: number | null
  longitude: number | null
  points_win: number
  points_draw: number
  points_loss: number
  mvp_enabled: boolean
}

const blank = { name: '', address: '', latitude: '', longitude: '', points_win: 3, points_draw: 1, points_loss: 0, mvp_enabled: false }

export function VenuesPage() {
  const { isSuperAdmin } = useAuth()
  const [venues, setVenues] = useState<Venue[]>([])
  const [form, setForm] = useState(blank)
  const [editing, setEditing] = useState<Venue | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function load() {
    const { data } = await supabase.from('venues').select('*').order('name')
    setVenues(data ?? [])
  }

  useEffect(() => { load() }, [])

  function openCreate() {
    setEditing(null); setForm(blank); setShowForm(true); setError(null)
  }

  function openEdit(v: Venue) {
    setEditing(v)
    setForm({
      name: v.name,
      address: v.address ?? '',
      latitude: v.latitude?.toString() ?? '',
      longitude: v.longitude?.toString() ?? '',
      points_win: v.points_win,
      points_draw: v.points_draw,
      points_loss: v.points_loss,
      mvp_enabled: v.mvp_enabled,
    })
    setShowForm(true); setError(null)
  }

  async function save() {
    setSaving(true); setError(null)
    const payload = {
      name: form.name,
      address: form.address || null,
      latitude: form.latitude ? parseFloat(form.latitude) : null,
      longitude: form.longitude ? parseFloat(form.longitude) : null,
      points_win: form.points_win,
      points_draw: form.points_draw,
      points_loss: form.points_loss,
      mvp_enabled: form.mvp_enabled,
      timezone: 'Australia/Sydney',
    }
    const { error } = editing
      ? await supabase.from('venues').update(payload).eq('id', editing.id)
      : await supabase.from('venues').insert(payload)
    if (error) setError(error.message)
    else { setShowForm(false); load() }
    setSaving(false)
  }

  async function remove(id: string) {
    if (!confirm('Delete this venue? Courts, time slots and divisions will also be deleted.')) return
    const { error } = await supabase.from('venues').delete().eq('id', id)
    if (error) alert(error.message)
    else load()
  }

  const set = (field: string, value: unknown) => setForm(f => ({ ...f, [field]: value }))

  return (
    <div>
      <div className="page-header">
        <h1>Venues</h1>
        {isSuperAdmin && <button onClick={openCreate}>+ Add venue</button>}
      </div>

      {showForm && isSuperAdmin && (
        <div className="card">
          <h2>{editing ? 'Edit venue' : 'New venue'}</h2>
          {error && <div className="form-error">{error}</div>}
          <div className="form-grid">
            <label>Name *<input value={form.name} onChange={e => set('name', e.target.value)} /></label>
            <label>Address<input value={form.address} onChange={e => set('address', e.target.value)} /></label>
            <label>Latitude<input type="number" step="any" value={form.latitude} onChange={e => set('latitude', e.target.value)} /></label>
            <label>Longitude<input type="number" step="any" value={form.longitude} onChange={e => set('longitude', e.target.value)} /></label>
            <label>Points — win<input type="number" value={form.points_win} onChange={e => set('points_win', parseInt(e.target.value))} /></label>
            <label>Points — draw<input type="number" value={form.points_draw} onChange={e => set('points_draw', parseInt(e.target.value))} /></label>
            <label>Points — loss<input type="number" value={form.points_loss} onChange={e => set('points_loss', parseInt(e.target.value))} /></label>
            <label className="checkbox-label">
              <input type="checkbox" checked={form.mvp_enabled} onChange={e => set('mvp_enabled', e.target.checked)} />
              MVP points enabled
            </label>
          </div>
          <div className="form-actions">
            <button onClick={save} disabled={saving || !form.name}>{saving ? 'Saving…' : 'Save'}</button>
            <button className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      {venues.length === 0 && (
        <div className="card" style={{ color: 'var(--color-muted)', fontSize: '0.9rem' }}>No venues yet — add one above.</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
        {venues.map(v => (
          <div key={v.id} className="card" style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginBottom: 0 }}>
            {/* Header */}
            <div>
              <div style={{ fontWeight: 700, fontSize: '1.1rem' }}>{v.name}</div>
              {v.address && <div style={{ fontSize: '0.82rem', color: 'var(--color-muted)', marginTop: '0.15rem' }}>{v.address}</div>}
              <div style={{ fontSize: '0.78rem', color: 'var(--color-muted)', marginTop: '0.25rem' }}>
                Points: {v.points_win}W / {v.points_draw}D / {v.points_loss}L
                {v.mvp_enabled && <span style={{ marginLeft: '0.6rem', background: '#dbeafe', color: '#1d4ed8', borderRadius: 999, padding: '0.1rem 0.5rem', fontSize: '0.72rem', fontWeight: 600 }}>MVP</span>}
              </div>
            </div>

            {/* Manage buttons */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.4rem' }}>
              {[
                { label: 'Courts', to: `/admin/venues/${v.id}/courts` },
                { label: 'Time Slots', to: `/admin/venues/${v.id}/timeslots` },
                { label: 'Nights', to: `/admin/venues/${v.id}/nights` },
              ].map(({ label, to }) => (
                <Link key={label} to={to} style={{ textDecoration: 'none' }}>
                  <button className="btn-secondary" style={{ width: '100%', fontSize: '0.82rem', padding: '0.5rem 0.25rem', textAlign: 'center' }}>
                    {label}
                  </button>
                </Link>
              ))}
            </div>

            {/* Edit / Delete */}
            {isSuperAdmin && (
              <div style={{ display: 'flex', gap: '0.4rem', paddingTop: '0.25rem', borderTop: '1px solid var(--color-border)' }}>
                <button className="btn-sm btn-secondary" style={{ flex: 1 }} onClick={() => openEdit(v)}>Edit</button>
                <button className="btn-sm btn-danger" style={{ flex: 1 }} onClick={() => remove(v.id)}>Delete</button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
