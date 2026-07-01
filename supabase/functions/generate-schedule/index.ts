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

// Season-long tally: how many times each team has played each slot so far.
type SlotUsage = Map<string, Map<string, number>>

function assignSlots(
  games: Game[],
  slots: { id: string; slot_order: number }[],
  courts: { id: string }[],
  teamPlayers: Map<string, Set<string>>,
  sharedMixedMixed: Set<string>,
  slotUsage: SlotUsage,   // mutated across rounds to spread teams over time slots
  roundNum: number,       // rotates tie-breaks so no slot is systematically favoured
): AssignedGame[] {
  const ordered = [...slots].sort((a, b) => a.slot_order - b.slot_order)
  const nCourts = courts.length

  function hasSharedMixed(g: Game) {
    for (const [pid, teams] of teamPlayers) {
      if (sharedMixedMixed.has(pid) && (teams.has(g.homeId) || teams.has(g.awayId))) return true
    }
    return false
  }

  function usageOf(teamId: string, slotId: string): number {
    return slotUsage.get(teamId)?.get(slotId) ?? 0
  }
  function bump(teamId: string, slotId: string) {
    let m = slotUsage.get(teamId)
    if (!m) { m = new Map(); slotUsage.set(teamId, m) }
    m.set(slotId, (m.get(slotId) ?? 0) + 1)
  }

  const results: AssignedGame[] = []
  const occupancy = new Map<string, AssignedGame[]>(ordered.map(s => [s.id, []]))

  // Byes get no slot/court.
  for (const g of games.filter(g => g.isBye)) {
    results.push({ ...g, slotId: null, courtId: null })
  }

  const realGames = games.filter(g => !g.isBye)
  const mixed = realGames.filter(g => g.divType === 'mixed')
  const mens = realGames.filter(g => g.divType !== 'mixed')

  // Place the hardest-to-schedule mixed games (shared players) first.
  mixed.sort((a, b) => {
    const as_ = hasSharedMixed(a), bs = hasSharedMixed(b)
    if (as_ !== bs) return as_ ? -1 : 1
    return 0
  })

  // RULE: mixed occupies the earliest slots, mens the rest. Band size is derived
  // from how many slots the mixed games need this round (option a).
  const mixedSlotCount = nCourts > 0 ? Math.min(ordered.length, Math.ceil(mixed.length / nCourts)) : 0
  const mixedBand = ordered.slice(0, mixedSlotCount)
  const mensBand = ordered.slice(mixedSlotCount)

  function placeGroup(group: Game[], band: { id: string; slot_order: number }[]) {
    const bandLen = band.length
    for (const game of group) {
      const candidates: { slotId: string; idx: number; cost: number }[] = []
      band.forEach((slot, idx) => {
        const occ = occupancy.get(slot.id)!
        if (occ.length >= nCourts) return

        const occTeams = new Set(occ.flatMap(g => [g.homeId, g.awayId]))
        if (occTeams.has(game.homeId) || occTeams.has(game.awayId)) return

        const occPlayers = new Set<string>()
        for (const g of occ) {
          teamPlayers.get(g.homeId)?.forEach(p => occPlayers.add(p))
          teamPlayers.get(g.awayId)?.forEach(p => occPlayers.add(p))
        }
        const gamePlayers = new Set([...(teamPlayers.get(game.homeId) ?? []), ...(teamPlayers.get(game.awayId) ?? [])])
        if ([...gamePlayers].some(p => occPlayers.has(p))) return

        // Balance: prefer the slot these two teams have played least this season.
        const cost = usageOf(game.homeId, slot.id) + usageOf(game.awayId, slot.id)
        candidates.push({ slotId: slot.id, idx, cost })
      })

      if (!candidates.length) { results.push({ ...game, slotId: null, courtId: null }); continue }

      candidates.sort((a, b) => {
        if (a.cost !== b.cost) return a.cost - b.cost
        // Rotate which slot wins a tie, per round, to remove first-week bias.
        const ra = (a.idx + roundNum) % bandLen
        const rb = (b.idx + roundNum) % bandLen
        if (ra !== rb) return ra - rb
        return a.idx - b.idx
      })

      const chosenId = candidates[0].slotId
      const occ = occupancy.get(chosenId)!
      const usedCourts = new Set(occ.map(g => g.courtId))
      const court = courts.find(c => !usedCourts.has(c.id))!
      const ag: AssignedGame = { ...game, slotId: chosenId, courtId: court.id }
      occ.push(ag)
      results.push(ag)
      bump(game.homeId, chosenId)
      bump(game.awayId, chosenId)
    }
  }

  placeGroup(mixed, mixedBand)
  placeGroup(mens, mensBand)

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

    // Load season and its venue_night_id
    const { data: season } = await admin
      .from('seasons')
      .select('id, status, venue_night_id')
      .eq('id', season_id)
      .single()
    if (!season) return resp({ error: 'Season not found' }, 404)
    if (season.status !== 'draft') return resp({ error: 'Cannot regenerate a published season' }, 400)
    if (!season.venue_night_id) return resp({ error: 'Season has no venue night assigned' }, 400)

    // Clear existing draft fixtures for this season
    await admin.from('fixtures').delete().eq('season_id', season_id)

    // Load the single venue night with its divisions/teams
    const { data: night, error: nightErr } = await admin
      .from('venue_nights')
      .select(`
        id, venue_id, day_of_week, name,
        venues(id, name),
        divisions(id, name, type, teams(id, name, team_players(player_id)))
      `)
      .eq('id', season.venue_night_id)
      .single()

    if (nightErr || !night) return resp({ error: nightErr?.message ?? 'Venue night not found' }, 500)

    const divisions: any[] = ((night as any).divisions ?? []).filter((d: any) => (d.teams ?? []).length >= 2)
    if (!divisions.length) return resp({ error: 'No divisions with 2+ teams found for this night' }, 400)

    // Load courts and slots for this venue
    const venueId = (night as any).venue_id
    const [{ data: courts }, { data: slots }] = await Promise.all([
      admin.from('courts').select('id').eq('venue_id', venueId),
      admin.from('time_slots').select('id, slot_order').eq('venue_id', venueId).order('slot_order'),
    ])

    if (!courts?.length) return resp({ error: 'No courts configured for this venue' }, 400)
    if (!slots?.length) return resp({ error: 'No time slots configured for this venue' }, 400)

    const teamPlayers = buildTeamPlayerMap(divisions)

    // Players shared across ≥2 mixed teams on this night
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

    const allFixtures: object[] = []
    const dayOfWeek = (night as any).day_of_week

    // Season-long slot usage per team — drives the spread across time slots.
    const slotUsage: SlotUsage = new Map()

    for (let round = 1; round <= maxRounds; round++) {
      const date = gameDate(start_date, round, round_interval_days, dayOfWeek)
      const games: Game[] = []

      for (const div of divisions) {
        const rounds = divRounds.get(div.id)!
        if (round > rounds.length) continue
        for (const [homeId, awayId] of rounds[round - 1]) {
          const isBye = homeId === '__BYE__' || awayId === '__BYE__'
          games.push({
            homeId: isBye ? (homeId === '__BYE__' ? awayId : homeId) : homeId,
            awayId: isBye ? '__BYE__' : awayId,
            divisionId: div.id,
            divType: div.type,
            isBye,
          })
        }
      }

      const assigned = assignSlots(games, slots, courts, teamPlayers, sharedMixedMixed, slotUsage, round)

      for (const g of assigned) {
        allFixtures.push({
          season_id,
          division_id: g.divisionId,
          venue_id: venueId,
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

    // Cross-venue clash detection — check if any players in this night also
    // play at a different venue on the same day_of_week
    const allPlayerIds = [...new Set(
      divisions.flatMap((d: any) => d.teams.flatMap((t: any) => t.team_players.map((tp: any) => tp.player_id)))
    )]

    if (allPlayerIds.length > 0) {
      const { data: otherEntries } = await admin
        .from('team_players')
        .select('player_id, teams(id, name, divisions(id, name, venue_night_id, venue_nights(venue_id, day_of_week, venues(name))))')
        .in('player_id', allPlayerIds)

      const warnings: { type: string; message: string }[] = []
      const clashMessages = new Set<string>()

      for (const entry of otherEntries ?? []) {
        const team = (entry as any).teams
        const div = team?.divisions
        const vn = div?.venue_nights
        if (!vn) continue
        if (vn.venue_id === venueId) continue          // same venue — OK
        if (vn.day_of_week !== dayOfWeek) continue     // different day — OK

        // Same day, different venue = clash
        const key = `${entry.player_id}|${div.name}@${vn.venues?.name}`
        if (!clashMessages.has(key)) {
          clashMessages.add(key)
          const thisNightLabel = `${(night as any).name ?? DAY_NAMES[dayOfWeek]} @ ${(night as any).venues?.name}`
          warnings.push({
            type: 'cross_venue_clash',
            message: `A player in ${thisNightLabel} also plays ${div.name} @ ${vn.venues?.name} — both on ${DAY_NAMES[dayOfWeek]}s. Unresolvable cross-venue clash.`,
          })
        }
      }

      if (allFixtures.length > 0) {
        const { error: insErr } = await admin.from('fixtures').insert(allFixtures)
        if (insErr) return resp({ error: insErr.message }, 500)
      }

      const realFixtures = allFixtures.filter((f: any) => f.away_team_id !== null)
      const byes = allFixtures.filter((f: any) => f.away_team_id === null)
      return resp({ success: true, fixtures_created: realFixtures.length, byes: byes.length, warnings })
    }

    if (allFixtures.length > 0) {
      const { error: insErr } = await admin.from('fixtures').insert(allFixtures)
      if (insErr) return resp({ error: insErr.message }, 500)
    }

    const realFixtures = allFixtures.filter((f: any) => f.away_team_id !== null)
    const byes = allFixtures.filter((f: any) => f.away_team_id === null)
    return resp({ success: true, fixtures_created: realFixtures.length, byes: byes.length, warnings: [] })

  } catch (err: any) {
    return resp({ error: err?.message ?? 'Unknown error' }, 500)
  }
})
