-- ============================================================================
-- Security hardening + org branding
-- Run ONCE in the Supabase SQL Editor. Every statement is idempotent, so it is
-- safe to re-run. Companion to SECURITY-AUDIT.md.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Org branding settings (match-sheet logo / org name / contact info)
--    Single-row table (id is always true), so there is exactly one settings row.
-- ----------------------------------------------------------------------------
create table if not exists public.org_settings (
  id            boolean primary key default true,
  org_name      text,
  contact_info  text,
  logo_data_url text,                       -- base64 data URL of the logo
  updated_at    timestamptz not null default now(),
  constraint org_settings_singleton check (id)
);

alter table public.org_settings enable row level security;

drop policy if exists org_settings_read  on public.org_settings;
drop policy if exists org_settings_write on public.org_settings;

-- Any admin can read the branding (venue admins print match sheets too)…
create policy org_settings_read on public.org_settings for select to authenticated
  using (public.is_admin());
-- …only super admins can change it.
create policy org_settings_write on public.org_settings for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

-- ----------------------------------------------------------------------------
-- 2. FINDING H1 — reconcile the venue-scope table.
--    The app reads/writes `admin_venue_access` (user_id -> app_users.id) but the
--    original schema defined `sub_admin_scopes` and has_venue_scope() still read
--    that table. This ensures admin_venue_access exists, is RLS-protected, and
--    that has_venue_scope() actually uses it — otherwise venue-admin writes are
--    either broken or the mapping table is unprotected (privilege escalation).
-- ----------------------------------------------------------------------------
create table if not exists public.admin_venue_access (
  user_id  uuid not null references public.app_users(id) on delete cascade,
  venue_id uuid not null references public.venues(id)    on delete cascade,
  primary key (user_id, venue_id)
);

alter table public.admin_venue_access enable row level security;

drop policy if exists ava_select on public.admin_venue_access;
drop policy if exists ava_write  on public.admin_venue_access;

-- A user can see their own venue grants; super admins see all.
create policy ava_select on public.admin_venue_access for select to authenticated
  using (
    public.is_super_admin()
    or user_id in (select id from public.app_users where auth_user_id = auth.uid())
  );
-- Only super admins can grant/revoke venue access.
create policy ava_write on public.admin_venue_access for all to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

-- Point has_venue_scope() at admin_venue_access (was sub_admin_scopes).
create or replace function public.has_venue_scope(target_venue uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select public.is_super_admin()
      or exists (
        select 1
        from public.app_users u
        join public.admin_venue_access s on s.user_id = u.id
        where u.auth_user_id = auth.uid()
          and s.venue_id = target_venue
      );
$$;

-- If the old table is genuinely unused, you may drop it after confirming:
--   drop table if exists public.sub_admin_scopes;

-- ----------------------------------------------------------------------------
-- 3. FINDING M1 (optional) — hide draft seasons from the public.
--    Public can currently read every seasons row, including drafts (their names
--    exist publicly even though draft fixtures are hidden). Uncomment to limit
--    public reads to published seasons only. Verify the public pages still load.
-- ----------------------------------------------------------------------------
-- drop policy if exists seasons_read on public.seasons;
-- create policy seasons_read on public.seasons for select to anon, authenticated
--   using (status = 'published' or public.is_admin());
