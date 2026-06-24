import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

function resp(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

// ── Round-robin ───────────────────────────────────────────────────────────────

function singleRR(ids: string[]): [string, string][][] {
  const teams = ids.length % 2 === 0 ? [...ids] : [...ids, '__BYE__']
  const n = teams.length
  const fixed = teams[0]
  const rotating = teams.slice(1)
  const rounds: [string, string][][] = []
  for (let r = 0; r < n - 1; r++) {
    const rot = [...rotating.slice(r), ...rotating.slice(0, r)]
    const round: [string, string][] = [[fixed, rot[0]]]
    for (let i = 1; i < n / 2; i++) round.push([rot[i], rot[n - 1 - i]])
    rounds.push(round)
  }
  return rounds
}

function doubleRR(ids: string[]): [string, string][][] {
  const first = singleRR(ids)
  const second = first.map(r => r.map(([a, b]) => [b, a] as [string, string]))
  return [...first, ...second]
}

// ── Date assignment ───────────────────────────────────────────────────────────

function gameDate(startDate: string, round: number, intervalDays: number, dayOfWeek: number): string {
  const base = new Date(startDate + 'T00:00:00Z')
  base.setUTCDate(base.getUTCDate() + (round - 1) * intervalDays)
  const offset = (dayOfWeek - base.getUTCDay() + 7) % 7
  base.setUTCDate(base.getUTCDate() + offset)
  return base.toISOString().split('T')[0]
}

// ── Slot assignment ───────────────────────────────────────────────────────────

interface Game {
  homeId: string; awayId: string; divisionId: string; divType: string; isBye: boolean
}

interface AssignedGame extends Game {
  slotId: string | null; courtId: string | null
}

function buildTeamPlayerMap(divisions: any[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>()
  for (const div of divisions) {
    for (const team of div.teams ?? []) {
      map.set(team.id, new Set((team.team_players ?? []).map((tp: any) => tp.player_id as string)))
    }
  }
  return map
}

function assignSlots(
  games: Game[],
  slots: { id: string; slot_order: number }[],
  courts: { id: string }[],
  teamPlayers: Map<string, Set<string>>,
  sharedMixedMixed: Set<string>,
): AssignedGame[] {
  const ordered = [...slots].sort((a, b) => a.slot_order - b.slot_order)

  function hasSharedMixed(g: Game) {
    for (const [pid, teams] of teamPlayers) {
      if (sharedMixedMixed.has(pid) && (teams.has(g.homeId) || teams.has(g.awayId))) return true
    }
    return false
  }

  const sorted = [...games].sort((a, b) => {
    if (a.isBye !== b.isBye) return a.isBye ? 1 : -1
    if (a.divType !== b.divType) return a.divType === 'mixed' ? -1 : 1
    if (a.divType === 'mixed') {
      const as_ = hasSharedMixed(a), bs = hasSharedMixed(b)
      if (as_ !== bs) return as_ ? -1 : 1
    }
    return 0
  })

  const occupancy = new Map<string, AssignedGame[]>(ordered.map(s => [s.id, []]))
  const results: AssignedGame[] = []

  for (const game of sorted) {
    if (game.isBye) { results.push({ ...game, slotId: null, courtId: null }); continue }

    let placed = false
    for (const slot of ordered) {
      const occ = occupancy.get(slot.id)!
      if (occ.length >= courts.length) continue

      const occTeams = new Set(occ.flatMap(g => [g.homeId, g.awayId]))
      if (occTeams.has(game.homeId) || occTeams.has(game.awayId)) continue

      const occPlayers = new Set<string>()
      for (const g of occ) {
        teamPlayers.get(g.homeId)?.forEach(p => occPlayers.add(p))
        teamPlayers.get(g.awayId)?.forEach(p => occPlayers.add(p))
      }

      const gamePlayers = new Set([...(teamPlayers.get(game.homeId) ?? []), ...(teamPlayers.get(game.awayId) ?? [])])
      if ([...gamePlayers].some(p => occPlayers.has(p))) continue

      const usedCourts = new Set(occ.map(g => g.courtId))
      const court = courts.find(c => !usedCourts.has(c.id))!
      const ag: AssignedGame = { ...game, slotId: slot.id, courtId: court.id }
      occ.push(ag)
      results.push(ag)
      placed = true
      break
    }

    if (!placed) results.push({ ...game, slotId: null, courtId: null })
  }

  return results
}

// ── Cross-venue clash detection ───────────────────────────────────────────────

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function detectClashes(nights: any[]): { type: string; message: string }[] {
  const warnings: { type: string; message: string }[] = []
  const playerEntries = new Map<string, { venueId: string; day: number; label: string }[]>()

  for (const night of nights) {
    for (const div of night.divisions ?? []) {
      for (const team of div.teams ?? []) {
        for (const tp of team.team_players ?? []) {
          const list = playerEntries.get(tp.player_id) ?? []
          list.push({ venueId: night.venue_id, day: night.day_of_week, label: `${div.name} @ ${night.venues?.name ?? 'venue'}` })
          playerEntries.set(tp.player_id, list)
        }
      }
    }
  }

  for (const [, entries] of playerEntries) {
    const byDay = new Map<number, typeof entries>()
    for (const e of entries) {
      const list = byDay.get(e.day) ?? []; list.push(e); byDay.set(e.day, list)
    }
    for (const [day, list] of byDay) {
      if (new Set(list.map(e => e.venueId)).size > 1) {
        warnings.push({
          type: 'cross_venue_clash',
          message: `Player is in ${list.map(e => e.label).join(' and ')} — all on ${DAY_NAMES[day]}s. Unresolvable cross-venue clash; player must choose or accept a missed game.`,
        })
      }
    }
  }

  return warnings
}

// ── Main ──────────────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return resp({ error: 'Unauthorized' }, 401)

    const caller = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } } })
    const { data: { user } } = await caller.auth.getUser()
    if (!user) return resp({ error: 'Unauthorized' }, 401)

    const { data: appUser } = await caller.from('app_users').select('role').eq('auth_user_id', user.id).single()
    if (appUser?.role !== 'super_admin') return resp({ error: 'Super-admin only' }, 403)

    const admin = createClient(supabaseUrl, serviceKey)

    const { season_id, start_date, round_interval_days = 7 } = await req.json()
    if (!season_id || !start_date) return resp({ error: 'Missing season_id or start_date' }, 400)

    const { data: season } = await admin.from('seasons').select('id, status').eq('id', season_id).single()
    if (!season) return resp({ error: 'Season not found' }, 404)
    if (season.status !== 'draft') return resp({ error: 'Cannot regenerate a published season' }, 400)

    // Clear existing draft fixtures
    await admin.from('fixtures').delete().eq('season_id', season_id)

    // Load venue nights with their divisions/teams
    const { data: nights, error: nightErr } = await admin
      .from('venue_nights')
      .select(`
        id, venue_id, day_of_week, name,
        venues(id, name),
        divisions(id, name, type, teams(id, name, team_players(player_id)))
      `)
    if (nightErr) return resp({ error: nightErr.message }, 500)
    if (!nights?.length) return resp({ error: 'No venue nights configured' }, 400)

    // Load courts and slots by venue
    const venueIds = [...new Set(nights.map((n: any) => n.venue_id as string))]
    const [{ data: allCourts }, { data: allSlots }] = await Promise.all([
      admin.from('courts').select('id, venue_id').in('venue_id', venueIds),
      admin.from('time_slots').select('id, venue_id, slot_order').in('venue_id', venueIds).order('slot_order'),
    ])

    const courtsByVenue = new Map<string, { id: string }[]>()
    for (const c of allCourts ?? []) {
      const list = courtsByVenue.get(c.venue_id) ?? []; list.push(c); courtsByVenue.set(c.venue_id, list)
    }
    const slotsByVenue = new Map<string, { id: string; slot_order: number }[]>()
    for (const s of allSlots ?? []) {
      const list = slotsByVenue.get(s.venue_id) ?? []; list.push(s); slotsByVenue.set(s.venue_id, list)
    }

    const allFixtures: object[] = []
    const warnings: { type: string; message: string }[] = []

    for (const night of nights as any[]) {
      const divisions: any[] = (night.divisions ?? []).filter((d: any) => (d.teams ?? []).length >= 2)
      if (!divisions.length) continue

      const courts = courtsByVenue.get(night.venue_id) ?? []
      const slots = slotsByVenue.get(night.venue_id) ?? []

      if (!courts.length || !slots.length) {
        warnings.push({ type: 'config', message: `${night.venues?.name} night "${night.name ?? DAY_NAMES[night.day_of_week]}" skipped — missing courts or time slots` })
        continue
      }

      const teamPlayers = buildTeamPlayerMap(divisions)

      // Players shared across ≥2 mixed teams on this night (highest back-to-back priority)
      const playerMixedTeams = new Map<string, Set<string>>()
      for (const div of divisions.filter((d: any) => d.type === 'mixed')) {
        for (const team of div.teams ?? []) {
          for (const tp of team.team_players ?? []) {
            const s = playerMixedTeams.get(tp.player_id) ?? new Set()
            s.add(team.id); playerMixedTeams.set(tp.player_id, s)
          }
        }
      }
      const sharedMixedMixed = new Set([...playerMixedTeams.entries()].filter(([, s]) => s.size >= 2).map(([id]) => id))

      let maxRounds = 0
      const divRounds = new Map<string, [string, string][][]>()
      for (const div of divisions) {
        const pairings = doubleRR(div.teams.map((t: any) => t.id))
        divRounds.set(div.id, pairings)
        maxRounds = Math.max(maxRounds, pairings.length)
      }

      for (let round = 1; round <= maxRounds; round++) {
        const date = gameDate(start_date, round, round_interval_days, night.day_of_week)
        const games: Game[] = []

        for (const div of divisions) {
          const rounds = divRounds.get(div.id)!
          if (round > rounds.length) continue
          for (const [homeId, awayId] of rounds[round - 1]) {
            const isBye = homeId === '__BYE__' || awayId === '__BYE__'
            games.push({ homeId: isBye ? (homeId === '__BYE__' ? awayId : homeId) : homeId, awayId: isBye ? '__BYE__' : awayId, divisionId: div.id, divType: div.type, isBye })
          }
        }

        const assigned = assignSlots(games, slots, courts, teamPlayers, sharedMixedMixed)

        for (const g of assigned) {
          allFixtures.push({
            season_id,
            division_id: g.divisionId,
            venue_id: night.venue_id,
            court_id: g.isBye ? null : g.courtId,
            slot_id: g.isBye ? null : g.slotId,
            round,
            phase: 'regular',
            home_team_id: g.homeId,
            away_team_id: g.isBye ? null : g.awayId,
            scheduled_date: date,
            status: 'scheduled',
          })
        }
      }
    }

    warnings.push(...detectClashes(nights))

    if (allFixtures.length > 0) {
      const { error: insErr } = await admin.from('fixtures').insert(allFixtures)
      if (insErr) return resp({ error: insErr.message }, 500)
    }

    const realFixtures = allFixtures.filter((f: any) => f.away_team_id !== null)
    const byes = allFixtures.filter((f: any) => f.away_team_id === null)

    return resp({ success: true, fixtures_created: realFixtures.length, byes: byes.length, warnings })
  } catch (err: any) {
    return resp({ error: err?.message ?? 'Unknown error' }, 500)
  }
})
