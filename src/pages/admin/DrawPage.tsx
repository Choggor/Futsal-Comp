import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

interface Season { id: string; name: string; status: 'draft' | 'published'; created_at: string }
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

function fmt12(t: string | null) {
  if (!t) return ''
  const [h, m] = t.split(':')
  const hour = parseInt(h)
  return `${hour % 12 || 12}:${m}${hour < 12 ? 'am' : 'pm'}`
}

export function DrawPage() {
  const [seasons, setSeasons] = useState<Season[]>([])
  const [selected, setSelected] = useState<Season | null>(null)
  const [newSeasonName, setNewSeasonName] = useState('')
  const [showSeasonForm, setShowSeasonForm] = useState(false)
  const [startDate, setStartDate] = useState('')
  const [intervalDays, setIntervalDays] = useState(7)
  const [generating, setGenerating] = useState(false)
  const [genResult, setGenResult] = useState<{ fixtures_created: number; byes: number; warnings: Warning[] } | null>(null)
  const [genError, setGenError] = useState<string | null>(null)
  const [fixtures, setFixtures] = useState<Fixture[]>([])
  const [loadingFixtures, setLoadingFixtures] = useState(false)
  const [publishing, setPublishing] = useState(false)

  async function loadSeasons() {
    const { data } = await supabase.from('seasons').select('*').order('created_at', { ascending: false })
    setSeasons(data ?? [])
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
        time_slots(start_time),
        courts(name)
      `)
      .eq('season_id', seasonId)
      .order('round')
      .order('scheduled_date')
    setFixtures((data ?? []) as unknown as Fixture[])
    setLoadingFixtures(false)
  }

  useEffect(() => { loadSeasons() }, [])

  async function createSeason() {
    if (!newSeasonName.trim()) return
    const { data, error } = await supabase.from('seasons').insert({ name: newSeasonName.trim(), status: 'draft' }).select('*').single()
    if (error) { alert(error.message); return }
    setNewSeasonName(''); setShowSeasonForm(false)
    await loadSeasons()
    setSelected(data as Season)
    setFixtures([])
  }

  function selectSeason(s: Season) {
    setSelected(s)
    setGenResult(null)
    setGenError(null)
    loadFixtures(s.id)
  }

  async function generate() {
    if (!selected || !startDate) return
    setGenerating(true); setGenResult(null); setGenError(null)

    const { data, error } = await supabase.functions.invoke('generate-schedule', {
      body: { season_id: selected.id, start_date: startDate, round_interval_days: intervalDays },
    })

    if (error || data?.error) {
      setGenError(error?.message ?? data?.error ?? 'Unknown error')
    } else {
      setGenResult(data)
      await loadFixtures(selected.id)
    }
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
    const list = byRound.get(f.round) ?? []
    list.push(f)
    byRound.set(f.round, list)
  }
  const rounds = [...byRound.entries()].sort(([a], [b]) => a - b)

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
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
            <input placeholder="Season name e.g. Summer 2025" value={newSeasonName} onChange={e => setNewSeasonName(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
            <button onClick={createSeason} disabled={!newSeasonName.trim()}>Create</button>
            <button className="btn-secondary" onClick={() => setShowSeasonForm(false)}>Cancel</button>
          </div>
        )}

        {seasons.length === 0
          ? <p style={{ color: 'var(--color-muted)', fontSize: '0.875rem' }}>No seasons yet — create one to generate a draw.</p>
          : (
            <table className="data-table">
              <thead><tr><th>Name</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {seasons.map(s => (
                  <tr key={s.id} style={selected?.id === s.id ? { background: '#eff6ff' } : undefined}>
                    <td>{s.name}</td>
                    <td>
                      <span className={`badge ${s.status === 'published' ? 'badge-ok' : 'badge-warn'}`}>
                        {s.status === 'published' ? 'Published' : 'Draft'}
                      </span>
                    </td>
                    <td>
                      <button className="btn-sm" onClick={() => selectSeason(s)}>
                        {selected?.id === s.id ? 'Selected' : 'Select'}
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
          <h2>Generate draw — {selected.name}</h2>
          <p style={{ fontSize: '0.85rem', color: 'var(--color-muted)', marginBottom: '0.75rem' }}>
            Generates a double round-robin for every division across all configured venue nights.
            Re-generating will replace any existing draft fixtures for this season.
          </p>
          <div className="form-grid">
            <label>Season start date *
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} />
            </label>
            <label>Weeks between rounds
              <input type="number" min={1} max={4} value={intervalDays / 7} onChange={e => setIntervalDays(parseInt(e.target.value) * 7)} />
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

      {/* ── Fixture list ── */}
      {selected && (
        <div>
          <h2 style={{ marginBottom: '1rem', fontSize: '1.1rem' }}>
            {fixtures.length > 0 ? `${fixtures.length} fixtures across ${rounds.length} rounds` : 'No fixtures yet'}
          </h2>

          {loadingFixtures && <div className="loading">Loading fixtures…</div>}

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
                            {(f.divisions as any)?.type ?? ''}{' '}
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
