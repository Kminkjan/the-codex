-- ===========================================================================
-- M6 Campaign Management, phase 1 (issue #85): the Campaign Charter.
-- A campaign-level screen visible to every role, with the DM able to edit
-- the campaign identity (title / subtitle / crest image) inline. This
-- migration provides the three DB pieces the screen needs:
--
--   1. campaigns.image_url — the optional crest/cover, stored in the
--      existing entity-images bucket under a campaign/ prefix (the 0006
--      storage policies gate on bucket + non-anonymous claim only, so no
--      storage policy change is needed).
--   2. A DM-only UPDATE policy on campaigns, replacing 0006's
--      `member write campaigns` FOR ALL policy. Two deliberate
--      consequences, both decided during planning:
--        * campaigns.active_session_id becomes DM-writable only — the
--          live-session pin is now the DM's control. The client gates the
--          SessionPin dropdown on real-DM-ness to match; non-DM editors
--          get the viewer's static label. (Old clients in the apply→deploy
--          gap fire-and-forget a 0-row update: silent no-op, console error
--          only. Apply + deploy back-to-back, not on a session night.)
--        * The dropped FOR ALL policy also carried INSERT/DELETE on
--          campaigns; no client UI creates or deletes campaigns today, so
--          those verbs become deny-all for client roles until issue #87
--          (campaign CRUD) adds its own policies.
--   3. profiles(user_id, display_name, avatar_url) — auth user metadata is
--      only readable for the signed-in user, so the charter's party roster
--      (campaign_members × names) needs a public mirror. Each editor's
--      client upserts its own row on session load (AuthProvider). Not in
--      the realtime publication: the roster is fetched on charter mount
--      and staleness is accepted for v1.
--
-- Privacy posture: the open profiles SELECT means any visitor can
-- enumerate editor display names / avatars via the API — deliberate, the
-- same posture as campaign_members (private group app). Scoping reads to
-- co-members would need another SECURITY DEFINER helper; deferred.
--
-- Advisor notes: the is_anonymous claim checks are wrapped in scalar
-- subqueries for initplan caching; rls_policy heuristics may still flag
-- the claim-based halves, as with 0006/0018 — by design.
--
-- Rollout: apply this, then deploy the client built against it,
-- back-to-back. The new client hard-depends on campaigns.image_url and
-- profiles (its fire-and-forget writes fail silently against a
-- pre-migration schema).
-- ===========================================================================

-- ==========================================================================
-- 1. Campaign identity: crest/cover image
-- ==========================================================================

alter table public.campaigns add column if not exists image_url text;

-- ==========================================================================
-- 2. DM-only campaigns UPDATE (replaces the 0006 FOR ALL write policy)
-- ==========================================================================
-- Gate column is `id` — the pin/identity live on the campaigns row itself.
-- is_campaign_dm is the SECURITY DEFINER helper from 0018.

drop policy if exists "member write campaigns" on public.campaigns;

drop policy if exists "dm updates campaign" on public.campaigns;
create policy "dm updates campaign" on public.campaigns
  for update to authenticated
  using      ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true and public.is_campaign_dm(id))
  with check ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true and public.is_campaign_dm(id));

-- ==========================================================================
-- 3. profiles: public mirror of editor identity for the party roster
-- ==========================================================================

create table if not exists public.profiles (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url   text,
  updated_at   timestamptz not null default now()
);

-- Explicit grants: newer Supabase stacks don't auto-grant to
-- anon/authenticated (0018 precedent). No DELETE — rows live as long as
-- the auth user; the FK cascade handles cleanup.
grant select on public.profiles to anon, authenticated;
grant insert, update on public.profiles to authenticated;

drop trigger if exists tg_profiles_touch on public.profiles;
create trigger tg_profiles_touch
  before update on public.profiles
  for each row execute function public.touch_updated_at();

alter table public.profiles enable row level security;

drop policy if exists "profiles are readable by anyone" on public.profiles;
create policy "profiles are readable by anyone"
  on public.profiles for select
  to anon, authenticated
  using (true);

drop policy if exists "user inserts own profile" on public.profiles;
create policy "user inserts own profile"
  on public.profiles for insert
  to authenticated
  with check ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true and auth.uid() = user_id);

drop policy if exists "user updates own profile" on public.profiles;
create policy "user updates own profile"
  on public.profiles for update
  to authenticated
  using      ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true and auth.uid() = user_id)
  with check ((select (auth.jwt() ->> 'is_anonymous')::boolean) is not true and auth.uid() = user_id);
