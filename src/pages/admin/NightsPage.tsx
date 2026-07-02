import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

interface Night { id: string; venue_id: string; day_of_week: number; name: string | null }
interface Venue { id: string; name: string }

export function NightsPage() {
  const { venueId } = useParams<{ venueId: string }>()
  const [venue, setVenue] = useState<Venue | null>(null)
  const [nights, setNights] = useState<Night[]>([])
  const [form, setForm] = useState({ day_of_week: 1, name: '' })
  const [editing, setEditing] = useState<Night | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function load() {
    const [{ data: v }, { data: n }] = await Promise.all([
      supabase.from('venues').select('id, name').eq('id', venueId!).single(),
      supabase.from('venue_nights').select('*').eq('venue_id', venueId!).order('day_of_week'),
    ])
    setVenue(v); setNights(n ?? [])
  }

  useEffect(() => { load() }, [venueId])

  function openCreate() { setEditing(null); setForm({ day_of_week: 1, name: '' }); setShowForm(true); setError(null) }
  function openEdit(n: Night) { setEditing(n); setForm({ day_of_week: n.day_of_week, name: n.name ?? '' }); setShowForm(true); setError(null) }

  async function save() {
    setSaving(true); setError(null)
    const payload = { day_of_week: form.day_of_week, name: form.name || null, venue_id: venueId! }
    const { error } = editing
      ? await supabase.from('venue_nights').update({ day_of_week: form.day_of_week, name: form.name || null }).eq('id', editing.id)
      : await supabase.from('venue_nights').insert(payload)
    if (error) setError(error.message)
    else { setShowForm(false); load() }
    setSaving(false)
  }

  async function remove(id: string) {
    if (!confirm('Delete this night? All its divisions and teams will also be deleted.')) return
    const { error } = await supabase.from('venue_nights').delete().eq('id', id)
    if (error) alert(error.message)
    else load()
  }

  const usedDays = new Set(nights.filter(n => !editing || n.id !== editing.id).map(n => n.day_of_week))

  return (
    <div>
      <div className="breadcrumb"><Link to="/admin/venues">Venues</Link> › {venue?.name ?? '…'}</div>
      <div className="page-header">
        <h1>Competition Nights — {venue?.name}</h1>
        <button onClick={openCreate}>+ Add night</button>
      </div>

      {showForm && (
        <div className="card">
          <h2>{editing ? 'Edit night' : 'New competition night'}</h2>
          {error && <div className="form-error">{error}</div>}
          <div className="form-grid">
            <label>Day of week *
              <select value={form.day_of_week} onChange={e => setForm(f => ({ ...f, day_of_week: parseInt(e.target.value) }))}>
                {DAY_NAMES.map((d, i) => (
                  <option key={i} value={i} disabled={usedDays.has(i)}>{d}{usedDays.has(i) ? ' (already configured)' : ''}</option>
                ))}
              </select>
            </label>
            <label>Display name (optional)
              <input placeholder={`e.g. ${DAY_NAMES[form.day_of_week]} Night`} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </label>
          </div>
          <div className="form-actions">
            <button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
            <button className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="table-scroll"><table className="data-table">
        <thead><tr><th>Night</th><th>Divisions</th><th></th></tr></thead>
        <tbody>
          {nights.map(n => (
            <tr key={n.id}>
              <td>
                <strong>{n.name ?? DAY_NAMES[n.day_of_week]}</strong>
                {n.name && <span style={{ color: 'var(--color-muted)', fontSize: '0.8rem', marginLeft: 8 }}>{DAY_NAMES[n.day_of_week]}</span>}
              </td>
              <td><Link to={`/admin/venues/${venueId}/nights/${n.id}/divisions`}>Manage divisions</Link></td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <button className="btn-sm" onClick={() => openEdit(n)}>Edit</button>
                {' '}
                <button className="btn-sm btn-danger" onClick={() => remove(n.id)}>Delete</button>
              </td>
            </tr>
          ))}
          {nights.length === 0 && <tr><td colSpan={3}>No competition nights yet. Add one to start configuring divisions.</td></tr>}
        </tbody>
      </table></div>
    </div>
  )
}
