import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function iso(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function addDays(isoStr: string, n: number): string {
  const [y, m, d] = isoStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d); dt.setDate(dt.getDate() + n)
  return iso(dt)
}
function fmtDay(isoStr: string): string {
  const [y, m, d] = isoStr.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return `${DOW[dt.getDay()]} ${d} ${MON[m - 1]}`
}

interface WeekRow { seasonId: string; venue: string; round: number; date: string; games: number; due: boolean }
interface Item { count: number; tone: 'danger' | 'warning' | 'info'; title: string; sub: string; to: string }

const TONE: Record<string, [string, string]> = {
  danger: ['#fee2e2', '#991b1b'],
  warning: ['#fef3c7', '#92400e'],
  info: ['#dbeafe', '#1d4ed8'],
}

export function Dashboard() {
  const { appUser, isSuperAdmin, venueScopes } = useAuth()
  const [loading, setLoading] = useState(true)
  const [week, setWeek] = useState<WeekRow[]>([])
  const [items, setItems] = useState<Item[]>([])

  useEffect(() => { load() }, [isSuperAdmin, venueScopes.join(',')]) // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setLoading(true)
    const today = iso(new Date())
    const from = addDays(today, -4)
    const to = addDays(today, 4)
    const scope = <T extends { in: (col: string, vals: string[]) => T }>(q: T): T =>
      isSuperAdmin ? q : q.in('venue_id', venueScopes)

    // ── This week at a glance (published seasons, real games, ±4 days) ──────────
    const { data: wf } = await scope(
      supabase.from('fixtures')
        .select('season_id, venue_id, round, scheduled_date, status, away_team_id, venues(name), seasons(status)')
        .gte('scheduled_date', from).lte('scheduled_date', to)
        .not('away_team_id', 'is', null) as any
    )
    const groups = new Map<string, { seasonId: string; venue: string; round: number; date: string; games: number; unplayed: number }>()
    for (const f of (wf ?? []) as any[]) {
      if (f.seasons?.status !== 'published') continue
      const key = `${f.season_id}|${f.scheduled_date}`
      let g = groups.get(key)
      if (!g) { g = { seasonId: f.season_id, venue: f.venues?.name ?? '', round: f.round, date: f.scheduled_date, games: 0, unplayed: 0 }; groups.set(key, g) }
      g.games++
      if (f.status === 'scheduled') g.unplayed++
    }
    setWeek([...groups.values()]
      .sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.venue.localeCompare(b.venue))
      .map(g => ({ seasonId: g.seasonId, venue: g.venue, round: g.round, date: g.date, games: g.games, due: g.date <= today && g.unplayed > 0 })))

    // ── Results outstanding (published, past 60 days → today, still scheduled) ───
    const { data: rf } = await scope(
      supabase.from('fixtures')
        .select('season_id, venue_id, seasons(status)')
        .gte('scheduled_date', addDays(today, -60)).lte('scheduled_date', today)
        .eq('status', 'scheduled').not('away_team_id', 'is', null) as any
    )
    const pubR = ((rf ?? []) as any[]).filter(f => f.seasons?.status === 'published')
    const rc = new Map<string, number>()
    for (const f of pubR) rc.set(f.season_id, (rc.get(f.season_id) ?? 0) + 1)
    const topR = [...rc.entries()].sort((a, b) => b[1] - a[1])[0]

    // ── Unscheduled real games (no slot assigned) ───────────────────────────────
    const { data: uf } = await scope(
      supabase.from('fixtures')
        .select('season_id, venue_id')
        .is('slot_id', null).not('away_team_id', 'is', null) as any
    )
    const uc = new Map<string, number>()
    for (const f of (uf ?? []) as any[]) uc.set(f.season_id, (uc.get(f.season_id) ?? 0) + 1)
    const topU = [...uc.entries()].sort((a, b) => b[1] - a[1])[0]

    // ── Draft seasons (role-scoped) ─────────────────────────────────────────────
    const { data: sf } = await supabase
      .from('seasons').select('id, name, status, venue_nights(venue_id)').eq('status', 'draft')
    let drafts = (sf ?? []) as any[]
    if (!isSuperAdmin) drafts = drafts.filter(s => venueScopes.includes(s.venue_nights?.venue_id))

    // ── Insurance needing payment (role-scoped) ─────────────────────────────────
    let insurance = 0
    const insFilter = `insurance_expiry.is.null,insurance_expiry.lt.${today}`
    if (isSuperAdmin) {
      const { count } = await supabase.from('players').select('id', { count: 'exact', head: true }).or(insFilter)
      insurance = count ?? 0
    } else if (venueScopes.length) {
      const { data: divs } = await supabase.from('divisions').select('id').in('venue_id', venueScopes)
      const divIds = (divs ?? []).map((d: any) => d.id)
      if (divIds.length) {
        const { data: teams } = await supabase.from('teams').select('id').in('division_id', divIds)
        const teamIds = (teams ?? []).map((t: any) => t.id)
        if (teamIds.length) {
          const { data: tps } = await supabase.from('team_players').select('player_id').in('team_id', teamIds)
          const pids = [...new Set((tps ?? []).map((t: any) => t.player_id))]
          if (pids.length) {
            const { count } = await supabase.from('players').select('id', { count: 'exact', head: true }).in('id', pids).or(insFilter)
            insurance = count ?? 0
          }
        }
      }
    }

    // ── Build action items (only those with something to do) ────────────────────
    const list: Item[] = []
    if (pubR.length > 0) list.push({ count: pubR.length, tone: 'danger', title: 'Results outstanding', sub: 'Games played but scores not yet entered', to: topR ? `/admin/draw/${topR[0]}/scores` : '/admin/draw' })
    if (insurance > 0) list.push({ count: insurance, tone: 'warning', title: 'Players need insurance', sub: 'Expired or unpaid — payment required', to: '/admin/players' })
    if ((uf ?? []).length > 0) list.push({ count: (uf ?? []).length, tone: 'warning', title: 'Games unscheduled', sub: 'No free slot in their round', to: topU ? `/admin/draw/${topU[0]}/editor` : '/admin/draw' })
    if (drafts.length > 0) list.push({ count: drafts.length, tone: 'info', title: drafts.length === 1 ? `${drafts[0].name} is in draft` : 'Seasons in draft', sub: 'Ready to review and publish', to: '/admin/draw' })
    setItems(list)

    setLoading(false)
  }

  return (
    <div>
      <h1>Dashboard</h1>
      <p style={{ marginTop: '0.35rem', marginBottom: '1.5rem', color: 'var(--color-muted)' }}>
        Welcome back, {appUser?.display_name ?? 'Admin'}.
      </p>

      {loading && <div className="loading">Loading…</div>}

      {!loading && (
        <>
          {/* Needs attention */}
          <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--color-muted)', marginBottom: '0.5rem' }}>Needs attention</div>
          {items.length === 0 ? (
            <div className="card" style={{ textAlign: 'center', padding: '1.6rem', marginBottom: '1.5rem' }}>
              <div style={{ fontSize: '1.6rem', color: '#059669', lineHeight: 1 }}>✓</div>
              <div style={{ fontWeight: 600, marginTop: '0.4rem' }}>All caught up</div>
              <div style={{ fontSize: '0.85rem', color: 'var(--color-muted)' }}>No outstanding tasks right now.</div>
            </div>
          ) : (
            <div className="card" style={{ padding: 0, marginBottom: '1.5rem', overflow: 'hidden' }}>
              {items.map((it, i) => {
                const [bg, fg] = TONE[it.tone]
                return (
                  <Link key={i} to={it.to} style={{ textDecoration: 'none', color: 'inherit', display: 'flex', alignItems: 'center', gap: '0.85rem', padding: '0.75rem 0.9rem', borderTop: i ? '1px solid var(--color-border)' : 'none' }}>
                    <span style={{ minWidth: 30, height: 26, padding: '0 8px', borderRadius: 8, background: bg, color: fg, fontWeight: 700, fontSize: '0.9rem', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{it.count}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontWeight: 500, fontSize: '0.92rem' }}>{it.title}</span>
                      <span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--color-muted)' }}>{it.sub}</span>
                    </span>
                    <span style={{ color: 'var(--color-muted)', fontSize: '1.1rem' }}>›</span>
                  </Link>
                )
              })}
            </div>
          )}

          {/* This week at a glance */}
          <div style={{ fontSize: '0.9rem', fontWeight: 600, color: 'var(--color-muted)', marginBottom: '0.5rem' }}>This week at a glance</div>
          {week.length === 0 ? (
            <div className="card" style={{ color: 'var(--color-muted)', fontSize: '0.88rem' }}>No games scheduled in the next few days.</div>
          ) : (
            <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
              {week.map((w, i) => (
                <div key={`${w.seasonId}-${w.date}`} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', padding: '0.7rem 0.9rem', borderTop: i ? '1px solid var(--color-border)' : 'none' }}>
                  <div style={{ flex: 1, minWidth: 150 }}>
                    <span style={{ fontWeight: 500, fontSize: '0.92rem' }}>{fmtDay(w.date)}</span>
                    <span style={{ fontSize: '0.85rem', color: 'var(--color-muted)' }}> · {w.venue} · Round {w.round} · {w.games} game{w.games !== 1 ? 's' : ''}</span>
                    {w.due && (
                      <span style={{ marginLeft: 8, fontSize: '0.72rem', fontWeight: 600, background: '#fee2e2', color: '#991b1b', borderRadius: 999, padding: '0.1rem 0.5rem' }}>Results due</span>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                    <Link to={`/admin/draw/${w.seasonId}/matchsheets`} style={{ textDecoration: 'none' }}>
                      <button className="btn-sm btn-secondary">Match sheets</button>
                    </Link>
                    <Link to={`/admin/draw/${w.seasonId}/scores`} style={{ textDecoration: 'none' }}>
                      <button className="btn-sm">Enter scores</button>
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
