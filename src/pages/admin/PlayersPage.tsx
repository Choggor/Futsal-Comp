import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'

const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']

interface TeamRef {
  team_id: string
  teams: { id: string; name: string; divisions: { name: string; venue_id: string; venue_night_id: string | null } }
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
  venue_night_id: string | null
  night_name: string
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
      .select('id, name, divisions(name, venue_id, venue_night_id, venues(name), venue_nights(name, day_of_week))')
      .order('name')
    const flat: TeamOption[] = (data ?? []).map((t: any) => {
      const vn = t.divisions?.venue_nights
      const nightName = vn ? (vn.name ?? DAY_NAMES[vn.day_of_week] ?? 'Unknown') : ''
      return {
        id: t.id,
        name: t.name,
        division_name: t.divisions?.name ?? '',
        venue_id: t.divisions?.venue_id ?? '',
        venue_name: t.divisions?.venues?.name ?? '',
        venue_night_id: t.divisions?.venue_night_id ?? null,
        night_name: nightName,
      }
    })
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

  const [venueFilter, setVenueFilter] = useState('all')
  const [nightFilter, setNightFilter] = useState('all')
  const [teamFilter, setTeamFilter] = useState('all')

  // Derived filter options
  const allVenues = Array.from(new Map(teamOptions.map(t => [t.venue_id, t.venue_name])).entries())
    .sort((a, b) => a[1].localeCompare(b[1]))

  const nightsForVenue = Array.from(
    new Map(
      teamOptions
        .filter(t => venueFilter === 'all' || t.venue_id === venueFilter)
        .filter(t => t.venue_night_id)
        .map(t => [t.venue_night_id!, t.night_name])
    ).entries()
  ).sort((a, b) => a[1].localeCompare(b[1]))

  const teamsForFilter = teamOptions
    .filter(t => venueFilter === 'all' || t.venue_id === venueFilter)
    .filter(t => nightFilter === 'all' || t.venue_night_id === nightFilter)

  // Reset downstream filters when parent changes
  function handleVenueChange(v: string) {
    setVenueFilter(v); setNightFilter('all'); setTeamFilter('all')
  }
  function handleNightChange(n: string) {
    setNightFilter(n); setTeamFilter('all')
  }

  const filtered = players.filter(p => {
    const matchesSearch = p.name.toLowerCase().includes(search.toLowerCase())
    const matchesVenue = venueFilter === 'all' || p.team_players.some(tp => {
      const team = teamOptions.find(t => t.id === tp.team_id)
      return team?.venue_id === venueFilter
    })
    const matchesNight = nightFilter === 'all' || p.team_players.some(tp => {
      const team = teamOptions.find(t => t.id === tp.team_id)
      return team?.venue_night_id === nightFilter
    })
    const matchesTeam = teamFilter === 'all' || p.team_players.some(tp => tp.team_id === teamFilter)
    return matchesSearch && matchesVenue && matchesNight && matchesTeam
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

      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem', alignItems: 'flex-end' }}>
        <label style={{ flex: '1 1 180px' }}>
          Search
          <input
            type="search"
            placeholder="Player name…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </label>
        {allVenues.length > 1 && (
          <label style={{ flex: '1 1 160px' }}>
            Venue
            <select value={venueFilter} onChange={e => handleVenueChange(e.target.value)}>
              <option value="all">All venues</option>
              {allVenues.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </label>
        )}
        {nightsForVenue.length > 1 && (
          <label style={{ flex: '1 1 160px' }}>
            Night
            <select value={nightFilter} onChange={e => handleNightChange(e.target.value)}>
              <option value="all">All nights</option>
              {nightsForVenue.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            </select>
          </label>
        )}
        {teamsForFilter.length > 0 && (
          <label style={{ flex: '1 1 160px' }}>
            Team
            <select value={teamFilter} onChange={e => setTeamFilter(e.target.value)}>
              <option value="all">All teams</option>
              {teamsForFilter.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
        )}
      </div>

      <div style={{ fontSize: '0.8rem', color: 'var(--color-muted)', marginBottom: '0.5rem' }}>
        {filtered.length} player{filtered.length !== 1 ? 's' : ''}
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
