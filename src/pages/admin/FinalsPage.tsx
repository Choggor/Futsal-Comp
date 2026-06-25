import { useEffect, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

interface Season { id: string; name: string; status: string }
interface Team { id: string; name: string; division_id: string }
interface Division { id: string; name: string; type: string; venue_id: string }

interface Standing {
  team_id: string
  team_name: string
  points: number
  gd: number
  gf: number
  played: number
}

interface FinalsFixture {
  id: string
  round: number
  division_id: string
  home_team_id: string
  away_team_id: string | null
  home_score: number | null
  away_score: number | null
  status: 'scheduled' | 'played' | 'forfeit' | 'postponed' | 'cancelled'
  home_team: { name: string } | null
  away_team: { name: string } | null
}

function sortStandings(rows: Standing[]) {
  return [...rows].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points
    if (b.gd !== a.gd) return b.gd - a.gd
    return b.gf - a.gf
  })
}

function winner(f: FinalsFixture): string | null {
  if (f.status === 'forfeit' || f.status === 'played') {
    if (f.home_score === null || f.away_score === null) return null
    if (f.home_score > f.away_score) return f.home_team_id
    if (f.away_score > f.home_score) return f.away_team_id
  }
  return null // draw or not yet played
}

function winnerName(f: FinalsFixture): string {
  const w = winner(f)
  if (!w) return f.home_score === f.away_score && f.home_score !== null ? 'Draw' : '—'
  return w === f.home_team_id ? (f.home_team?.name ?? '?') : (f.away_team?.name ?? '?')
}

function ScoreDisplay({ f }: { f: FinalsFixture }) {
  if (f.status === 'scheduled') return <span style={{ color: 'var(--color-muted)' }}>vs</span>
  if (f.home_score !== null && f.away_score !== null)
    return <strong>{f.home_score} – {f.away_score}</strong>
  return <span style={{ color: 'var(--color-muted)' }}>—</span>
}

// ── Per-division finals panel ─────────────────────────────────────────────────

function DivisionFinalsPanel({
  division,
  standings,
  finalsFixtures,
  maxRegularRound,
  allTeams,
  seasonId,
  onRefresh,
}: {
  division: Division
  standings: Standing[]
  finalsFixtures: FinalsFixture[]
  maxRegularRound: number
  allTeams: Team[]
  seasonId: string
  onRefresh: () => void
}) {
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [gfHome, setGfHome] = useState('')
  const [gfAway, setGfAway] = useState('')
  const [showGfPicker, setShowGfPicker] = useState(false)

  const semis = finalsFixtures.filter(f => f.round === maxRegularRound + 1)
  const gf = finalsFixtures.find(f => f.round === maxRegularRound + 2)
  const divTeams = allTeams.filter(t => t.division_id === division.id)

  const numTeams = standings.length
  const canSeedSemis = numTeams >= 2 && semis.length === 0 && !gf
  const isDirectFinal = numTeams < 4

  // Determine if both semis have conclusive results
  const bothSemisComplete = semis.length === 2 && semis.every(f => f.status === 'played' || f.status === 'forfeit')
  const bothSemisHaveWinner = semis.length === 2 && semis.every(f => winner(f) !== null)

  async function seedSemis() {
    setSaving(true); setError(null)
    const ordered = sortStandings(standings)

    let fixtures: object[]
    if (isDirectFinal) {
      // Direct grand final: 1st vs 2nd
      fixtures = [{
        season_id: seasonId,
        division_id: division.id,
        venue_id: division.venue_id,
        home_team_id: ordered[0].team_id,
        away_team_id: ordered[1].team_id,
        round: maxRegularRound + 2,
        phase: 'finals',
        status: 'scheduled',
        home_score: null, away_score: null,
      }]
    } else {
      // Semi-finals: 1v4, 2v3
      fixtures = [
        {
          season_id: seasonId, division_id: division.id, venue_id: division.venue_id,
          home_team_id: ordered[0].team_id, away_team_id: ordered[3].team_id,
          round: maxRegularRound + 1, phase: 'finals', status: 'scheduled',
          home_score: null, away_score: null,
        },
        {
          season_id: seasonId, division_id: division.id, venue_id: division.venue_id,
          home_team_id: ordered[1].team_id, away_team_id: ordered[2].team_id,
          round: maxRegularRound + 1, phase: 'finals', status: 'scheduled',
          home_score: null, away_score: null,
        },
      ]
    }

    const { error: e } = await supabase.from('fixtures').insert(fixtures)
    if (e) setError(e.message)
    else onRefresh()
    setSaving(false)
  }

  async function createGrandFinal() {
    if (!gfHome || !gfAway) { setError('Select both finalists'); return }
    setSaving(true); setError(null)
    const { error: e } = await supabase.from('fixtures').insert({
      season_id: seasonId,
      division_id: division.id,
      venue_id: division.venue_id,
      home_team_id: gfHome,
      away_team_id: gfAway,
      round: maxRegularRound + 2,
      phase: 'finals',
      status: 'scheduled',
      home_score: null,
      away_score: null,
    })
    if (e) setError(e.message)
    else { setShowGfPicker(false); onRefresh() }
    setSaving(false)
  }

  const orderedStandings = sortStandings(standings)

  return (
    <div className="card" style={{ marginBottom: '1.5rem' }}>
      <h2 style={{ fontSize: '1rem', marginBottom: '1rem', textTransform: 'capitalize' }}>
        {division.type} · {division.name}
      </h2>

      {error && <div style={{ color: 'var(--color-danger)', fontSize: '0.875rem', marginBottom: '0.75rem' }}>{error}</div>}

      {/* Standings summary */}
      {standings.length > 0 && (
        <div style={{ marginBottom: '1rem' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.4rem' }}>
            Final standings
          </div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <tbody>
              {orderedStandings.map((s, i) => (
                <tr key={s.team_id} style={{ background: i < (isDirectFinal ? 2 : 4) ? 'transparent' : '#f9fafb' }}>
                  <td style={{ padding: '0.25rem 0.4rem', fontWeight: 600, color: 'var(--color-muted)', width: 28 }}>
                    {i + 1}
                  </td>
                  <td style={{ padding: '0.25rem 0.4rem', fontWeight: i < (isDirectFinal ? 2 : 4) ? 700 : 400 }}>
                    {s.team_name}
                    {!isDirectFinal && i === 0 && <span style={{ marginLeft: '0.4rem', fontSize: '0.7rem', color: '#d97706' }}>1st</span>}
                    {!isDirectFinal && i === 1 && <span style={{ marginLeft: '0.4rem', fontSize: '0.7rem', color: '#6b7280' }}>2nd</span>}
                    {!isDirectFinal && i === 2 && <span style={{ marginLeft: '0.4rem', fontSize: '0.7rem', color: '#6b7280' }}>3rd</span>}
                    {!isDirectFinal && i === 3 && <span style={{ marginLeft: '0.4rem', fontSize: '0.7rem', color: '#6b7280' }}>4th</span>}
                  </td>
                  <td style={{ padding: '0.25rem 0.4rem', textAlign: 'right', fontWeight: 700 }}>{s.points} pts</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Seed button */}
      {canSeedSemis && (
        <div style={{ marginBottom: '1rem' }}>
          {numTeams < 2 ? (
            <p style={{ color: 'var(--color-muted)', fontSize: '0.875rem' }}>Not enough teams for finals.</p>
          ) : (
            <button onClick={seedSemis} disabled={saving}>
              {saving ? 'Creating…' : isDirectFinal ? 'Create grand final (1 vs 2)' : 'Seed semi-finals (1v4, 2v3)'}
            </button>
          )}
        </div>
      )}

      {/* Semi-finals */}
      {semis.length > 0 && (
        <div style={{ marginBottom: '1rem' }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
            Semi-finals
          </div>
          {semis.map(f => (
            <div key={f.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.35rem', fontSize: '0.875rem' }}>
              <span style={{ flex: 1, textAlign: 'right', fontWeight: 600 }}>{f.home_team?.name}</span>
              <ScoreDisplay f={f} />
              <span style={{ flex: 1, fontWeight: 600 }}>{f.away_team?.name}</span>
              <span style={{ fontSize: '0.75rem', color: winner(f) ? '#059669' : 'var(--color-muted)' }}>
                {winner(f) ? `→ ${winnerName(f)}` : f.status !== 'scheduled' ? '(draw)' : ''}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Grand final */}
      {gf && (
        <div>
          <div style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.5rem' }}>
            Grand final
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.875rem' }}>
            <span style={{ flex: 1, textAlign: 'right', fontWeight: 700 }}>{gf.home_team?.name}</span>
            <ScoreDisplay f={gf} />
            <span style={{ flex: 1, fontWeight: 700 }}>{gf.away_team?.name}</span>
            {winner(gf) && (
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: '#d97706' }}>🏆 {winnerName(gf)}</span>
            )}
          </div>
        </div>
      )}

      {/* Create grand final after semis */}
      {semis.length > 0 && !gf && (
        <div style={{ marginTop: '1rem' }}>
          {!showGfPicker ? (
            <button
              className={bothSemisComplete ? '' : 'btn-secondary'}
              onClick={() => {
                if (bothSemisHaveWinner) {
                  setGfHome(winner(semis[0]) ?? '')
                  setGfAway(winner(semis[1]) ?? '')
                }
                setShowGfPicker(true)
              }}
            >
              {bothSemisComplete ? 'Create grand final' : 'Create grand final (semis pending)'}
            </button>
          ) : (
            <div style={{ background: '#f0fdf4', border: '1px solid #86efac', borderRadius: 'var(--radius)', padding: '0.75rem' }}>
              <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.5rem' }}>Select grand finalists</div>
              <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '0.5rem' }}>
                <label style={{ fontSize: '0.8rem' }}>Home team<br />
                  <select value={gfHome} onChange={e => setGfHome(e.target.value)} style={{ fontSize: '0.85rem', padding: '0.3rem' }}>
                    <option value="">— select —</option>
                    {divTeams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </label>
                <label style={{ fontSize: '0.8rem' }}>Away team<br />
                  <select value={gfAway} onChange={e => setGfAway(e.target.value)} style={{ fontSize: '0.85rem', padding: '0.3rem' }}>
                    <option value="">— select —</option>
                    {divTeams.filter(t => t.id !== gfHome).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                </label>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button onClick={createGrandFinal} disabled={saving}>{saving ? 'Creating…' : 'Create grand final'}</button>
                <button className="btn-secondary" onClick={() => setShowGfPicker(false)}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      <div style={{ marginTop: '1rem', fontSize: '0.78rem', color: 'var(--color-muted)' }}>
        Use the <Link to={`/admin/draw/${seasonId}/editor`}>fixture editor</Link> to assign courts and time slots to finals games.
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function FinalsPage() {
  const { seasonId } = useParams<{ seasonId: string }>()
  const [season, setSeason] = useState<Season | null>(null)
  const [divisions, setDivisions] = useState<Division[]>([])
  const [standingsMap, setStandingsMap] = useState<Record<string, Standing[]>>({})
  const [finalsMap, setFinalsMap] = useState<Record<string, FinalsFixture[]>>({})
  const [allTeams, setAllTeams] = useState<Team[]>([])
  const [maxRegularRound, setMaxRegularRound] = useState(0)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)

    const { data: s } = await supabase.from('seasons').select('id, name, status').eq('id', seasonId!).single()
    setSeason(s)

    // All fixtures for this season
    const { data: allFixtures } = await supabase
      .from('fixtures')
      .select('id, round, phase, division_id, home_team_id, away_team_id, home_score, away_score, status, venue_id, home_team:home_team_id(name), away_team:away_team_id(name)')
      .eq('season_id', seasonId!)

    if (!allFixtures?.length) { setLoading(false); return }

    const regularRounds = allFixtures.filter(f => f.phase === 'regular').map(f => f.round)
    const maxRR = regularRounds.length ? Math.max(...regularRounds) : 0
    setMaxRegularRound(maxRR)

    // Division IDs from fixtures
    const divIds = [...new Set(allFixtures.map(f => f.division_id))]

    const [{ data: divs }, { data: teams }, { data: venues }] = await Promise.all([
      supabase.from('divisions').select('id, name, type, venue_id').in('id', divIds).order('name'),
      supabase.from('teams').select('id, name, division_id').in('division_id', divIds),
      supabase.from('venues').select('id, points_win, points_draw, points_loss'),
    ])

    setDivisions((divs ?? []) as Division[])
    setAllTeams(teams ?? [])

    const venueMap: Record<string, { points_win: number; points_draw: number; points_loss: number }> = {}
    for (const v of venues ?? []) venueMap[v.id] = v

    // Compute standings from regular fixtures
    const regularFixtures = allFixtures.filter(f => f.phase === 'regular' && (f.status === 'played' || f.status === 'forfeit'))
    const sMap: Record<string, Standing[]> = {}
    const fMap: Record<string, FinalsFixture[]> = {}

    for (const div of divs ?? []) {
      const vp = venueMap[(div as any).venue_id] ?? { points_win: 3, points_draw: 1, points_loss: 0 }
      const divTeams = (teams ?? []).filter(t => t.division_id === div.id)
      const divFx = regularFixtures.filter(f => f.division_id === div.id)

      const stats: Record<string, { w: number; d: number; l: number; gf: number; ga: number }> = {}
      for (const t of divTeams) stats[t.id] = { w: 0, d: 0, l: 0, gf: 0, ga: 0 }

      for (const f of divFx) {
        if (f.home_score === null || f.away_score === null) continue
        const hs = f.home_score, as_ = f.away_score
        if (stats[f.home_team_id]) {
          stats[f.home_team_id].gf += hs; stats[f.home_team_id].ga += as_
          if (hs > as_) stats[f.home_team_id].w++
          else if (hs === as_) stats[f.home_team_id].d++
          else stats[f.home_team_id].l++
        }
        if (f.away_team_id && stats[f.away_team_id]) {
          stats[f.away_team_id].gf += as_; stats[f.away_team_id].ga += hs
          if (as_ > hs) stats[f.away_team_id].w++
          else if (as_ === hs) stats[f.away_team_id].d++
          else stats[f.away_team_id].l++
        }
      }

      sMap[div.id] = divTeams.map(t => {
        const s = stats[t.id] ?? { w: 0, d: 0, l: 0, gf: 0, ga: 0 }
        const pts = s.w * vp.points_win + s.d * vp.points_draw + s.l * vp.points_loss
        return { team_id: t.id, team_name: t.name, points: pts, gd: s.gf - s.ga, gf: s.gf, played: s.w + s.d + s.l }
      })

      fMap[div.id] = (allFixtures.filter(f => f.division_id === div.id && f.phase === 'finals') as unknown as FinalsFixture[])
    }

    setStandingsMap(sMap)
    setFinalsMap(fMap)
    setLoading(false)
  }, [seasonId])

  useEffect(() => { load() }, [load])

  return (
    <div>
      <div className="breadcrumb"><Link to="/admin/draw">Draw</Link> › Finals</div>
      <div className="page-header"><h1>Finals — {season?.name ?? '…'}</h1></div>

      {loading && <div className="loading">Loading…</div>}

      {!loading && divisions.length === 0 && (
        <div className="card">No fixtures found for this season. Generate the draw first.</div>
      )}

      {!loading && divisions.map(div => (
        <DivisionFinalsPanel
          key={div.id}
          division={div}
          standings={standingsMap[div.id] ?? []}
          finalsFixtures={finalsMap[div.id] ?? []}
          maxRegularRound={maxRegularRound}
          allTeams={allTeams}
          seasonId={seasonId!}
          onRefresh={load}
        />
      ))}
    </div>
  )
}
