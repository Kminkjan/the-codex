-- ==========================================================================
-- Authenticated-only write policies.
-- Reads were opened in 0001_init.sql; this adds INSERT/UPDATE/DELETE for any
-- signed-in user (including anonymous sign-ins via supabase.auth.signInAnonymously).
--
-- Rationale: zero sign-up friction via anonymous auth, but mutations still
-- require a real JWT so bots and anon key abuse can't trash data.
-- ==========================================================================

create policy "auth write campaigns"        on public.campaigns       for all to authenticated using (true) with check (true);
create policy "auth write sessions"         on public.sessions        for all to authenticated using (true) with check (true);
create policy "auth write locations"        on public.locations       for all to authenticated using (true) with check (true);
create policy "auth write factions"         on public.factions        for all to authenticated using (true) with check (true);
create policy "auth write people"           on public.people          for all to authenticated using (true) with check (true);
create policy "auth write quests"           on public.quests          for all to authenticated using (true) with check (true);
create policy "auth write goals"            on public.goals           for all to authenticated using (true) with check (true);
create policy "auth write items"            on public.items           for all to authenticated using (true) with check (true);
create policy "auth write lore"             on public.lore            for all to authenticated using (true) with check (true);
create policy "auth write connections"      on public.connections     for all to authenticated using (true) with check (true);
create policy "auth write board_positions"  on public.board_positions for all to authenticated using (true) with check (true);
create policy "auth write presence_users"   on public.presence_users  for all to authenticated using (true) with check (true);
create policy "auth write party_notes"      on public.party_notes     for all to authenticated using (true) with check (true);
