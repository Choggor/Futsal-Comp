# Security & RLS Audit

_Scope: the futsal competition platform — Supabase (PostgreSQL + RLS + Auth), Edge Functions, and the React/Vite frontend. Reviewed the database schema, all RLS policies, the Edge Functions, the auth flow, and how the frontend talks to Supabase._

Corrective SQL for the actionable findings is in [`supabase/security-and-branding.sql`](supabase/security-and-branding.sql).

## Summary

The design is fundamentally sound: RLS is enabled on every core table, the service-role key never leaves the Edge Functions, the frontend uses only the public anon key, privileged operations are gated behind server-side super-admin checks, and public views expose only safe, aggregated columns (privacy-by-design — insurance numbers are never stored). The main issue is a divergence between the live database and the original schema around the venue-scope table, which is both a correctness and a security concern.

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| H1 | High | Venue-scope table divergence (`admin_venue_access` vs `sub_admin_scopes`) | Fix in SQL |
| M1 | Medium | Draft-season metadata readable by anonymous users | Optional fix in SQL |
| M2 | Medium | No enforced password policy / MFA at the Auth layer | Config change |
| L1 | Low | Any admin can insert player rows (no venue scoping on create) | Accept / monitor |
| L2 | Low | Edge Function CORS is `*` | Accept / optional tighten |
| — | Info | Items verified as correct (see bottom) | ✔ |

---

## H1 — Venue-scope table divergence (High)

The application reads and writes venue permissions in **`admin_venue_access`** (`user_id` → `app_users.id`), but the original schema defined **`sub_admin_scopes`** (`app_user_id`) and the `has_venue_scope()` helper — which every venue-scoped RLS policy depends on (`fixtures`, `team_players`, `mvp_awards`) — read from `sub_admin_scopes`.

Two consequences, depending on the live DB's exact state:
- If `has_venue_scope()` still reads `sub_admin_scopes`, venue admins have **no** effective scope, so their score/fixture writes silently fail.
- If `admin_venue_access` was created ad-hoc **without RLS**, any authenticated user could read or modify the venue-permission mapping — a **privilege-escalation / data-exposure** risk.

**Fix:** ensure `admin_venue_access` exists with RLS (self-read, super-admin-write) and repoint `has_venue_scope()` at it. See section 2 of the SQL script. After running it, confirm a venue admin can enter scores for their venue but not another, and cannot read/modify `admin_venue_access` rows for other users.

## M1 — Draft seasons readable by anonymous users (Medium)

`seasons_read` grants `select` to `anon`, so the public can read every season row including **drafts** (name, venue-night). Draft _fixtures_ are correctly hidden, but the existence and naming of unpublished seasons leaks. Low impact, but easy to close by restricting public reads to `status = 'published'`. Optional fix (commented) in section 3 of the SQL — verify the public pages still load after applying.

## M2 — Auth password policy & MFA (Medium)

Passwords are validated to ≥ 8 characters in both the UI and the create-user Edge Function, but the **Supabase project** minimum may be lower and there is no leaked-password check or MFA. Recommend, in the Supabase dashboard (Authentication → Providers / Policies):
- Set a minimum password length and enable **leaked-password protection**.
- Consider enabling **MFA** for admin accounts — every user here is a privileged admin.

## L1 — Any admin can create player rows (Low)

`players_insert` allows any admin (`is_admin()`), so a venue admin could create arbitrary `players` rows (they cannot, however, attach them to teams outside their venue — `team_players` insert is venue-scoped). Acceptable for the current trust model; revisit if venue admins become less trusted.

## L2 — Edge Function CORS is `*` (Low)

`invite-admin` and `generate-schedule` send `Access-Control-Allow-Origin: *`. They are still protected by JWT + super-admin checks, so this is not exploitable, but the origin could be pinned to the app domain for defence-in-depth.

---

## Verified correct (no action)

- **RLS enabled on every core table**, default-deny.
- **Service-role key is confined to Edge Functions**; the frontend (`src/lib/supabase.ts`) uses only `VITE_SUPABASE_ANON_KEY`. No secret is bundled client-side.
- **Privileged Edge Functions check `super_admin`** from the caller's JWT before acting, and `generate-schedule` **refuses to regenerate a non-draft season** (published draws are protected).
- **Public views** (`standings`, `mvp_leaderboard`) are owner-rights views exposing only safe columns — the MVP leaderboard shows a first name + team only, never a full name.
- **Insurance numbers are never stored** — only an expiry date drives status. No sensitive-PII table to protect.
- **Client-side role gating is cosmetic**; real enforcement is RLS + Edge Functions. Spot-checked that a venue admin hitting `venues`/`fixtures insert`/`app_users` directly is blocked by RLS.
- **Match-sheet branding** moved out of `localStorage` into the RLS-protected `org_settings` table (read: admins, write: super admins).

## Operational recommendations (not code)

- **Backups:** the Supabase free tier has none and pauses on inactivity — move to Pro before any real use.
- **Rotate keys** if the anon/service keys were ever shared, and keep the service-role key only in Edge Function secrets.
- Keep `schema.sql` in sync with the live database (it still references `sub_admin_scopes`); regenerate it after applying the fixes.
