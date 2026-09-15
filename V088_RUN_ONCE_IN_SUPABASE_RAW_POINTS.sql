-- Family NFL Picks v0.8.8
-- RAW CUMULATIVE SCORING PATCH
--
-- Run this ONCE in Supabase -> SQL Editor.
--
-- What it changes:
--   points = actual weekly checks × round multiplier
--
-- Example regular-season week:
--   Limar 6 checks -> 6 points
--   Yezan 5 checks -> 5 points
--   Samer 4 checks -> 4 points
--   Yasin 1 check  -> 1 point
--
-- It NO LONGER subtracts the lowest player's score from everybody.
--
-- Safety:
--   - does NOT delete/reset picks
--   - does NOT reset PINs
--   - does NOT delete games
--   - does NOT delete standings/history
--   - does NOT change lock/reveal rules
--   - does NOT change winner/checkmark logic
--
-- The trigger is used so the existing week-scoring function can stay in place:
-- whenever family_week_scores is inserted or updated, points are forced to
-- checks × multiplier.

create or replace function public.family_use_raw_points()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.points := coalesce(new.checks, 0) * coalesce(new.multiplier, 1);
  return new;
end;
$$;

drop trigger if exists family_week_scores_raw_points on public.family_week_scores;

create trigger family_week_scores_raw_points
before insert or update of checks, points, multiplier
on public.family_week_scores
for each row
execute function public.family_use_raw_points();

-- Repair any already-scored rows safely, if there are any.
-- This preserves checks/history and only recalculates the points field.
update public.family_week_scores
set points = coalesce(checks, 0) * coalesce(multiplier, 1)
where points is distinct from (coalesce(checks, 0) * coalesce(multiplier, 1));

-- Ask PostgREST to refresh its schema cache.
notify pgrst, 'reload schema';
