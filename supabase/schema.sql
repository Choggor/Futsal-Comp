-- ============================================================================
-- Futsal Competition — Supabase schema + Row-Level Security (RLS)
-- ----------------------------------------------------------------------------
-- Run this top-to-bottom in the Supabase SQL Editor on a fresh project.
-- It is the companion to futsal-comp-build-plan.md (Phase 2: Schema + RLS).
--
-- KEY DESIGN DECISION:
--   Insurance NUMBERS are NOT stored (kept offline). Each player has only an
--   `insurance_expiry` date driving a paid / needs-payment status. Marking a
--   player paid auto-renews the expiry by a year via mark_insurance_paid().
--   With no regulated number in the database, there is no sensitive-PII table
--   to lock down — a deliberate privacy-by-design choice.
--
-- VISIBILITY SUMMARY:
--   public (anon)      -> venues/courts/slots/divisions/teams/seasons,
--                         published fixtures, standings view, MVP leaderboard view
--   venue admin        -> + scores/MVP writes in their venue, renew insurance
--                         status, read players (name + expiry), read rosters
--   super admin        -> everything (full config + account management)
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 0. Extensions
-- ---------------------------------------------------------------------------
create extension if not exists "pgcrypto";   -- for gen_random_uuid()

-- ---------------------------------------------------------------------------
-- 1. Tables (created in dependency order)
-- ---------------------------------------------------------------------------

-- Admin accounts. Maps a Supabase Auth user (auth.uid()) to a role.
-- Players are NOT in here — only admins ever authenticate.
create table public.app_users (
  id           uuid primary key default gen_random_uuid(),
  auth_user_id uuid not null unique references auth.users(id) on delete cascade,
  display_name text,
  role         text not null check (role in ('super_admin','sub_admin')),
  created_at   timestamptz not null default now()
);

create table public.venues (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  address     text,
  latitude    double precision,
  longitude   double precision,
  timezone    text not null default 'Australia/Sydney', -- IANA name; handles DST automatically
  points_win  integer not null default 3,
  points_draw integer not null default 1,
  points_loss integer not null default 0,
  mvp_enabled boolean not null default false,
  created_at  timestamptz not null default now()
);

create table public.courts (
  id        uuid primary key default gen_random_uuid(),
  venue_id  uuid not null references public.venues(id) on delete cascade,
  name      text not null
);

-- Ordered evening time grid, shared across a venue's courts.
create table public.time_slots (
  id         uuid primary key default gen_random_uuid(),
  venue_id   uuid not null references public.venues(id) on delete cascade,
  start_time time not null,
  slot_order integer not null
);

create table public.divisions (
  id            uuid primary key default gen_random_uuid(),
  venue_id      uuid not null references public.venues(id) on delete cascade,
  name          text not null,
  type          text not null check (type in ('mens','mixed')),
  finals_format text not null default 'top4'
                  check (finals_format in ('none','top4','split8'))
  -- 'top4'   = Championship only: SF 1v4 & 2v3 -> GF
  -- 'split8' = Championship (1v4,2v3->GF) + Plate (5v8,6v7->GF). No 3rd/4th playoff.
);

create table public.seasons (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  status     text not null default 'draft' check (status in ('draft','published')),
  created_at timestamptz not null default now()
);

create table public.teams (
  id          uuid primary key default gen_random_uuid(),
  division_id uuid not null references public.divisions(id) on delete cascade,
  name        text not null
);

-- Player: name + insurance EXPIRY only. Insurance numbers are kept offline
-- (not in this database). Expiry drives the paid / needs-payment status.
create table public.players (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  insurance_expiry date,            -- null or past = needs payment
  created_at       timestamptz not null default now()
);

-- A player can be in many teams (across divisions and mens/mixed).
create table public.team_players (
  team_id   uuid not null references public.teams(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  primary key (team_id, player_id)
);

create table public.fixtures (
  id                    uuid primary key default gen_random_uuid(),
  season_id             uuid not null references public.seasons(id) on delete cascade,
  division_id           uuid not null references public.divisions(id) on delete cascade,
  venue_id              uuid not null references public.venues(id) on delete cascade,
  court_id              uuid references public.courts(id) on delete set null,
  slot_id               uuid references public.time_slots(id) on delete set null,
  round                 integer,
  phase                 text not null default 'regular'
                          check (phase in ('regular','makeup','finals')),
  finals_bracket        text check (finals_bracket in ('championship','plate')), -- null unless split-finals
  finals_label          text,  -- 'SF1' | 'SF2' | 'GF' (null for regular/makeup)
  home_team_id          uuid references public.teams(id) on delete set null,
  away_team_id          uuid references public.teams(id) on delete set null,
  scheduled_date        date,
  home_score            integer,
  away_score            integer,
  status                text not null default 'scheduled'
                          check (status in ('scheduled','played','forfeit','postponed','cancelled')),
  forfeit_winner_team_id uuid references public.teams(id) on delete set null,
  created_at            timestamptz not null default now()
);

-- 3-2-1 MVP awards, entered with the score. Only at venues with mvp_enabled.
create table public.mvp_awards (
  id         uuid primary key default gen_random_uuid(),
  fixture_id uuid not null references public.fixtures(id) on delete cascade,
  player_id  uuid not null references public.players(id) on delete cascade,
  points     integer not null check (points in (1,2,3)),
  unique (fixture_id, points)  -- one player per 3/2/1 placing per game
);

-- Which venues a sub-admin may act on.
create table public.sub_admin_scopes (
  app_user_id uuid not null references public.app_users(id) on delete cascade,
  venue_id    uuid not null references public.venues(id) on delete cascade,
  primary key (app_user_id, venue_id)
);

-- Helpful indexes
create index on public.fixtures (season_id);
create index on public.fixtures (division_id);
create index on public.fixtures (venue_id);
create index on public.fixtures (scheduled_date);
create index on public.team_players (player_id);
create index on public.mvp_awards (fixture_id);

-- ---------------------------------------------------------------------------
-- 2. Helper functions (SECURITY DEFINER so they can read app_users safely
--    without tripping RLS recursion). All are read-only and STABLE.
-- ---------------------------------------------------------------------------

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.app_users u where u.auth_user_id = auth.uid()
  );
$$;

create or replace function public.is_super_admin()
returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.app_users u
    where u.auth_user_id = auth.uid() and u.role = 'super_admin'
  );
$$;

-- True if caller is super-admin, OR a sub-admin scoped to the given venue.
create or replace function public.has_venue_scope(target_venue uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_super_admin()
      or exists (
        select 1
        from public.app_users u
        join public.sub_admin_scopes s on s.app_user_id = u.id
        where u.auth_user_id = auth.uid()
          and s.venue_id = target_venue
      );
$$;

-- ---------------------------------------------------------------------------
-- 3. Enable RLS on every table (default-deny once enabled)
-- ---------------------------------------------------------------------------
alter table public.app_users        enable row level security;
alter table public.venues           enable row level security;
alter table public.courts           enable row level security;
alter table public.time_slots       enable row level security;
alter table public.divisions        enable row level security;
alter table public.seasons          enable row level security;
alter table public.teams            enable row level security;
alter table public.players          enable row level security;
alter table public.team_players     enable row level security;
alter table public.fixtures         enable row level security;
alter table public.mvp_awards       enable row level security;
alter table public.sub_admin_scopes enable row level security;

-- ---------------------------------------------------------------------------
-- 4. Policies
-- ---------------------------------------------------------------------------

-- --- app_users: read own row, super-admin manages all ----------------------
create policy app_users_select on public.app_users for select to authenticated
  using (auth_user_id = auth.uid() or public.is_super_admin());
create policy app_users_write on public.app_users for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

-- --- sub_admin_scopes: read own, super-admin manages -----------------------
create policy scopes_select on public.sub_admin_scopes for select to authenticated
  using (
    public.is_super_admin()
    or app_user_id in (select id from public.app_users where auth_user_id = auth.uid())
  );
create policy scopes_write on public.sub_admin_scopes for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

-- --- Static config tables: public READ, super-admin WRITE ------------------
-- venues
create policy venues_read  on public.venues for select to anon, authenticated using (true);
create policy venues_write on public.venues for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());
-- courts
create policy courts_read  on public.courts for select to anon, authenticated using (true);
create policy courts_write on public.courts for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());
-- time_slots
create policy slots_read  on public.time_slots for select to anon, authenticated using (true);
create policy slots_write on public.time_slots for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());
-- divisions
create policy divisions_read  on public.divisions for select to anon, authenticated using (true);
create policy divisions_write on public.divisions for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());
-- teams
create policy teams_read  on public.teams for select to anon, authenticated using (true);
create policy teams_write on public.teams for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());
-- seasons
create policy seasons_read  on public.seasons for select to anon, authenticated using (true);
create policy seasons_write on public.seasons for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

-- --- players: admins READ; any admin can INSERT a new player record;
--     UPDATE/DELETE is super-admin only (sub-admins renew expiry via the RPC).
create policy players_read   on public.players for select to authenticated
  using (public.is_admin());
create policy players_insert on public.players for insert to authenticated
  with check (public.is_admin());
create policy players_update on public.players for update to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());
create policy players_delete on public.players for delete to authenticated
  using (public.is_super_admin());

-- --- team_players (rosters): admins read; sub-admins can INSERT players into
--     teams at their scoped venue; UPDATE/DELETE is super-admin only.
create policy roster_read   on public.team_players for select to authenticated
  using (public.is_admin());
-- Sub-admins can add a player to a team that belongs to their venue.
create policy roster_insert on public.team_players for insert to authenticated
  with check (
    public.is_super_admin()
    or exists (
      select 1
      from public.teams t
      join public.divisions d on d.id = t.division_id
      where t.id = team_id
        and public.has_venue_scope(d.venue_id)
    )
  );
create policy roster_update on public.team_players for update to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());
create policy roster_delete on public.team_players for delete to authenticated
  using (public.is_super_admin());

-- --- fixtures --------------------------------------------------------------
-- READ: public sees published-season fixtures; admins see everything.
create policy fixtures_read on public.fixtures for select to anon, authenticated
  using (
    public.is_admin()
    or exists (select 1 from public.seasons s where s.id = season_id and s.status = 'published')
  );
-- INSERT/DELETE: super-admin only (structural — generated by the scheduler).
create policy fixtures_insert on public.fixtures for insert to authenticated
  with check (public.is_super_admin());
create policy fixtures_delete on public.fixtures for delete to authenticated
  using (public.is_super_admin());
-- UPDATE: super-admin anywhere; venue admin only for fixtures at their venue.
-- (covers score/MVP entry, status changes, and drag-drop moves within a venue)
create policy fixtures_update on public.fixtures for update to authenticated
  using (public.has_venue_scope(venue_id))
  with check (public.has_venue_scope(venue_id));

-- --- mvp_awards: admins read directly; public uses the leaderboard view ----
create policy mvp_read on public.mvp_awards for select to authenticated
  using (public.is_admin());
-- write scoped to the fixture's venue
create policy mvp_write on public.mvp_awards for all to authenticated
  using (
    exists (select 1 from public.fixtures f
            where f.id = fixture_id and public.has_venue_scope(f.venue_id))
  )
  with check (
    exists (select 1 from public.fixtures f
            where f.id = fixture_id and public.has_venue_scope(f.venue_id))
  );

-- ---------------------------------------------------------------------------
-- 5. Public views (owner-rights views: they intentionally bypass table RLS to
--    expose ONLY safe, aggregated columns to the public). Never select the
--    insurance number or expiry here.
-- ---------------------------------------------------------------------------

-- Standings per division (all teams shown, even with 0 games played).
-- Tiebreakers applied here: points -> goal difference -> goals for -> name.
-- HEAD-TO-HEAD: the agreed final tiebreaker (when points, GD and GF are all
-- equal) is not resolved in this view — that exact-tie case is rare and
-- head-to-head is awkward in pure SQL. Resolve it in app code for the tied
-- cluster if/when it occurs, or accept alphabetical as the last fallback.
create or replace view public.standings as
with results as (
  select f.division_id, f.home_team_id as team_id, f.home_score gf, f.away_score ga
  from public.fixtures f
  join public.seasons s on s.id = f.season_id
  where s.status = 'published' and f.status in ('played','forfeit')
    and f.home_score is not null and f.away_score is not null
  union all
  select f.division_id, f.away_team_id as team_id, f.away_score gf, f.home_score ga
  from public.fixtures f
  join public.seasons s on s.id = f.season_id
  where s.status = 'published' and f.status in ('played','forfeit')
    and f.home_score is not null and f.away_score is not null
),
agg as (
  select team_id, division_id,
    count(*)                              as played,
    count(*) filter (where gf > ga)       as won,
    count(*) filter (where gf = ga)       as drawn,
    count(*) filter (where gf < ga)       as lost,
    coalesce(sum(gf),0)                   as goals_for,
    coalesce(sum(ga),0)                   as goals_against
  from results group by team_id, division_id
)
select
  t.division_id,
  t.id                              as team_id,
  t.name                            as team_name,
  coalesce(a.played,0)              as played,
  coalesce(a.won,0)                 as won,
  coalesce(a.drawn,0)               as drawn,
  coalesce(a.lost,0)                as lost,
  coalesce(a.goals_for,0)           as goals_for,
  coalesce(a.goals_against,0)       as goals_against,
  coalesce(a.goals_for,0) - coalesce(a.goals_against,0) as goal_diff,
  coalesce(a.won,0)*v.points_win
    + coalesce(a.drawn,0)*v.points_draw
    + coalesce(a.lost,0)*v.points_loss as points
from public.teams t
join public.divisions d on d.id = t.division_id
join public.venues v    on v.id = d.venue_id
left join agg a         on a.team_id = t.id
order by t.division_id, points desc, goal_diff desc, goals_for desc, t.name;

-- MVP leaderboard per division. Exposes FIRST NAME + TEAM NAME only (never a
-- full name) — privacy-conscious for a public page that may include juniors.
-- The player's team is resolved via their roster entry within that division.
create or replace view public.mvp_leaderboard as
select
  d.id                        as division_id,
  p.id                        as player_id,
  split_part(p.name, ' ', 1)  as first_name,
  t.name                      as team_name,
  coalesce(sum(m.points),0)   as mvp_points
from public.mvp_awards m
join public.fixtures f    on f.id = m.fixture_id
join public.seasons s     on s.id = f.season_id
join public.divisions d   on d.id = f.division_id
join public.players p     on p.id = m.player_id
join public.team_players tp on tp.player_id = p.id
join public.teams t       on t.id = tp.team_id and t.division_id = d.id
where s.status = 'published'
group by d.id, p.id, split_part(p.name, ' ', 1), t.name
order by d.id, mvp_points desc, first_name;

grant select on public.standings to anon, authenticated;
grant select on public.mvp_leaderboard to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. RPC: renew insurance (lets any admin mark a player paid WITHOUT granting
--    them UPDATE on players or any sight of the insurance number).
-- ---------------------------------------------------------------------------
create or replace function public.mark_insurance_paid(p_player_id uuid, p_months integer default 12)
returns date
language plpgsql security definer set search_path = public as $$
declare
  new_expiry date;
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;
  update public.players
     set insurance_expiry = (current_date + make_interval(months => p_months))::date
   where id = p_player_id
  returning insurance_expiry into new_expiry;
  return new_expiry;
end;
$$;

revoke all on function public.mark_insurance_paid(uuid, integer) from public;
grant execute on function public.mark_insurance_paid(uuid, integer) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. FIRST SUPER-ADMIN SEED  (bootstrap — required, run once)
-- ---------------------------------------------------------------------------
-- There is a chicken-and-egg: only super-admins can create accounts in-app,
-- so the first one must be seeded directly. Do this:
--
--   1. In the Supabase Dashboard: Authentication > Users > "Add user".
--      Create the admin's email + password. Copy the new user's UUID.
--   2. Paste that UUID below and run this insert.
--
-- After this, that super-admin creates all other accounts inside the app.
--
-- insert into public.app_users (auth_user_id, display_name, role)
-- values ('PASTE-AUTH-USER-UUID-HERE', 'Comp Administrator', 'super_admin');

-- ============================================================================
-- Notes / things to verify after running:
--  * Sign in as a sub-admin and confirm: cannot UPDATE a fixture at a venue
--    outside their scope, CAN enter scores for their venue, CAN call
--    mark_insurance_paid().
--  * Sign in as anon (logged out) and confirm: standings + mvp_leaderboard
--    return data, draft-season fixtures are hidden, players return nothing.
--  * Insurance NUMBERS are intentionally not stored here — only a paid/expiry
--    status. Keep the numbers in your offline registration records.
--  * Free tier has NO backups — export the DB periodically (see plan §14).
-- ============================================================================
