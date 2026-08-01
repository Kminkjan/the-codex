-- ===========================================================================
-- Seat an existing adventurer: add_campaign_member (follows 0022).
--
-- 0022 made membership self-service, but only in one direction: the DM forges
-- a link, and the *joiner* redeems it. There was no way to seat someone the
-- app already knows — including a player sitting in channel presence right
-- now, whose auth uuid and display name are already on screen. This adds the
-- missing verb.
--
-- Design, deliberately parallel to redeem_campaign_invite:
--   * SECURITY DEFINER RPC, because campaign_members has no client write
--     policies (0018) and this migration does not add any.
--   * Editor gate + DM-of-this-campaign gate, same shape as
--     create_campaign_invite. assert_editor() covers null uid / anonymous JWT.
--   * The TARGET must be a real editor account too. Every visitor gets an
--     anonymous auth.users row (auth.tsx signs one in on first load), so
--     without this check a DM could seat a throwaway viewer session — a
--     member row that no human can ever sign back into, and that counts
--     toward the last-DM guard if promoted. auth.users.is_anonymous is the
--     durable column behind the JWT claim 0006 gates writes on.
--   * Idempotent and role-preserving: `on conflict do nothing`, so seating an
--     existing member is a no-op rather than a silent demotion. The return
--     value says which happened so the client can tell the DM.
--   * No advisory lock. 0022's set_member_role/remove_member take one because
--     they can *reduce* the DM count and race past the last-DM guard; adding
--     a member can only increase it, so there is nothing to serialize.
--
-- Consent note, since this is the first path onto a charter that the joiner
-- doesn't initiate: a DM can now seat someone without their say-so. That
-- matches the existing `strike` verb (a DM already removes members without
-- asking) and suits a group of friends, but it is a policy choice, not a
-- technical necessity. If it ever needs to become request/accept, this
-- function is the single place to add a pending state.
--
-- Purely additive: no existing table, policy, or function changes. Safe to
-- apply before the client deploy.
-- ===========================================================================

create or replace function public.add_campaign_member(
  cid text,
  uid uuid,
  new_role text default 'player'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  was_member boolean;
begin
  perform public.assert_editor();
  if not public.is_campaign_dm(cid) then
    raise exception 'only the DM can add members';
  end if;
  if new_role not in ('dm', 'player') then
    raise exception 'invalid role';
  end if;

  if not exists (
    select 1 from auth.users u
    where u.id = uid and u.is_anonymous is not true
  ) then
    raise exception 'no such editor account';
  end if;

  was_member := exists (
    select 1 from public.campaign_members m
    where m.campaign_id = cid and m.user_id = uid
  );

  insert into public.campaign_members (campaign_id, user_id, role)
  values (cid, uid, new_role)
  on conflict (campaign_id, user_id) do nothing;

  return jsonb_build_object('already_member', was_member);
end;
$$;

revoke execute on function public.add_campaign_member(text, uuid, text) from public, anon;
grant execute on function public.add_campaign_member(text, uuid, text) to authenticated;
