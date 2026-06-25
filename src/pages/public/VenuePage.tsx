import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import './VenuePage.css'

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/* ── Types ────────────────────────────────────────────────────────────────── */

interface Venue { id: string; name: string; mvp_enabled: boolean }
interface Night { id: string; day_of_week: number; name: string | null }
interface Division { id: string; name: string; venue_night_id: string }

interface Fixture {
  id: string
  season_id: string
  round: number
  scheduled_date: string | null
  slot_time: string | null
  slot_order: number | null
  court_name: string | null
  home_team_name: string
  away_team_name: string
  home_score: number | null
  away_score: number | null
  status: string
}

interface StandingRow {
  team_id: string; team_name: string
  played: number; won: number; drawn: number; lost: number
  goals_for: number; goals_against: number; goal_diff: number; points: number
}

interface MvpEntry { first_name: string; team_name: string; mvp_points: number }

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function fmtDate(d: string | null) {
  if (!d) return '—'
  // Parse as local date to avoid timezone shift
  const [y, m, day] = d.split('-')
  return new Date(+y, +m - 1, +day).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short' })
}

function fmtTime(t: string | null) {
  if (!t) return ''
  const [h, m] = t.split(':')
  const hour = parseInt(h, 10)
  return `${hour % 12 || 12}:${m}${hour >= 12 ? 'pm' : 'am'}`
}

function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function nextOccurrence(dayOfWeek: number): Date {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diff = (dayOfWeek - today.getDay() + 7) % 7
  const d = new Date(today)
  d.setDate(today.getDate() + (diff === 0 ? 0 : diff))
  return d
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normaliseFixture(r: any): Fixture {
  return {
    id: r.id,
    season_id: r.season_id,
    round: r.round,
    scheduled_date: r.scheduled_date,
    slot_time: r.slot?.start_time ?? null,
    slot_order: r.slot?.slot_order ?? null,
    court_name: r.court?.name ?? null,
    home_team_name: r.home_team?.name ?? '?',
    away_team_name: r.away_team?.name ?? '?',
    home_score: r.home_score,
    away_score: r.away_score,
    status: r.status,
  }
}

const FIXTURE_SELECT = `id, season_id, round, scheduled_date, status, home_score, away_score,
  home_team:teams!fixtures_home_team_id_fkey(name),
  away_team:teams!fixtures_away_team_id_fkey(name),
  slot:time_slots(start_time, slot_order),
  court:courts(name)`

function sortFixtures(list: Fixture[]) {
  return list.sort((a, b) =>
    (a.slot_order ?? 999) - (b.slot_order ?? 999) ||
    (a.court_name ?? '').localeCompare(b.court_name ?? '')
  )
}

/* ── Component ───────────────────────────────────────────────────────────── */

export function VenuePage() {
  const { venueId } = useParams<{ venueId: string }>()

  const [venue, setVenue] = useState<Venue | null>(null)
  const [nights, setNights] = useState<Night[]>([])
  const [divisions, setDivisions] = useState<Division[]>([])

  const [selectedNight, setSelectedNight] = useState<string>('')
  const [selectedDivision, setSelectedDivision] = useState<string>('')

  const [weekFixtures, setWeekFixtures] = useState<Fixture[]>([])
  const [allFixtures, setAllFixtures] = useState<Fixture[]>([])
  const [standings, setStandings] = useState<StandingRow[]>([])
  const [mvp, setMvp] = useState<MvpEntry[]>([])
  const [showFullDraw, setShowFullDraw] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /* Load venue + nights */
  useEffect(() => {
    if (!venueId) return
    supabase.from('venues').select('id, name, mvp_enabled').eq('id', venueId).single()
      .then(({ data }) => setVenue(data))
    supabase.from('venue_nights').select('id, day_of_week, name')
      .eq('venue_id', venueId).order('day_of_week')
      .then(({ data }) => setNights(data ?? []))
  }, [venueId])

  /* Load divisions when night selected */
  useEffect(() => {
    setDivisions([])
    setSelectedDivision('')
    setWeekFixtures([])
    setAllFixtures([])
    setStandings([])
    setMvp([])
    setShowFullDraw(false)
    if (!selectedNight) return
    supabase.from('divisions').select('id, name, venue_night_id')
      .eq('venue_night_id', selectedNight).order('name')
      .then(({ data }) => setDivisions(data ?? []))
  }, [selectedNight])

  /* Load data when division selected */
  useEffect(() => {
    setWeekFixtures([])
    setAllFixtures([])
    setStandings([])
    setMvp([])
    setShowFullDraw(false)
    setError(null)
    if (!selectedNight || !selectedDivision) return
    loadDivisionData(selectedNight, selectedDivision)
  }, [selectedDivision]) // eslint-disable-line react-hooks/exhaustive-deps

  async function loadDivisionData(nightId: string, divId: string) {
    setLoading(true)
    setError(null)

    const night = nights.find(n => n.id === nightId)
    const targetDate = night ? nextOccurrence(night.day_of_week) : null
    const dateStr = targetDate ? toLocalDateStr(targetDate) : null

    // Find the active season: the soonest upcoming scheduled fixture for this division.
    // Fall back to the most recently scheduled fixture if none are upcoming.
    const { data: activeFx } = await supabase.from('fixtures')
      .select('season_id')
      .eq('division_id', divId)
      .eq('status', 'scheduled')
      .is('home_score', null)
      .order('scheduled_date')
      .limit(1)
      .single()

    let seasonId: string | null = activeFx?.season_id ?? null
    if (!seasonId) {
      const { data: latest } = await supabase.from('fixtures')
        .select('season_id')
        .eq('division_id', divId)
        .neq('status', 'cancelled')
        .order('scheduled_date', { ascending: false })
        .limit(1)
        .single()
      seasonId = latest?.season_id ?? null
    }

    // Fetch weekly fixtures pinned to that season
    const weekResult = await supabase.from('fixtures')
      .select(FIXTURE_SELECT)
      .eq('division_id', divId)
      .eq('status', 'scheduled')
      .is('home_score', null)
      .eq('scheduled_date', dateStr ?? '')
      .eq('season_id', seasonId ?? '')
      .order('scheduled_date')

    const weekRows = (weekResult.data ?? []).map(normaliseFixture)
    sortFixtures(weekRows)

    const [allResult, standResult, mvpResult] = await Promise.all([
      // Full draw — same season only
      seasonId
        ? supabase.from('fixtures')
            .select(FIXTURE_SELECT)
            .eq('division_id', divId)
            .eq('season_id', seasonId)
            .neq('status', 'cancelled')
            .order('round')
            .order('scheduled_date')
        : Promise.resolve({ data: [], error: null }),

      // Standings (published seasons only, via view)
      supabase.from('standings')
        .select('team_id, team_name, played, won, drawn, lost, goals_for, goals_against, goal_diff, points')
        .eq('division_id', divId)
        .order('points', { ascending: false })
        .order('goal_diff', { ascending: false })
        .order('goals_for', { ascending: false })
        .order('team_name'),

      // MVP leaderboard
      venue?.mvp_enabled
        ? supabase.from('mvp_leaderboard')
            .select('first_name, team_name, mvp_points')
            .eq('division_id', divId)
            .order('mvp_points', { ascending: false })
            .limit(5)
        : Promise.resolve({ data: [] }),
    ])

    if (weekResult.error || allResult.error) {
      setError('Could not load fixtures. Please try again.')
      setLoading(false)
      return
    }

    setWeekFixtures(weekRows)
    setAllFixtures(sortFixtures((allResult.data ?? []).map(normaliseFixture)))
    setStandings(standResult.data ?? [])
    setMvp((mvpResult as { data: MvpEntry[] | null }).data ?? [])
    setLoading(false)
  }

  // Group all fixtures by round for the full draw view
  const drawByRound = new Map<number, Fixture[]>()
  for (const f of allFixtures) {
    const list = drawByRound.get(f.round) ?? []
    list.push(f)
    drawByRound.set(f.round, list)
  }
  const drawRounds = [...drawByRound.entries()].sort(([a], [b]) => a - b)

  const selectedNightObj = nights.find(n => n.id === selectedNight)
  const nightLabel = selectedNightObj
    ? (selectedNightObj.name ?? DAY_NAMES[selectedNightObj.day_of_week])
    : null

  const upcomingDate = selectedNightObj
    ? nextOccurrence(selectedNightObj.day_of_week).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long' })
    : null

  /* ── Render ── */
  return (
    <div className="venue-page">
      <div className="venue-page__inner">
        <div className="venue-page__heading">
          <h1>{venue?.name || 'Venue'}</h1>
        </div>
        <hr className="brand-rule" />

        {/* Filters */}
        <div className="venue-filters">
          <div className="venue-filter">
            <label className="venue-filter__label" htmlFor="night-select">Night</label>
            <select
              id="night-select"
              className="pub-venue-select"
              value={selectedNight}
              onChange={e => setSelectedNight(e.target.value)}
            >
              <option value="">Select a night…</option>
              {nights.map(n => (
                <option key={n.id} value={n.id}>{n.name ?? DAY_NAMES[n.day_of_week]}</option>
              ))}
            </select>
          </div>

          {divisions.length > 0 && (
            <div className="venue-filter">
              <label className="venue-filter__label" htmlFor="div-select">Division</label>
              <select
                id="div-select"
                className="pub-venue-select"
                value={selectedDivision}
                onChange={e => setSelectedDivision(e.target.value)}
              >
                <option value="">Select a division…</option>
                {divisions.map(d => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        {/* Prompt messages */}
        {!selectedNight && <p className="venue-empty">Select a night to get started.</p>}
        {selectedNight && !selectedDivision && divisions.length === 0 && <p className="venue-empty">No divisions configured for this night.</p>}
        {selectedNight && !selectedDivision && divisions.length > 0 && <p className="venue-empty">Select a division to see fixtures.</p>}
        {selectedDivision && loading && <div className="venue-spinner">Loading…</div>}
        {selectedDivision && !loading && error && <div className="venue-error">{error}</div>}

        {/* Content */}
        {selectedDivision && !loading && !error && (
          <div className="venue-content">

            {/* ── This week's fixtures ── */}
            <section className="venue-section">
              <h2>{upcomingDate ? `Fixtures — ${upcomingDate}` : 'Upcoming fixtures'}</h2>

              {weekFixtures.length === 0 ? (
                <p className="venue-empty">No fixtures scheduled{upcomingDate ? ` for ${nightLabel}` : ''}.</p>
              ) : (
                <div className="fixture-list">
                  {weekFixtures.map(f => (
                    <div key={f.id} className={`fixture-row card ${f.status === 'postponed' ? 'fixture-row--postponed' : ''}`}>
                      <div className="fixture-row__header">
                        {f.slot_time && <span>{fmtTime(f.slot_time)}</span>}
                        {f.slot_time && f.court_name && <span className="fixture-row__sep">·</span>}
                        {f.court_name && <span>{f.court_name}</span>}
                        {f.status === 'postponed' && <span className="fixture-row__postponed">Postponed</span>}
                      </div>
                      <div className="fixture-row__teams">
                        <span className="fixture-row__team">{f.home_team_name}</span>
                        <span className="fixture-row__score">vs</span>
                        <span className="fixture-row__team fixture-row__team--away">{f.away_team_name}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Expandable full draw */}
              {allFixtures.length > 0 && (
                <div className="full-draw">
                  <button
                    className="full-draw__toggle"
                    onClick={() => setShowFullDraw(v => !v)}
                  >
                    {showFullDraw ? '▲ Hide full draw' : '▼ View full draw'}
                  </button>

                  {showFullDraw && (
                    <div className="full-draw__content">
                      {drawRounds.map(([round, fxs]) => (
                        <div key={round} className="draw-round">
                          <div className="draw-round__header">
                            <span className="draw-round__label">Round {round}</span>
                            {fxs[0]?.scheduled_date && (
                              <span className="draw-round__date">{fmtDate(fxs[0].scheduled_date)}</span>
                            )}
                          </div>
                          {fxs.map(f => (
                            <div key={f.id} className="draw-row">
                              <span className="draw-row__time">{fmtTime(f.slot_time)}</span>
                              <span className="draw-row__team draw-row__team--home">{f.home_team_name}</span>
                              <span className="draw-row__score">
                                {f.home_score != null && f.away_score != null
                                  ? `${f.home_score}–${f.away_score}`
                                  : 'vs'}
                              </span>
                              <span className="draw-row__team draw-row__team--away">{f.away_team_name}</span>
                              {f.court_name && <span className="draw-row__court">{f.court_name}</span>}
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>

            {/* ── Standings ── */}
            {standings.length > 0 && (
              <section className="venue-section">
                <h2>Ladder</h2>
                <div className="ladder-wrap">
                  <div className="ladder-title">Team's Standing</div>
                  <table className="ladder">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th className="ladder__team-col">Team</th>
                        <th title="Played">P</th>
                        <th title="Won">W</th>
                        <th title="Drawn">D</th>
                        <th title="Lost">L</th>
                        <th title="Goals For">GF</th>
                        <th title="Goals Against">GA</th>
                        <th title="Goal Difference">GD</th>
                        <th title="Points" className="ladder__pts">PTS</th>
                      </tr>
                    </thead>
                    <tbody>
                      {standings.map((row, i) => (
                        <tr key={row.team_id} className={i === 0 ? 'ladder__top' : ''}>
                          <td className="ladder__pos">{i + 1}</td>
                          <td className="ladder__team-col">{row.team_name}</td>
                          <td>{row.played}</td>
                          <td>{row.won}</td>
                          <td>{row.drawn}</td>
                          <td>{row.lost}</td>
                          <td>{row.goals_for}</td>
                          <td>{row.goals_against}</td>
                          <td className={row.goal_diff > 0 ? 'pos' : row.goal_diff < 0 ? 'neg' : ''}>
                            {row.goal_diff > 0 ? `+${row.goal_diff}` : row.goal_diff}
                          </td>
                          <td className="ladder__pts">{row.points}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}

            {/* ── MVP leaderboard ── */}
            {venue?.mvp_enabled && mvp.length > 0 && (
              <section className="venue-section venue-section--mvp">
                <h2>MVP leaderboard</h2>
                <ol className="mvp-list">
                  {mvp.map((entry, i) => (
                    <li key={`${entry.first_name}-${i}`} className="mvp-entry card">
                      <span className="mvp-entry__rank">{i + 1}</span>
                      <div className="mvp-entry__info">
                        <span className="mvp-entry__name">{entry.first_name}</span>
                        <span className="mvp-entry__team">{entry.team_name}</span>
                      </div>
                      <span className="mvp-entry__pts">{entry.mvp_points} pts</span>
                    </li>
                  ))}
                </ol>
              </section>
            )}

          </div>
        )}
      </div>
    </div>
  )
}
