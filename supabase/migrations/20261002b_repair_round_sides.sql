-- Round sides — repair `match_rounds.side` and the auto tags copied from it.
--
-- Run this whole file in the Supabase SQL editor (this project has no CLI link;
-- migrations are applied by hand and kept here as the record of what was run).
-- Safe to run twice: the second run changes nothing and reports zeros.
--
-- Every stored first-half side was the opposite of what was played. Rows
-- written before 2026-05-02 swapped at the half but started on the wrong side;
-- rows written after it carry the second-half side on every round, because the
-- side was looked up by a round number the Henrik payload does not have. New
-- rows are right once `sideForRound` (src/lib/roundSides.ts) is deployed; this
-- file corrects the rows already stored. No schema change.
--
-- The stored rounds hold the answer themselves. A defuse is a round won by the
-- defenders and a detonation one won by the attackers, so any round that ended
-- on the spike says which side the player was on, and one such round fixes the
-- whole match: rounds 1–12 are one side, 13–24 the other, and overtime swaps
-- every round starting on the first-half side.
--
-- The result row reports what was done. On the data of 2026-10-02 the first run
-- returns 73 / 73 / 1047 / 740. If `matches_resolved` is lower than
-- `matches_with_rounds`, some match has no spike round to read and was left
-- alone: send the output to Claude rather than editing rows by hand.

with evidence as (
  -- One reading per spike round in regulation: did the player attack first?
  select
    match_id,
    user_id,
    (round_number <= 12) <> ((end_type = 'Bomb defused') = round_won) as attacked_first
  from public.match_rounds
  where round_number <= 24
    and end_type in ('Bomb defused', 'Bomb detonated')
),
first_half as (
  -- Only matches whose spike rounds all agree.
  select match_id, user_id, bool_and(attacked_first) as attacked_first
  from evidence
  group by match_id, user_id
  having bool_and(attacked_first) = bool_or(attacked_first)

  union all

  -- Two matches where every round ended in an elimination. Read from Henrik on
  -- 2026-10-02: the player was on Red, and Red planted throughout the first half.
  select distinct r.match_id, r.user_id, true
  from public.match_rounds r
  where r.match_id in (
      '1faf5c09-9fd6-4c51-9da4-4f094a5a28b4',
      'c712e841-dded-43fd-9438-cefb5b1aea0e'
    )
    and not exists (
      select 1 from evidence e where e.match_id = r.match_id and e.user_id = r.user_id
    )
),
target as (
  select
    r.id,
    r.match_id,
    r.user_id,
    r.round_number,
    r.round_won,
    case
      when (r.round_number <= 12 or (r.round_number > 24 and r.round_number % 2 = 1)) = f.attacked_first
        then 'attack'
      else 'defense'
    end as side
  from public.match_rounds r
  join first_half f on f.match_id = r.match_id and f.user_id = r.user_id
),
fixed_rounds as (
  update public.match_rounds r
  set side = t.side
  from target t
  where t.id = r.id
    and r.side <> t.side
  returning r.id
),
fixed_tags as (
  -- Auto tags carry the side twice: in `side` and inside the label. Both are
  -- rebuilt the way `generateAutoTags` writes them. Manual tags are not touched.
  update public.vod_tags g
  set
    side = t.side,
    label = case g.tag_type
      when 'round' then
        'R' || t.round_number || ' '
        || case t.side when 'attack' then 'ATK' else 'DEF' end
        || ' — '
        || case when t.round_won then 'Won' else 'Lost' end
      else 'Side switch → ' || upper(t.side)
    end
  from public.vod_reviews v
  join target t on t.match_id = v.match_id and t.user_id = v.user_id
  where v.id = g.vod_review_id
    and t.round_number = g.round_number
    and g.is_auto
    and g.tag_type in ('round', 'half')
    and g.side is distinct from t.side
  returning g.id
)
select
  (select count(distinct (match_id, user_id)) from target) as matches_resolved,
  (select count(distinct (match_id, user_id)) from public.match_rounds) as matches_with_rounds,
  (select count(*) from fixed_rounds) as rounds_corrected,
  (select count(*) from fixed_tags) as tags_corrected;
