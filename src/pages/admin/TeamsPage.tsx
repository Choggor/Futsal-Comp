import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

interface Team { id: string; division_id: string; name: string }

export function TeamsPage() {
  const { venueId, nightId, divisionId } = useParams<{ venueId: string; nightId: string; divisionId: string }>()
  const [venue, setVenue] = useState<{ name: string } | null>(null)
  const [night, setNight] = useState<{ name: string | null; day_of_week: number; venue_id: string } | null>(null)
  const [division, setDivision] = useState<{ name: string } | null>(null)
  const [teams, setTeams] = useState<Team[]>([])
  const [form, setForm] = useState({ name: '' })
  const [editing, setEditing] = useState<Team | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function load() {
    const [{ data: d }, { data: t }, { data: n }] = await Promise.all([
      supabase.from('divisions').select('name').eq('id', divisionId!).single(),
      supabase.from('teams').select('*').eq('division_id', divisionId!).order('name'),
      supabase.from('venue_nights').select('name, day_of_week, venue_id').eq('id', nightId!).single(),
    ])
    setDivision(d); setTeams(t ?? []); setNight(n)
    if (n) {
      const { data: v } = await supabase.from('venues').select('name').eq('id', n.venue_id).single()
      setVenue(v)
    }
  }

  useEffect(() => { load() }, [divisionId])

  function openCreate() { setEditing(null); setForm({ name: '' }); setShowForm(true); setError(null) }
  function openEdit(t: Team) { setEditing(t); setForm({ name: t.name }); setShowForm(true); setError(null) }

  async function save() {
    setSaving(true); setError(null)
    const { error } = editing
      ? await supabase.from('teams').update({ name: form.name }).eq('id', editing.id)
      : await supabase.from('teams').insert({ name: form.name, division_id: divisionId! })
    if (error) setError(error.message)
    else { setShowForm(false); load() }
    setSaving(false)
  }

  async function remove(id: string) {
    if (!confirm('Delete this team?')) return
    const { error } = await supabase.from('teams').delete().eq('id', id)
    if (error) alert(error.message)
    else load()
  }

  const nightLabel = night ? (night.name ?? DAY_NAMES[night.day_of_week]) : '…'

  return (
    <div>
      <div className="breadcrumb">
        <Link to="/admin/venues">Venues</Link>
        {' › '}
        <Link to={`/admin/venues/${venueId}/nights`}>{venue?.name ?? '…'}</Link>
        {' › '}
        <Link to={`/admin/venues/${venueId}/nights/${nightId}/divisions`}>{nightLabel}</Link>
        {' › '}
        {division?.name ?? '…'}
      </div>
      <div className="page-header">
        <h1>Teams — {division?.name}</h1>
        <button onClick={openCreate}>+ Add team</button>
      </div>

      {showForm && (
        <div className="card">
          <h2>{editing ? 'Edit team' : 'New team'}</h2>
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
          {teams.map(t => (
            <tr key={t.id}>
              <td>{t.name}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <button className="btn-sm" onClick={() => openEdit(t)}>Edit</button>
                {' '}
                <button className="btn-sm btn-danger" onClick={() => remove(t.id)}>Delete</button>
              </td>
            </tr>
          ))}
          {teams.length === 0 && <tr><td colSpan={2}>No teams yet.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}
