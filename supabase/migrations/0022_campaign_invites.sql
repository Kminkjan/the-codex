-- ===========================================================================
-- M6 Campaign Management, phase 2 (issue #86): self-service membership.
-- 0018 created campaign_members deliberately deny-all for client writes
-- (dashboard/SQL only). This migration makes membership self-service from
-- the charter screen: the DM forges invite links, any signed-in editor
-- redeems one to join as a player, and the DM manages roles/removal.
--
-- Design:
--   * All writes go through SECURITY DEFINER RPCs — invite redemption cannot
--     be expressed as a row-level policy (the joining user has no row yet,
--     and the invite code must be validated server-side). Direct writes on
--     campaign_members stay deny-all; campaign_invites gets no write
--     policies either.
--   * campaign_invites: the code IS the secret. SELECT is DM-of-the-campaign
--     only (and the table is not granted to anon at all). Revocation is soft
--     (revoked_at) so a revoked link fails loudly instead of vanishing.
--   * RLS does not apply inside definer functions, so each RPC gates
--     explicitly: a null auth.uid() or an is_anonymous JWT claim raises.
--     As with 0006, the role GRANT cannot exclude anonymous JWTs (they hold
--     the `authenticated` role) — the in-function claim check is the real
--     gate. Advisor heuristics may flag this as with 0006/0018/0020.
--   * Last-DM guard: set_member_role / remove_member take a per-campaign
--     advisory xact lock before counting DMs — two concurrent demotes of a
--     two-DM campaign would otherwise both pass the count and leave zero
--     DMs, which is unrecoverable from the client (every DM affordance and
--     the invites SELECT policy die with the last dm row).
--   * remove_member allows self-removal (uid = auth.uid()) so "leave
--     campaign" shares the same last-DM guard instead of being a sixth RPC.
--   * redeem returns jsonb, not `returns table` — table OUT params named
--     campaign_id/role would be ambiguous against column references in the
--     body's queries. Returning the campaign_id is load-bearing: after an
--     OAuth round-trip the client reloads at the bare origin holding only
--     the code, and navigates from the return value.
--   * Neither campaign_invites nor campaign_members joins the realtime
--     publication: the client refetches membership after each RPC (the
--     0018 reload-on-membership-change doctrine, now self-service).
--
-- Purely additive: no existing table, policy, or function changes. Safe to
-- apply before the client deploy.
-- ===========================================================================

-- ==========================================================================
-- 1. campaign_invites
-- ==========================================================================

create table if not exists public.campaign_invites (
  code        text primary key default gen_random_uuid()::text,
  campaign_id text not null references public.campaigns(id) on delete cascade,
  role        text not null default 'player' check (role in ('player', 'dm')),
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  revoked_at  timestamptz
);

-- FK lookup index; also powers the DM's active-invites list.
create index if not exists campaign_invites_campaign_id_idx
  on public.campaign_invites (campaign_id);

-- SELECT only, authenticated only — anon never reads invites.
grant select on public.campaign_invites to authenticated;

alter table public.campaign_invites enable row level security;

drop policy if exists "dm reads campaign_invites" on public.campaign_invites;
create policy "dm reads campaign_invites"
  on public.campaign_invites for select
  to authenticated
  using (
    (select (auth.jwt() ->> 'is_anonymous')::boolean) is not true
    and public.is_campaign_dm(campaign_id)
  );
-- No write policies: all writes go through the RPCs below.

-- ==========================================================================
-- 2. RPC helpers (shared gates)
-- ==========================================================================

-- Editor gate used at the top of every RPC. Definer + pinned search_path
-- like is_campaign_dm (0018).
create or replace function public.assert_editor()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null
     or (select (auth.jwt() ->> 'is_anonymous')::boolean) is true then
    raise exception 'editors only';
  end if;
end;
$$;

revoke execute on function public.assert_editor() from public, anon;
grant execute on function public.assert_editor() to authenticated;

-- ==========================================================================
-- 3. Invite RPCs
-- ==========================================================================

create or replace function public.create_campaign_invite(cid text)
returns public.campaign_invites
language plpgsql
security definer
set search_path = ''
as $$
declare
  invite public.campaign_invites;
begin
  perform public.assert_editor();
  if not public.is_campaign_dm(cid) then
    raise exception 'only the DM can create invites';
  end if;

  insert into public.campaign_invites (campaign_id, created_by)
  values (cid, auth.uid())
  returning * into invite;

  return invite;
end;
$$;

revoke execute on function public.create_campaign_invite(text) from public, anon;
grant execute on function public.create_campaign_invite(text) to authenticated;

create or replace function public.revoke_campaign_invite(invite_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_editor();

  -- One merged error: a non-DM probing codes can't distinguish "exists"
  -- from "not yours".
  update public.campaign_invites i
  set revoked_at = now()
  where i.code = invite_code
    and i.revoked_at is null
    and public.is_campaign_dm(i.campaign_id);

  if not found then
    raise exception 'invite not found or not authorized';
  end if;
end;
$$;

revoke execute on function public.revoke_campaign_invite(text) from public, anon;
grant execute on function public.revoke_campaign_invite(text) to authenticated;

create or replace function public.redeem_campaign_invite(invite_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  invite public.campaign_invites;
  was_member boolean;
begin
  perform public.assert_editor();

  select * into invite
  from public.campaign_invites i
  where i.code = invite_code
    and i.revoked_at is null;

  if not found then
    raise exception 'invite not found or revoked';
  end if;

  was_member := exists (
    select 1 from public.campaign_members m
    where m.campaign_id = invite.campaign_id
      and m.user_id = auth.uid()
  );

  -- Idempotent, and never changes an existing row's role — a DM redeeming
  -- a player invite is not demoted.
  insert into public.campaign_members (campaign_id, user_id, role)
  values (invite.campaign_id, auth.uid(), invite.role)
  on conflict (campaign_id, user_id) do nothing;

  return jsonb_build_object(
    'campaign_id', invite.campaign_id,
    'role', invite.role,
    'already_member', was_member
  );
end;
$$;

revoke execute on function public.redeem_campaign_invite(text) from public, anon;
grant execute on function public.redeem_campaign_invite(text) to authenticated;

-- ==========================================================================
-- 4. Roster RPCs (last-DM guard)
-- ==========================================================================

create or replace function public.set_member_role(cid text, uid uuid, new_role text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_editor();
  if not public.is_campaign_dm(cid) then
    raise exception 'only the DM can change roles';
  end if;
  if new_role not in ('dm', 'player') then
    raise exception 'invalid role';
  end if;

  -- Serialize membership mutations per campaign so concurrent demotes/
  -- removals can't race past the last-DM count.
  perform pg_advisory_xact_lock(hashtextextended('campaign_members:' || cid, 0));

  if new_role = 'player'
     and exists (
       select 1 from public.campaign_members m
       where m.campaign_id = cid and m.user_id = uid and m.role = 'dm'
     )
     and (select count(*) from public.campaign_members m
          where m.campaign_id = cid and m.role = 'dm') = 1 then
    raise exception 'cannot demote the last DM';
  end if;

  update public.campaign_members m
  set role = new_role
  where m.campaign_id = cid and m.user_id = uid;

  if not found then
    raise exception 'no such member';
  end if;
end;
$$;

revoke execute on function public.set_member_role(text, uuid, text) from public, anon;
grant execute on function public.set_member_role(text, uuid, text) to authenticated;

create or replace function public.remove_member(cid text, uid uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.assert_editor();
  -- DM removes anyone; anyone removes themselves ("leave campaign").
  if not (public.is_campaign_dm(cid) or uid = auth.uid()) then
    raise exception 'only the DM can remove members';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('campaign_members:' || cid, 0));

  if exists (
       select 1 from public.campaign_members m
       where m.campaign_id = cid and m.user_id = uid and m.role = 'dm'
     )
     and (select count(*) from public.campaign_members m
          where m.campaign_id = cid and m.role = 'dm') = 1 then
    raise exception 'cannot remove the last DM';
  end if;

  delete from public.campaign_members m
  where m.campaign_id = cid and m.user_id = uid;

  if not found then
    raise exception 'no such member';
  end if;
end;
$$;

revoke execute on function public.remove_member(text, uuid) from public, anon;
grant execute on function public.remove_member(text, uuid) to authenticated;
