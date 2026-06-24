import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const DAY_NAMES_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

interface Season {
  id: string
  name: string
  status: 'draft' | 'published'
  venue_night_id: string | null
  created_at: string
  venue_nights?: { name: string | null; day_of_week: number; venues: { name: string } | null } | null
}

interface Warning { type: string; message: string }

interface Fixture {
  id: string
  round: number
  scheduled_date: string
  home_team_id: string
  away_team_id: string | null
  status: string
  divisions: { name: string; type: string } | null
  home_team: { name: string } | null
  away_team: { name: string } | null
  time_slots: { start_time: string } | null
  courts: { name: string } | null
}

interface Venue { id: string; name: string }
interface Night { id: string; venue_id: string; day_of_week: number; name: string | null }

function fmt12(t: string | null) {
  if (!t) return ''
  const [h, m] = t.split(':')
  const hour = parseInt(h)
  return `${hour % 12 || 12}:${m}${hour < 12 ? 'am' : 'pm'}`
}

function nightLabel(n: Season['venue_nights']) {
  if (!n) return '—'
  return `${n.name ?? DAY_NAMES_FULL[n.day_of_week]} @ ${n.venues?.name ?? '?'}`
}

export function DrawPage() {
  const [seasons, setSeasons] = useState<Season[]>([])
  const [selected, setSelected] = useState<Season | null>(null)
  const [venues, setVenues] = useState<Venue[]>([])
  const [nights, setNights] = useState<Night[]>([])
  const [showSeasonForm, setShowSeasonForm] = useState(false)
  const [newName, setNewName] = useState('')
  const [newVenueId, setNewVenueId] = useState('')
  const [newNightId, setNewNightId] = useState('')
  const [startDate, setStartDate] = useState('')
  const [intervalDays, setIntervalDays] = useState(7)
  const [generating, setGenerating] = useState(false)
  const [genResult, setGenResult] = useState<{ fixtures_created: number; byes: number; warnings: Warning[] } | null>(null)
  const [genError, setGenError] = useState<string | null>(null)
  const [fixtures, setFixtures] = useState<Fixture[]>([])
  const [loadingFixtures, setLoadingFixtures] = useState(false)
  const [publishing, setPublishing] = useState(false)

  async function loadSeasons() {
    const { data } = await supabase
      .from('seasons')
      .select('id, name, status, venue_night_id, created_at, venue_nights(name, day_of_week, venues(name))')
      .order('created_at', { ascending: false })
    setSeasons((data ?? []) as unknown as Season[])
  }

  async function loadVenues() {
    const { data } = await supabase.from('venues').select('id, name').order('name')
    setVenues(data ?? [])
  }

  async function loadNights(venueId: string) {
    const { data } = await supabase
      .from('venue_nights')
      .select('id, venue_id, day_of_week, name')
      .eq('venue_id', venueId)
      .order('day_of_week')
    setNights(data ?? [])
    setNewNightId('')
  }

  async function loadFixtures(seasonId: string) {
    setLoadingFixtures(true)
    const { data } = await supabase
      .from('fixtures')
      .select(`
        id, round, scheduled_date, status, home_team_id, away_team_id,
        divisions(name, type),
        home_team:home_team_id(name),
        away_team:away_team_id(name),
        time_slots:slot_id(start_time),
        courts(name)
      `)
      .eq('season_id', seasonId)
      .order('round')
      .order('scheduled_date')
    setFixtures((data ?? []) as unknown as Fixture[])
    setLoadingFixtures(false)
  }

  useEffect(() => { loadSeasons(); loadVenues() }, [])

  async function createSeason() {
    if (!newName.trim() || !newNightId) return
    const { data, error } = await supabase
      .from('seasons')
      .insert({ name: newName.trim(), status: 'draft', venue_night_id: newNightId })
      .select('id, name, status, venue_night_id, created_at, venue_nights(name, day_of_week, venues(name))')
      .single()
    if (error) { alert(error.message); return }
    setNewName(''); setNewVenueId(''); setNewNightId(''); setShowSeasonForm(false)
    await loadSeasons()
    setSelected(data as unknown as Season)
    setFixtures([])
    setGenResult(null)
  }

  function selectSeason(s: Season) {
    setSelected(s); setGenResult(null); setGenError(null)
    loadFixtures(s.id)
  }

  async function generate() {
    if (!selected || !startDate) return
    setGenerating(true); setGenResult(null); setGenError(null)
    const { data, error } = await supabase.functions.invoke('generate-schedule', {
      body: { season_id: selected.id, start_date: startDate, round_interval_days: intervalDays },
    })
    if (error || data?.error) setGenError(error?.message ?? data?.error ?? 'Unknown error')
    else { setGenResult(data); await loadFixtures(selected.id) }
    setGenerating(false)
  }

  async function publish() {
    if (!selected) return
    if (!confirm(`Publish "${selected.name}"? This cannot be undone — the draw will go live and cannot be regenerated.`)) return
    setPublishing(true)
    const { error } = await supabase.from('seasons').update({ status: 'published' }).eq('id', selected.id)
    if (error) { alert(error.message); setPublishing(false); return }
    await loadSeasons()
    setSelected(s => s ? { ...s, status: 'published' } : s)
    setPublishing(false)
  }

  // Group fixtures by round
  const byRound = new Map<number, Fixture[]>()
  for (const f of fixtures) {
    const list = byRound.get(f.round) ?? []; list.push(f); byRound.set(f.round, list)
  }
  const rounds = [...byRound.entries()].sort(([a], [b]) => a - b)

  const filteredNights = nights.filter(n => n.venue_id === newVenueId)

  return (
    <div>
      <div className="page-header"><h1>Draw</h1></div>

      {/* ── Seasons ── */}
      <div className="card">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h2 style={{ margin: 0 }}>Seasons</h2>
          <button className="btn-sm" onClick={() => setShowSeasonForm(f => !f)}>+ New season</button>
        </div>

        {showSeasonForm && (
          <div style={{ marginBottom: '0.75rem' }}>
            <div className="form-grid" style={{ marginBottom: '0.5rem' }}>
              <label>Season name *
                <input placeholder="e.g. Monday Mixed — Summer 2025" value={newName} onChange={e => setNewName(e.target.value)} />
              </label>
              <label>Venue *
                <select value={newVenueId} onChange={e => { setNewVenueId(e.target.value); loadNights(e.target.value) }}>
                  <option value="">— select venue —</option>
                  {venues.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </label>
              {newVenueId && (
                <label>Night *
                  <select value={newNightId} onChange={e => setNewNightId(e.target.value)}>
                    <option value="">— select night —</option>
                    {filteredNights.map(n => (
                      <option key={n.id} value={n.id}>
                        {n.name ?? DAY_NAMES_FULL[n.day_of_week]}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button onClick={createSeason} disabled={!newName.trim() || !newNightId}>Create</button>
              <button className="btn-secondary" onClick={() => setShowSeasonForm(false)}>Cancel</button>
            </div>
          </div>
        )}

        {seasons.length === 0
          ? <p style={{ color: 'var(--color-muted)', fontSize: '0.875rem' }}>No seasons yet — create one to generate a draw.</p>
          : (
            <table className="data-table">
              <thead><tr><th>Name</th><th>Night</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {seasons.map(s => (
                  <tr key={s.id} style={selected?.id === s.id ? { background: '#eff6ff' } : undefined}>
                    <td>{s.name}</td>
                    <td style={{ fontSize: '0.85rem', color: 'var(--color-muted)' }}>
                      {nightLabel((s as any).venue_nights)}
                    </td>
                    <td>
                      <span className={`badge ${s.status === 'published' ? 'badge-ok' : 'badge-warn'}`}>
                        {s.status === 'published' ? 'Published' : 'Draft'}
                      </span>
                    </td>
                    <td>
                      <button className="btn-sm" onClick={() => selectSeason(s)}>
                        {selected?.id === s.id ? 'Selected ✓' : 'Select'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
      </div>

      {/* ── Generate (draft only) ── */}
      {selected && selected.status === 'draft' && (
        <div className="card">
          <h2 style={{ marginBottom: '0.25rem' }}>Generate draw</h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--color-muted)', marginBottom: '0.75rem' }}>
            {nightLabel((selected as any).venue_nights)} — double round-robin for all divisions on this night.
            Re-generating will replace any existing draft fixtures.
          </p>
          <div className="form-grid">
            <label>Season start date *
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
            </label>
            <label>Weeks between rounds
              <input type="number" min={1} max={4} value={intervalDays / 7}
                onChange={e => setIntervalDays(parseInt(e.target.value) * 7)} />
            </label>
          </div>
          {genError && <div className="form-error">{genError}</div>}
          {genResult && (
            <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 'var(--radius)', padding: '0.75rem', marginBottom: '0.75rem', fontSize: '0.875rem' }}>
              <strong>Generated:</strong> {genResult.fixtures_created} fixtures
              {genResult.byes > 0 && `, ${genResult.byes} bye${genResult.byes !== 1 ? 's' : ''}`}.
              {genResult.warnings.length === 0 && ' No warnings.'}
            </div>
          )}
          {genResult && genResult.warnings.length > 0 && (
            <div style={{ marginBottom: '0.75rem' }}>
              <strong style={{ color: 'var(--color-danger)', fontSize: '0.875rem' }}>
                {genResult.warnings.length} warning{genResult.warnings.length !== 1 ? 's' : ''}
              </strong>
              <ul style={{ marginTop: '0.5rem', paddingLeft: '1.25rem', fontSize: '0.85rem' }}>
                {genResult.warnings.map((w, i) => (
                  <li key={i} style={{ marginBottom: '0.25rem', color: w.type === 'cross_venue_clash' ? 'var(--color-danger)' : 'inherit' }}>
                    {w.message}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="form-actions">
            <button onClick={generate} disabled={generating || !startDate}>
              {generating ? 'Generating…' : 'Generate draw'}
            </button>
            {fixtures.length > 0 && (
              <button onClick={publish} disabled={publishing} style={{ background: '#059669' }}>
                {publishing ? 'Publishing…' : 'Publish season'}
              </button>
            )}
          </div>
        </div>
      )}

      {selected && selected.status === 'published' && (
        <div className="card" style={{ background: '#f0fdf4', borderColor: '#86efac' }}>
          <strong>{selected.name}</strong> is published. Scores can be entered but the draw cannot be regenerated.
        </div>
      )}

      {/* ── Score / standings links ── */}
      {selected && fixtures.length > 0 && (
        <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
          <Link to={`/admin/draw/${selected.id}/scores`} style={{ textDecoration: 'none' }}>
            <button>Enter scores</button>
          </Link>
          <Link to={`/admin/draw/${selected.id}/standings`} style={{ textDecoration: 'none' }}>
            <button className="btn-secondary">View standings</button>
          </Link>
        </div>
      )}

      {/* ── Fixture list ── */}
      {selected && (
        <div>
          <h2 style={{ marginBottom: '1rem', fontSize: '1.1rem' }}>
            {loadingFixtures ? 'Loading fixtures…'
              : fixtures.length > 0 ? `${fixtures.length} fixtures · ${rounds.length} rounds`
              : 'No fixtures yet'}
          </h2>

          {rounds.map(([round, fxs]) => {
            const date = fxs[0]?.scheduled_date
            const dow = date ? DAY_NAMES[new Date(date + 'T00:00:00Z').getUTCDay()] : ''
            return (
              <div key={round} className="card" style={{ marginBottom: '1rem' }}>
                <h3 style={{ marginBottom: '0.75rem', fontSize: '1rem' }}>
                  Round {round}
                  {date && <span style={{ fontWeight: 400, color: 'var(--color-muted)', marginLeft: 8, fontSize: '0.875rem' }}>{dow} {date}</span>}
                </h3>
                <table className="data-table">
                  <thead>
                    <tr><th>Division</th><th>Home</th><th>Away</th><th>Court</th><th>Time</th></tr>
                  </thead>
                  <tbody>
                    {fxs.map(f => (
                      <tr key={f.id}>
                        <td>
                          <span style={{ fontSize: '0.75rem', color: 'var(--color-muted)', textTransform: 'capitalize' }}>
                            {(f.divisions as any)?.type}{' '}
                          </span>
                          {(f.divisions as any)?.name ?? '—'}
                        </td>
                        <td>{(f.home_team as any)?.name ?? '—'}</td>
                        <td>{f.away_team_id ? ((f.away_team as any)?.name ?? '—') : <em style={{ color: 'var(--color-muted)' }}>Bye</em>}</td>
                        <td>{(f.courts as any)?.name ?? '—'}</td>
                        <td>{fmt12((f.time_slots as any)?.start_time ?? null)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
