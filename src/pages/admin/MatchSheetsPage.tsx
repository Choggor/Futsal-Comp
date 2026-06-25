import { useEffect, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { generateMatchSheetsPDF } from '../../utils/matchSheetPdf'
import type { MatchSheetFixture } from '../../utils/matchSheetPdf'

interface RawFixture {
  id: string
  round: number
  phase: string
  scheduled_date: string | null
  home_team_id: string
  away_team_id: string | null
  division_id: string
  venue_id: string
  slot_id: string | null
  court_id: string | null
  status: string
}

export function MatchSheetsPage() {
  const { seasonId } = useParams<{ seasonId: string }>()
  const [seasonName, setSeasonName] = useState('')
  const [fixtures, setFixtures] = useState<RawFixture[]>([])
  const [selectedRound, setSelectedRound] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: s }, { data: fx }] = await Promise.all([
      supabase.from('seasons').select('name').eq('id', seasonId!).single(),
      supabase.from('fixtures')
        .select('id, round, phase, scheduled_date, home_team_id, away_team_id, division_id, venue_id, slot_id, court_id, status')
        .eq('season_id', seasonId!)
        .not('away_team_id', 'is', null) // skip byes
        .order('round')
        .order('slot_id')
        .order('court_id'),
    ])
    setSeasonName(s?.name ?? '')
    const fxList = (fx ?? []) as RawFixture[]
    setFixtures(fxList)
    const rounds = [...new Set(fxList.map(f => f.round))].sort((a, b) => a - b)
    if (rounds.length) setSelectedRound(rounds[0])
    setLoading(false)
  }, [seasonId])

  useEffect(() => { load() }, [load])

  async function handleGenerate() {
    if (selectedRound === null) return
    setGenerating(true)
    setError(null)

    try {
      const roundFixtures = fixtures.filter(f => f.round === selectedRound)
      if (!roundFixtures.length) { setError('No fixtures in this round.'); setGenerating(false); return }

      // Gather unique IDs to batch-load
      const venueIds = [...new Set(roundFixtures.map(f => f.venue_id))]
      const divIds = [...new Set(roundFixtures.map(f => f.division_id))]
      const teamIds = [...new Set(roundFixtures.flatMap(f => [f.home_team_id, f.away_team_id].filter(Boolean) as string[]))]
      const slotIds = [...new Set(roundFixtures.map(f => f.slot_id).filter(Boolean) as string[])]
      const courtIds = [...new Set(roundFixtures.map(f => f.court_id).filter(Boolean) as string[])]

      const [
        { data: venues },
        { data: divisions },
        { data: teams },
        { data: slots },
        { data: courts },
        { data: teamPlayers },
      ] = await Promise.all([
        supabase.from('venues').select('id, name, mvp_enabled').in('id', venueIds),
        supabase.from('divisions').select('id, name, type').in('id', divIds),
        supabase.from('teams').select('id, name').in('id', teamIds),
        slotIds.length ? supabase.from('time_slots').select('id, start_time').in('id', slotIds) : { data: [] },
        courtIds.length ? supabase.from('courts').select('id, name').in('id', courtIds) : { data: [] },
        supabase.from('team_players').select('team_id, player_id').in('team_id', teamIds),
      ])

      // Build lookup maps
      const venueMap = new Map((venues ?? []).map(v => [v.id, v]))
      const divMap = new Map((divisions ?? []).map(d => [d.id, d]))
      const teamMap = new Map((teams ?? []).map(t => [t.id, t]))
      const slotMap = new Map((slots ?? []).map(s => [s.id, s]))
      const courtMap = new Map((courts ?? []).map(c => [c.id, c]))

      // Load players for all team_players
      const playerIds = [...new Set((teamPlayers ?? []).map(tp => tp.player_id))]
      const { data: playerRows } = playerIds.length
        ? await supabase.from('players').select('id, first_name, last_name').in('id', playerIds)
        : { data: [] }

      const playerMap = new Map((playerRows ?? []).map(p => [p.id, `${p.first_name} ${p.last_name}`]))

      // team → sorted player names
      const teamPlayerNames = new Map<string, string[]>()
      for (const tp of teamPlayers ?? []) {
        const name = playerMap.get(tp.player_id) ?? ''
        if (!name) continue
        const list = teamPlayerNames.get(tp.team_id) ?? []
        list.push(name)
        teamPlayerNames.set(tp.team_id, list)
      }
      for (const [tid, names] of teamPlayerNames) {
        teamPlayerNames.set(tid, names.sort())
      }

      // Sort fixtures by slot order then court name
      const slotOrderMap = new Map((slots ?? []).map(s => [s.id, (s as any).slot_order ?? 0]))
      const sorted = [...roundFixtures].sort((a, b) => {
        const sA = slotOrderMap.get(a.slot_id ?? '') ?? 999
        const sB = slotOrderMap.get(b.slot_id ?? '') ?? 999
        if (sA !== sB) return sA - sB
        const cA = courtMap.get(a.court_id ?? '')?.name ?? ''
        const cB = courtMap.get(b.court_id ?? '')?.name ?? ''
        return cA.localeCompare(cB)
      })

      const sheets: MatchSheetFixture[] = sorted.map(f => {
        const venue = venueMap.get(f.venue_id)
        const div = divMap.get(f.division_id)
        const slot = f.slot_id ? slotMap.get(f.slot_id) : null
        const court = f.court_id ? courtMap.get(f.court_id) : null
        const homePlayers = teamPlayerNames.get(f.home_team_id) ?? []
        const awayPlayers = f.away_team_id ? (teamPlayerNames.get(f.away_team_id) ?? []) : []

        return {
          round: f.round,
          scheduledDate: f.scheduled_date,
          slotTime: slot ? (slot as any).start_time : null,
          courtName: court ? (court as any).name : null,
          venueName: venue?.name ?? '',
          mvpEnabled: venue?.mvp_enabled ?? false,
          divisionType: div?.type ?? '',
          divisionName: div?.name ?? '',
          homeTeamName: teamMap.get(f.home_team_id)?.name ?? '?',
          awayTeamName: f.away_team_id ? (teamMap.get(f.away_team_id)?.name ?? '?') : null,
          homePlayers,
          awayPlayers,
        }
      })

      generateMatchSheetsPDF(sheets)
    } catch (e: any) {
      setError(e?.message ?? 'Failed to generate PDF')
    }
    setGenerating(false)
  }

  const rounds = [...new Set(fixtures.map(f => f.round))].sort((a, b) => a - b)
  const roundPhase = (r: number) => fixtures.find(f => f.round === r)?.phase ?? 'regular'
  const roundLabel = (r: number) => {
    const p = roundPhase(r)
    if (p === 'finals') return `Finals (Rd ${r})`
    if (p === 'makeup') return `Makeup (Rd ${r})`
    return `Round ${r}`
  }

  const roundCount = fixtures.filter(f => f.round === selectedRound).length

  return (
    <div>
      <div className="breadcrumb">
        <Link to={`/admin/draw?season=${seasonId}`}>Draw</Link> › Match sheets
      </div>
      <div className="page-header">
        <h1>Match sheets — {seasonName}</h1>
      </div>

      {loading && <div className="loading">Loading…</div>}

      {!loading && rounds.length === 0 && (
        <div className="card">No fixtures found. Generate the draw first.</div>
      )}

      {!loading && rounds.length > 0 && (
        <div className="card">
          <p style={{ fontSize: '0.9rem', color: 'var(--color-muted)', marginBottom: '1rem' }}>
            Select a round to download one match sheet per fixture as a single printable PDF (landscape A4).
          </p>

          {/* Round selector */}
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
            {rounds.map(r => (
              <button
                key={r}
                className={selectedRound === r ? '' : 'btn-secondary'}
                style={{ fontSize: '0.85rem', padding: '0.4rem 0.8rem' }}
                onClick={() => setSelectedRound(r)}
              >
                {roundLabel(r)}
              </button>
            ))}
          </div>

          {selectedRound !== null && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
              <button onClick={handleGenerate} disabled={generating}>
                {generating ? 'Generating…' : `Download PDF — ${roundCount} sheet${roundCount !== 1 ? 's' : ''}`}
              </button>
              <span style={{ fontSize: '0.85rem', color: 'var(--color-muted)' }}>
                {roundCount} fixture{roundCount !== 1 ? 's' : ''} · {fixtures.find(f => f.round === selectedRound)?.scheduled_date ? (() => { const d = fixtures.find(f => f.round === selectedRound)!.scheduled_date!; const [y,m,day] = d.split('-'); return `${day}/${m}/${y}` })() : ''}
              </span>
            </div>
          )}

          {error && (
            <div style={{ color: 'var(--color-danger)', fontSize: '0.875rem', marginTop: '0.75rem' }}>{error}</div>
          )}
        </div>
      )}
    </div>
  )
}
