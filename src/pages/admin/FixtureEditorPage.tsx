import { useEffect, useState, useCallback, Fragment } from 'react'
import { useParams, Link } from 'react-router-dom'
import {
  DndContext, DragOverlay,
  PointerSensor, useSensor, useSensors, useDroppable, useDraggable,
} from '@dnd-kit/core'
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core'
import { supabase } from '../../lib/supabase'

interface Fixture {
  id: string
  round: number
  phase: string
  scheduled_date: string | null
  slot_id: string | null
  court_id: string | null
  status: 'scheduled' | 'played' | 'forfeit' | 'postponed' | 'cancelled'
  home_team_id: string
  away_team_id: string | null
  home_team: { name: string } | null
  away_team: { name: string } | null
  divisions: { name: string; type: string } | null
}

interface Slot { id: string; start_time: string; slot_order: number }
interface Court { id: string; name: string }
interface Season { id: string; name: string; status: string; venue_night_id: string | null }

type PendingAction =
  | { kind: 'move'; fixture: Fixture; slotId: string; courtId: string; warnings: string[] }
  | { kind: 'swap'; fixture: Fixture; occupant: Fixture; warnings: string[] }

function fmt12(t: string | null) {
  if (!t) return ''
  const [h, m] = t.split(':')
  const hour = parseInt(h)
  return `${hour % 12 || 12}:${m}${hour < 12 ? 'am' : 'pm'}`
}

function fmtDate(d: string | null) {
  if (!d) return ''
  const [y, mo, day] = d.split('-')
  return `${day}/${mo}/${y}`
}

function validateMove(
  fixture: Fixture,
  targetSlotId: string,
  targetCourtId: string,
  roundFixtures: Fixture[],
  teamPlayerMap: Map<string, Set<string>>,
): string[] {
  const warnings: string[] = []
  const others = roundFixtures.filter(f => f.id !== fixture.id && f.slot_id === targetSlotId)

  if (others.some(f => f.court_id === targetCourtId)) {
    warnings.push('Court already occupied in this slot')
  }

  const occupiedTeams = new Set(others.flatMap(f => [f.home_team_id, f.away_team_id].filter(Boolean) as string[]))
  if (occupiedTeams.has(fixture.home_team_id)) warnings.push(`${fixture.home_team?.name} already plays in this slot`)
  if (fixture.away_team_id && occupiedTeams.has(fixture.away_team_id)) warnings.push(`${fixture.away_team?.name} already plays in this slot`)

  const occupiedPlayers = new Set<string>()
  for (const o of others) {
    teamPlayerMap.get(o.home_team_id)?.forEach(p => occupiedPlayers.add(p))
    if (o.away_team_id) teamPlayerMap.get(o.away_team_id)?.forEach(p => occupiedPlayers.add(p))
  }
  const myPlayers = new Set([
    ...(teamPlayerMap.get(fixture.home_team_id) ?? []),
    ...(fixture.away_team_id ? teamPlayerMap.get(fixture.away_team_id) ?? [] : []),
  ])
  const clashCount = [...myPlayers].filter(p => occupiedPlayers.has(p)).length
  if (clashCount) warnings.push(`${clashCount} shared player${clashCount > 1 ? 's' : ''} already playing in this slot`)

  return warnings
}

// Validate a swap: a moves to b's slot/court and b moves to a's.
// Only cross-slot swaps can create new clashes (same-slot = just trading courts).
function validateSwap(
  a: Fixture,
  b: Fixture,
  roundFixtures: Fixture[],
  teamPlayerMap: Map<string, Set<string>>,
): string[] {
  const warnings: string[] = []
  if (a.slot_id === b.slot_id) return warnings // just trading courts in the same slot — always safe

  const checkInto = (mover: Fixture, newSlotId: string | null) => {
    const others = roundFixtures.filter(f => f.id !== a.id && f.id !== b.id && f.slot_id === newSlotId)

    const occTeams = new Set(others.flatMap(f => [f.home_team_id, f.away_team_id].filter(Boolean) as string[]))
    if (occTeams.has(mover.home_team_id)) warnings.push(`${mover.home_team?.name} would play twice in the same time slot`)
    if (mover.away_team_id && occTeams.has(mover.away_team_id)) warnings.push(`${mover.away_team?.name} would play twice in the same time slot`)

    const occPlayers = new Set<string>()
    for (const o of others) {
      teamPlayerMap.get(o.home_team_id)?.forEach(p => occPlayers.add(p))
      if (o.away_team_id) teamPlayerMap.get(o.away_team_id)?.forEach(p => occPlayers.add(p))
    }
    const myPlayers = new Set([
      ...(teamPlayerMap.get(mover.home_team_id) ?? []),
      ...(mover.away_team_id ? teamPlayerMap.get(mover.away_team_id) ?? [] : []),
    ])
    const clash = [...myPlayers].filter(p => occPlayers.has(p)).length
    if (clash) warnings.push(`${clash} shared player${clash > 1 ? 's' : ''} would clash in the new slot`)
  }

  checkInto(a, b.slot_id)
  checkInto(b, a.slot_id)
  return warnings
}

// ── Date helpers for the schedule view ────────────────────────────────────────

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function addDays(isoDate: string, n: number): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  dt.setDate(dt.getDate() + n)
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`
}

function longDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  return `${DOW[dt.getDay()]} ${d} ${MON[m - 1]} ${y}`
}

function weeksBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  const da = new Date(ay, am - 1, ad).getTime()
  const db = new Date(by, bm - 1, bd).getTime()
  return Math.round((db - da) / (7 * 86400000))
}

// ── Draggable fixture card ────────────────────────────────────────────────────

function FixtureCard({ fixture, overlay = false }: { fixture: Fixture; overlay?: boolean }) {
  const isBye = !fixture.away_team_id
  const statusColour: Record<string, string> = {
    played: '#d1fae5', forfeit: '#fef3c7', postponed: '#fee2e2', cancelled: '#f3f4f6',
  }
  return (
    <div style={{
      background: statusColour[fixture.status] ?? '#fff',
      border: '1px solid var(--color-border)',
      borderRadius: 'var(--radius)',
      padding: '0.4rem 0.5rem',
      fontSize: '0.78rem',
      lineHeight: 1.3,
      boxShadow: overlay ? '0 4px 12px rgba(0,0,0,0.15)' : undefined,
      opacity: overlay ? 0.95 : 1,
      cursor: overlay ? 'grabbing' : 'grab',
      userSelect: 'none',
    }}>
      <div style={{ fontWeight: 600, color: 'var(--color-muted)', textTransform: 'capitalize', fontSize: '0.7rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {(fixture.divisions as any)?.type} · {(fixture.divisions as any)?.name}
      </div>
      <div style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fixture.home_team?.name ?? '—'}</div>
      <div style={{ color: 'var(--color-muted)', fontSize: '0.72rem' }}>vs</div>
      <div style={{ fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{isBye ? <em>Bye</em> : (fixture.away_team?.name ?? '—')}</div>
      {fixture.status !== 'scheduled' && (
        <div style={{ marginTop: '0.2rem', fontSize: '0.68rem', textTransform: 'capitalize', color: '#6b7280' }}>
          {fixture.status}
        </div>
      )}
    </div>
  )
}

function Draggable({ fixture }: { fixture: Fixture }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: fixture.id })
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      style={{
        transform: transform ? `translate(${transform.x}px,${transform.y}px)` : undefined,
        opacity: isDragging ? 0.3 : 1,
        touchAction: 'none',
      }}
    >
      <FixtureCard fixture={fixture} />
    </div>
  )
}

// ── Droppable grid cell ───────────────────────────────────────────────────────

function DroppableCell({ id, children }: { id: string; children?: React.ReactNode }) {
  const { setNodeRef, isOver } = useDroppable({ id })
  return (
    <td
      ref={setNodeRef}
      style={{
        verticalAlign: 'top',
        minWidth: 100,
        minHeight: 70,
        padding: '0.35rem',
        background: isOver ? '#eff6ff' : undefined,
        border: isOver ? '2px dashed var(--color-primary)' : '1px solid var(--color-border)',
        transition: 'background 0.1s',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', minHeight: 60 }}>
        {children}
      </div>
    </td>
  )
}

// ── Reschedule panel (for postponed fixtures) ─────────────────────────────────

function ReschedulePanel({ fixture, slots, courts, maxRound, onSaved }: {
  fixture: Fixture
  slots: Slot[]
  courts: Court[]
  maxRound: number
  onSaved: () => void
}) {
  const [date, setDate] = useState('')
  const [slotId, setSlotId] = useState('')
  const [courtId, setCourtId] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    if (!date || !slotId || !courtId) { setError('Fill all fields'); return }
    setSaving(true)
    const { error: e } = await supabase.from('fixtures').update({
      scheduled_date: date,
      slot_id: slotId,
      court_id: courtId,
      status: 'scheduled',
      phase: 'makeup',
      round: maxRound + 1,
    }).eq('id', fixture.id)
    if (e) { setError(e.message); setSaving(false); return }
    onSaved()
  }

  return (
    <div style={{ marginTop: '0.5rem', padding: '0.5rem', background: '#fef9c3', borderRadius: 'var(--radius)', border: '1px solid #fde047' }}>
      <div style={{ fontSize: '0.78rem', fontWeight: 600, marginBottom: '0.4rem' }}>Reschedule to makeup round</div>
      {error && <div style={{ color: 'var(--color-danger)', fontSize: '0.78rem', marginBottom: '0.3rem' }}>{error}</div>}
      <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <label style={{ fontSize: '0.78rem' }}>Date<br />
          <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ fontSize: '0.85rem', padding: '0.3rem' }} />
        </label>
        <label style={{ fontSize: '0.78rem' }}>Time slot<br />
          <select value={slotId} onChange={e => setSlotId(e.target.value)} style={{ fontSize: '0.85rem', padding: '0.3rem' }}>
            <option value="">— select —</option>
            {slots.map(s => <option key={s.id} value={s.id}>{fmt12(s.start_time)}</option>)}
          </select>
        </label>
        <label style={{ fontSize: '0.78rem' }}>Court<br />
          <select value={courtId} onChange={e => setCourtId(e.target.value)} style={{ fontSize: '0.85rem', padding: '0.3rem' }}>
            <option value="">— select —</option>
            {courts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <button onClick={save} disabled={saving} style={{ fontSize: '0.85rem', padding: '0.35rem 0.75rem' }}>
          {saving ? 'Saving…' : 'Reschedule'}
        </button>
      </div>
    </div>
  )
}

// ── Schedule view — round dates, holidays, cascading shifts ───────────────────

interface RoundInfo {
  round: number
  phase: string
  date: string | null
  games: number
  ids: string[]
}

function ScheduleView({ fixtures, onChanged }: { fixtures: Fixture[]; onChanged: () => void }) {
  const [expanded, setExpanded] = useState<number | null>(null)
  const [dateDraft, setDateDraft] = useState('')
  const [saving, setSaving] = useState(false)

  // Group fixtures into rounds
  const roundMap = new Map<number, RoundInfo>()
  for (const f of fixtures) {
    if (f.round == null) continue
    let ri = roundMap.get(f.round)
    if (!ri) { ri = { round: f.round, phase: f.phase, date: f.scheduled_date, games: 0, ids: [] }; roundMap.set(f.round, ri) }
    ri.ids.push(f.id)
    if (f.away_team_id) ri.games++
    if (!ri.date && f.scheduled_date) ri.date = f.scheduled_date
  }
  const rounds = [...roundMap.values()].sort((a, b) => {
    if (a.date && b.date) return a.date < b.date ? -1 : a.date > b.date ? 1 : a.round - b.round
    if (a.date) return -1
    if (b.date) return 1
    return a.round - b.round
  })

  const maxDate = rounds.reduce((m, r) => (r.date && r.date > m ? r.date : m), '')

  function roundLabel(r: RoundInfo) {
    if (r.phase === 'finals') return 'Finals'
    if (r.phase === 'makeup') return `Makeup ${r.round}`
    return `Round ${r.round}`
  }

  async function applyDate(r: RoundInfo, newDate: string) {
    setSaving(true)
    const { error } = await supabase.from('fixtures').update({ scheduled_date: newDate }).in('id', r.ids)
    setSaving(false)
    if (error) { alert(error.message); return }
    setExpanded(null)
    onChanged()
  }

  // Shift this round AND everything scheduled on/after its date by `weeks`.
  async function shiftFrom(r: RoundInfo, weeks: number) {
    if (!r.date) return
    const days = weeks * 7
    const affected = fixtures.filter(f => f.scheduled_date && f.scheduled_date >= r.date!)
    const byDate = new Map<string, string[]>()
    for (const f of affected) {
      const list = byDate.get(f.scheduled_date!) ?? []
      list.push(f.id)
      byDate.set(f.scheduled_date!, list)
    }
    setSaving(true)
    for (const [d, ids] of byDate) {
      const { error } = await supabase.from('fixtures').update({ scheduled_date: addDays(d, days) }).in('id', ids)
      if (error) { alert(error.message); setSaving(false); return }
    }
    setSaving(false)
    setExpanded(null)
    onChanged()
  }

  async function moveToEnd(r: RoundInfo) {
    if (!maxDate) return
    await applyDate(r, addDays(maxDate, 7))
  }

  return (
    <div className="card">
      <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)', marginBottom: '1rem' }}>
        Adjust round dates for public holidays or closures. Changes go live on the public site immediately.
      </p>

      <div style={{ border: '1px solid var(--color-border)', borderRadius: 'var(--radius)', overflow: 'hidden' }}>
        {rounds.map((r, i) => {
          const prev = rounds[i - 1]
          const gap = (prev?.date && r.date) ? weeksBetween(prev.date, r.date) : 1
          const isOpen = expanded === r.round
          // Disallow pulling forward if it would collide with the previous round
          const canPullForward = !!r.date && (!prev?.date || weeksBetween(prev.date, r.date) > 1)
          return (
            <div key={r.round}>
              {gap > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.4rem 0.9rem', background: '#fef9c3', borderBottom: '1px solid var(--color-border)', fontSize: '0.78rem', color: '#854d0e' }}>
                  <span style={{ fontWeight: 600 }}>▸ {gap - 1} week break</span>
                  <span style={{ opacity: 0.75 }}>no games scheduled</span>
                </div>
              )}
              <div style={{ borderBottom: i === rounds.length - 1 ? 'none' : '1px solid var(--color-border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.7rem 0.9rem' }}>
                  <div style={{ width: 80, fontWeight: 600, fontSize: '0.85rem', flexShrink: 0 }}>{roundLabel(r)}</div>
                  <div style={{ flex: 1, minWidth: 0, fontSize: '0.85rem' }}>{r.date ? longDate(r.date) : <em style={{ color: 'var(--color-muted)' }}>No date set</em>}</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--color-muted)', flexShrink: 0 }}>{r.games} game{r.games !== 1 ? 's' : ''}</div>
                  <button
                    className="btn-sm btn-secondary"
                    style={{ flexShrink: 0 }}
                    onClick={() => { setExpanded(isOpen ? null : r.round); setDateDraft(r.date ?? '') }}
                  >
                    {isOpen ? 'Close' : 'Edit'}
                  </button>
                </div>

                {isOpen && (
                  <div style={{ padding: '0 0.9rem 0.9rem 0.9rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                    {/* Change this round only */}
                    <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius)', padding: '0.6rem 0.75rem' }}>
                      <div style={{ fontSize: '0.78rem', fontWeight: 600, marginBottom: '0.4rem' }}>Move just this round</div>
                      <div className="action-row" style={{ alignItems: 'center' }}>
                        <input type="date" value={dateDraft} onChange={e => setDateDraft(e.target.value)} style={{ fontSize: '0.85rem', padding: '0.35rem' }} />
                        <button
                          disabled={saving || !dateDraft || dateDraft === r.date}
                          onClick={() => applyDate(r, dateDraft)}
                        >
                          Apply to this round only
                        </button>
                      </div>
                    </div>

                    {/* Cascade */}
                    <div style={{ background: 'var(--color-surface)', borderRadius: 'var(--radius)', padding: '0.6rem 0.75rem' }}>
                      <div style={{ fontSize: '0.78rem', fontWeight: 600, marginBottom: '0.15rem' }}>Shift this round and all later rounds</div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--color-muted)', marginBottom: '0.4rem' }}>
                        Everything on or after this date moves together — use for a holiday break.
                      </div>
                      <div className="action-row">
                        <button disabled={saving || !canPullForward} onClick={() => shiftFrom(r, -1)}>− 1 week earlier</button>
                        <button disabled={saving || !r.date} onClick={() => shiftFrom(r, 1)}>+ 1 week later</button>
                      </div>
                    </div>

                    {/* Move to end */}
                    <div className="action-row">
                      <button className="btn-secondary" disabled={saving || !r.date || r.date === maxDate} onClick={() => moveToEnd(r)}>
                        Move to end of season
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )
        })}
        {rounds.length === 0 && (
          <div style={{ padding: '1rem', fontSize: '0.85rem', color: 'var(--color-muted)' }}>No rounds yet.</div>
        )}
      </div>

      {saving && <div style={{ color: 'var(--color-muted)', fontSize: '0.85rem', marginTop: '0.75rem' }}>Saving…</div>}
    </div>
  )
}

// ── Balance view — teams × time-slots heatmap ─────────────────────────────────

function BalanceView({ fixtures, slots }: { fixtures: Fixture[]; slots: Slot[] }) {
  const orderedSlots = [...slots].sort((a, b) => a.slot_order - b.slot_order)

  interface TeamMeta { id: string; name: string; divType: string; divName: string }
  const teamMeta = new Map<string, TeamMeta>()
  const counts = new Map<string, Map<string, number>>()      // teamId → slotId → games
  const bandByType = new Map<string, Set<string>>()          // divType → slots that type uses

  for (const f of fixtures) {
    if (!f.away_team_id || !f.slot_id) continue               // skip byes / unscheduled
    const div = f.divisions as any
    const type = div?.type ?? 'mens'
    const dname = div?.name ?? ''
    const pairs: [string, string | undefined][] = [
      [f.home_team_id, f.home_team?.name],
      [f.away_team_id!, f.away_team?.name],
    ]
    for (const [tid, tname] of pairs) {
      if (!teamMeta.has(tid)) teamMeta.set(tid, { id: tid, name: tname ?? '—', divType: type, divName: dname })
      let m = counts.get(tid); if (!m) { m = new Map(); counts.set(tid, m) }
      m.set(f.slot_id, (m.get(f.slot_id) ?? 0) + 1)
    }
    const bset = bandByType.get(type) ?? new Set<string>(); bset.add(f.slot_id); bandByType.set(type, bset)
  }

  const maxCount = Math.max(1, ...[...counts.values()].flatMap(m => [...m.values()]))

  const teams = [...teamMeta.values()]
  const divNames = [...new Set(teams.map(t => t.divName))].sort((a, b) => {
    const ta = teams.find(t => t.divName === a)!.divType
    const tb = teams.find(t => t.divName === b)!.divType
    if (ta !== tb) return ta === 'mixed' ? -1 : 1
    return a.localeCompare(b)
  })

  const cellBg = (n: number) => n === 0 ? 'transparent' : `rgba(37, 99, 235, ${0.15 + 0.85 * (n / maxCount)})`
  const cellFg = (n: number) => n === 0 ? 'transparent' : n / maxCount > 0.55 ? '#fff' : '#1e3a8a'

  if (!teams.length) {
    return <div className="card">No scheduled games to analyse yet. Generate the draw first.</div>
  }

  return (
    <div className="card">
      <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)', marginBottom: '1rem' }}>
        How many games each team plays in each time slot across the season. Even shading along a row = a good spread.
        The <strong>Spread</strong> column flags any team stuck in too few slots.
      </p>

      <div className="table-scroll">
        <table style={{ borderCollapse: 'collapse', fontSize: '0.8rem', width: '100%' }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '0.4rem 0.6rem', position: 'sticky', left: 0, background: 'var(--color-surface)', borderBottom: '2px solid var(--color-border)', minWidth: 130 }}>Team</th>
              {orderedSlots.map(s => (
                <th key={s.id} style={{ padding: '0.4rem 0.3rem', textAlign: 'center', whiteSpace: 'nowrap', borderBottom: '2px solid var(--color-border)', color: 'var(--color-muted)', fontWeight: 600, minWidth: 52 }}>
                  {fmt12(s.start_time)}
                </th>
              ))}
              <th style={{ padding: '0.4rem 0.6rem', textAlign: 'left', borderBottom: '2px solid var(--color-border)', color: 'var(--color-muted)', fontWeight: 600, whiteSpace: 'nowrap' }}>Spread</th>
            </tr>
          </thead>
          <tbody>
            {divNames.map(dn => {
              const divTeams = teams.filter(t => t.divName === dn).sort((a, b) => a.name.localeCompare(b.name))
              const type = divTeams[0]?.divType
              return (
                <Fragment key={dn}>
                  <tr>
                    <td colSpan={orderedSlots.length + 2} style={{ padding: '0.5rem 0.6rem 0.25rem', fontWeight: 700, fontSize: '0.78rem', textTransform: 'capitalize', color: 'var(--color-muted)' }}>
                      {type} · {dn}
                    </td>
                  </tr>
                  {divTeams.map(t => {
                    const band = bandByType.get(t.divType) ?? new Set<string>()
                    const bandSlots = orderedSlots.filter(s => band.has(s.id))
                    const rowCounts = bandSlots.map(s => counts.get(t.id)?.get(s.id) ?? 0)
                    const mx = rowCounts.length ? Math.max(...rowCounts) : 0
                    const mn = rowCounts.length ? Math.min(...rowCounts) : 0
                    const range = mx - mn
                    const spreadColor = range <= 1 ? '#16a34a' : range === 2 ? '#d97706' : '#dc2626'
                    return (
                      <tr key={t.id}>
                        <td style={{ padding: '0.35rem 0.6rem', position: 'sticky', left: 0, background: 'var(--color-bg, #fff)', borderBottom: '1px solid var(--color-border)', whiteSpace: 'nowrap' }}>{t.name}</td>
                        {orderedSlots.map(s => {
                          const n = counts.get(t.id)?.get(s.id) ?? 0
                          return (
                            <td key={s.id} style={{ textAlign: 'center', padding: '0.35rem 0.3rem', borderBottom: '1px solid var(--color-border)', background: cellBg(n), color: cellFg(n), fontWeight: 600 }}>
                              {n > 0 ? n : ''}
                            </td>
                          )
                        })}
                        <td style={{ padding: '0.35rem 0.6rem', borderBottom: '1px solid var(--color-border)', whiteSpace: 'nowrap' }}>
                          <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', background: spreadColor, marginRight: 6 }} />
                          <span style={{ color: 'var(--color-muted)' }}>{rowCounts.join(' / ')}</span>
                        </td>
                      </tr>
                    )
                  })}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function FixtureEditorPage() {
  const { seasonId } = useParams<{ seasonId: string }>()
  const [season, setSeason] = useState<Season | null>(null)
  const [fixtures, setFixtures] = useState<Fixture[]>([])
  const [slots, setSlots] = useState<Slot[]>([])
  const [courts, setCourts] = useState<Court[]>([])
  const [teamPlayerMap, setTeamPlayerMap] = useState<Map<string, Set<string>>>(new Map())
  const [selectedRound, setSelectedRound] = useState<number>(1)
  const [loading, setLoading] = useState(true)
  const [dragFixture, setDragFixture] = useState<Fixture | null>(null)
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [view, setView] = useState<'grid' | 'schedule' | 'balance'>('grid')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }))

  const load = useCallback(async () => {
    setLoading(true)
    const { data: s } = await supabase.from('seasons').select('id, name, status, venue_night_id').eq('id', seasonId!).single()
    setSeason(s)

    const { data: f } = await supabase.from('fixtures').select(`
      id, round, phase, scheduled_date, slot_id, court_id, status,
      home_team_id, away_team_id,
      home_team:home_team_id(name), away_team:away_team_id(name),
      divisions(name, type)
    `).eq('season_id', seasonId!).order('round').order('slot_id')
    const fxs = (f ?? []) as unknown as Fixture[]
    setFixtures(fxs)

    // Rounds
    const rounds = [...new Set(fxs.map(f => f.round))].sort((a, b) => a - b)
    setSelectedRound(rounds[0] ?? 1)

    // Load venue → courts + slots via venue_night
    if (s?.venue_night_id) {
      const { data: vn } = await supabase.from('venue_nights').select('venue_id').eq('id', s.venue_night_id).single()
      if (vn) {
        const [{ data: c }, { data: sl }] = await Promise.all([
          supabase.from('courts').select('id, name').eq('venue_id', vn.venue_id).order('name'),
          supabase.from('time_slots').select('id, start_time, slot_order').eq('venue_id', vn.venue_id).order('slot_order'),
        ])
        setCourts(c ?? [])
        setSlots(sl ?? [])

        // Team player map for clash validation
        const teamIds = [...new Set(fxs.flatMap(f => [f.home_team_id, f.away_team_id].filter(Boolean) as string[]))]
        if (teamIds.length) {
          const { data: tp } = await supabase.from('team_players').select('team_id, player_id').in('team_id', teamIds)
          const map = new Map<string, Set<string>>()
          for (const row of tp ?? []) {
            const s = map.get(row.team_id) ?? new Set(); s.add(row.player_id); map.set(row.team_id, s)
          }
          setTeamPlayerMap(map)
        }
      }
    }
    setLoading(false)
  }, [seasonId])

  useEffect(() => { load() }, [load])

  function handleDragStart(e: DragStartEvent) {
    setDragFixture(fixtures.find(f => f.id === e.active.id) ?? null)
    setPending(null)
  }

  function handleDragEnd(e: DragEndEvent) {
    setDragFixture(null)
    const { active, over } = e
    if (!over || over.id === 'unscheduled') return
    const fixture = fixtures.find(f => f.id === active.id)
    if (!fixture) return

    const [slotId, courtId] = (over.id as string).split('|')
    if (!slotId || !courtId) return
    if (fixture.slot_id === slotId && fixture.court_id === courtId) return // no-op

    const roundFixtures = fixtures.filter(f => f.round === selectedRound && f.scheduled_date === fixture.scheduled_date)

    // If the target cell already holds another (placed) fixture, swap them —
    // their slot + court trade, so a 6pm game can swap with an 8pm game.
    const occupant = roundFixtures.find(f => f.id !== fixture.id && f.slot_id === slotId && f.court_id === courtId)
    if (occupant && fixture.slot_id && fixture.court_id) {
      const warnings = validateSwap(fixture, occupant, roundFixtures, teamPlayerMap)
      if (warnings.length) setPending({ kind: 'swap', fixture, occupant, warnings })
      else applySwap(fixture, occupant)
      return
    }

    const warnings = validateMove(fixture, slotId, courtId, roundFixtures, teamPlayerMap)
    if (warnings.length) setPending({ kind: 'move', fixture, slotId, courtId, warnings })
    else applyMove(fixture, slotId, courtId)
  }

  async function applyMove(fixture: Fixture, slotId: string, courtId: string) {
    setSaving(true)
    setPending(null)
    const { error } = await supabase.from('fixtures').update({ slot_id: slotId, court_id: courtId }).eq('id', fixture.id)
    if (error) alert(error.message)
    else setFixtures(prev => prev.map(f => f.id === fixture.id ? { ...f, slot_id: slotId, court_id: courtId } : f))
    setSaving(false)
  }

  async function applySwap(a: Fixture, b: Fixture) {
    setSaving(true)
    setPending(null)
    const aPos = { slot_id: a.slot_id, court_id: a.court_id }
    const bPos = { slot_id: b.slot_id, court_id: b.court_id }
    // a takes b's cell, b takes a's cell
    const { error: e1 } = await supabase.from('fixtures').update(bPos).eq('id', a.id)
    const { error: e2 } = await supabase.from('fixtures').update(aPos).eq('id', b.id)
    if (e1 || e2) alert((e1 || e2)!.message)
    else setFixtures(prev => prev.map(f =>
      f.id === a.id ? { ...f, ...bPos } : f.id === b.id ? { ...f, ...aPos } : f
    ))
    setSaving(false)
  }

  async function updateStatus(fixtureId: string, status: Fixture['status']) {
    const { error } = await supabase.from('fixtures').update({ status }).eq('id', fixtureId)
    if (error) alert(error.message)
    else setFixtures(prev => prev.map(f => f.id === fixtureId ? { ...f, status } : f))
  }

  const rounds = [...new Set(fixtures.map(f => f.round))].sort((a, b) => a - b)
  const regularRounds = fixtures.filter(f => f.phase === 'regular').map(f => f.round)
  const maxRound = regularRounds.length ? Math.max(...regularRounds) : 0
  const roundFixtures = fixtures.filter(f => f.round === selectedRound)
  const roundDate = roundFixtures.find(f => f.scheduled_date)?.scheduled_date ?? null
  const scheduled = roundFixtures.filter(f => f.slot_id && f.court_id)
  const unscheduled = roundFixtures.filter(f => !f.slot_id || !f.court_id)

  // Build grid: slot → court → fixture[]
  const grid = new Map<string, Map<string, Fixture[]>>()
  for (const slot of slots) {
    const courtMap = new Map<string, Fixture[]>()
    for (const court of courts) courtMap.set(court.id, [])
    grid.set(slot.id, courtMap)
  }
  for (const f of scheduled) {
    grid.get(f.slot_id!)?.get(f.court_id!)?.push(f)
  }

  return (
    <div>
      <div className="breadcrumb"><Link to={`/admin/draw?season=${seasonId}`}>Draw</Link> › Fixture editor</div>
      <div className="page-header">
        <h1>Fixture Editor — {season?.name ?? '…'}</h1>
      </div>

      {loading && <div className="loading">Loading…</div>}
      {!loading && fixtures.length === 0 && <div className="card">No fixtures yet. Generate the draw first.</div>}

      {!loading && fixtures.length > 0 && (
        <>
          {/* View toggle */}
          <div className="tab-scroll" style={{ marginBottom: '1rem' }}>
            <button className={view === 'grid' ? '' : 'btn-secondary'} style={{ fontSize: '0.85rem', padding: '0.4rem 0.9rem' }} onClick={() => setView('grid')}>Grid</button>
            <button className={view === 'schedule' ? '' : 'btn-secondary'} style={{ fontSize: '0.85rem', padding: '0.4rem 0.9rem' }} onClick={() => { setView('schedule'); setPending(null) }}>Schedule</button>
            <button className={view === 'balance' ? '' : 'btn-secondary'} style={{ fontSize: '0.85rem', padding: '0.4rem 0.9rem' }} onClick={() => { setView('balance'); setPending(null) }}>Balance</button>
          </div>

          {view === 'schedule' && <ScheduleView fixtures={fixtures} onChanged={load} />}
          {view === 'balance' && <BalanceView fixtures={fixtures} slots={slots} />}

          {view === 'grid' && (
          <>
          {/* Round selector */}
          <div style={{ marginBottom: '1rem' }}>
            <select
              value={selectedRound}
              onChange={e => { setSelectedRound(Number(e.target.value)); setPending(null) }}
              style={{ fontSize: '0.9rem', padding: '0.45rem 0.6rem', minWidth: 200 }}
            >
              {rounds.map(r => {
                const phase = fixtures.find(f => f.round === r)?.phase
                const label = phase === 'makeup' ? `Makeup ${r}` : phase === 'finals' ? 'Finals' : `Round ${r}`
                return <option key={r} value={r}>{label}</option>
              })}
            </select>
          </div>

          {roundDate && (
            <div style={{ color: 'var(--color-muted)', fontSize: '0.875rem', marginBottom: '0.75rem' }}>
              {fmtDate(roundDate)}
            </div>
          )}

          {/* Clash warning + confirm */}
          {pending && (
            <div style={{ background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: 'var(--radius)', padding: '0.75rem', marginBottom: '1rem' }}>
              <div style={{ fontWeight: 700, marginBottom: '0.4rem' }}>⚠ {pending.kind === 'swap' ? 'Swap' : 'Scheduling'} clash detected</div>
              <ul style={{ margin: '0 0 0.75rem 1.25rem', fontSize: '0.875rem' }}>
                {pending.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button onClick={() => pending.kind === 'swap' ? applySwap(pending.fixture, pending.occupant) : applyMove(pending.fixture, pending.slotId, pending.courtId)}>
                  Apply anyway
                </button>
                <button className="btn-secondary" onClick={() => setPending(null)}>Cancel</button>
              </div>
            </div>
          )}

          {saving && <div style={{ color: 'var(--color-muted)', fontSize: '0.85rem', marginBottom: '0.5rem' }}>Saving…</div>}

          {/* Grid */}
          <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
            <div style={{ overflowX: 'auto', marginBottom: '1.5rem', WebkitOverflowScrolling: 'touch' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 360 }}>
                <thead>
                  <tr>
                    <th style={{ padding: '0.4rem 0.5rem', textAlign: 'left', fontSize: '0.8rem', color: 'var(--color-muted)', whiteSpace: 'nowrap', background: 'var(--color-surface)', borderBottom: '2px solid var(--color-border)' }}>
                      Time
                    </th>
                    {courts.map(c => (
                      <th key={c.id} style={{ padding: '0.4rem 0.5rem', textAlign: 'left', fontSize: '0.85rem', fontWeight: 700, background: 'var(--color-surface)', borderBottom: '2px solid var(--color-border)', minWidth: 140 }}>
                        {c.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {slots.map(slot => (
                    <tr key={slot.id}>
                      <td style={{ padding: '0.4rem 0.5rem', fontSize: '0.82rem', fontWeight: 600, whiteSpace: 'nowrap', verticalAlign: 'middle', color: 'var(--color-muted)' }}>
                        {fmt12(slot.start_time)}
                      </td>
                      {courts.map(court => {
                        const cellFixtures = grid.get(slot.id)?.get(court.id) ?? []
                        return (
                          <DroppableCell key={court.id} id={`${slot.id}|${court.id}`}>
                            {cellFixtures.map(f => <Draggable key={f.id} fixture={f} />)}
                          </DroppableCell>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Unscheduled — kept inside DndContext so the cards are draggable */}
            {unscheduled.length > 0 && (
              <div className="card" style={{ marginBottom: '1.5rem' }}>
                <h3 style={{ fontSize: '0.9rem', marginBottom: '0.5rem', color: 'var(--color-muted)' }}>
                  Unscheduled ({unscheduled.length}) — No slot available. Either add a time slot or reduce total teams
                </h3>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                  {unscheduled.map(f => (
                    <div key={f.id} style={{ width: 150 }}>
                      <Draggable fixture={f} />
                    </div>
                  ))}
                </div>
              </div>
            )}

            <DragOverlay>
              {dragFixture && <FixtureCard fixture={dragFixture} overlay />}
            </DragOverlay>
          </DndContext>

          {/* Status controls */}
          <div className="card">
            <h3 style={{ fontSize: '0.9rem', marginBottom: '0.75rem' }}>Round {selectedRound} — fixture status</h3>
            {roundFixtures.filter(f => f.away_team_id).map(f => (
              <div key={f.id} style={{ borderBottom: '1px solid var(--color-border)', paddingBottom: '0.75rem', marginBottom: '0.75rem' }}>
                <div
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer', gap: '0.5rem' }}
                  onClick={() => setExpandedId(expandedId === f.id ? null : f.id)}
                >
                  <div style={{ fontSize: '0.875rem' }}>
                    <span style={{ color: 'var(--color-muted)', fontSize: '0.78rem', textTransform: 'capitalize' }}>
                      {(f.divisions as any)?.type} · {(f.divisions as any)?.name} ·{' '}
                    </span>
                    <strong>{f.home_team?.name}</strong> vs <strong>{f.away_team?.name ?? 'Bye'}</strong>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
                    <span style={{ fontSize: '0.78rem', padding: '0.2rem 0.5rem', borderRadius: 999, background: f.status === 'postponed' ? '#fee2e2' : f.status === 'cancelled' ? '#f3f4f6' : '#dbeafe', color: f.status === 'postponed' ? '#991b1b' : f.status === 'cancelled' ? '#374151' : '#1d4ed8' }}>
                      {f.status}
                    </span>
                    <span style={{ color: 'var(--color-muted)' }}>{expandedId === f.id ? '▲' : '▼'}</span>
                  </div>
                </div>

                {expandedId === f.id && (
                  <div style={{ marginTop: '0.5rem' }}>
                    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                      {(['scheduled', 'postponed', 'cancelled'] as Fixture['status'][]).map(s => (
                        <button
                          key={s}
                          className={f.status === s ? '' : 'btn-secondary'}
                          style={{ fontSize: '0.82rem', padding: '0.35rem 0.7rem' }}
                          onClick={() => updateStatus(f.id, s)}
                        >
                          {s.charAt(0).toUpperCase() + s.slice(1)}
                        </button>
                      ))}
                    </div>
                    {f.status === 'postponed' && (
                      <ReschedulePanel
                        fixture={f}
                        slots={slots}
                        courts={courts}
                        maxRound={maxRound}
                        onSaved={load}
                      />
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
          </>
          )}
        </>
      )}
    </div>
  )
}
