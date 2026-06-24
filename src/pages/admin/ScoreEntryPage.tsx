import { useEffect, useState, useCallback } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

interface Fixture {
  id: string
  round: number
  scheduled_date: string | null
  status: 'scheduled' | 'played' | 'forfeit' | 'postponed' | 'cancelled'
  home_score: number | null
  away_score: number | null
  forfeit_winner_team_id: string | null
  home_team_id: string
  away_team_id: string | null
  division_id: string
  venue_id: string
  court_id: string | null
  slot_id: string | null
  divisions: { name: string; type: string } | null
  home_team: { name: string } | null
  away_team: { name: string } | null
  courts: { name: string } | null
  time_slots: { start_time: string } | null
}

interface Season { id: string; name: string; status: 'draft' | 'published' }
interface MvpAward { player_id: string; points: number }
interface Player { id: string; name: string }
interface VenueInfo { mvp_enabled: boolean; points_win: number; points_draw: number; points_loss: number }

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

function fmt12(t: string | null) {
  if (!t) return ''
  const [h, m] = t.split(':')
  const hour = parseInt(h)
  return `${hour % 12 || 12}:${m}${hour < 12 ? 'am' : 'pm'}`
}

const STATUS_LABELS = { scheduled: 'Scheduled', played: 'Played', forfeit: 'Forfeit', postponed: 'Postponed', cancelled: 'Cancelled' }

function ScoreForm({ fixture, venueInfo, onSaved }: {
  fixture: Fixture
  venueInfo: VenueInfo
  onSaved: () => void
}) {
  const isBye = !fixture.away_team_id
  const [status, setStatus] = useState<Fixture['status']>(fixture.status)
  const [homeScore, setHomeScore] = useState(fixture.home_score?.toString() ?? '')
  const [awayScore, setAwayScore] = useState(fixture.away_score?.toString() ?? '')
  const [forfeitWinner, setForfeitWinner] = useState(fixture.forfeit_winner_team_id ?? '')
  const [mvpAwards, setMvpAwards] = useState<MvpAward[]>([])
  const [players, setPlayers] = useState<Player[]>([])
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [errorMsg, setErrorMsg] = useState('')

  const loadMvpAndPlayers = useCallback(async () => {
    if (!venueInfo.mvp_enabled || isBye) return
    const [{ data: awards }, { data: teamPlayers }] = await Promise.all([
      supabase.from('mvp_awards').select('player_id, points').eq('fixture_id', fixture.id),
      supabase.from('team_players')
        .select('player_id, players(id, name)')
        .in('team_id', [fixture.home_team_id, fixture.away_team_id!]),
    ])
    setMvpAwards(awards ?? [])
    const playerList = (teamPlayers ?? [])
      .map((tp: any) => tp.players)
      .filter(Boolean)
      .sort((a: Player, b: Player) => a.name.localeCompare(b.name))
    // deduplicate by id
    const seen = new Set<string>()
    setPlayers(playerList.filter((p: Player) => { if (seen.has(p.id)) return false; seen.add(p.id); return true }))
    // init empty mvp slots if none saved yet
    if (!awards?.length) setMvpAwards([{ player_id: '', points: 3 }, { player_id: '', points: 2 }, { player_id: '', points: 1 }])
    else setMvpAwards([3, 2, 1].map(pts => awards.find(a => a.points === pts) ?? { player_id: '', points: pts }))
  }, [fixture.id, fixture.home_team_id, fixture.away_team_id, venueInfo.mvp_enabled, isBye])

  useEffect(() => { loadMvpAndPlayers() }, [loadMvpAndPlayers])

  // When status flips to forfeit, auto-fill 3-0
  useEffect(() => {
    if (status === 'forfeit' && forfeitWinner) {
      if (forfeitWinner === fixture.home_team_id) { setHomeScore('3'); setAwayScore('0') }
      else { setHomeScore('0'); setAwayScore('3') }
    }
  }, [status, forfeitWinner, fixture.home_team_id])

  async function save() {
    setSaveState('saving'); setErrorMsg('')
    try {
      const isPlayed = status === 'played'
      const isForfeit = status === 'forfeit'
      const hs = isPlayed ? parseInt(homeScore) : isForfeit ? (forfeitWinner === fixture.home_team_id ? 3 : 0) : null
      const as = isPlayed ? parseInt(awayScore) : isForfeit ? (forfeitWinner === fixture.home_team_id ? 0 : 3) : null

      if (isPlayed && (isNaN(hs!) || isNaN(as!))) throw new Error('Enter valid scores before saving')
      if (isForfeit && !forfeitWinner) throw new Error('Select the team that turned up')

      const { error: fErr } = await supabase.from('fixtures').update({
        status,
        home_score: hs,
        away_score: as,
        forfeit_winner_team_id: isForfeit ? forfeitWinner : null,
      }).eq('id', fixture.id)
      if (fErr) throw fErr

      // MVP
      if (venueInfo.mvp_enabled && isPlayed && !isBye) {
        await supabase.from('mvp_awards').delete().eq('fixture_id', fixture.id)
        const validMvp = mvpAwards.filter(a => a.player_id)
        if (validMvp.length) {
          const { error: mErr } = await supabase.from('mvp_awards').insert(
            validMvp.map(a => ({ fixture_id: fixture.id, player_id: a.player_id, points: a.points }))
          )
          if (mErr) throw mErr
        }
      }

      setSaveState('saved')
      onSaved()
      setTimeout(() => setSaveState('idle'), 2000)
    } catch (e: any) {
      setSaveState('error')
      setErrorMsg(e.message ?? 'Save failed')
    }
  }

  if (isBye) return <div style={{ color: 'var(--color-muted)', fontSize: '0.85rem', padding: '0.5rem 0' }}>Bye — no score required</div>

  const usedPlayers = new Set(mvpAwards.filter(a => a.player_id).map(a => a.player_id))

  return (
    <div style={{ marginTop: '0.75rem' }}>
      {/* Status */}
      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
        {(['played', 'forfeit', 'postponed', 'cancelled'] as Fixture['status'][]).map(s => (
          <button
            key={s}
            onClick={() => setStatus(s)}
            style={{
              padding: '0.6rem 1rem',
              fontSize: '0.9rem',
              background: status === s ? (s === 'played' ? 'var(--color-primary)' : s === 'forfeit' ? '#f59e0b' : '#6b7280') : 'var(--color-surface)',
              color: status === s ? '#fff' : 'var(--color-text)',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius)',
              cursor: 'pointer',
              fontWeight: status === s ? 600 : 400,
            }}
          >
            {STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      {/* Score inputs */}
      {status === 'played' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--color-muted)' }}>{(fixture.home_team as any)?.name}</span>
            <input
              type="number" min={0} max={99}
              value={homeScore} onChange={e => setHomeScore(e.target.value)}
              style={{ width: 72, fontSize: '2rem', textAlign: 'center', padding: '0.4rem', fontWeight: 700 }}
            />
          </div>
          <span style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--color-muted)', marginTop: '1.2rem' }}>–</span>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.25rem' }}>
            <span style={{ fontSize: '0.8rem', color: 'var(--color-muted)' }}>{(fixture.away_team as any)?.name}</span>
            <input
              type="number" min={0} max={99}
              value={awayScore} onChange={e => setAwayScore(e.target.value)}
              style={{ width: 72, fontSize: '2rem', textAlign: 'center', padding: '0.4rem', fontWeight: 700 }}
            />
          </div>
        </div>
      )}

      {/* Forfeit winner */}
      {status === 'forfeit' && (
        <div style={{ marginBottom: '0.75rem' }}>
          <label style={{ fontSize: '0.875rem', fontWeight: 500, display: 'block', marginBottom: '0.25rem' }}>
            Team that turned up (wins 3–0):
          </label>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            {[{ id: fixture.home_team_id, name: (fixture.home_team as any)?.name }, { id: fixture.away_team_id!, name: (fixture.away_team as any)?.name }].map(t => (
              <button
                key={t.id}
                onClick={() => setForfeitWinner(t.id)}
                style={{
                  padding: '0.6rem 1.2rem', fontSize: '0.9rem',
                  background: forfeitWinner === t.id ? '#f59e0b' : 'var(--color-surface)',
                  color: forfeitWinner === t.id ? '#fff' : 'var(--color-text)',
                  border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', cursor: 'pointer',
                  fontWeight: forfeitWinner === t.id ? 600 : 400,
                }}
              >
                {t.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* MVP (only for played fixtures at mvp-enabled venues) */}
      {venueInfo.mvp_enabled && status === 'played' && (
        <div style={{ marginBottom: '0.75rem' }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: '0.4rem', color: 'var(--color-muted)' }}>MVP (3-2-1)</div>
          {mvpAwards.map((award, i) => (
            <div key={award.points} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
              <span style={{
                minWidth: 28, height: 28, borderRadius: '50%', background: ['#fbbf24', '#94a3b8', '#d97706'][i],
                color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '0.8rem', fontWeight: 700, flexShrink: 0,
              }}>{award.points}</span>
              <select
                value={award.player_id}
                onChange={e => setMvpAwards(prev => prev.map(a => a.points === award.points ? { ...a, player_id: e.target.value } : a))}
                style={{ flex: 1, fontSize: '0.9rem', padding: '0.4rem' }}
              >
                <option value="">— select player —</option>
                {players.map(p => (
                  <option key={p.id} value={p.id} disabled={usedPlayers.has(p.id) && award.player_id !== p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}

      {/* Save button */}
      {(status === 'played' || status === 'forfeit') && (
        <div>
          <button
            onClick={save}
            disabled={saveState === 'saving'}
            style={{
              width: '100%', padding: '0.85rem', fontSize: '1rem', fontWeight: 700,
              background: saveState === 'saved' ? '#059669' : saveState === 'error' ? 'var(--color-danger)' : 'var(--color-primary)',
              color: '#fff', border: 'none', borderRadius: 'var(--radius)', cursor: 'pointer',
            }}
          >
            {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? '✓ Saved' : saveState === 'error' ? '✗ Retry' : 'Save result'}
          </button>
          {saveState === 'error' && <div style={{ color: 'var(--color-danger)', fontSize: '0.85rem', marginTop: '0.4rem' }}>{errorMsg}</div>}
        </div>
      )}
    </div>
  )
}

export function ScoreEntryPage() {
  const { seasonId } = useParams<{ seasonId: string }>()
  const [season, setSeason] = useState<Season | null>(null)
  const [fixtures, setFixtures] = useState<Fixture[]>([])
  const [venues, setVenues] = useState<Record<string, VenueInfo>>({})
  const [expanded, setExpanded] = useState<string | null>(null)
  const [filterRound, setFilterRound] = useState<number | 'all'>('all')
  const [loading, setLoading] = useState(true)

  async function load() {
    setLoading(true)
    const [{ data: s }, { data: f }, { data: v }] = await Promise.all([
      supabase.from('seasons').select('id, name, status').eq('id', seasonId!).single(),
      supabase.from('fixtures').select(`
        id, round, scheduled_date, status, home_score, away_score,
        forfeit_winner_team_id, home_team_id, away_team_id, division_id, venue_id, court_id, slot_id,
        divisions(name, type),
        home_team:home_team_id(name),
        away_team:away_team_id(name),
        courts(name),
        time_slots:slot_id(start_time)
      `).eq('season_id', seasonId!).order('round').order('scheduled_date'),
      supabase.from('venues').select('id, mvp_enabled, points_win, points_draw, points_loss'),
    ])
    setSeason(s as Season)
    setFixtures((f ?? []) as unknown as Fixture[])
    const vMap: Record<string, VenueInfo> = {}
    for (const venue of v ?? []) vMap[venue.id] = venue
    setVenues(vMap)
    setLoading(false)
  }

  useEffect(() => { load() }, [seasonId])

  const rounds = [...new Set(fixtures.map(f => f.round))].sort((a, b) => a - b)
  const visible = filterRound === 'all' ? fixtures : fixtures.filter(f => f.round === filterRound)

  const byRound = new Map<number, Fixture[]>()
  for (const f of visible) {
    const list = byRound.get(f.round) ?? []
    list.push(f)
    byRound.set(f.round, list)
  }

  const statusBadge = (f: Fixture) => {
    if (f.status === 'played') return <span className="badge badge-ok">Played</span>
    if (f.status === 'forfeit') return <span className="badge badge-warn">Forfeit</span>
    if (f.status === 'postponed') return <span className="badge" style={{ background: '#e5e7eb', color: '#374151' }}>Postponed</span>
    if (f.status === 'cancelled') return <span className="badge badge-error">Cancelled</span>
    return <span className="badge" style={{ background: '#dbeafe', color: '#1d4ed8' }}>Scheduled</span>
  }

  return (
    <div>
      <div className="breadcrumb"><Link to="/admin/draw">Draw</Link> › Score entry</div>
      <div className="page-header">
        <h1>Score Entry — {season?.name ?? '…'}</h1>
      </div>

      {loading && <div className="loading">Loading fixtures…</div>}

      {!loading && fixtures.length === 0 && (
        <div className="card">No fixtures yet. Generate the draw first.</div>
      )}

      {!loading && fixtures.length > 0 && (
        <>
          {/* Round filter */}
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
            <button
              className={filterRound === 'all' ? '' : 'btn-secondary'}
              style={{ fontSize: '0.85rem', padding: '0.4rem 0.8rem' }}
              onClick={() => setFilterRound('all')}
            >All rounds</button>
            {rounds.map(r => (
              <button
                key={r}
                className={filterRound === r ? '' : 'btn-secondary'}
                style={{ fontSize: '0.85rem', padding: '0.4rem 0.8rem' }}
                onClick={() => setFilterRound(r)}
              >Round {r}</button>
            ))}
          </div>

          {[...byRound.entries()].map(([round, fxs]) => (
            <div key={round} style={{ marginBottom: '1.5rem' }}>
              <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: '0.75rem', color: 'var(--color-muted)' }}>
                Round {round}
                {fxs[0]?.scheduled_date && <span style={{ fontWeight: 400, marginLeft: 8 }}>{fxs[0].scheduled_date}</span>}
              </h2>

              {fxs.map(f => {
                const isExpanded = expanded === f.id
                const venue = venues[f.venue_id] ?? { mvp_enabled: false, points_win: 3, points_draw: 1, points_loss: 0 }
                return (
                  <div key={f.id} className="card" style={{ marginBottom: '0.75rem', padding: '0.875rem' }}>
                    {/* Fixture header — tap to expand */}
                    <div
                      onClick={() => setExpanded(isExpanded ? null : f.id)}
                      style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem' }}
                    >
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '0.75rem', color: 'var(--color-muted)', marginBottom: '0.2rem', textTransform: 'capitalize' }}>
                          {(f.divisions as any)?.type} · {(f.divisions as any)?.name}
                          {(f.courts as any)?.name && ` · ${(f.courts as any).name}`}
                          {(f.time_slots as any)?.start_time && ` · ${fmt12((f.time_slots as any).start_time)}`}
                        </div>
                        <div style={{ fontWeight: 700, fontSize: '1rem' }}>
                          {(f.home_team as any)?.name ?? '—'}
                          {' '}
                          {f.status === 'played' || f.status === 'forfeit'
                            ? <span style={{ fontWeight: 400, fontSize: '0.95rem' }}>{f.home_score} – {f.away_score}</span>
                            : <span style={{ color: 'var(--color-muted)', fontWeight: 400, fontSize: '0.85rem' }}>vs</span>
                          }
                          {' '}
                          {f.away_team_id ? (f.away_team as any)?.name : <em style={{ fontWeight: 400, color: 'var(--color-muted)' }}>Bye</em>}
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
                        {statusBadge(f)}
                        <span style={{ color: 'var(--color-muted)', fontSize: '1.1rem' }}>{isExpanded ? '▲' : '▼'}</span>
                      </div>
                    </div>

                    {/* Expanded score form */}
                    {isExpanded && (
                      <ScoreForm
                        fixture={f}
                        venueInfo={venue}
                        onSaved={load}
                      />
                    )}
                  </div>
                )
              })}
            </div>
          ))}
        </>
      )}
    </div>
  )
}
