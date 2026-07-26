-- ===========================================================================
-- Sagas: arcs nest one level deep.
--
-- The DM runs the chronicle as Saga → Arc → Chapter. The Codex modelled two
-- levels (arcs → sessions) and its arc rows sat at the *coarse* granularity —
-- `foi-arc2` was literally titled "The Barovia Saga" and spanned 78–146 — so
-- the DM's finer arcs (Vallaki, Wizard of Wines, Krezk…) had nowhere to live.
--
-- A saga is just a top-level arc: `parent_id is null`. That buys the whole
-- feature without a second table — no new RLS policy pair, no realtime
-- publication entry, no extra select in the client's parallel load, no mapper,
-- no KindKey member, no findEntity branch, no detail-sheet kind. Every one of
-- those is inherited from `arcs` (0008).
--
-- Depth is capped at 2 by trigger, which also makes cycles structurally
-- impossible: a cycle needs two non-null parent_ids and rule 2 forbids that.
-- No recursive CTE, no periodic integrity sweep.
--
-- No RLS work: 0008's "anon read arcs" / "member write arcs" are table-wide
-- (for select / for all) and already cover new columns. No entity_hidden()
-- (0018/0024) edit either — arcs carry no `hidden` column, since 0005
-- deliberately excluded arcs/sessions/events from archive/hide as permanent
-- history. `arcs` is already in the realtime publication.
--
-- Rollout: safe to apply before the client deploy. An old client selects * and
-- ignores the two new columns; the seed below only re-shapes arc rows, which
-- an old client renders as a flat list exactly as it does today.
-- ===========================================================================

-- ==========================================================================
-- Columns
-- ==========================================================================

alter table public.arcs
  add column if not exists parent_id    text references public.arcs(id) on delete set null,
  add column if not exists completed_at timestamptz;

-- Backs the per-saga child lookup (the Arcs page walks it for every saga).
create index if not exists arcs_parent_idx on public.arcs (parent_id);

-- ==========================================================================
-- Depth guard
-- ==========================================================================
-- Four ways to get this wrong, all rejected here rather than trusted to the
-- client: the UI's parent picker mirrors these rules so it can't offer a write
-- the database will refuse, but the rules live here because they're invariants.

create or replace function public.arcs_enforce_depth()
returns trigger
language plpgsql
as $$
declare
  parent_campaign text;
  parent_parent   text;
begin
  if new.parent_id is null then
    return new;
  end if;

  if new.parent_id = new.id then
    raise exception 'An arc cannot be its own saga (%)', new.id;
  end if;

  select campaign_id, parent_id into parent_campaign, parent_parent
  from public.arcs where id = new.parent_id;

  -- The FK would reject a dangling parent anyway, but it fires after this
  -- trigger — without this branch the null campaign_id falls through to the
  -- cross-campaign message below and reports the wrong problem.
  if not found then
    raise exception 'No such saga to nest under: %', new.parent_id;
  end if;

  if parent_campaign is distinct from new.campaign_id then
    raise exception 'Arc % belongs to another campaign than its saga %', new.id, new.parent_id;
  end if;

  if parent_parent is not null then
    raise exception 'Arcs nest one level: % is itself an arc within a saga', new.parent_id;
  end if;

  if exists (select 1 from public.arcs where parent_id = new.id) then
    raise exception 'Arc % has arcs of its own, so it cannot become a child', new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists tg_arcs_depth on public.arcs;
create trigger tg_arcs_depth
  before insert or update on public.arcs
  for each row execute function public.arcs_enforce_depth();

-- ==========================================================================
-- Seed: the Fist of Ilmater chronicle in the DM's own shape
-- ==========================================================================
-- 3 sagas, 22 arcs. The four existing foi-arc rows do NOT match the DM's saga
-- boundaries (foi-arc1 spans 31–77, straddling Black Spider ≤70 / Ravenloft
-- 71+), so they are replaced rather than promoted, and their hand-written
-- summaries move up to the saga each one actually describes.
--
-- Chapters 1–30 have no session rows (the seed starts at foi-s31), so the five
-- arcs that live entirely before it insert with null start/end session — the
-- FKs would fail otherwise. They render as chapterless until those sessions
-- exist, which is an honest gap in the journal rather than a defect.
--
-- completed_at is left null on all three sagas on purpose: Black Spider and
-- Ravenloft are finished in the fiction, but closing a saga is the DM's
-- deliberate act through the Complete Saga wizard (which stamps this column
-- and sweeps the supporting cast). Pre-stamping them here would skip the
-- ceremony and hide the button that performs it.

insert into public.arcs (id, campaign_id, title, summary, start_session_id, end_session_id, order_num, parent_id) values
  ('foi-saga-black-spider', 'fist-of-ilmater', 'The Black Spider Saga', 'The Shields of the Crying God rescue Gundren Rockseeker, break Trade Off, and reclaim the Forge of Spells — only to learn the Black Spider was Mephistopheles all along. The road north costs them Tillem, then Karn, before the mists swallow the survivors.', null,        'foi-s70',  1, null),
  ('foi-saga-ravenloft',    'fist-of-ilmater', 'The Ravenloft Saga',    'Trapped in Strahd von Zarovich''s Domain of Dread, the party follows Madam Eva''s cards through Vallaki, the Amber Temple, and Castle Ravenloft — unseating Baba Lysaga, staking the Devil Strahd in his coffin, and walking the mists home.',                    'foi-s71',  'foi-s147', 2, null),
  -- No end_session_id: this saga is still being played. A saga's last chapter
  -- is set when it's sealed (the Complete Saga wizard writes both), and pinning
  -- one here would go stale the next time the party sits down.
  ('foi-saga-giant',        'fist-of-ilmater', 'The Giant Saga',        'Back on the Sword Coast, giants stir: Grudd Haug falls, Port Llast burns, and the trail of the abducted smith Theldin leads through seven iron doors into the Shadowfell — while Faldorn and Mephistopheles move against the Emerald Enclave.',              'foi-s148', null,       3, null)
on conflict (id) do nothing;

insert into public.arcs (id, campaign_id, title, summary, start_session_id, end_session_id, order_num, parent_id) values
  -- The Black Spider Saga — chapters 1–70
  ('foi-arc-tomb-of-orestes',  'fist-of-ilmater', 'Tomb of Orestes Arc',  null, null,        null,       1, 'foi-saga-black-spider'),
  ('foi-arc-phandalin',        'fist-of-ilmater', 'Phandalin Arc',        null, null,        null,       2, 'foi-saga-black-spider'),
  ('foi-arc-thundertree',      'fist-of-ilmater', 'Thundertree Arc',      null, null,        null,       3, 'foi-saga-black-spider'),
  ('foi-arc-helms-hold',       'fist-of-ilmater', 'Helm''s Hold Arc',     null, null,        null,       4, 'foi-saga-black-spider'),
  ('foi-arc-moongrave',        'fist-of-ilmater', 'Moongrave Arc',        null, null,        null,       5, 'foi-saga-black-spider'),
  ('foi-arc-cragmaw-castle',   'fist-of-ilmater', 'Cragmaw Castle Arc',   null, 'foi-s31',   'foi-s36',  6, 'foi-saga-black-spider'),
  ('foi-arc-longsaddle',       'fist-of-ilmater', 'Longsaddle Arc',       null, 'foi-s37',   'foi-s44',  7, 'foi-saga-black-spider'),
  ('foi-arc-wave-echo-cave',   'fist-of-ilmater', 'Wave Echo Cave Arc',   null, 'foi-s45',   'foi-s61',  8, 'foi-saga-black-spider'),
  ('foi-arc-icespire-hold',    'fist-of-ilmater', 'Icespire Hold Arc',    null, 'foi-s62',   'foi-s70',  9, 'foi-saga-black-spider'),
  -- The Ravenloft Saga — chapters 71–147
  ('foi-arc-evermoors',        'fist-of-ilmater', 'Evermoors Arc',        null, 'foi-s71',   'foi-s76',  1, 'foi-saga-ravenloft'),
  ('foi-arc-morgantha',        'fist-of-ilmater', 'Morgantha Arc',        null, 'foi-s77',   'foi-s83',  2, 'foi-saga-ravenloft'),
  ('foi-arc-vallaki',          'fist-of-ilmater', 'Vallaki Arc',          null, 'foi-s84',   'foi-s98',  3, 'foi-saga-ravenloft'),
  ('foi-arc-amber-temple',     'fist-of-ilmater', 'Amber Temple Arc',     null, 'foi-s99',   'foi-s106', 4, 'foi-saga-ravenloft'),
  ('foi-arc-wizard-of-wines',  'fist-of-ilmater', 'Wizard of Wines Arc',  null, 'foi-s107',  'foi-s110', 5, 'foi-saga-ravenloft'),
  ('foi-arc-krezk',            'fist-of-ilmater', 'Krezk Arc',            null, 'foi-s111',  'foi-s119', 6, 'foi-saga-ravenloft'),
  ('foi-arc-castle-ravenloft', 'fist-of-ilmater', 'Castle Ravenloft Arc', null, 'foi-s120',  'foi-s144', 7, 'foi-saga-ravenloft'),
  ('foi-arc-post-barovia',     'fist-of-ilmater', 'Post-Barovia Arc',     null, 'foi-s145',  'foi-s147', 8, 'foi-saga-ravenloft'),
  -- The Giant Saga — chapters 148–191, still open
  ('foi-arc-blusterhelm',      'fist-of-ilmater', 'Blusterhelm Arc',      null, 'foi-s148',  'foi-s152', 1, 'foi-saga-giant'),
  ('foi-arc-grudd-haug',       'fist-of-ilmater', 'Grudd Haug Arc',       null, 'foi-s153',  'foi-s158', 2, 'foi-saga-giant'),
  ('foi-arc-lightning-keep',   'fist-of-ilmater', 'Lightning Keep Arc',   null, 'foi-s159',  'foi-s161', 3, 'foi-saga-giant'),
  ('foi-arc-mt-hotenow',       'fist-of-ilmater', 'Mt. Hotenow Arc',      null, 'foi-s162',  'foi-s183', 4, 'foi-saga-giant'),
  -- The DM's table reads "184-189+" — genuinely open-ended, so this arc has no
  -- end chapter either and its range below runs to infinity. The campaign is
  -- past S191 already (S192 "Worm Storm" was recorded in the app, not in any
  -- migration), and a closed range here would strand every chapter played
  -- between writing this file and applying it. Inherits foi-arc4's summary.
  ('foi-arc-neverwinter',      'fist-of-ilmater', 'Neverwinter Arc',      'The guild plants roots in Waterdeep and repays Neverwinter by hunting a cult of Vecna beneath the city — secrets siphoned from souls, the missing recovered from the crypts of Neverdeath, and a one-eyed lich-god who now has his eye on the party.', 'foi-s184', null,       5, 'foi-saga-giant')
on conflict (id) do nothing;

-- Chapters → arcs. One statement for all 22 ranges; the five pre-31 arcs
-- simply match no sessions. Sessions point at leaf arcs from here on, and the
-- saga is derived by walking up — see sagaSessions() in src/saga.ts.
with arc_ranges(arc_id, lo, hi) as (values
  ('foi-arc-tomb-of-orestes',    1,   4),
  ('foi-arc-phandalin',          5,  11),
  ('foi-arc-thundertree',       12,  14),
  ('foi-arc-helms-hold',        15,  21),
  ('foi-arc-moongrave',         22,  30),
  ('foi-arc-cragmaw-castle',    31,  36),
  ('foi-arc-longsaddle',        37,  44),
  ('foi-arc-wave-echo-cave',    45,  61),
  ('foi-arc-icespire-hold',     62,  70),
  ('foi-arc-evermoors',         71,  76),
  ('foi-arc-morgantha',         77,  83),
  ('foi-arc-vallaki',           84,  98),
  ('foi-arc-amber-temple',      99, 106),
  ('foi-arc-wizard-of-wines',  107, 110),
  ('foi-arc-krezk',            111, 119),
  ('foi-arc-castle-ravenloft', 120, 144),
  ('foi-arc-post-barovia',     145, 147),
  ('foi-arc-blusterhelm',      148, 152),
  ('foi-arc-grudd-haug',       153, 158),
  ('foi-arc-lightning-keep',   159, 161),
  ('foi-arc-mt-hotenow',       162, 183),
  -- Open-ended: claims S192 ("Worm Storm", already recorded) and every chapter
  -- played after this file was written, instead of leaving them unclaimed.
  ('foi-arc-neverwinter',      184, 2147483647)
)
update public.sessions s
   set arc_id = r.arc_id
  from arc_ranges r
 where s.campaign_id = 'fist-of-ilmater'
   and s.num between r.lo and r.hi
   -- Seed the unfiled; never overwrite curation. On the first run every chapter
   -- is either unassigned or still points at one of the four arcs this migration
   -- replaces, so this passes for all of them. If the file is ever replayed
   -- against a database that already has it — the integration won't, but this
   -- project has a documented history of hand-applied SQL — chapters the DM has
   -- since re-filed keep their arc, and only genuinely unclaimed ones (a session
   -- played after this ran) get picked up by the open-ended range above.
   and (s.arc_id is null or s.arc_id in ('foi-arc1', 'foi-arc2', 'foi-arc3', 'foi-arc4'));

-- Quests → the arc covering the chapter they were logged in.
with arc_ranges(arc_id, lo, hi) as (values
  ('foi-arc-cragmaw-castle',    31,  36),
  ('foi-arc-longsaddle',        37,  44),
  ('foi-arc-wave-echo-cave',    45,  61),
  ('foi-arc-icespire-hold',     62,  70),
  ('foi-arc-evermoors',         71,  76),
  ('foi-arc-morgantha',         77,  83),
  ('foi-arc-vallaki',           84,  98),
  ('foi-arc-amber-temple',      99, 106),
  ('foi-arc-wizard-of-wines',  107, 110),
  ('foi-arc-krezk',            111, 119),
  ('foi-arc-castle-ravenloft', 120, 144),
  ('foi-arc-post-barovia',     145, 147),
  ('foi-arc-blusterhelm',      148, 152),
  ('foi-arc-grudd-haug',       153, 158),
  ('foi-arc-lightning-keep',   159, 161),
  ('foi-arc-mt-hotenow',       162, 183),
  -- Open-ended: claims S192 ("Worm Storm", already recorded) and every chapter
  -- played after this file was written, instead of leaving them unclaimed.
  ('foi-arc-neverwinter',      184, 2147483647)
)
update public.quests q
   set arc_id = r.arc_id
  from public.sessions s, arc_ranges r
 where q.campaign_id = 'fist-of-ilmater'
   and q.session_id = s.id
   and s.num between r.lo and r.hi
   -- Same guard as the chapters above: seed the unfiled, leave curation alone.
   and (q.arc_id is null or q.arc_id in ('foi-arc1', 'foi-arc2', 'foi-arc3', 'foi-arc4'));

-- Sessionless quests keep their altitude: they fall back to the saga their old
-- arc became, which is the honest answer when there's no chapter to place them.
update public.quests
   set arc_id = case arc_id
     when 'foi-arc1' then 'foi-saga-black-spider'
     when 'foi-arc2' then 'foi-saga-ravenloft'
     when 'foi-arc3' then 'foi-saga-giant'
     when 'foi-arc4' then 'foi-arc-neverwinter'
   end
 where campaign_id = 'fist-of-ilmater'
   and arc_id in ('foi-arc1', 'foi-arc2', 'foi-arc3', 'foi-arc4');

-- Last, once nothing references them. Deliberately not relying on 0008's
-- `on delete set null`: that would silently orphan any row the re-points above
-- missed, and a null arc is indistinguishable from "never assigned".
delete from public.arcs
 where campaign_id = 'fist-of-ilmater'
   and id in ('foi-arc1', 'foi-arc2', 'foi-arc3', 'foi-arc4');
