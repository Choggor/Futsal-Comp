import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

interface TimeSlot { id: string; venue_id: string; start_time: string; slot_order: number }
interface Venue { id: string; name: string }

export function TimeSlotsPage() {
  const { venueId } = useParams<{ venueId: string }>()
  const [venue, setVenue] = useState<Venue | null>(null)
  const [slots, setSlots] = useState<TimeSlot[]>([])
  const [form, setForm] = useState({ start_time: '', slot_order: 1 })
  const [editing, setEditing] = useState<TimeSlot | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function load() {
    const [{ data: v }, { data: s }] = await Promise.all([
      supabase.from('venues').select('id, name').eq('id', venueId!).single(),
      supabase.from('time_slots').select('*').eq('venue_id', venueId!).order('slot_order'),
    ])
    setVenue(v); setSlots(s ?? [])
  }

  useEffect(() => { load() }, [venueId])

  function openCreate() {
    setEditing(null)
    const nextOrder = slots.length > 0 ? Math.max(...slots.map(s => s.slot_order)) + 1 : 1
    setForm({ start_time: '', slot_order: nextOrder })
    setShowForm(true); setError(null)
  }

  function openEdit(s: TimeSlot) {
    setEditing(s); setForm({ start_time: s.start_time, slot_order: s.slot_order }); setShowForm(true); setError(null)
  }

  async function save() {
    setSaving(true); setError(null)
    const { error } = editing
      ? await supabase.from('time_slots').update({ start_time: form.start_time, slot_order: form.slot_order }).eq('id', editing.id)
      : await supabase.from('time_slots').insert({ start_time: form.start_time, slot_order: form.slot_order, venue_id: venueId! })
    if (error) setError(error.message)
    else { setShowForm(false); load() }
    setSaving(false)
  }

  async function remove(id: string) {
    if (!confirm('Delete this time slot?')) return
    const { error } = await supabase.from('time_slots').delete().eq('id', id)
    if (error) alert(error.message)
    else load()
  }

  function fmt(t: string) {
    if (!t) return ''
    const [h, m] = t.split(':')
    const hour = parseInt(h)
    return `${hour % 12 || 12}:${m} ${hour < 12 ? 'am' : 'pm'}`
  }

  return (
    <div>
      <div className="breadcrumb">
        <Link to="/admin/venues">Venues</Link> › {venue?.name ?? '…'}
      </div>
      <div className="page-header">
        <h1>Time Slots — {venue?.name}</h1>
        <button onClick={openCreate}>+ Add slot</button>
      </div>

      {showForm && (
        <div className="card">
          <h2>{editing ? 'Edit slot' : 'New slot'}</h2>
          {error && <div className="form-error">{error}</div>}
          <div className="form-grid">
            <label>Start time *<input type="time" value={form.start_time} onChange={e => setForm(f => ({ ...f, start_time: e.target.value }))} /></label>
            <label>Order (lower = earlier)<input type="number" min={1} value={form.slot_order} onChange={e => setForm(f => ({ ...f, slot_order: parseInt(e.target.value) }))} /></label>
          </div>
          <div className="form-actions">
            <button onClick={save} disabled={saving || !form.start_time}>{saving ? 'Saving…' : 'Save'}</button>
            <button className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      <table className="data-table">
        <thead><tr><th>Order</th><th>Start time</th><th></th></tr></thead>
        <tbody>
          {slots.map(s => (
            <tr key={s.id}>
              <td>{s.slot_order}</td>
              <td>{fmt(s.start_time)}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <button className="btn-sm" onClick={() => openEdit(s)}>Edit</button>
                {' '}
                <button className="btn-sm btn-danger" onClick={() => remove(s.id)}>Delete</button>
              </td>
            </tr>
          ))}
          {slots.length === 0 && <tr><td colSpan={3}>No time slots yet.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}
