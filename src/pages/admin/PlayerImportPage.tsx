import { useState, useRef } from 'react'
import Papa from 'papaparse'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'

interface DivisionRecord {
  id: string
  name: string
  venue_night_id: string
  night_label: string  // e.g. "Monday Night @ Test Venue"
}

interface ValidatedRow {
  rowIndex: number
  player_name: string
  team: string
  division: string
  venue_night: string
  insurance_expiry: string
  errors: string[]
  divisionId: string | null
  divisionLabel: string | null
}

const TEMPLATE = [
  'player_name,team,division,venue_night,insurance_expiry',
  'John Smith,Tigers,Mixed Div 1,,2027-01-01',
  'Sarah Jones,Eagles,Mixed Div 1,,',
  'John Smith,Eagles,Mens Div 1,,2027-01-01',
].join('\n')

function col(row: Record<string, string>, ...keys: string[]): string {
  for (const k of keys) {
    const v = row[k] ?? row[k.toLowerCase()] ?? ''
    if (v.trim()) return v.trim()
  }
  return ''
}

export function PlayerImportPage() {
  const [rows, setRows] = useState<ValidatedRow[]>([])
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ players: number; teams: number; assignments: number } | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setResult(null); setParseError(null); setRows([])

    // Load all divisions with their night/venue info
    const { data: divData } = await supabase
      .from('divisions')
      .select('id, name, venue_night_id, venue_nights(name, day_of_week, venues(name))')

    const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

    const divisions: DivisionRecord[] = (divData ?? []).map((d: any) => {
      const nightName = d.venue_nights?.name ?? DAY_NAMES[d.venue_nights?.day_of_week ?? 0] ?? 'Unknown'
      const venueName = d.venue_nights?.venues?.name ?? 'Unknown'
      return {
        id: d.id,
        name: d.name,
        venue_night_id: d.venue_night_id,
        night_label: `${nightName} @ ${venueName}`,
      }
    })

    // Scope divisions for sub-admins
    // (sub-admins can only create teams in their venue's nights)
    // We need venue_id from the night to check scope — load separately if needed
    // For now all admins see all divisions; RLS will enforce on insert

    // Build lookup: div_name_lower -> [DivisionRecord]
    const divByName = new Map<string, DivisionRecord[]>()
    for (const d of divisions) {
      const key = d.name.toLowerCase()
      const list = divByName.get(key) ?? []
      list.push(d)
      divByName.set(key, list)
    }

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: ({ data }) => {
        if (data.length === 0) {
          setParseError('No rows found. Check headers: player_name, team, division, venue_night (optional), insurance_expiry')
          return
        }

        const validated: ValidatedRow[] = data.map((row, i) => {
          const player_name = col(row, 'player_name', 'Player Name', 'name')
          const team = col(row, 'team', 'Team')
          const division = col(row, 'division', 'Division')
          const venue_night = col(row, 'venue_night', 'Venue Night', 'night')
          const insurance_expiry = col(row, 'insurance_expiry', 'Insurance Expiry', 'expiry').replace(/\//g, '-')

          const errors: string[] = []
          if (!player_name) errors.push('Player name is required')
          if (!team) errors.push('Team is required')
          if (!division) errors.push('Division is required')
          if (insurance_expiry && isNaN(Date.parse(insurance_expiry))) {
            errors.push(`Invalid date "${insurance_expiry}" — use YYYY-MM-DD`)
          }

          let divisionId: string | null = null
          let divisionLabel: string | null = null

          if (division) {
            const matches = divByName.get(division.toLowerCase()) ?? []
            if (matches.length === 0) {
              errors.push(`Division "${division}" not found — name must match exactly`)
            } else if (matches.length === 1) {
              divisionId = matches[0].id
              divisionLabel = `${matches[0].name} (${matches[0].night_label})`
            } else {
              // Multiple divisions with same name — need venue_night to disambiguate
              if (venue_night) {
                const filtered = matches.filter(d =>
                  d.night_label.toLowerCase().includes(venue_night.toLowerCase())
                )
                if (filtered.length === 1) {
                  divisionId = filtered[0].id
                  divisionLabel = `${filtered[0].name} (${filtered[0].night_label})`
                } else if (filtered.length === 0) {
                  errors.push(`Division "${division}" found but venue_night "${venue_night}" doesn't match any: ${matches.map(d => d.night_label).join(', ')}`)
                } else {
                  errors.push(`Division "${division}" still ambiguous after filtering by venue_night — be more specific`)
                }
              } else {
                errors.push(`Division "${division}" exists in multiple nights: ${matches.map(d => d.night_label).join(', ')} — add a venue_night column to disambiguate`)
              }
            }
          }

          return { rowIndex: i + 2, player_name, team, division, venue_night, insurance_expiry, errors, divisionId, divisionLabel }
        })

        // Flag name collisions (same name, different expiry)
        const nameExpiries = new Map<string, Set<string>>()
        validated.forEach(r => {
          if (!r.player_name) return
          const set = nameExpiries.get(r.player_name.toLowerCase()) ?? new Set()
          set.add(r.insurance_expiry)
          nameExpiries.set(r.player_name.toLowerCase(), set)
        })
        validated.forEach(r => {
          if ((nameExpiries.get(r.player_name.toLowerCase())?.size ?? 0) > 1) {
            r.errors.push(`"${r.player_name}" appears with different expiry dates — check which is correct`)
          }
        })

        setRows(validated)
      },
      error: (err) => setParseError(err.message),
    })
  }

  async function runImport() {
    const okRows = rows.filter(r => r.errors.length === 0)
    if (!okRows.length) return
    setImporting(true)

    // ── Step 1: Create missing teams ──────────────────────────────────────────
    // Collect unique (team_name, division_id) pairs needed
    const neededTeams = new Map<string, string>() // `name|divId` -> divId
    for (const r of okRows) {
      if (!r.divisionId) continue
      neededTeams.set(`${r.team.toLowerCase()}|${r.divisionId}`, r.divisionId)
    }

    // Fetch existing teams in affected divisions
    const divIds = [...new Set(okRows.map(r => r.divisionId).filter(Boolean) as string[])]
    const { data: existingTeams } = await supabase
      .from('teams')
      .select('id, name, division_id')
      .in('division_id', divIds)

    const teamMap = new Map<string, string>() // `name_lower|divId` -> team_id
    for (const t of existingTeams ?? []) {
      teamMap.set(`${t.name.toLowerCase()}|${t.division_id}`, t.id)
    }

    const toCreateTeams = [...neededTeams.entries()]
      .filter(([key]) => !teamMap.has(key))
      .map(([key, divId]) => ({ name: okRows.find(r => `${r.team.toLowerCase()}|${r.divisionId}` === key)!.team, division_id: divId }))

    let teamsCreated = 0
    if (toCreateTeams.length > 0) {
      const { data: newTeams } = await supabase.from('teams').insert(toCreateTeams).select('id, name, division_id')
      for (const t of newTeams ?? []) {
        teamMap.set(`${t.name.toLowerCase()}|${t.division_id}`, t.id)
      }
      teamsCreated = newTeams?.length ?? 0
    }

    // ── Step 2: Create missing players ────────────────────────────────────────
    const { data: existingPlayers } = await supabase.from('players').select('id, name, insurance_expiry')
    const playerMap = new Map<string, string>() // `name_lower|expiry` -> player_id
    for (const p of existingPlayers ?? []) {
      playerMap.set(`${p.name.toLowerCase()}|${p.insurance_expiry ?? ''}`, p.id)
    }

    const toCreatePlayers = new Map<string, { name: string; insurance_expiry: string | null }>()
    for (const r of okRows) {
      const key = `${r.player_name.toLowerCase()}|${r.insurance_expiry}`
      if (!playerMap.has(key) && !toCreatePlayers.has(key)) {
        toCreatePlayers.set(key, { name: r.player_name, insurance_expiry: r.insurance_expiry || null })
      }
    }

    let playersCreated = 0
    if (toCreatePlayers.size > 0) {
      const { data: newPlayers } = await supabase.from('players').insert([...toCreatePlayers.values()]).select('id, name, insurance_expiry')
      for (const p of newPlayers ?? []) {
        playerMap.set(`${p.name.toLowerCase()}|${p.insurance_expiry ?? ''}`, p.id)
      }
      playersCreated = newPlayers?.length ?? 0
    }

    // ── Step 3: Create missing team_players assignments ────────────────────────
    const { data: existingRoster } = await supabase.from('team_players').select('player_id, team_id')
    const rosterSet = new Set((existingRoster ?? []).map(r => `${r.player_id}|${r.team_id}`))

    const rosterInserts: { player_id: string; team_id: string }[] = []
    for (const r of okRows) {
      if (!r.divisionId) continue
      const playerId = playerMap.get(`${r.player_name.toLowerCase()}|${r.insurance_expiry}`)
      const teamId = teamMap.get(`${r.team.toLowerCase()}|${r.divisionId}`)
      if (!playerId || !teamId) continue
      const key = `${playerId}|${teamId}`
      if (rosterSet.has(key)) continue
      rosterSet.add(key)
      rosterInserts.push({ player_id: playerId, team_id: teamId })
    }

    if (rosterInserts.length > 0) {
      await supabase.from('team_players').insert(rosterInserts)
    }

    setResult({ players: playersCreated, teams: teamsCreated, assignments: rosterInserts.length })
    setRows([])
    if (fileRef.current) fileRef.current.value = ''
    setImporting(false)
  }

  const errorCount = rows.filter(r => r.errors.length > 0).length
  const okCount = rows.filter(r => r.errors.length === 0).length

  return (
    <div>
      <div className="page-header">
        <h1>Import Players (CSV)</h1>
        <Link to="/admin/players">← Players</Link>
      </div>

      <div className="card">
        <h2>File format</h2>
        <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)', marginBottom: '0.5rem' }}>
          Columns: <code>player_name</code>, <code>team</code>, <code>division</code>,{' '}
          <code>venue_night</code> (optional — only needed if two divisions share the same name),{' '}
          <code>insurance_expiry</code> (YYYY-MM-DD, optional).
        </p>
        <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)', marginBottom: '0.75rem' }}>
          Teams are created automatically if they don't exist in the specified division.
          Divisions must already exist. For a player in multiple teams, add one row per team.
        </p>
        <a
          href={`data:text/csv;charset=utf-8,${encodeURIComponent(TEMPLATE)}`}
          download="players-template.csv"
          style={{ fontSize: '0.875rem' }}
        >
          Download template
        </a>
      </div>

      <div className="card">
        <label>
          Select CSV file
          <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={handleFile} style={{ marginTop: '0.25rem' }} />
        </label>
        {parseError && <div className="form-error" style={{ marginTop: '0.75rem' }}>{parseError}</div>}
      </div>

      {result && (
        <div className="card" style={{ background: '#f0fdf4', borderColor: '#86efac' }}>
          <strong>Import complete.</strong>{' '}
          {result.teams > 0 && `${result.teams} team${result.teams !== 1 ? 's' : ''} created. `}
          {result.players > 0 && `${result.players} player${result.players !== 1 ? 's' : ''} created. `}
          {result.assignments > 0 && `${result.assignments} roster assignment${result.assignments !== 1 ? 's' : ''} added.`}
          {result.teams === 0 && result.players === 0 && result.assignments === 0 && 'All records already existed — nothing new to add.'}
        </div>
      )}

      {rows.length > 0 && (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
            <div>
              <span className="badge badge-ok" style={{ marginRight: 8 }}>{okCount} OK</span>
              {errorCount > 0 && <span className="badge badge-error">{errorCount} error{errorCount !== 1 ? 's' : ''} — fix and re-upload</span>}
            </div>
            <button onClick={runImport} disabled={okCount === 0 || errorCount > 0 || importing}>
              {importing ? 'Importing…' : `Import ${okCount} row${okCount !== 1 ? 's' : ''}`}
            </button>
          </div>

          <table className="data-table">
            <thead>
              <tr><th>Row</th><th>Player</th><th>Team</th><th>Division</th><th>Expiry</th><th>Status</th></tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.rowIndex} style={r.errors.length ? { background: '#fff5f5' } : undefined}>
                  <td>{r.rowIndex}</td>
                  <td>{r.player_name}</td>
                  <td>{r.team}</td>
                  <td style={{ fontSize: '0.8rem' }}>{r.divisionLabel ?? r.division}</td>
                  <td>{r.insurance_expiry || '—'}</td>
                  <td>
                    {r.errors.length === 0
                      ? <span className="badge badge-ok">OK</span>
                      : r.errors.map((e, i) => <div key={i} className="badge badge-error" style={{ marginBottom: 2 }}>{e}</div>)
                    }
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}
