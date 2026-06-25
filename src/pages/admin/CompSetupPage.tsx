import { useState, useRef } from 'react'
import Papa from 'papaparse'
import { supabase } from '../../lib/supabase'

/* ── Types ─────────────────────────────────────────────────────────────────── */

interface ParsedRow {
  player_name: string
  team: string
  division: string
  venue_night: string   // "Monday @ Test Venue 1"
  insurance_expiry: string
  // derived
  venue_name: string
  day_of_week: number
  division_type: 'mens' | 'mixed'
  errors: string[]
}

interface Preview {
  venues: string[]
  nights: { venue: string; day: string }[]
  divisions: { venue: string; night: string; name: string; type: string }[]
  teams: { division: string; night: string; name: string }[]
  players: number
}

interface ImportResult {
  venues: number
  nights: number
  divisions: number
  teams: number
  players: number
  assignments: number
}

/* ── Helpers ────────────────────────────────────────────────────────────────── */

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DAY_MAP: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6,
}

function parseVenueNight(venueNight: string): { venueName: string; dayOfWeek: number; dayName: string } | null {
  // Format: "Monday @ Test Venue 1"
  const atIdx = venueNight.indexOf(' @ ')
  if (atIdx === -1) return null
  const dayName = venueNight.slice(0, atIdx).trim()
  const venueName = venueNight.slice(atIdx + 3).trim()
  const dayOfWeek = DAY_MAP[dayName.toLowerCase()]
  if (dayOfWeek === undefined) return null
  return { venueName, dayOfWeek, dayName }
}

function inferDivisionType(divisionName: string): 'mens' | 'mixed' {
  return divisionName.toLowerCase().includes('mixed') ? 'mixed' : 'mens'
}

function parseDate(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const m = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  return trimmed.replace(/\//g, '-')
}

function col(row: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) {
    const v = row[k] ?? row[k.toLowerCase()] ?? ''
    if (v.trim()) return v.trim()
  }
  return ''
}

function buildPreview(rows: ParsedRow[]): Preview {
  const venues = [...new Set(rows.map(r => r.venue_name))].filter(Boolean).sort()

  const nightSet = new Map<string, { venue: string; day: string }>()
  for (const r of rows) {
    if (!r.venue_name || r.day_of_week === undefined) continue
    const key = `${r.venue_name}|${r.day_of_week}`
    if (!nightSet.has(key)) nightSet.set(key, { venue: r.venue_name, day: DAY_NAMES[r.day_of_week] })
  }
  const nights = [...nightSet.values()]

  const divSet = new Map<string, { venue: string; night: string; name: string; type: string }>()
  for (const r of rows) {
    if (!r.venue_name || !r.division) continue
    const key = `${r.venue_name}|${r.day_of_week}|${r.division}`
    if (!divSet.has(key)) divSet.set(key, { venue: r.venue_name, night: DAY_NAMES[r.day_of_week], name: r.division, type: r.division_type })
  }
  const divisions = [...divSet.values()]

  const teamSet = new Map<string, { division: string; night: string; name: string }>()
  for (const r of rows) {
    if (!r.team || !r.division) continue
    const key = `${r.venue_name}|${r.day_of_week}|${r.division}|${r.team}`
    if (!teamSet.has(key)) teamSet.set(key, { division: r.division, night: DAY_NAMES[r.day_of_week], name: r.team })
  }
  const teams = [...teamSet.values()]

  const playerSet = new Set(rows.map(r => r.player_name.toLowerCase()))

  return { venues, nights, divisions, teams, players: playerSet.size }
}

/* ── Component ──────────────────────────────────────────────────────────────── */

export function CompSetupPage() {
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [preview, setPreview] = useState<Preview | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [log, setLog] = useState<string[]>([])
  const fileRef = useRef<HTMLInputElement>(null)

  function addLog(msg: string) {
    setLog(prev => [...prev, msg])
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setParseError(null); setRows([]); setPreview(null); setResult(null); setLog([])

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: ({ data }) => {
        if (!data.length) {
          setParseError('No rows found. Expected columns: player_name, team, division, venue_night, insurance_expiry')
          return
        }

        const parsed: ParsedRow[] = data.map(row => {
          const player_name = col(row, 'player_name', 'Player Name', 'name')
          const team = col(row, 'team', 'Team')
          const division = col(row, 'division', 'Division')
          const venue_night = col(row, 'venue_night', 'Venue Night', 'night')
          const insurance_expiry = parseDate(col(row, 'insurance_expiry', 'Insurance Expiry', 'expiry')) ?? ''

          const errors: string[] = []
          if (!player_name) errors.push('player_name required')
          if (!team) errors.push('team required')
          if (!division) errors.push('division required')
          if (!venue_night) errors.push('venue_night required (e.g. "Monday @ Test Venue 1")')

          let venue_name = ''
          let day_of_week = -1

          if (venue_night) {
            const parsed = parseVenueNight(venue_night)
            if (!parsed) {
              errors.push(`venue_night "${venue_night}" must be "DayName @ Venue Name"`)
            } else {
              venue_name = parsed.venueName
              day_of_week = parsed.dayOfWeek
            }
          }

          const division_type = inferDivisionType(division)

          return { player_name, team, division, venue_night, insurance_expiry, venue_name, day_of_week, division_type, errors }
        })

        setRows(parsed)
        setPreview(buildPreview(parsed.filter(r => r.errors.length === 0)))
      },
      error: err => setParseError(err.message),
    })
  }

  async function runImport() {
    const okRows = rows.filter(r => r.errors.length === 0)
    if (!okRows.length) return
    setImporting(true); setLog([])

    const result: ImportResult = { venues: 0, nights: 0, divisions: 0, teams: 0, players: 0, assignments: 0 }

    /* ── 1. Venues ───────────────────────────────────────────────────────────── */
    addLog('Creating venues…')
    const uniqueVenueNames = [...new Set(okRows.map(r => r.venue_name))]

    const { data: existingVenues } = await supabase.from('venues').select('id, name')
    const venueMap = new Map<string, string>() // name_lower → id
    for (const v of existingVenues ?? []) venueMap.set(v.name.toLowerCase(), v.id)

    const newVenueNames = uniqueVenueNames.filter(n => !venueMap.has(n.toLowerCase()))
    if (newVenueNames.length) {
      const { data: created } = await supabase
        .from('venues')
        .insert(newVenueNames.map(name => ({ name })))
        .select('id, name')
      for (const v of created ?? []) venueMap.set(v.name.toLowerCase(), v.id)
      result.venues = created?.length ?? 0
    }
    addLog(`Venues: ${result.venues} created, ${uniqueVenueNames.length - result.venues} already existed`)

    /* ── 2. Venue nights ─────────────────────────────────────────────────────── */
    addLog('Creating venue nights…')
    const uniqueNights = [...new Map(
      okRows.map(r => [`${r.venue_name}|${r.day_of_week}`, { venueName: r.venue_name, dayOfWeek: r.day_of_week }])
    ).values()]

    const venueIds = [...new Set(uniqueNights.map(n => venueMap.get(n.venueName.toLowerCase())).filter(Boolean) as string[])]
    const { data: existingNights } = await supabase
      .from('venue_nights').select('id, venue_id, day_of_week')
      .in('venue_id', venueIds)

    const nightMap = new Map<string, string>() // `venueId|day` → id
    for (const n of existingNights ?? []) nightMap.set(`${n.venue_id}|${n.day_of_week}`, n.id)

    const newNights = uniqueNights
      .map(n => ({ venueId: venueMap.get(n.venueName.toLowerCase())!, dayOfWeek: n.dayOfWeek }))
      .filter(n => n.venueId && !nightMap.has(`${n.venueId}|${n.dayOfWeek}`))

    if (newNights.length) {
      const { data: created } = await supabase
        .from('venue_nights')
        .insert(newNights.map(n => ({ venue_id: n.venueId, day_of_week: n.dayOfWeek })))
        .select('id, venue_id, day_of_week')
      for (const n of created ?? []) nightMap.set(`${n.venue_id}|${n.day_of_week}`, n.id)
      result.nights = created?.length ?? 0
    }
    addLog(`Nights: ${result.nights} created, ${uniqueNights.length - result.nights} already existed`)

    /* ── 3. Divisions ────────────────────────────────────────────────────────── */
    addLog('Creating divisions…')
    const uniqueDivisions = [...new Map(
      okRows.map(r => [
        `${r.venue_name}|${r.day_of_week}|${r.division}`,
        { venueName: r.venue_name, dayOfWeek: r.day_of_week, name: r.division, type: r.division_type }
      ])
    ).values()]

    const nightIds = [...new Set([...nightMap.values()])]
    const { data: existingDivisions } = await supabase
      .from('divisions').select('id, name, venue_night_id')
      .in('venue_night_id', nightIds)

    const divMap = new Map<string, string>() // `nightId|name_lower` → id
    for (const d of existingDivisions ?? []) divMap.set(`${d.venue_night_id}|${d.name.toLowerCase()}`, d.id)

    const newDivisions = uniqueDivisions
      .map(d => {
        const venueId = venueMap.get(d.venueName.toLowerCase())
        const nightId = nightMap.get(`${venueId}|${d.dayOfWeek}`)
        return { venueId, nightId, name: d.name, type: d.type }
      })
      .filter(d => d.venueId && d.nightId && !divMap.has(`${d.nightId}|${d.name.toLowerCase()}`))

    if (newDivisions.length) {
      const { data: created } = await supabase
        .from('divisions')
        .insert(newDivisions.map(d => ({
          venue_id: d.venueId,
          venue_night_id: d.nightId,
          name: d.name,
          type: d.type,
          finals_format: 'top4',
        })))
        .select('id, name, venue_night_id')
      for (const d of created ?? []) divMap.set(`${d.venue_night_id}|${d.name.toLowerCase()}`, d.id)
      result.divisions = created?.length ?? 0
    }
    addLog(`Divisions: ${result.divisions} created, ${uniqueDivisions.length - result.divisions} already existed`)

    /* ── 4. Teams ────────────────────────────────────────────────────────────── */
    addLog('Creating teams…')
    const uniqueTeams = [...new Map(
      okRows.map(r => [
        `${r.venue_name}|${r.day_of_week}|${r.division}|${r.team}`,
        { venueName: r.venue_name, dayOfWeek: r.day_of_week, divisionName: r.division, teamName: r.team }
      ])
    ).values()]

    const divIds = [...new Set([...divMap.values()])]
    const { data: existingTeams } = await supabase
      .from('teams').select('id, name, division_id')
      .in('division_id', divIds)

    const teamMap = new Map<string, string>() // `divId|name_lower` → id
    for (const t of existingTeams ?? []) teamMap.set(`${t.division_id}|${t.name.toLowerCase()}`, t.id)

    const newTeams = uniqueTeams
      .map(t => {
        const venueId = venueMap.get(t.venueName.toLowerCase())
        const nightId = nightMap.get(`${venueId}|${t.dayOfWeek}`)
        const divId = nightId ? divMap.get(`${nightId}|${t.divisionName.toLowerCase()}`) : undefined
        return { divId, name: t.teamName }
      })
      .filter(t => t.divId && !teamMap.has(`${t.divId}|${t.name.toLowerCase()}`))

    if (newTeams.length) {
      const { data: created } = await supabase
        .from('teams')
        .insert(newTeams.map(t => ({ division_id: t.divId, name: t.name })))
        .select('id, name, division_id')
      for (const t of created ?? []) teamMap.set(`${t.division_id}|${t.name.toLowerCase()}`, t.id)
      result.teams = created?.length ?? 0
    }
    addLog(`Teams: ${result.teams} created, ${uniqueTeams.length - result.teams} already existed`)

    /* ── 5. Players ──────────────────────────────────────────────────────────── */
    addLog('Creating players…')

    // Fetch all existing players in pages (PostgREST default limit is 1000)
    const playerMap = new Map<string, string>() // name_lower → id
    let playerPage = 0
    while (true) {
      const { data: page } = await supabase.from('players').select('id, name')
        .range(playerPage * 1000, playerPage * 1000 + 999)
      if (!page?.length) break
      for (const p of page) playerMap.set(p.name.toLowerCase(), p.id)
      if (page.length < 1000) break
      playerPage++
    }

    const newPlayers = new Map<string, { name: string; insurance_expiry: string | null }>()
    for (const r of okRows) {
      if (!playerMap.has(r.player_name.toLowerCase())) {
        newPlayers.set(r.player_name.toLowerCase(), { name: r.player_name, insurance_expiry: r.insurance_expiry || null })
      }
    }

    if (newPlayers.size) {
      // Insert in batches of 500 to stay well under PostgREST limits
      const playerBatches = [...newPlayers.values()]
      for (let i = 0; i < playerBatches.length; i += 500) {
        const { data: created } = await supabase
          .from('players')
          .insert(playerBatches.slice(i, i + 500))
          .select('id, name')
        for (const p of created ?? []) playerMap.set(p.name.toLowerCase(), p.id)
        result.players += created?.length ?? 0
      }
    }
    addLog(`Players: ${result.players} created, ${playerMap.size - result.players} already existed`)

    /* ── 6. Roster assignments ───────────────────────────────────────────────── */
    addLog('Creating roster assignments…')
    const rosterSet = new Set<string>()
    let rosterPage = 0
    while (true) {
      const { data: page } = await supabase.from('team_players').select('player_id, team_id')
        .range(rosterPage * 1000, rosterPage * 1000 + 999)
      if (!page?.length) break
      for (const r of page) rosterSet.add(`${r.player_id}|${r.team_id}`)
      if (page.length < 1000) break
      rosterPage++
    }

    const rosterInserts: { player_id: string; team_id: string }[] = []
    for (const r of okRows) {
      const playerId = playerMap.get(r.player_name.toLowerCase())
      const venueId = venueMap.get(r.venue_name.toLowerCase())
      const nightId = nightMap.get(`${venueId}|${r.day_of_week}`)
      const divId = nightId ? divMap.get(`${nightId}|${r.division.toLowerCase()}`) : undefined
      const teamId = divId ? teamMap.get(`${divId}|${r.team.toLowerCase()}`) : undefined
      if (!playerId || !teamId) continue
      const key = `${playerId}|${teamId}`
      if (rosterSet.has(key)) continue
      rosterSet.add(key)
      rosterInserts.push({ player_id: playerId, team_id: teamId })
    }

    if (rosterInserts.length) {
      await supabase.from('team_players').insert(rosterInserts)
      result.assignments = rosterInserts.length
    }
    addLog(`Roster assignments: ${result.assignments} added`)

    addLog('✓ Done!')
    setResult(result)
    setImporting(false)
    setRows([])
    setPreview(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const errorRows = rows.filter(r => r.errors.length > 0)
  const okRows = rows.filter(r => r.errors.length === 0)

  return (
    <div>
      <div className="page-header">
        <h1>Competition Setup — CSV Import</h1>
      </div>

      <div className="card">
        <h2>What this does</h2>
        <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)', lineHeight: 1.6 }}>
          Reads your CSV and creates <strong>venues → nights → divisions → teams → players</strong> in one pass.
          Existing records are skipped (safe to re-run). Courts and time slots still need to be added
          manually via Venues after import.
        </p>
        <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)', marginTop: '0.5rem' }}>
          Required columns: <code>player_name</code>, <code>team</code>, <code>division</code>,{' '}
          <code>venue_night</code> (format: <code>Monday @ Venue Name</code>), <code>insurance_expiry</code> (optional, DD/MM/YYYY).
        </p>
        <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)', marginTop: '0.5rem' }}>
          Division type is inferred automatically — names containing "Mixed" become mixed divisions, all others become mens.
        </p>
      </div>

      <div className="card">
        <label style={{ fontWeight: 600 }}>
          Select CSV file
          <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={handleFile} style={{ display: 'block', marginTop: '0.5rem' }} />
        </label>
        {parseError && <div className="form-error" style={{ marginTop: '0.75rem' }}>{parseError}</div>}
      </div>

      {/* Validation errors */}
      {errorRows.length > 0 && (
        <div className="card" style={{ borderColor: '#fca5a5', background: '#fff5f5' }}>
          <strong style={{ color: 'var(--color-danger)' }}>{errorRows.length} row{errorRows.length !== 1 ? 's' : ''} with errors — fix and re-upload</strong>
          <table className="data-table" style={{ marginTop: '0.75rem' }}>
            <thead><tr><th>Row</th><th>Player</th><th>Error</th></tr></thead>
            <tbody>
              {errorRows.map((r, i) => (
                <tr key={i} style={{ background: '#fff5f5' }}>
                  <td>{i + 2}</td>
                  <td>{r.player_name || '—'}</td>
                  <td style={{ color: 'var(--color-danger)', fontSize: '0.8rem' }}>{r.errors.join(' · ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Preview */}
      {preview && okRows.length > 0 && !result && (
        <div className="card">
          <h2>Preview — {okRows.length} rows ready to import</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
            {[
              { label: 'Venues', count: preview.venues.length },
              { label: 'Nights', count: preview.nights.length },
              { label: 'Divisions', count: preview.divisions.length },
              { label: 'Teams', count: preview.teams.length },
              { label: 'Players', count: preview.players },
            ].map(({ label, count }) => (
              <div key={label} style={{ background: 'var(--color-surface-2)', borderRadius: 'var(--radius-md)', padding: '0.75rem 1rem' }}>
                <div style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--color-primary)', fontFamily: 'var(--font-display)' }}>{count}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--color-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
              </div>
            ))}
          </div>

          <details style={{ marginBottom: '1rem' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem' }}>Venues &amp; nights ({preview.venues.length})</summary>
            <ul style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: 'var(--color-muted)' }}>
              {preview.nights.map((n, i) => <li key={i}>{n.day} @ {n.venue}</li>)}
            </ul>
          </details>

          <details style={{ marginBottom: '1rem' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem' }}>Divisions ({preview.divisions.length})</summary>
            <ul style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: 'var(--color-muted)' }}>
              {preview.divisions.map((d, i) => <li key={i}>{d.night} @ {d.venue} — {d.name} ({d.type})</li>)}
            </ul>
          </details>

          <details style={{ marginBottom: '1.5rem' }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600, fontSize: '0.875rem' }}>Teams ({preview.teams.length})</summary>
            <ul style={{ marginTop: '0.5rem', fontSize: '0.8rem', color: 'var(--color-muted)' }}>
              {preview.teams.map((t, i) => <li key={i}>{t.division} ({t.night}) — {t.name}</li>)}
            </ul>
          </details>

          <button onClick={runImport} disabled={importing}>
            {importing ? 'Importing…' : `Run import (${okRows.length} rows)`}
          </button>
        </div>
      )}

      {/* Import log */}
      {log.length > 0 && (
        <div className="card">
          <h2>Import log</h2>
          <ul style={{ fontSize: '0.875rem', color: 'var(--color-muted)', lineHeight: 1.8, listStyle: 'none', padding: 0, margin: 0 }}>
            {log.map((l, i) => <li key={i}>{l}</li>)}
          </ul>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className="card" style={{ background: '#f0fdf4', borderColor: '#86efac' }}>
          <strong>Import complete!</strong>
          <ul style={{ marginTop: '0.75rem', fontSize: '0.875rem', lineHeight: 1.8, paddingLeft: '1.25rem' }}>
            <li>{result.venues} venue{result.venues !== 1 ? 's' : ''} created</li>
            <li>{result.nights} night{result.nights !== 1 ? 's' : ''} created</li>
            <li>{result.divisions} division{result.divisions !== 1 ? 's' : ''} created</li>
            <li>{result.teams} team{result.teams !== 1 ? 's' : ''} created</li>
            <li>{result.players} player{result.players !== 1 ? 's' : ''} created</li>
            <li>{result.assignments} roster assignment{result.assignments !== 1 ? 's' : ''} added</li>
          </ul>
          <p style={{ marginTop: '0.75rem', fontSize: '0.875rem', color: 'var(--color-muted)' }}>
            Next: go to <strong>Venues</strong> and add courts + time slots to each venue, then use <strong>Draw</strong> to generate and publish a season.
          </p>
        </div>
      )}
    </div>
  )
}
