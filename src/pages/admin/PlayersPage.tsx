import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'

interface TeamRef {
  team_id: string
  teams: { id: string; name: string; divisions: { name: string; venue_id: string } }
}

interface Player {
  id: string
  name: string
  insurance_expiry: string | null
  team_players: TeamRef[]
}

interface TeamOption {
  id: string
  name: string
  division_name: string
  venue_id: string
  venue_name: string
}

const blankForm = { name: '', insurance_expiry: '', team_id: '' }

function insuranceBadge(expiry: string | null) {
  if (!expiry || new Date(expiry) < new Date()) {
    return <span className="badge badge-warn">PAYMENT REQUIRED</span>
  }
  return <span className="badge badge-ok">Paid — expires {expiry}</span>
}

export function PlayersPage() {
  const { isSuperAdmin, venueScopes } = useAuth()
  const [players, setPlayers] = useState<Player[]>([])
  const [teamOptions, setTeamOptions] = useState<TeamOption[]>([])
  const [search, setSearch] = useState('')
  const [form, setForm] = useState(blankForm)
  const [editing, setEditing] = useState<Player | null>(null)
  const [showForm, setShowForm] = useState(false)
  const [assignTarget, setAssignTarget] = useState<Player | null>(null)
  const [assignTeamId, setAssignTeamId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function load() {
    const { data } = await supabase
      .from('players')
      .select('id, name, insurance_expiry, team_players(team_id, teams(id, name, divisions(name, venue_id)))')
      .order('name')
    setPlayers((data ?? []) as unknown as Player[])
  }

  async function loadTeams() {
    const { data } = await supabase
      .from('teams')
      .select('id, name, divisions(name, venue_id, venues(name))')
      .order('name')
    const flat: TeamOption[] = (data ?? []).map((t: any) => ({
      id: t.id,
      name: t.name,
      division_name: t.divisions?.name ?? '',
      venue_id: t.divisions?.venue_id ?? '',
      venue_name: t.divisions?.venues?.name ?? '',
    }))
    setTeamOptions(isSuperAdmin ? flat : flat.filter(t => venueScopes.includes(t.venue_id)))
  }

  useEffect(() => { load(); loadTeams() }, [isSuperAdmin, venueScopes.join(',')])

  function openCreate() {
    setEditing(null); setForm(blankForm); setShowForm(true); setError(null)
  }

  function openEdit(p: Player) {
    setEditing(p)
    setForm({ name: p.name, insurance_expiry: p.insurance_expiry ?? '', team_id: '' })
    setShowForm(true); setError(null)
  }

  async function save() {
    setSaving(true); setError(null)
    const payload = { name: form.name, insurance_expiry: form.insurance_expiry || null }

    if (editing) {
      const { error } = await supabase.from('players').update(payload).eq('id', editing.id)
      if (error) { setError(error.message); setSaving(false); return }
    } else {
      const { data: created, error } = await supabase.from('players').insert(payload).select('id').single()
      if (error) { setError(error.message); setSaving(false); return }
      if (form.team_id && created) {
        const { error: rErr } = await supabase.from('team_players').insert({ player_id: created.id, team_id: form.team_id })
        if (rErr) { setError(rErr.message); setSaving(false); return }
      }
    }

    setShowForm(false); load(); setSaving(false)
  }

  async function remove(id: string) {
    if (!confirm('Delete this player? They will be removed from all teams.')) return
    const { error } = await supabase.from('players').delete().eq('id', id)
    if (error) alert(error.message)
    else load()
  }

  async function assignToTeam() {
    if (!assignTarget || !assignTeamId) return
    setSaving(true)
    const { error } = await supabase.from('team_players').insert({ player_id: assignTarget.id, team_id: assignTeamId })
    if (error) alert(error.message)
    setAssignTarget(null); setAssignTeamId(''); setSaving(false); load()
  }

  async function removeFromTeam(playerId: string, teamId: string) {
    if (!confirm('Remove this player from the team?')) return
    await supabase.from('team_players').delete().eq('player_id', playerId).eq('team_id', teamId)
    load()
  }

  const [teamFilter, setTeamFilter] = useState<string>('all')

  // All unique teams across all players for the filter chips
  const allTeams = Array.from(
    new Map(
      players.flatMap(p => p.team_players.map(tp => [tp.team_id, tp.teams.name]))
    ).entries()
  ).sort((a, b) => a[1].localeCompare(b[1]))

  const filtered = players.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(search.toLowerCase())
    const matchesTeam = teamFilter === 'all' || p.team_players.some(tp => tp.team_id === teamFilter)
    return matchesSearch && matchesTeam
  })

  return (
    <div>
      <div className="page-header">
        <h1>Players</h1>
        <button onClick={openCreate}>+ Add player</button>
      </div>

      {showForm && (
        <div className="card">
          <h2>{editing ? 'Edit player' : 'New player'}</h2>
          {error && <div className="form-error">{error}</div>}
          <div className="form-grid">
            <label>Name *<input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></label>
            <label>Insurance expiry
              <input type="date" value={form.insurance_expiry} onChange={e => setForm(f => ({ ...f, insurance_expiry: e.target.value }))} />
            </label>
            {!editing && teamOptions.length > 0 && (
              <label>Assign to team (optional)
                <select value={form.team_id} onChange={e => setForm(f => ({ ...f, team_id: e.target.value }))}>
                  <option value="">— none —</option>
                  {teamOptions.map(t => (
                    <option key={t.id} value={t.id}>{t.name} ({t.division_name} @ {t.venue_name})</option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <div className="form-actions">
            <button onClick={save} disabled={saving || !form.name}>{saving ? 'Saving…' : 'Save'}</button>
            <button className="btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
          </div>
        </div>
      )}

      {assignTarget && (
        <div className="card">
          <h2>Assign {assignTarget.name} to a team</h2>
          <label>Team
            <select value={assignTeamId} onChange={e => setAssignTeamId(e.target.value)}>
              <option value="">— select —</option>
              {teamOptions
                .filter(t => !assignTarget.team_players.some(tp => tp.team_id === t.id))
                .map(t => (
                  <option key={t.id} value={t.id}>{t.name} ({t.division_name} @ {t.venue_name})</option>
                ))}
            </select>
          </label>
          <div className="form-actions">
            <button onClick={assignToTeam} disabled={!assignTeamId || saving}>Assign</button>
            <button className="btn-secondary" onClick={() => setAssignTarget(null)}>Cancel</button>
          </div>
        </div>
      )}

      <div style={{ marginBottom: '0.75rem' }}>
        <input
          type="search"
          placeholder="Search players…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ maxWidth: 340 }}
        />
      </div>

      {allTeams.length > 0 && (
        <div style={{ marginBottom: '1rem', maxWidth: 340 }}>
          <select value={teamFilter} onChange={e => setTeamFilter(e.target.value)}>
            <option value="all">All teams</option>
            {allTeams.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
        </div>
      )}

      <div style={{ fontSize: '0.8rem', color: 'var(--color-muted)', marginBottom: '0.5rem' }}>
        {filtered.length} player{filtered.length !== 1 ? 's' : ''}
        {teamFilter !== 'all' && ` · ${allTeams.find(([id]) => id === teamFilter)?.[1]}`}
        {search && ` · "${search}"`}
      </div>

      <div className="table-scroll"><table className="data-table">
        <thead>
          <tr><th>Name</th><th>Insurance</th><th>Teams</th><th></th></tr>
        </thead>
        <tbody>
          {filtered.map(p => (
            <tr key={p.id}>
              <td>{p.name}</td>
              <td>{insuranceBadge(p.insurance_expiry)}</td>
              <td>
                {p.team_players.map(tp => (
                  <span key={tp.team_id} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginRight: 8, fontSize: '0.8rem' }}>
                    {tp.teams.name}
                    {isSuperAdmin && (
                      <button
                        className="btn-sm btn-danger"
                        style={{ padding: '0 5px', lineHeight: 1.2, fontSize: '0.7rem' }}
                        onClick={() => removeFromTeam(p.id, tp.team_id)}
                      >×</button>
                    )}
                  </span>
                ))}
              </td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <button className="btn-sm" onClick={() => setAssignTarget(p)}>+ Team</button>
                {isSuperAdmin && (
                  <>
                    {' '}
                    <button className="btn-sm" onClick={() => openEdit(p)}>Edit</button>
                    {' '}
                    <button className="btn-sm btn-danger" onClick={() => remove(p.id)}>Delete</button>
                  </>
                )}
              </td>
            </tr>
          ))}
          {filtered.length === 0 && (
            <tr><td colSpan={4}>{search ? 'No players match your search.' : 'No players yet.'}</td></tr>
          )}
        </tbody>
      </table></div>
    </div>
  )
}
