import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

type DivType = 'mens' | 'mixed'
type FinalsFormat = 'none' | 'top4' | 'split8'

interface Division { id: string; name: string; type: DivType; finals_format: FinalsFormat; venue_night_id: string | null }
interface Night { id: string; venue_id: string; day_of_week: number; name: string | null }
interface Venue { id: string; name: string }

const blank: { name: string; type: DivType; finals_format: FinalsFormat } = { name: '', type: 'mixed', finals_format: 'top4' }

export function DivisionsPage() {
  const { venueId, nightId } = useParams<{ venueId: string; nightId: string }>()
  const [venue, setVenue] = useState<Venue | null>(null)
  const [night, setNight] = useState<Night | null>(null)
  const [divisions, setDivisions] = useState<Division[]>([])
  const [form, setForm] = useState<{ name: string; type: DivType; finals_format: FinalsFormat }>(blank)
  const [editing, setEditing] = useState<Division | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function load() {
    const [{ data: n }, { data: d }] = await Promise.all([
      supabase.from('venue_nights').select('id, venue_id, day_of_week, name').eq('id', nightId!).single(),
      supabase.from('divisions').select('*').eq('venue_night_id', nightId!).order('name'),
    ])
    setNight(n)
    setDivisions(d ?? [])
    if (n) {
      const { data: v } = await supabase.from('venues').select('id, name').eq('id', n.venue_id).single()
      setVenue(v)
    }
  }

  useEffect(() => { load() }, [nightId])

  function openCreate() { setEditing(null); setForm(blank); setShowForm(true); setError(null) }
  function openEdit(d: Division) {
    setEditing(d); setForm({ name: d.name, type: d.type, finals_format: d.finals_format }); setShowForm(true); setError(null)
  }

  async function save() {
    setSaving(true); setError(null)
    const { error } = editing
      ? await supabase.from('divisions').update(form).eq('id', editing.id)
      : await supabase.from('divisions').insert({ ...form, venue_night_id: nightId!, venue_id: night!.venue_id })
    if (error) setError(error.message)
    else { setShowForm(false); load() }
    setSaving(false)
  }

  async function remove(id: string) {
    if (!confirm('Delete this division? Its teams will also be deleted.')) return
    const { error } = await supabase.from('divisions').delete().eq('id', id)
    if (error) alert(error.message)
    else load()
  }

  const nightLabel = night ? (night.name ?? DAY_NAMES[night.day_of_week]) : '…'
  const finalsLabel = { none: 'None', top4: 'Top 4', split8: 'Split 8' }

  return (
    <div>
      <div className="breadcrumb">
        <Link to="/admin/venues">Venues</Link>
        {' › '}
        <Link to={`/admin/venues/${venueId}/nights`}>{venue?.name ?? '…'}</Link>
        {' › '}
        {nightLabel}
      </div>
      <div className="page-header">
        <h1>Divisions — {nightLabel}</h1>
        <button onClick={openCreate}>+ Add division</button>
      </div>

      {showForm && (
        <div className="card">
          <h2>{editing ? 'Edit division' : 'New division'}</h2>
          {error && <div className="form-error">{error}</div>}
          <div className="form-grid">
            <label>Name *<input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></label>
            <label>Type
              <select value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value as DivType }))}>
                <option value="mixed">Mixed</option>
                <option value="mens">Mens</option>
              </select>
            </label>
            <label>Finals format
              <select value={form.finals_format} onChange={e => setForm(f => ({ ...f, finals_format: e.target.value as FinalsFormat }))}>
                <option value="top4">Top 4 (1v4, 2v3 → GF)</option>
                <option value="split8">Split 8 (Championship + Plate)</option>
                <option value="none">None</option>
              </select>
            </label>
          </div>
          <div className="form-actions">
            <button onClick={save} disabled={saving || !form.name}>{saving ? 'Saving…' : 'Save'}</button>
            <button className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="table-scroll"><table className="data-table">
        <thead><tr><th>Name</th><th>Type</th><th>Finals</th><th>Teams</th><th></th></tr></thead>
        <tbody>
          {divisions.map(d => (
            <tr key={d.id}>
              <td>{d.name}</td>
              <td style={{ textTransform: 'capitalize' }}>{d.type}</td>
              <td>{finalsLabel[d.finals_format]}</td>
              <td><Link to={`/admin/venues/${venueId}/nights/${nightId}/divisions/${d.id}/teams`}>Manage teams</Link></td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <button className="btn-sm" onClick={() => openEdit(d)}>Edit</button>
                {' '}
                <button className="btn-sm btn-danger" onClick={() => remove(d.id)}>Delete</button>
              </td>
            </tr>
          ))}
          {divisions.length === 0 && <tr><td colSpan={5}>No divisions yet for this night.</td></tr>}
        </tbody>
      </table></div>
    </div>
  )
}
