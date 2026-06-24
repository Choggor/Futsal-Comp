import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

interface StandingRow {
  team_id: string
  division_id: string
  team_name: string
  played: number
  won: number
  drawn: number
  lost: number
  gf: number
  ga: number
  gd: number
  points: number
}

interface Division { id: string; name: string; type: string }
interface Season { id: string; name: string }
interface MvpRow { division_id: string; player_id: string; first_name: string; team_name: string; total_points: number }

export function StandingsPage() {
  const { seasonId } = useParams<{ seasonId: string }>()
  const [season, setSeason] = useState<Season | null>(null)
  const [divisions, setDivisions] = useState<Division[]>([])
  const [standings, setStandings] = useState<Record<string, StandingRow[]>>({})
  const [mvp, setMvp] = useState<Record<string, MvpRow[]>>({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      setLoading(true)

      const { data: s } = await supabase.from('seasons').select('id, name').eq('id', seasonId!).single()
      setSeason(s)

      // Get all division_ids that have fixtures in this season
      const { data: fixDivs } = await supabase
        .from('fixtures')
        .select('division_id')
        .eq('season_id', seasonId!)
      const divIds = [...new Set((fixDivs ?? []).map((f: any) => f.division_id))]

      if (!divIds.length) { setLoading(false); return }

      const [{ data: divs }, { data: fixtures }, { data: teams }, { data: venues }, { data: mvpData }] = await Promise.all([
        supabase.from('divisions').select('id, name, type, venue_id').in('id', divIds).order('name'),
        supabase.from('fixtures')
          .select('division_id, home_team_id, away_team_id, home_score, away_score, status')
          .eq('season_id', seasonId!)
          .in('status', ['played', 'forfeit']),
        supabase.from('teams').select('id, name, division_id').in('division_id', divIds),
        supabase.from('venues').select('id, points_win, points_draw, points_loss'),
        supabase.from('mvp_leaderboard').select('*').in('division_id', divIds),
      ])

      setDivisions(divs ?? [])

      const venueMap: Record<string, { points_win: number; points_draw: number; points_loss: number }> = {}
      for (const v of venues ?? []) venueMap[v.id] = v

      // Build standings from raw fixtures
      const grouped: Record<string, StandingRow[]> = {}
      for (const div of divs ?? []) {
        const vp = venueMap[(div as any).venue_id] ?? { points_win: 3, points_draw: 1, points_loss: 0 }
        const divTeams = (teams ?? []).filter(t => t.division_id === div.id)
        const divFixtures = (fixtures ?? []).filter(f => f.division_id === div.id)

        const stats: Record<string, { w: number; d: number; l: number; gf: number; ga: number }> = {}
        for (const t of divTeams) stats[t.id] = { w: 0, d: 0, l: 0, gf: 0, ga: 0 }

        for (const f of divFixtures) {
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

        grouped[div.id] = sortStandings(divTeams.map(t => {
          const s = stats[t.id] ?? { w: 0, d: 0, l: 0, gf: 0, ga: 0 }
          const played = s.w + s.d + s.l
          const pts = s.w * vp.points_win + s.d * vp.points_draw + s.l * vp.points_loss
          return {
            team_id: t.id, division_id: div.id, team_name: t.name,
            played, won: s.w, drawn: s.d, lost: s.l,
            gf: s.gf, ga: s.ga, gd: s.gf - s.ga, points: pts,
          }
        }))
      }
      setStandings(grouped)

      const mvpGrouped: Record<string, MvpRow[]> = {}
      for (const row of mvpData ?? []) {
        if (!mvpGrouped[row.division_id]) mvpGrouped[row.division_id] = []
        mvpGrouped[row.division_id].push(row)
      }
      setMvp(mvpGrouped)

      setLoading(false)
    }
    load()
  }, [seasonId])

  return (
    <div>
      <div className="breadcrumb"><Link to="/admin/draw">Draw</Link> › Standings</div>
      <div className="page-header"><h1>Standings — {season?.name ?? '…'}</h1></div>

      {loading && <div className="loading">Loading…</div>}

      {!loading && divisions.length === 0 && (
        <div className="card">No fixtures found for this season.</div>
      )}

      {divisions.map(div => {
        const rows = standings[div.id] ?? []
        const mvpRows = mvp[div.id] ?? []
        return (
          <div key={div.id} className="card" style={{ marginBottom: '1.5rem' }}>
            <h2 style={{ fontSize: '1rem', marginBottom: '1rem', textTransform: 'capitalize' }}>
              {div.type} · {div.name}
            </h2>

            {rows.length === 0
              ? <p style={{ color: 'var(--color-muted)', fontSize: '0.875rem' }}>No results yet.</p>
              : (
                <div style={{ overflowX: 'auto' }}>
                  <table className="data-table" style={{ minWidth: 480 }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left' }}>Team</th>
                        <th>P</th><th>W</th><th>D</th><th>L</th>
                        <th>GF</th><th>GA</th><th>GD</th>
                        <th style={{ fontWeight: 800 }}>Pts</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r, i) => (
                        <tr key={r.team_id} style={i === 0 ? { background: '#fffbeb' } : undefined}>
                          <td style={{ fontWeight: i < 2 ? 700 : 400 }}>{r.team_name}</td>
                          <td style={{ textAlign: 'center' }}>{r.played}</td>
                          <td style={{ textAlign: 'center' }}>{r.won}</td>
                          <td style={{ textAlign: 'center' }}>{r.drawn}</td>
                          <td style={{ textAlign: 'center' }}>{r.lost}</td>
                          <td style={{ textAlign: 'center' }}>{r.gf}</td>
                          <td style={{ textAlign: 'center' }}>{r.ga}</td>
                          <td style={{ textAlign: 'center', color: r.gd > 0 ? '#059669' : r.gd < 0 ? 'var(--color-danger)' : undefined }}>
                            {r.gd > 0 ? `+${r.gd}` : r.gd}
                          </td>
                          <td style={{ textAlign: 'center', fontWeight: 800, fontSize: '1rem' }}>{r.points}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            }

            {mvpRows.length > 0 && (
              <div style={{ marginTop: '1rem' }}>
                <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-muted)', marginBottom: '0.4rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  MVP Leaderboard
                </div>
                <table className="data-table">
                  <thead><tr><th style={{ textAlign: 'left' }}>Player</th><th style={{ textAlign: 'left' }}>Team</th><th>Pts</th></tr></thead>
                  <tbody>
                    {mvpRows.slice(0, 5).map(m => (
                      <tr key={m.player_id}>
                        <td>{m.first_name}</td>
                        <td style={{ color: 'var(--color-muted)', fontSize: '0.875rem' }}>{m.team_name}</td>
                        <td style={{ textAlign: 'center', fontWeight: 700 }}>{m.total_points}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// Sort: pts desc, gd desc, gf desc. Head-to-head handled server-side via the view;
// client just orders the already-aggregated rows correctly.
function sortStandings(rows: StandingRow[]): StandingRow[] {
  return [...rows].sort((a, b) => {
    if (b.points !== a.points) return b.points - a.points
    if (b.gd !== a.gd) return b.gd - a.gd
    return b.gf - a.gf
  })
}
