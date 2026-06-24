import { useEffect, useState, useCallback } from 'react'
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
      <div style={{ fontWeight: 600, color: 'var(--color-muted)', textTransform: 'capitalize', fontSize: '0.7rem' }}>
        {(fixture.divisions as any)?.type} · {(fixture.divisions as any)?.name}
      </div>
      <div style={{ fontWeight: 700 }}>{fixture.home_team?.name ?? '—'}</div>
      <div style={{ color: 'var(--color-muted)', fontSize: '0.72rem' }}>vs</div>
      <div style={{ fontWeight: 700 }}>{isBye ? <em>Bye</em> : (fixture.away_team?.name ?? '—')}</div>
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
        minWidth: 130,
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
  const [pendingMove, setPendingMove] = useState<{ fixture: Fixture; slotId: string; courtId: string; warnings: string[] } | null>(null)
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
    setPendingMove(null)
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
    const warnings = validateMove(fixture, slotId, courtId, roundFixtures, teamPlayerMap)

    if (warnings.length) {
      setPendingMove({ fixture, slotId, courtId, warnings })
    } else {
      applyMove(fixture, slotId, courtId)
    }
  }

  async function applyMove(fixture: Fixture, slotId: string, courtId: string) {
    setSaving(true)
    setPendingMove(null)
    const { error } = await supabase.from('fixtures').update({ slot_id: slotId, court_id: courtId }).eq('id', fixture.id)
    if (error) alert(error.message)
    else setFixtures(prev => prev.map(f => f.id === fixture.id ? { ...f, slot_id: slotId, court_id: courtId } : f))
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
      <div className="breadcrumb"><Link to="/admin/draw">Draw</Link> › Fixture editor</div>
      <div className="page-header">
        <h1>Fixture Editor — {season?.name ?? '…'}</h1>
      </div>

      {loading && <div className="loading">Loading…</div>}
      {!loading && fixtures.length === 0 && <div className="card">No fixtures yet. Generate the draw first.</div>}

      {!loading && fixtures.length > 0 && (
        <>
          {/* Round selector */}
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
            {rounds.map(r => {
              const phase = fixtures.find(f => f.round === r)?.phase
              return (
                <button
                  key={r}
                  className={selectedRound === r ? '' : 'btn-secondary'}
                  style={{ fontSize: '0.85rem', padding: '0.4rem 0.8rem' }}
                  onClick={() => { setSelectedRound(r); setPendingMove(null) }}
                >
                  {phase === 'makeup' ? `Makeup ${r}` : phase === 'finals' ? `Finals` : `Round ${r}`}
                </button>
              )
            })}
          </div>

          {roundDate && (
            <div style={{ color: 'var(--color-muted)', fontSize: '0.875rem', marginBottom: '0.75rem' }}>
              {fmtDate(roundDate)}
            </div>
          )}

          {/* Clash warning + confirm */}
          {pendingMove && (
            <div style={{ background: '#fef3c7', border: '1px solid #f59e0b', borderRadius: 'var(--radius)', padding: '0.75rem', marginBottom: '1rem' }}>
              <div style={{ fontWeight: 700, marginBottom: '0.4rem' }}>⚠ Scheduling clash detected</div>
              <ul style={{ margin: '0 0 0.75rem 1.25rem', fontSize: '0.875rem' }}>
                {pendingMove.warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button onClick={() => applyMove(pendingMove.fixture, pendingMove.slotId, pendingMove.courtId)}>
                  Apply anyway
                </button>
                <button className="btn-secondary" onClick={() => setPendingMove(null)}>Cancel</button>
              </div>
            </div>
          )}

          {saving && <div style={{ color: 'var(--color-muted)', fontSize: '0.85rem', marginBottom: '0.5rem' }}>Saving…</div>}

          {/* Grid */}
          <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
            <div style={{ overflowX: 'auto', marginBottom: '1.5rem' }}>
              <table style={{ borderCollapse: 'collapse', width: '100%' }}>
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

            <DragOverlay>
              {dragFixture && <FixtureCard fixture={dragFixture} overlay />}
            </DragOverlay>
          </DndContext>

          {/* Unscheduled */}
          {unscheduled.length > 0 && (
            <div className="card" style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ fontSize: '0.9rem', marginBottom: '0.5rem', color: 'var(--color-muted)' }}>
                Unscheduled ({unscheduled.length}) — drag to a slot above
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
    </div>
  )
}
