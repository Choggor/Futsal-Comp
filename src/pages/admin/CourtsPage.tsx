import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

interface Court { id: string; venue_id: string; name: string }
interface Venue { id: string; name: string }

export function CourtsPage() {
  const { venueId } = useParams<{ venueId: string }>()
  const [venue, setVenue] = useState<Venue | null>(null)
  const [courts, setCourts] = useState<Court[]>([])
  const [form, setForm] = useState({ name: '' })
  const [editing, setEditing] = useState<Court | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function load() {
    const [{ data: v }, { data: c }] = await Promise.all([
      supabase.from('venues').select('id, name').eq('id', venueId!).single(),
      supabase.from('courts').select('*').eq('venue_id', venueId!).order('name'),
    ])
    setVenue(v); setCourts(c ?? [])
  }

  useEffect(() => { load() }, [venueId])

  function openCreate() { setEditing(null); setForm({ name: '' }); setShowForm(true); setError(null) }
  function openEdit(c: Court) { setEditing(c); setForm({ name: c.name }); setShowForm(true); setError(null) }

  async function save() {
    setSaving(true); setError(null)
    const { error } = editing
      ? await supabase.from('courts').update({ name: form.name }).eq('id', editing.id)
      : await supabase.from('courts').insert({ name: form.name, venue_id: venueId! })
    if (error) setError(error.message)
    else { setShowForm(false); load() }
    setSaving(false)
  }

  async function remove(id: string) {
    if (!confirm('Delete this court?')) return
    const { error } = await supabase.from('courts').delete().eq('id', id)
    if (error) alert(error.message)
    else load()
  }

  return (
    <div>
      <div className="breadcrumb">
        <Link to="/admin/venues">Venues</Link> › {venue?.name ?? '…'}
      </div>
      <div className="page-header">
        <h1>Courts — {venue?.name}</h1>
        <button onClick={openCreate}>+ Add court</button>
      </div>

      {showForm && (
        <div className="card">
          <h2>{editing ? 'Edit court' : 'New court'}</h2>
          {error && <div className="form-error">{error}</div>}
          <label>Name *<input value={form.name} onChange={e => setForm({ name: e.target.value })} /></label>
          <div className="form-actions">
            <button onClick={save} disabled={saving || !form.name}>{saving ? 'Saving…' : 'Save'}</button>
            <button className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      <table className="data-table">
        <thead><tr><th>Name</th><th></th></tr></thead>
        <tbody>
          {courts.map(c => (
            <tr key={c.id}>
              <td>{c.name}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <button className="btn-sm" onClick={() => openEdit(c)}>Edit</button>
                {' '}
                <button className="btn-sm btn-danger" onClick={() => remove(c.id)}>Delete</button>
              </td>
            </tr>
          ))}
          {courts.length === 0 && <tr><td colSpan={2}>No courts yet.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}
