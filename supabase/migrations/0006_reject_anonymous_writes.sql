-- ===========================================================================
-- Reject anonymous WRITES (issue #4, option 3).
--
-- Anonymous sign-in users hold the `authenticated` role — only the
-- `is_anonymous` JWT claim distinguishes them — so the 0003/0004 policies
-- (`to authenticated using (true)`) effectively let anyone who loads the
-- site mutate every row. This migration replaces every write policy with a
-- claim-gated version: reads stay open to `anon` (shared links keep working,
-- and the anonymous provider stays enabled for read-only JWTs); writes
-- require a non-anonymous session (email magic link).
--
-- The gate passes for real users (`is_anonymous` = false) and for any legacy
-- token missing the claim (null), and fails only for anonymous JWTs (true).
--
-- Advisor note: `rls_policy_always_true` may still flag these policies —
-- they are claim-based, not row-based, by design. Per-campaign membership
-- (`campaign_members`) is tracked separately in issue #18.
--
-- Rollout order matters: apply this only after the app ships the sign-in
-- flow and the Supabase dashboard has Email (magic link) enabled, otherwise
-- every current user becomes read-only with no way to sign in.
-- ===========================================================================

-- Table write policies (replacing 0003_enable_writes.sql)

drop policy "auth write campaigns"       on public.campaigns;
drop policy "auth write sessions"        on public.sessions;
drop policy "auth write locations"       on public.locations;
drop policy "auth write factions"        on public.factions;
drop policy "auth write people"          on public.people;
drop policy "auth write quests"          on public.quests;
drop policy "auth write goals"           on public.goals;
drop policy "auth write items"           on public.items;
drop policy "auth write lore"            on public.lore;
drop policy "auth write connections"     on public.connections;
drop policy "auth write board_positions" on public.board_positions;
drop policy "auth write presence_users"  on public.presence_users;
drop policy "auth write party_notes"     on public.party_notes;

create policy "member write campaigns" on public.campaigns
  for all to authenticated
  using      ((auth.jwt() ->> 'is_anonymous')::boolean is not true)
  with check ((auth.jwt() ->> 'is_anonymous')::boolean is not true);

create policy "member write sessions" on public.sessions
  for all to authenticated
  using      ((auth.jwt() ->> 'is_anonymous')::boolean is not true)
  with check ((auth.jwt() ->> 'is_anonymous')::boolean is not true);

create policy "member write locations" on public.locations
  for all to authenticated
  using      ((auth.jwt() ->> 'is_anonymous')::boolean is not true)
  with check ((auth.jwt() ->> 'is_anonymous')::boolean is not true);

create policy "member write factions" on public.factions
  for all to authenticated
  using      ((auth.jwt() ->> 'is_anonymous')::boolean is not true)
  with check ((auth.jwt() ->> 'is_anonymous')::boolean is not true);

create policy "member write people" on public.people
  for all to authenticated
  using      ((auth.jwt() ->> 'is_anonymous')::boolean is not true)
  with check ((auth.jwt() ->> 'is_anonymous')::boolean is not true);

create policy "member write quests" on public.quests
  for all to authenticated
  using      ((auth.jwt() ->> 'is_anonymous')::boolean is not true)
  with check ((auth.jwt() ->> 'is_anonymous')::boolean is not true);

create policy "member write goals" on public.goals
  for all to authenticated
  using      ((auth.jwt() ->> 'is_anonymous')::boolean is not true)
  with check ((auth.jwt() ->> 'is_anonymous')::boolean is not true);

create policy "member write items" on public.items
  for all to authenticated
  using      ((auth.jwt() ->> 'is_anonymous')::boolean is not true)
  with check ((auth.jwt() ->> 'is_anonymous')::boolean is not true);

create policy "member write lore" on public.lore
  for all to authenticated
  using      ((auth.jwt() ->> 'is_anonymous')::boolean is not true)
  with check ((auth.jwt() ->> 'is_anonymous')::boolean is not true);

create policy "member write connections" on public.connections
  for all to authenticated
  using      ((auth.jwt() ->> 'is_anonymous')::boolean is not true)
  with check ((auth.jwt() ->> 'is_anonymous')::boolean is not true);

create policy "member write board_positions" on public.board_positions
  for all to authenticated
  using      ((auth.jwt() ->> 'is_anonymous')::boolean is not true)
  with check ((auth.jwt() ->> 'is_anonymous')::boolean is not true);

create policy "member write presence_users" on public.presence_users
  for all to authenticated
  using      ((auth.jwt() ->> 'is_anonymous')::boolean is not true)
  with check ((auth.jwt() ->> 'is_anonymous')::boolean is not true);

create policy "member write party_notes" on public.party_notes
  for all to authenticated
  using      ((auth.jwt() ->> 'is_anonymous')::boolean is not true)
  with check ((auth.jwt() ->> 'is_anonymous')::boolean is not true);

-- Storage write policies (replacing the write half of 0004_entity_images.sql;
-- the "anon read entity-images" select policy stays as-is)

drop policy "auth write entity-images"  on storage.objects;
drop policy "auth update entity-images" on storage.objects;
drop policy "auth delete entity-images" on storage.objects;

create policy "member write entity-images"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'entity-images'
    and (auth.jwt() ->> 'is_anonymous')::boolean is not true
  );

create policy "member update entity-images"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'entity-images'
    and (auth.jwt() ->> 'is_anonymous')::boolean is not true
  );

create policy "member delete entity-images"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'entity-images'
    and (auth.jwt() ->> 'is_anonymous')::boolean is not true
  );
