import { useState, useRef } from 'react'
import Papa from 'papaparse'
import { Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'

interface ValidatedRow {
  rowIndex: number
  player_name: string
  team: string
  insurance_expiry: string
  errors: string[]
  teamId: string | null
}

const TEMPLATE = 'player_name,team,insurance_expiry\nJohn Smith,Mixed Div 1 - Tigers,2026-06-01\nSarah Jones,Mixed Div 1 - Tigers,\nJohn Smith,Mens Div 1 - Eagles,2026-06-01'

export function PlayerImportPage() {
  const { isSuperAdmin, venueScopes } = useAuth()
  const [rows, setRows] = useState<ValidatedRow[]>([])
  const [importing, setImporting] = useState(false)
  const [result, setResult] = useState<{ created: number; skipped: number } | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setResult(null); setParseError(null); setRows([])

    // Fetch all teams (scoped for sub-admins)
    const { data: teamData } = await supabase
      .from('teams')
      .select('id, name, divisions(venue_id)')

    const allTeams = (teamData ?? []) as unknown as { id: string; name: string; divisions: { venue_id: string } }[]
    const scopedTeams = isSuperAdmin
      ? allTeams
      : allTeams.filter(t => venueScopes.includes(t.divisions?.venue_id ?? ''))
    const teamMap = new Map(scopedTeams.map(t => [t.name.trim().toLowerCase(), t.id]))

    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: ({ data }) => {
        if (data.length === 0) {
          setParseError('No rows found. Check the file has data and the headers are: player_name, team, insurance_expiry')
          return
        }

        const validated: ValidatedRow[] = data.map((row, i) => {
          const player_name = (row['player_name'] ?? row['Player Name'] ?? row['name'] ?? '').trim()
          const team = (row['team'] ?? row['Team'] ?? '').trim()
          const insurance_expiry = (row['insurance_expiry'] ?? row['Insurance Expiry'] ?? row['expiry'] ?? '').trim()

          const errors: string[] = []
          if (!player_name) errors.push('Player name is required')
          if (!team) errors.push('Team name is required')

          const teamId = teamMap.get(team.toLowerCase()) ?? null
          if (team && !teamId) errors.push(`Team "${team}" not found — names must match exactly`)
          if (insurance_expiry && isNaN(Date.parse(insurance_expiry))) {
            errors.push(`Invalid date "${insurance_expiry}" — use YYYY-MM-DD`)
          }

          return { rowIndex: i + 2, player_name, team, insurance_expiry, errors, teamId }
        })

        // Flag name collisions: same name, different expiry
        const nameExpiries = new Map<string, Set<string>>()
        validated.forEach(r => {
          if (!r.player_name) return
          const key = r.player_name.toLowerCase()
          const set = nameExpiries.get(key) ?? new Set()
          set.add(r.insurance_expiry)
          nameExpiries.set(key, set)
        })
        validated.forEach(r => {
          const expiries = nameExpiries.get(r.player_name.toLowerCase())
          if (expiries && expiries.size > 1) {
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
    if (okRows.length === 0) return
    setImporting(true)

    // Fetch existing players
    const { data: existing } = await supabase.from('players').select('id, name, insurance_expiry')
    const existingMap = new Map(
      (existing ?? []).map(p => [`${p.name.toLowerCase()}|${p.insurance_expiry ?? ''}`, p.id])
    )

    // Fetch existing team_players to skip duplicates
    const { data: existingRoster } = await supabase.from('team_players').select('player_id, team_id')
    const rosterSet = new Set((existingRoster ?? []).map(r => `${r.player_id}|${r.team_id}`))

    // Deduplicate: one player record per name+expiry
    const toInsertMap = new Map<string, { name: string; insurance_expiry: string | null }>()
    okRows.forEach(r => {
      const key = `${r.player_name.toLowerCase()}|${r.insurance_expiry}`
      if (!existingMap.has(key) && !toInsertMap.has(key)) {
        toInsertMap.set(key, { name: r.player_name, insurance_expiry: r.insurance_expiry || null })
      }
    })

    let created = 0
    if (toInsertMap.size > 0) {
      const { data: newPlayers } = await supabase
        .from('players')
        .insert([...toInsertMap.values()])
        .select('id, name, insurance_expiry')
      ;(newPlayers ?? []).forEach(p => {
        existingMap.set(`${p.name.toLowerCase()}|${p.insurance_expiry ?? ''}`, p.id)
      })
      created = newPlayers?.length ?? 0
    }

    // Insert team assignments
    const rosterInserts = okRows
      .flatMap(r => {
        const key = `${r.player_name.toLowerCase()}|${r.insurance_expiry}`
        const playerId = existingMap.get(key)
        if (!playerId || !r.teamId) return []
        const rKey = `${playerId}|${r.teamId}`
        if (rosterSet.has(rKey)) return []
        rosterSet.add(rKey)
        return [{ player_id: playerId, team_id: r.teamId }]
      })

    if (rosterInserts.length > 0) {
      await supabase.from('team_players').insert(rosterInserts)
    }

    setResult({ created, skipped: toInsertMap.size === 0 ? okRows.length : okRows.length - created })
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
        <p style={{ fontSize: '0.875rem', color: 'var(--color-muted)', marginBottom: '0.75rem' }}>
          Columns: <code>player_name</code>, <code>team</code>, <code>insurance_expiry</code> (YYYY-MM-DD, optional).
          For a player in multiple teams, add one row per team with the same name and expiry.
          Team names must match exactly what's in the system.
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
          {result.created} new player{result.created !== 1 ? 's' : ''} created
          {result.skipped > 0 ? `, ${result.skipped} already existed (skipped).` : '.'}
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
              <tr><th>Row</th><th>Player name</th><th>Team</th><th>Insurance expiry</th><th>Status</th></tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.rowIndex} style={r.errors.length ? { background: '#fff5f5' } : undefined}>
                  <td>{r.rowIndex}</td>
                  <td>{r.player_name}</td>
                  <td>{r.team}</td>
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
