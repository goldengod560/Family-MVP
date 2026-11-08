-- Family NFL Picks v0.9.1
-- FUTURE-GAME LOCK INTEGRITY FIX
--
-- Run this ONCE in Supabase -> SQL Editor -> New query.
--
-- PURPOSE
-- A player is allowed to count as "submitted" only while they have a complete
-- pick for EVERY game currently loaded for that week.
--
-- This prevents an old/stale submission marker from making future games lock
-- while another player is still incomplete.
--
-- IMPORTANT: this does NOT reset or delete:
--   picks
--   margins
--   points
--   standings
--   history
--   PINs
--   games
--   overrides
--
-- It may remove ONLY an invalid/stale row from family_submissions when that
-- player does not currently have a complete pick for every game in that week.
-- That is the bad lock flag we are fixing.

create or replace function private.family_submission_is_complete(
  p_season integer,
  p_week integer,
  p_player_id text
)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select
    exists(
      select 1
      from public.family_submissions s
      where s.season=p_season
        and s.week=p_week
        and s.player_id=p_player_id
    )
    and exists(
      select 1
      from public.family_games g
      where g.season=p_season
        and g.week=p_week
    )
    and not exists(
      select 1
      from public.family_games g
      where g.season=p_season
        and g.week=p_week
        and not exists(
          select 1
          from public.family_picks p
          where p.season=g.season
            and p.week=g.week
            and p.game_id=g.game_id
            and p.player_id=p_player_id
            and p.team is not null
            and p.margin between 1 and 99
        )
    );
$$;

create or replace function private.family_clear_incomplete_submissions()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_season integer;
  v_week integer;
begin
  if TG_OP = 'DELETE' then
    v_season := OLD.season;
    v_week   := OLD.week;
  else
    v_season := NEW.season;
    v_week   := NEW.week;
  end if;

  delete from public.family_submissions s
  where s.season=v_season
    and s.week=v_week
    and not private.family_submission_is_complete(
      s.season,
      s.week,
      s.player_id
    );

  if TG_OP = 'DELETE' then
    return OLD;
  end if;
  return NEW;
end;
$$;

-- If the loaded schedule changes after somebody submitted, re-check submission validity.
drop trigger if exists family_games_recheck_submissions on public.family_games;
create trigger family_games_recheck_submissions
after insert or update or delete
on public.family_games
for each row
execute function private.family_clear_incomplete_submissions();

-- If a pick is ever removed/invalidated, re-check submission validity too.
drop trigger if exists family_picks_recheck_submissions on public.family_picks;
create trigger family_picks_recheck_submissions
after insert or update or delete
on public.family_picks
for each row
execute function private.family_clear_incomplete_submissions();

-- Clean up any stale incomplete submission marker that already exists NOW.
delete from public.family_submissions s
where not private.family_submission_is_complete(
  s.season,
  s.week,
  s.player_id
);

notify pgrst, 'reload schema';

-- ============================================================
-- v0.9.2 LATE-PICK SPOILER PROTECTION
--
-- A viewer who has NO saved pick for a game after kickoff,
-- while that game is still non-final, does NOT receive:
--   * away/home live score
--   * other players' picks for that game
--
-- As soon as the viewer saves an authorized late pick, the
-- score and revealed picks are returned normally.
--
-- Once a game is FINAL, it may reveal even if the viewer missed
-- it, because family_authorize_late_pick refuses final games.
-- ============================================================

create or replace function public.family_snapshot(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player text;
  v_season integer;
  v_week integer;
  v_lock_week integer;
  v_admin boolean;
  v_all_submitted boolean;
  v_viewer_submitted boolean;
  v_games_count integer;
  v_result jsonb;
begin
  v_player := private.session_player(p_token);
  select season,current_week,prediction_lock_week into v_season,v_week,v_lock_week
    from public.family_settings order by season desc limit 1;
  v_admin := private.is_admin(v_player);

  update public.family_overrides
     set status='expired'
   where season=v_season and week=v_week and status='active'
     and expires_at is not null and expires_at <= now();

  select count(*)=4 into v_all_submitted
    from public.family_submissions where season=v_season and week=v_week;

  select exists(
    select 1 from public.family_submissions
     where season=v_season and week=v_week and player_id=v_player
  ) into v_viewer_submitted;

  select count(*) into v_games_count
    from public.family_games where season=v_season and week=v_week;

  select jsonb_build_object(
    'season',v_season,
    'currentWeek',v_week,
    'predictionLockWeek',v_lock_week,
    'serverNow',now(),

    'viewer',(select jsonb_build_object(
      'id',player_id,'name',display_name,'admin',is_admin
    ) from public.family_players where player_id=v_player),

    'players',(select coalesce(jsonb_agg(jsonb_build_object(
      'id',player_id,'name',display_name,'admin',is_admin
    ) order by case player_id
      when 'yasin' then 1 when 'yezan' then 2 when 'samer' then 3 else 4 end
    ),'[]'::jsonb) from public.family_players),

    'games',(select coalesce(jsonb_agg(jsonb_build_object(
      'id',g.game_id,
      'away',g.away,
      'awayName',g.away_name,
      'awayRecord',coalesce(g.away_record,''),
      'home',g.home,
      'homeName',g.home_name,
      'homeRecord',coalesce(g.home_record,''),
      'kickoff',g.kickoff,
      'status',g.status,
      'final',g.final,

      'scoreHidden',
        (
          g.kickoff <= now()
          and not g.final
          and not exists(
            select 1
              from public.family_picks vp
             where vp.season=g.season
               and vp.week=g.week
               and vp.game_id=g.game_id
               and vp.player_id=v_player
               and vp.team is not null
               and vp.margin between 1 and 99
          )
        ),

      'awayScore',
        case
          when (
            g.kickoff <= now()
            and not g.final
            and not exists(
              select 1
                from public.family_picks vp
               where vp.season=g.season
                 and vp.week=g.week
                 and vp.game_id=g.game_id
                 and vp.player_id=v_player
                 and vp.team is not null
                 and vp.margin between 1 and 99
            )
          ) then null
          else g.away_score
        end,

      'homeScore',
        case
          when (
            g.kickoff <= now()
            and not g.final
            and not exists(
              select 1
                from public.family_picks vp
               where vp.season=g.season
                 and vp.week=g.week
                 and vp.game_id=g.game_id
                 and vp.player_id=v_player
                 and vp.team is not null
                 and vp.margin between 1 and 99
            )
          ) then null
          else g.home_score
        end,

      'round',g.round
    ) order by g.kickoff),'[]'::jsonb)
      from public.family_games g
      where g.season=v_season and g.week=v_week),

    'visiblePicks',(select coalesce(jsonb_agg(jsonb_build_object(
      'gameId',p.game_id,
      'playerId',p.player_id,
      'team',p.team,
      'margin',p.margin,
      'lateOverride',p.late_override,
      'updatedAt',p.updated_at
    )),'[]'::jsonb)
      from public.family_picks p
      join public.family_games g
        on g.season=p.season and g.week=p.week and g.game_id=p.game_id
      where p.season=v_season
        and p.week=v_week
        and (
          -- Your own saved pick is always visible to you.
          p.player_id=v_player

          -- Commissioner review remains available only after Yasin submitted.
          or (
            v_admin
            and v_viewer_submitted
          )

          -- Non-admin reveal after kickoff/all-submitted is allowed only if
          -- THIS viewer already has a saved pick for that game, OR the game is final.
          or (
            (not v_admin)
            and (v_all_submitted or g.kickoff<=now())
            and (
              g.final
              or exists(
                select 1
                  from public.family_picks vp
                 where vp.season=g.season
                   and vp.week=g.week
                   and vp.game_id=g.game_id
                   and vp.player_id=v_player
                   and vp.team is not null
                   and vp.margin between 1 and 99
              )
            )
          )
        )),

    'submissions',(select coalesce(jsonb_agg(jsonb_build_object(
      'playerId',player_id,'submittedAt',submitted_at
    )),'[]'::jsonb)
      from public.family_submissions
      where season=v_season and week=v_week),

    'progress',(select coalesce(jsonb_agg(jsonb_build_object(
      'playerId',fp.player_id,
      'picked',coalesce(pc.picked,0),
      'total',v_games_count,
      'submitted',exists(
        select 1
          from public.family_submissions s
         where s.season=v_season
           and s.week=v_week
           and s.player_id=fp.player_id
      )
    ) order by case fp.player_id
      when 'yasin' then 1 when 'yezan' then 2 when 'samer' then 3 else 4 end
    ),'[]'::jsonb)
      from public.family_players fp
      left join (
        select player_id,count(*)::int picked
          from public.family_picks
         where season=v_season
           and week=v_week
           and team is not null
           and margin between 1 and 99
         group by player_id
      ) pc using(player_id)),

    'standings',(select coalesce(jsonb_agg(jsonb_build_object(
      'playerId',fp.player_id,
      'name',fp.display_name,
      'total',coalesce(t.total,0)
    ) order by coalesce(t.total,0) desc, fp.display_name),'[]'::jsonb)
      from public.family_players fp
      left join (
        select player_id,sum(points)::int total
          from public.family_week_scores
         where season=v_season
         group by player_id
      ) t using(player_id)),

    'currentScores',(select coalesce(jsonb_agg(jsonb_build_object(
      'playerId',player_id,
      'checks',checks,
      'points',points,
      'multiplier',multiplier,
      'scoredAt',scored_at
    )),'[]'::jsonb)
      from public.family_week_scores
      where season=v_season and week=v_week),

    'overrides',jsonb_build_object(
      'count',(select count(*)
        from public.family_overrides
        where season=v_season
          and week=v_week
          and kind in ('late_pick','commissioner_edit')
          and status<>'cancelled'),

      'activeForViewer',(select coalesce(jsonb_agg(jsonb_build_object(
        'id',override_id,
        'gameId',game_id,
        'playerId',player_id,
        'kind',kind,
        'authorizedAt',authorized_at,
        'expiresAt',expires_at
      ) order by authorized_at desc),'[]'::jsonb)
        from public.family_overrides
        where season=v_season
          and week=v_week
          and player_id=v_player
          and status='active'
          and (expires_at is null or expires_at>now())),

      'all',(select coalesce(jsonb_agg(jsonb_build_object(
        'id',o.override_id,
        'gameId',o.game_id,
        'playerId',o.player_id,
        'kind',o.kind,
        'status',o.status,
        'authorizedBy',o.authorized_by,
        'authorizedAt',o.authorized_at,
        'expiresAt',o.expires_at,
        'usedAt',o.used_at,
        'note',o.note,
        'oldTeam',case
          when (v_all_submitted or g.kickoff<=now() or g.final) then o.old_team else null end,
        'oldMargin',case
          when (v_all_submitted or g.kickoff<=now() or g.final) then o.old_margin else null end,
        'newTeam',case
          when (v_all_submitted or g.kickoff<=now() or g.final) then o.new_team else null end,
        'newMargin',case
          when (v_all_submitted or g.kickoff<=now() or g.final) then o.new_margin else null end
      ) order by o.authorized_at desc),'[]'::jsonb)
        from public.family_overrides o
        join public.family_games g
          on g.season=o.season and g.week=o.week and g.game_id=o.game_id
        where o.season=v_season
          and o.week=v_week
          and o.kind in ('late_pick','commissioner_edit'))
    ),

    'predictions',(select coalesce(
      jsonb_build_object('conference',conference,'superBowl',super_bowl),
      jsonb_build_object('conference','[]'::jsonb,'superBowl','[]'::jsonb)
    ) from public.family_predictions
      where season=v_season and player_id=v_player),

    'resultAlert',(
      select jsonb_build_object('week',z.week,'scoredAt',z.scored_at)
      from (
        select ws.week,max(ws.scored_at) scored_at
          from public.family_week_scores ws
         where ws.season=v_season
           and not exists(
             select 1
               from public.family_result_views rv
              where rv.season=ws.season
                and rv.week=ws.week
                and rv.player_id=v_player
           )
         group by ws.week
         order by ws.week desc
         limit 1
      ) z
    ),

    'history',(select coalesce(jsonb_agg(
      h.item order by (h.item->>'week')::int desc
    ),'[]'::jsonb) from (
      select jsonb_build_object(
        'week',ws.week,
        'multiplier',max(ws.multiplier),
        'scoredAt',max(ws.scored_at),

        'scores',(select jsonb_agg(jsonb_build_object(
          'playerId',s2.player_id,
          'checks',s2.checks,
          'points',s2.points
        ) order by s2.player_id)
          from public.family_week_scores s2
          where s2.season=v_season and s2.week=ws.week),

        'overrideCount',(select count(*)
          from public.family_overrides o
          where o.season=v_season
            and o.week=ws.week
            and o.kind in ('late_pick','commissioner_edit')
            and o.status<>'cancelled'),

        'overrides',(select coalesce(jsonb_agg(jsonb_build_object(
          'id',o.override_id,
          'gameId',o.game_id,
          'playerId',o.player_id,
          'kind',o.kind,
          'status',o.status,
          'authorizedBy',o.authorized_by,
          'authorizedAt',o.authorized_at,
          'expiresAt',o.expires_at,
          'usedAt',o.used_at,
          'note',o.note,
          'oldTeam',o.old_team,
          'oldMargin',o.old_margin,
          'newTeam',o.new_team,
          'newMargin',o.new_margin
        ) order by o.authorized_at),'[]'::jsonb)
          from public.family_overrides o
          where o.season=v_season
            and o.week=ws.week
            and o.kind in ('late_pick','commissioner_edit')),

        'games',(select coalesce(jsonb_agg(jsonb_build_object(
          'id',g.game_id,
          'away',g.away,
          'awayName',g.away_name,
          'awayScore',g.away_score,
          'home',g.home,
          'homeName',g.home_name,
          'homeScore',g.home_score,
          'final',g.final,
          'kickoff',g.kickoff,
          'picks',(select coalesce(jsonb_agg(jsonb_build_object(
            'playerId',p.player_id,
            'team',p.team,
            'margin',p.margin,
            'lateOverride',p.late_override
          )),'[]'::jsonb)
            from public.family_picks p
            where p.season=g.season
              and p.week=g.week
              and p.game_id=g.game_id)
        ) order by g.kickoff),'[]'::jsonb)
          from public.family_games g
          where g.season=v_season and g.week=ws.week)
      ) item
      from public.family_week_scores ws
      where ws.season=v_season
      group by ws.week
    ) h)
  ) into v_result;

  return v_result;
end;
$$;

notify pgrst, 'reload schema';
