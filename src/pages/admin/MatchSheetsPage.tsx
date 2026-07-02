import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useAuth } from '../../contexts/AuthContext'
import { generateMatchSheetsPDF } from '../../utils/matchSheetPdf'
import type { MatchSheetFixture, MatchSheetConfig } from '../../utils/matchSheetPdf'

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
}

const DAY_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function fmtShort(d: string | null): string {
  if (!d) return ''
  const [, m, day] = d.split('-').map(Number)
  return `${day} ${MON[m - 1]}`
}

export function MatchSheetsPage() {
  const { seasonId } = useParams<{ seasonId: string }>()
  const { isSuperAdmin } = useAuth()
  const [seasonName, setSeasonName] = useState('')
  const [venueName, setVenueName] = useState('')
  const [nightLabel, setNightLabel] = useState('')
  const [fixtures, setFixtures] = useState<RawFixture[]>([])
  const [selectedRound, setSelectedRound] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Config (org info + logo) — persisted in the database (org_settings, single row)
  const [config, setConfig] = useState<MatchSheetConfig>({ orgName: '', contactInfo: '', logoDataUrl: null })
  const [showConfig, setShowConfig] = useState(false)
  const [cfgSaving, setCfgSaving] = useState(false)
  const [cfgSaved, setCfgSaved] = useState(false)
  const logoInputRef = useRef<HTMLInputElement>(null)

  function updateConfig(patch: Partial<MatchSheetConfig>) {
    setConfig(prev => ({ ...prev, ...patch }))
  }

  function loadDefaultLogo() {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.naturalWidth || 400
      canvas.height = img.naturalHeight || 150
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.drawImage(img, 0, 0)
      updateConfig({ logoDataUrl: canvas.toDataURL('image/png') })
    }
    img.src = '/logo.svg'
  }

  // Load saved branding from the database (shared across devices and admins)
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('org_settings').select('org_name, contact_info, logo_data_url').maybeSingle()
      if (data) {
        setConfig({ orgName: data.org_name ?? '', contactInfo: data.contact_info ?? '', logoDataUrl: data.logo_data_url ?? null })
        if (!data.logo_data_url) loadDefaultLogo()
      } else {
        loadDefaultLogo()
      }
    })()
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function saveBranding() {
    setCfgSaving(true); setCfgSaved(false)
    const { error } = await supabase.from('org_settings').upsert({
      id: true,
      org_name: config.orgName || null,
      contact_info: config.contactInfo || null,
      logo_data_url: config.logoDataUrl,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'id' })
    setCfgSaving(false)
    if (error) { alert(error.message); return }
    setCfgSaved(true); setTimeout(() => setCfgSaved(false), 2500)
  }

  function handleLogoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => updateConfig({ logoDataUrl: ev.target?.result as string ?? null })
    reader.readAsDataURL(file)
  }

  const load = useCallback(async () => {
    setLoading(true)
    const [{ data: s }, { data: fx }] = await Promise.all([
      supabase.from('seasons').select('name, venue_nights(name, day_of_week, venues(name))').eq('id', seasonId!).single(),
      supabase.from('fixtures')
        .select('id, round, phase, scheduled_date, home_team_id, away_team_id, division_id, venue_id, slot_id, court_id')
        .eq('season_id', seasonId!)
        .not('away_team_id', 'is', null)
        .order('round'),
    ])
    setSeasonName(s?.name ?? '')
    const vn = (s as any)?.venue_nights
    setVenueName(vn?.venues?.name ?? '')
    setNightLabel(vn ? (vn.name ?? DAY_FULL[vn.day_of_week] ?? '') : '')
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
        slotIds.length
          ? supabase.from('time_slots').select('id, start_time, slot_order').in('id', slotIds)
          : { data: [] },
        courtIds.length
          ? supabase.from('courts').select('id, name').in('id', courtIds)
          : { data: [] },
        supabase.from('team_players').select('team_id, player_id').in('team_id', teamIds),
      ])

      // Load player details (name + insurance_expiry)
      const playerIds = [...new Set((teamPlayers ?? []).map(tp => tp.player_id))]
      const { data: playerRows } = playerIds.length
        ? await supabase.from('players').select('id, name, insurance_expiry').in('id', playerIds)
        : { data: [] }

      const today = new Date().toISOString().split('T')[0]
      const playerMap = new Map(
        (playerRows ?? []).map(p => [
          p.id,
          {
            name: p.name,
            insured: !!p.insurance_expiry && p.insurance_expiry >= today,
          },
        ])
      )

      // team → sorted players
      const teamPlayerMap = new Map<string, { name: string; insured: boolean }[]>()
      for (const tp of teamPlayers ?? []) {
        const info = playerMap.get(tp.player_id)
        if (!info) continue
        const list = teamPlayerMap.get(tp.team_id) ?? []
        list.push(info)
        teamPlayerMap.set(tp.team_id, list)
      }
      for (const [tid, list] of teamPlayerMap) {
        teamPlayerMap.set(tid, list.sort((a, b) => a.name.localeCompare(b.name)))
      }

      const venueMap = new Map((venues ?? []).map(v => [v.id, v]))
      const divMap = new Map((divisions ?? []).map(d => [d.id, d]))
      const teamMap = new Map((teams ?? []).map(t => [t.id, t]))
      const slotMap = new Map((slots ?? []).map(s => [s.id, s]))
      const courtMap = new Map((courts ?? []).map(c => [c.id, c]))

      // Sort by slot_order then court name
      const sorted = [...roundFixtures].sort((a, b) => {
        const sA = (slotMap.get(a.slot_id ?? '') as any)?.slot_order ?? 999
        const sB = (slotMap.get(b.slot_id ?? '') as any)?.slot_order ?? 999
        if (sA !== sB) return sA - sB
        const cA = (courtMap.get(a.court_id ?? '') as any)?.name ?? ''
        const cB = (courtMap.get(b.court_id ?? '') as any)?.name ?? ''
        return cA.localeCompare(cB)
      })

      const sheets: MatchSheetFixture[] = sorted.map(f => {
        const venue = venueMap.get(f.venue_id)
        const div = divMap.get(f.division_id)
        const slot = f.slot_id ? slotMap.get(f.slot_id) : null
        const court = f.court_id ? courtMap.get(f.court_id) : null
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
          homePlayers: teamPlayerMap.get(f.home_team_id) ?? [],
          awayPlayers: f.away_team_id ? (teamPlayerMap.get(f.away_team_id) ?? []) : [],
        }
      })

      const firstVenue = (venues ?? [])[0]
      const venueName = firstVenue?.name ?? 'Venue'
      const firstDate = roundFixtures[0]?.scheduled_date
      const dayName = firstDate
        ? ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][new Date(firstDate + 'T12:00:00').getDay()]
        : 'Night'

      generateMatchSheetsPDF(sheets, config, selectedRound, venueName, dayName)
    } catch (e: any) {
      setError(e?.message ?? 'Failed to generate PDF')
    }
    setGenerating(false)
  }

  const rounds = [...new Set(fixtures.map(f => f.round))].sort((a, b) => a - b)
  const roundLabel = (r: number) => {
    const p = fixtures.find(f => f.round === r)?.phase ?? 'regular'
    return p === 'finals' ? `Finals (Rd ${r})` : p === 'makeup' ? `Makeup (Rd ${r})` : `Round ${r}`
  }
  const roundDateShort = (r: number) => {
    const d = fixtures.find(f => f.round === r)?.scheduled_date
    return d ? fmtShort(d) : ''
  }
  const roundMin = rounds[0]
  const roundMax = rounds[rounds.length - 1]
  const teamCount = new Set(fixtures.flatMap(f => [f.home_team_id, f.away_team_id].filter(Boolean) as string[])).size
  const roundDate = selectedRound !== null
    ? fixtures.find(f => f.round === selectedRound)?.scheduled_date
    : null
  const roundCount = selectedRound !== null ? fixtures.filter(f => f.round === selectedRound).length : 0

  return (
    <div>
      <div className="breadcrumb">
        <Link to={`/admin/draw?season=${seasonId}`}>Draw</Link> › {venueName && `${venueName} · ${nightLabel} › `}Match sheets
      </div>
      <div className="page-header">
        <h1>Match sheets</h1>
      </div>

      {(venueName || nightLabel) && (
        <div className="card" style={{ display: 'flex', alignItems: 'center', gap: '0.9rem', marginBottom: '1rem' }}>
          <div style={{ width: 40, height: 40, borderRadius: 8, background: '#dbeafe', color: '#1d4ed8', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.25rem', flexShrink: 0 }}>📍</div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, fontSize: '1rem' }}>
              {venueName}{nightLabel && <span style={{ color: 'var(--color-muted)', fontWeight: 400 }}> · {nightLabel} nights</span>}
            </div>
            <div style={{ fontSize: '0.82rem', color: 'var(--color-muted)' }}>
              {seasonName}
              {rounds.length > 0 && ` · Rounds ${roundMin}–${roundMax}`}
              {` · ${teamCount} team${teamCount !== 1 ? 's' : ''}`}
            </div>
          </div>
        </div>
      )}

      {/* Organisation / Logo config (super admin only) */}
      {isSuperAdmin && (
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div
          style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}
          onClick={() => setShowConfig(v => !v)}
        >
          <div>
            <strong style={{ fontSize: '0.9rem' }}>Organisation info &amp; logo</strong>
            {!showConfig && config.orgName && (
              <span style={{ marginLeft: '0.75rem', fontSize: '0.82rem', color: 'var(--color-muted)' }}>{config.orgName}</span>
            )}
          </div>
          <span style={{ color: 'var(--color-muted)' }}>{showConfig ? '▲' : '▼'}</span>
        </div>

        {showConfig && (
          <div style={{ marginTop: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <label style={{ fontSize: '0.875rem' }}>
              Organisation name
              <input
                type="text"
                value={config.orgName}
                onChange={e => updateConfig({ orgName: e.target.value })}
                placeholder="e.g. City Futsal Association"
                style={{ display: 'block', width: '100%', marginTop: '0.3rem' }}
              />
            </label>
            <label style={{ fontSize: '0.875rem' }}>
              Contact info <span style={{ color: 'var(--color-muted)', fontWeight: 400 }}>(phone · email · website — printed on sheet)</span>
              <input
                type="text"
                value={config.contactInfo}
                onChange={e => updateConfig({ contactInfo: e.target.value })}
                placeholder="e.g. 0400 000 000 · admin@futsal.com · futsal.com"
                style={{ display: 'block', width: '100%', marginTop: '0.3rem' }}
              />
            </label>
            <div style={{ fontSize: '0.875rem' }}>
              <div style={{ marginBottom: '0.3rem' }}>Logo image</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <button className="btn-secondary" style={{ fontSize: '0.85rem' }} onClick={() => logoInputRef.current?.click()}>
                  {config.logoDataUrl ? 'Replace logo' : 'Upload logo'}
                </button>
                {config.logoDataUrl && (
                  <>
                    <img src={config.logoDataUrl} alt="logo preview" style={{ height: 36, objectFit: 'contain', border: '1px solid var(--color-border)', borderRadius: 4, padding: 2 }} />
                    <button className="btn-secondary" style={{ fontSize: '0.82rem', color: 'var(--color-danger)' }} onClick={() => updateConfig({ logoDataUrl: null })}>
                      Remove
                    </button>
                  </>
                )}
              </div>
              <input ref={logoInputRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleLogoFile} />
              <div style={{ fontSize: '0.78rem', color: 'var(--color-muted)', marginTop: '0.3rem' }}>
                PNG or JPG. Will be scaled to fit the top-left block on each sheet.
              </div>
            </div>
            <div className="form-actions" style={{ marginTop: '0.25rem' }}>
              <button onClick={saveBranding} disabled={cfgSaving}>
                {cfgSaving ? 'Saving…' : cfgSaved ? '✓ Saved' : 'Save branding'}
              </button>
            </div>
            <div style={{ fontSize: '0.78rem', color: 'var(--color-muted)' }}>Saved to the database — shared across all devices and admins.</div>
          </div>
        )}
      </div>
      )}

      {loading && <div className="loading">Loading…</div>}

      {!loading && rounds.length === 0 && (
        <div className="card">No fixtures found. Generate the draw first.</div>
      )}

      {!loading && rounds.length > 0 && (
        <div className="card">
          <p style={{ fontSize: '0.9rem', color: 'var(--color-muted)', marginBottom: '1rem' }}>
            Select a round to download one match sheet per fixture as a single printable PDF (landscape A4).
          </p>

          <div className="tab-scroll" style={{ marginBottom: '1.25rem' }}>
            {rounds.map(r => (
              <button
                key={r}
                className={selectedRound === r ? '' : 'btn-secondary'}
                style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1.15, fontSize: '0.85rem', padding: '0.4rem 0.85rem' }}
                onClick={() => setSelectedRound(r)}
              >
                <span>{roundLabel(r)}</span>
                {roundDateShort(r) && <span style={{ fontSize: '0.72rem', opacity: 0.8, fontWeight: 400 }}>{roundDateShort(r)}</span>}
              </button>
            ))}
          </div>

          {selectedRound !== null && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
              <button onClick={handleGenerate} disabled={generating}>
                {generating
                  ? 'Generating…'
                  : `Download PDF — ${roundCount} sheet${roundCount !== 1 ? 's' : ''}`}
              </button>
              {roundDate && (
                <span style={{ fontSize: '0.85rem', color: 'var(--color-muted)' }}>
                  {(() => { const [y,m,d] = roundDate.split('-'); return `${d}/${m}/${y}` })()}
                </span>
              )}
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
