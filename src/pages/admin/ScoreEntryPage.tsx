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
  venue_id: string
  court_id: string | null
  slot_id: string | null
  divisions: { name: string; type: string } | null
  home_team: { name: string } | null
  away_team: { name: string } | null
  courts: { name: string } | null
  time_slots: { start_time: string; slot_order: number } | null
}

interface Season { id: string; name: string; status: 'draft' | 'published' }
interface VenueInfo { name: string; mvp_enabled: boolean }
type Status = Fixture['status']
type EditStatus = Exclude<Status, 'scheduled'>

interface Row {
  status: EditStatus
  home: string
  away: string
  winner: string
  mvp: [string, string, string]   // player ids for 3, 2, 1
  touched: boolean
  savedInit: boolean
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const MEDAL = ['#f59e0b', '#94a3b8', '#b45309']

function fmt12(t: string | null) {
  if (!t) return ''
  const [h, m] = t.split(':')
  const hour = parseInt(h)
  return `${hour % 12 || 12}:${m}${hour < 12 ? 'am' : 'pm'}`
}
function fmtDay(d: string | null) {
  if (!d) return ''
  const [y, m, day] = d.split('-').map(Number)
  const dt = new Date(y, m - 1, day)
  return `${DOW[dt.getDay()]} ${day} ${MON[m - 1]}`
}

export function ScoreEntryPage() {
  const { seasonId } = useParams<{ seasonId: string }>()
  const [season, setSeason] = useState<Season | null>(null)
  const [fixtures, setFixtures] = useState<Fixture[]>([])
  const [venues, setVenues] = useState<Record<string, VenueInfo>>({})
  const [selectedRound, setSelectedRound] = useState<number | null>(null)
  const [rows, setRows] = useState<Record<string, Row>>({})
  const [playersByTeam, setPlayersByTeam] = useState<Record<string, { id: string; name: string }[]>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: s }, { data: f }, { data: v }] = await Promise.all([
      supabase.from('seasons').select('id, name, status').eq('id', seasonId!).single(),
      supabase.from('fixtures').select(`
        id, round, scheduled_date, status, home_score, away_score,
        forfeit_winner_team_id, home_team_id, away_team_id, venue_id, court_id, slot_id,
        divisions(name, type),
        home_team:home_team_id(name),
        away_team:away_team_id(name),
        courts(name),
        time_slots:slot_id(start_time, slot_order)
      `).eq('season_id', seasonId!).order('round').order('scheduled_date'),
      supabase.from('venues').select('id, name, mvp_enabled'),
    ])
    setSeason(s as Season)
    const fx = (f ?? []) as unknown as Fixture[]
    setFixtures(fx)
    const vMap: Record<string, VenueInfo> = {}
    for (const venue of v ?? []) vMap[venue.id] = venue
    setVenues(vMap)
    // Default to the first round that still has unentered games, else the first round
    const rs = [...new Set(fx.map(f => f.round))].sort((a, b) => a - b)
    const firstUnentered = rs.find(r => fx.some(f => f.round === r && f.away_team_id && f.status === 'scheduled'))
    setSelectedRound(prev => prev ?? firstUnentered ?? rs[0] ?? null)
    setLoading(false)
  }, [seasonId])

  useEffect(() => { load() }, [load])

  // Load rosters + existing MVP for the selected round and (re)initialise the editable rows
  useEffect(() => {
    if (selectedRound == null || !fixtures.length) return
    const roundFx = fixtures.filter(f => f.round === selectedRound && f.away_team_id)
    if (!roundFx.length) { setRows({}); setPlayersByTeam({}); return }

    let cancelled = false
    ;(async () => {
      const teamIds = [...new Set(roundFx.flatMap(f => [f.home_team_id, f.away_team_id!]))]
      const fixtureIds = roundFx.map(f => f.id)
      const [{ data: tps }, { data: awards }] = await Promise.all([
        supabase.from('team_players').select('team_id, players(id, name)').in('team_id', teamIds),
        supabase.from('mvp_awards').select('fixture_id, player_id, points').in('fixture_id', fixtureIds),
      ])
      if (cancelled) return

      const byTeam: Record<string, { id: string; name: string }[]> = {}
      for (const tp of (tps ?? []) as any[]) {
        const p = tp.players
        if (!p) continue
        ;(byTeam[tp.team_id] ??= []).push({ id: p.id, name: p.name })
      }
      for (const tid in byTeam) byTeam[tid].sort((a, b) => a.name.localeCompare(b.name))
      setPlayersByTeam(byTeam)

      const awardMap = new Map<string, Record<number, string>>()
      for (const a of (awards ?? []) as any[]) {
        const m = awardMap.get(a.fixture_id) ?? {}
        m[a.points] = a.player_id
        awardMap.set(a.fixture_id, m)
      }

      const next: Record<string, Row> = {}
      for (const f of roundFx) {
        const am = awardMap.get(f.id) ?? {}
        next[f.id] = {
          status: f.status === 'scheduled' ? 'played' : f.status,
          home: f.home_score?.toString() ?? '',
          away: f.away_score?.toString() ?? '',
          winner: f.forfeit_winner_team_id ?? '',
          mvp: [am[3] ?? '', am[2] ?? '', am[1] ?? ''],
          touched: false,
          savedInit: f.status !== 'scheduled',
        }
      }
      setRows(next)
    })()
    return () => { cancelled = true }
  }, [selectedRound, fixtures])

  function patchRow(id: string, patch: Partial<Row>) {
    setRows(prev => ({ ...prev, [id]: { ...prev[id], ...patch, touched: true } }))
  }

  const rounds = [...new Set(fixtures.map(f => f.round))].sort((a, b) => a - b)
  const roundReal = fixtures
    .filter(f => f.round === selectedRound && f.away_team_id)
    .sort((a, b) => ((a.time_slots?.slot_order ?? 999) - (b.time_slots?.slot_order ?? 999)) ||
      ((a.courts?.name ?? '').localeCompare(b.courts?.name ?? '')))
  const roundByes = fixtures.filter(f => f.round === selectedRound && !f.away_team_id)

  function complete(f: Fixture): boolean {
    const r = rows[f.id]; if (!r) return false
    if (r.status === 'played') return r.home !== '' && r.away !== ''
    if (r.status === 'forfeit') return !!r.winner
    return true // postponed / cancelled
  }
  const changedCount = roundReal.filter(f => rows[f.id]?.touched && complete(f)).length

  async function saveAll() {
    setSaving(true); setSavedMsg('')
    const toSave = roundReal.filter(f => rows[f.id]?.touched && complete(f))
    try {
      for (const f of toSave) {
        const r = rows[f.id]
        const isPlayed = r.status === 'played'
        const isForfeit = r.status === 'forfeit'
        const hs = isPlayed ? parseInt(r.home) : isForfeit ? (r.winner === f.home_team_id ? 3 : 0) : null
        const as = isPlayed ? parseInt(r.away) : isForfeit ? (r.winner === f.home_team_id ? 0 : 3) : null

        const { error: fErr } = await supabase.from('fixtures').update({
          status: r.status,
          home_score: hs,
          away_score: as,
          forfeit_winner_team_id: isForfeit ? r.winner : null,
        }).eq('id', f.id)
        if (fErr) throw fErr

        if (venues[f.venue_id]?.mvp_enabled) {
          await supabase.from('mvp_awards').delete().eq('fixture_id', f.id)
          if (isPlayed || isForfeit) {
            const inserts = ([[r.mvp[0], 3], [r.mvp[1], 2], [r.mvp[2], 1]] as [string, number][])
              .filter(([pid]) => pid)
              .map(([pid, points]) => ({ fixture_id: f.id, player_id: pid, points }))
            if (inserts.length) {
              const { error: mErr } = await supabase.from('mvp_awards').insert(inserts)
              if (mErr) throw mErr
            }
          }
        }
      }
      setSavedMsg(`Saved ${toSave.length} result${toSave.length !== 1 ? 's' : ''}`)
      await load() // refresh; the round effect re-initialises rows from fresh data
    } catch (e: any) {
      setSavedMsg('')
      alert(e.message ?? 'Save failed')
    }
    setSaving(false)
  }

  const roundDate = roundReal[0]?.scheduled_date ?? null

  return (
    <div style={{ paddingBottom: '5rem' }}>
      <div className="breadcrumb"><Link to={`/admin/draw?season=${seasonId}`}>Draw</Link> › Score entry</div>
      <div className="page-header">
        <h1>Score Entry — {season?.name ?? '…'}</h1>
      </div>

      {loading && <div className="loading">Loading fixtures…</div>}
      {!loading && fixtures.length === 0 && <div className="card">No fixtures yet. Generate the draw first.</div>}

      {!loading && fixtures.length > 0 && (
        <>
          <div style={{ marginBottom: '1rem' }}>
            <select
              value={selectedRound ?? ''}
              onChange={e => setSelectedRound(Number(e.target.value))}
              style={{ fontSize: '0.9rem', padding: '0.45rem 0.6rem', minWidth: 240 }}
            >
              {rounds.map(r => {
                const d = fixtures.find(f => f.round === r)?.scheduled_date ?? null
                return <option key={r} value={r}>Round {r}{d ? ` · ${fmtDay(d)}` : ''}</option>
              })}
            </select>
          </div>

          {roundDate && (
            <div style={{ color: 'var(--color-muted)', fontSize: '0.875rem', marginBottom: '0.75rem' }}>
              {fmtDay(roundDate)} · {roundReal.length} game{roundReal.length !== 1 ? 's' : ''}
            </div>
          )}

          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            {roundReal.map((f, i) => (
              <RowEditor
                key={f.id}
                fixture={f}
                row={rows[f.id]}
                mvpEnabled={venues[f.venue_id]?.mvp_enabled ?? false}
                players={[...(playersByTeam[f.home_team_id] ?? []).map(p => ({ ...p, team: f.home_team?.name ?? '' })),
                          ...(playersByTeam[f.away_team_id!] ?? []).map(p => ({ ...p, team: f.away_team?.name ?? '' }))]}
                complete={complete(f)}
                first={i === 0}
                onPatch={patch => patchRow(f.id, patch)}
              />
            ))}
            {roundByes.map(f => (
              <div key={f.id} style={{ padding: '0.75rem 0.9rem', borderTop: '1px solid var(--color-border)', opacity: 0.6 }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--color-muted)' }}>
                  {(f.divisions as any)?.type} · {(f.divisions as any)?.name}
                </div>
                <div style={{ fontSize: '0.95rem' }}>
                  <strong>{f.home_team?.name}</strong> <span style={{ color: 'var(--color-muted)', fontSize: '0.85rem' }}>— Bye, no score</span>
                </div>
              </div>
            ))}
            {roundReal.length === 0 && roundByes.length === 0 && (
              <div style={{ padding: '1rem', color: 'var(--color-muted)', fontSize: '0.88rem' }}>No games in this round.</div>
            )}
          </div>
        </>
      )}

      {/* Sticky save bar */}
      {!loading && roundReal.length > 0 && (
        <div style={{
          position: 'sticky', bottom: 0, marginTop: '1rem',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap',
          padding: '0.75rem 1rem', background: 'var(--color-surface)',
          border: '1px solid var(--color-border)', borderRadius: 'var(--radius)',
        }}>
          <span style={{ fontSize: '0.85rem', color: 'var(--color-muted)' }}>
            {savedMsg ? `✓ ${savedMsg}` : changedCount ? `${changedCount} unsaved change${changedCount !== 1 ? 's' : ''}` : 'No changes yet'}
          </span>
          <button onClick={saveAll} disabled={saving || changedCount === 0}>
            {saving ? 'Saving…' : changedCount ? `Save ${changedCount} change${changedCount !== 1 ? 's' : ''}` : 'Save changes'}
          </button>
        </div>
      )}
    </div>
  )
}

function RowEditor({ fixture, row, mvpEnabled, players, complete, first, onPatch }: {
  fixture: Fixture
  row: Row | undefined
  mvpEnabled: boolean
  players: { id: string; name: string; team: string }[]
  complete: boolean
  first: boolean
  onPatch: (patch: Partial<Row>) => void
}) {
  if (!row) return null
  const accent = row.touched ? (complete ? '#16a34a' : '#d97706') : 'transparent'
  const showMvp = mvpEnabled && (row.status === 'played' || row.status === 'forfeit')
  const chosen = row.mvp.filter(Boolean)

  function setStatus(status: EditStatus) {
    if (status === 'postponed' || status === 'cancelled') onPatch({ status, home: '', away: '' })
    else onPatch({ status })
  }
  function pickWinner(teamId: string) {
    const homeWon = teamId === fixture.home_team_id
    onPatch({ winner: teamId, home: homeWon ? '3' : '0', away: homeWon ? '0' : '3' })
  }
  function setMvp(idx: number, pid: string) {
    const mvp = [...row!.mvp] as [string, string, string]
    mvp[idx] = pid
    onPatch({ mvp })
  }

  return (
    <div style={{
      padding: '0.75rem 0.9rem',
      borderTop: first ? 'none' : '1px solid var(--color-border)',
      borderLeft: `3px solid ${accent}`,
      background: row.touched && complete ? 'var(--color-surface)' : undefined,
    }}>
      <div style={{ fontSize: '0.72rem', color: 'var(--color-muted)', marginBottom: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.5rem', textTransform: 'capitalize' }}>
        {(fixture.time_slots as any)?.start_time ? fmt12((fixture.time_slots as any).start_time) : ''}
        {(fixture.courts as any)?.name ? ` · ${(fixture.courts as any).name}` : ''}
        {' · '}{(fixture.divisions as any)?.type} {(fixture.divisions as any)?.name}
        {row.savedInit && !row.touched && <span className="badge badge-ok" style={{ fontSize: '0.68rem' }}>Saved</span>}
        {row.touched && <span className="badge badge-warn" style={{ fontSize: '0.68rem' }}>Unsaved</span>}
      </div>

      {/* Score line */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 46px 14px 46px 1fr', alignItems: 'center', gap: '0.5rem' }}>
        <span style={{ textAlign: 'right', fontWeight: 500, fontSize: '0.92rem' }}>{fixture.home_team?.name}</span>
        <input
          inputMode="numeric" value={row.home}
          disabled={row.status !== 'played'}
          onChange={e => onPatch({ home: e.target.value.replace(/[^0-9]/g, '') })}
          style={{ width: 46, textAlign: 'center', fontSize: '1.05rem', fontWeight: 600, padding: '0.3rem 0.1rem' }}
          placeholder="–"
        />
        <span style={{ textAlign: 'center', color: 'var(--color-muted)' }}>:</span>
        <input
          inputMode="numeric" value={row.away}
          disabled={row.status !== 'played'}
          onChange={e => onPatch({ away: e.target.value.replace(/[^0-9]/g, '') })}
          style={{ width: 46, textAlign: 'center', fontSize: '1.05rem', fontWeight: 600, padding: '0.3rem 0.1rem' }}
          placeholder="–"
        />
        <span style={{ fontWeight: 500, fontSize: '0.92rem' }}>{fixture.away_team?.name}</span>
      </div>

      {/* Status */}
      <div style={{ marginTop: '0.5rem' }}>
        <select value={row.status} onChange={e => setStatus(e.target.value as EditStatus)} style={{ fontSize: '0.8rem', padding: '0.3rem 0.5rem' }}>
          <option value="played">Played</option>
          <option value="forfeit">Forfeit</option>
          <option value="postponed">Postponed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      {/* Forfeit winner */}
      {row.status === 'forfeit' && (
        <div style={{ marginTop: '0.5rem', display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: '0.78rem', color: 'var(--color-muted)' }}>Winner (3–0):</span>
          {[{ id: fixture.home_team_id, name: fixture.home_team?.name }, { id: fixture.away_team_id!, name: fixture.away_team?.name }].map(t => (
            <button key={t.id} onClick={() => pickWinner(t.id)}
              className={row.winner === t.id ? '' : 'btn-secondary'}
              style={{ fontSize: '0.8rem', padding: '0.3rem 0.7rem', ...(row.winner === t.id ? { background: '#f59e0b', borderColor: '#f59e0b' } : {}) }}>
              {t.name}
            </button>
          ))}
        </div>
      )}

      {/* MVP (played or forfeit, mvp venues) */}
      {showMvp && (
        <div style={{ marginTop: '0.6rem', display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '0.78rem', color: 'var(--color-muted)' }}>MVP</span>
          {[0, 1, 2].map(idx => (
            <span key={idx} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
              <span style={{ width: 20, height: 20, borderRadius: '50%', background: MEDAL[idx], color: '#fff', fontSize: '0.7rem', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{3 - idx}</span>
              <select value={row.mvp[idx]} onChange={e => setMvp(idx, e.target.value)} style={{ fontSize: '0.78rem', padding: '0.25rem 0.4rem', maxWidth: 180 }}>
                <option value="">— none —</option>
                {players.map(p => (
                  <option key={p.id + p.team} value={p.id} disabled={row.mvp[idx] !== p.id && chosen.includes(p.id)}>
                    {p.name} - {p.team}
                  </option>
                ))}
              </select>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
