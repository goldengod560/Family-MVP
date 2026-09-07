-- Family NFL Picks v0.7 incremental feature migration.
-- Safe to run AFTER 002_shared_family_backend.sql and the PIN hotfix.
-- Adds 5-minute late-pick windows, commissioner edits, public override audit,
-- pick-progress status, and once-per-player end-of-week result alerts.

alter table public.family_overrides add column if not exists expires_at timestamptz;
alter table public.family_overrides add column if not exists old_team text;
alter table public.family_overrides add column if not exists old_margin integer;
alter table public.family_overrides add column if not exists new_team text;
alter table public.family_overrides add column if not exists new_margin integer;

alter table public.family_overrides drop constraint if exists family_overrides_status_check;
alter table public.family_overrides
  add constraint family_overrides_status_check
  check (status in ('active','used','cancelled','expired'));

create table if not exists public.family_result_views (
  season integer not null,
  week integer not null,
  player_id text not null references public.family_players(player_id) on delete cascade,
  seen_at timestamptz not null default now(),
  primary key(season,week,player_id)
);
alter table public.family_result_views enable row level security;
revoke all on public.family_result_views from anon, authenticated;

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
    'viewer',(select jsonb_build_object('id',player_id,'name',display_name,'admin',is_admin)
      from public.family_players where player_id=v_player),
    'players',(select coalesce(jsonb_agg(jsonb_build_object(
      'id',player_id,'name',display_name,'admin',is_admin
    ) order by case player_id when 'yasin' then 1 when 'yezan' then 2 when 'samer' then 3 else 4 end),'[]'::jsonb)
      from public.family_players),
    'games',(select coalesce(jsonb_agg(jsonb_build_object(
      'id',game_id,'away',away,'awayName',away_name,'awayRecord',coalesce(away_record,''),
      'home',home,'homeName',home_name,'homeRecord',coalesce(home_record,''),
      'kickoff',kickoff,'status',status,'final',final,'awayScore',away_score,'homeScore',home_score,'round',round
    ) order by kickoff),'[]'::jsonb)
      from public.family_games where season=v_season and week=v_week),
    'visiblePicks',(select coalesce(jsonb_agg(jsonb_build_object(
      'gameId',p.game_id,'playerId',p.player_id,'team',p.team,'margin',p.margin,
      'lateOverride',p.late_override,'updatedAt',p.updated_at
    )),'[]'::jsonb)
      from public.family_picks p
      join public.family_games g on g.season=p.season and g.week=p.week and g.game_id=p.game_id
      where p.season=v_season and p.week=v_week
        and (
          p.player_id=v_player
          or (v_admin and v_viewer_submitted)
          or ((not v_admin) and (v_all_submitted or g.kickoff<=now()))
        )),
    'submissions',(select coalesce(jsonb_agg(jsonb_build_object(
      'playerId',player_id,'submittedAt',submitted_at
    )),'[]'::jsonb)
      from public.family_submissions where season=v_season and week=v_week),
    'progress',(select coalesce(jsonb_agg(jsonb_build_object(
      'playerId',fp.player_id,
      'picked',coalesce(pc.picked,0),
      'total',v_games_count,
      'submitted',exists(select 1 from public.family_submissions s where s.season=v_season and s.week=v_week and s.player_id=fp.player_id)
    ) order by case fp.player_id when 'yasin' then 1 when 'yezan' then 2 when 'samer' then 3 else 4 end),'[]'::jsonb)
      from public.family_players fp
      left join (
        select player_id,count(*)::int picked
          from public.family_picks
         where season=v_season and week=v_week and team is not null and margin between 1 and 99
         group by player_id
      ) pc using(player_id)),
    'standings',(select coalesce(jsonb_agg(jsonb_build_object(
      'playerId',fp.player_id,'name',fp.display_name,'total',coalesce(t.total,0)
    ) order by coalesce(t.total,0) desc, fp.display_name),'[]'::jsonb)
      from public.family_players fp
      left join (
        select player_id,sum(points)::int total
          from public.family_week_scores where season=v_season group by player_id
      ) t using(player_id)),
    'currentScores',(select coalesce(jsonb_agg(jsonb_build_object(
      'playerId',player_id,'checks',checks,'points',points,'multiplier',multiplier,'scoredAt',scored_at
    )),'[]'::jsonb)
      from public.family_week_scores where season=v_season and week=v_week),
    'overrides',jsonb_build_object(
      'count',(select count(*) from public.family_overrides
        where season=v_season and week=v_week
          and kind in ('late_pick','commissioner_edit') and status<>'cancelled'),
      'activeForViewer',(select coalesce(jsonb_agg(jsonb_build_object(
        'id',override_id,'gameId',game_id,'playerId',player_id,'kind',kind,
        'authorizedAt',authorized_at,'expiresAt',expires_at
      ) order by authorized_at desc),'[]'::jsonb)
        from public.family_overrides
        where season=v_season and week=v_week and player_id=v_player and status='active'
          and (expires_at is null or expires_at>now())),
      'all',(select coalesce(jsonb_agg(jsonb_build_object(
        'id',o.override_id,'gameId',o.game_id,'playerId',o.player_id,'kind',o.kind,
        'status',o.status,'authorizedBy',o.authorized_by,'authorizedAt',o.authorized_at,
        'expiresAt',o.expires_at,'usedAt',o.used_at,'note',o.note,
        'oldTeam',case when (v_all_submitted or g.kickoff<=now() or g.final) then o.old_team else null end,
        'oldMargin',case when (v_all_submitted or g.kickoff<=now() or g.final) then o.old_margin else null end,
        'newTeam',case when (v_all_submitted or g.kickoff<=now() or g.final) then o.new_team else null end,
        'newMargin',case when (v_all_submitted or g.kickoff<=now() or g.final) then o.new_margin else null end
      ) order by o.authorized_at desc),'[]'::jsonb)
        from public.family_overrides o
        join public.family_games g on g.season=o.season and g.week=o.week and g.game_id=o.game_id
        where o.season=v_season and o.week=v_week and o.kind in ('late_pick','commissioner_edit'))
    ),
    'predictions',(select coalesce(
      jsonb_build_object('conference',conference,'superBowl',super_bowl),
      jsonb_build_object('conference','[]'::jsonb,'superBowl','[]'::jsonb)
    ) from public.family_predictions where season=v_season and player_id=v_player),
    'resultAlert',(
      select jsonb_build_object('week',z.week,'scoredAt',z.scored_at)
      from (
        select ws.week,max(ws.scored_at) scored_at
          from public.family_week_scores ws
         where ws.season=v_season
           and not exists(
             select 1 from public.family_result_views rv
              where rv.season=ws.season and rv.week=ws.week and rv.player_id=v_player
           )
         group by ws.week
         order by ws.week desc
         limit 1
      ) z
    ),
    'history',(select coalesce(jsonb_agg(h.item order by (h.item->>'week')::int desc),'[]'::jsonb) from (
      select jsonb_build_object(
        'week',ws.week,
        'multiplier',max(ws.multiplier),
        'scoredAt',max(ws.scored_at),
        'scores',(select jsonb_agg(jsonb_build_object(
          'playerId',s2.player_id,'checks',s2.checks,'points',s2.points
        ) order by s2.player_id)
          from public.family_week_scores s2 where s2.season=v_season and s2.week=ws.week),
        'overrideCount',(select count(*) from public.family_overrides o
          where o.season=v_season and o.week=ws.week and o.kind in ('late_pick','commissioner_edit') and o.status<>'cancelled'),
        'overrides',(select coalesce(jsonb_agg(jsonb_build_object(
          'id',o.override_id,'gameId',o.game_id,'playerId',o.player_id,'kind',o.kind,'status',o.status,
          'authorizedBy',o.authorized_by,'authorizedAt',o.authorized_at,'expiresAt',o.expires_at,
          'usedAt',o.used_at,'note',o.note,'oldTeam',o.old_team,'oldMargin',o.old_margin,
          'newTeam',o.new_team,'newMargin',o.new_margin
        ) order by o.authorized_at),'[]'::jsonb)
          from public.family_overrides o where o.season=v_season and o.week=ws.week and o.kind in ('late_pick','commissioner_edit')),
        'games',(select coalesce(jsonb_agg(jsonb_build_object(
          'id',g.game_id,'away',g.away,'awayName',g.away_name,'awayScore',g.away_score,
          'home',g.home,'homeName',g.home_name,'homeScore',g.home_score,'final',g.final,'kickoff',g.kickoff,
          'picks',(select coalesce(jsonb_agg(jsonb_build_object(
            'playerId',p.player_id,'team',p.team,'margin',p.margin,'lateOverride',p.late_override
          )),'[]'::jsonb)
            from public.family_picks p where p.season=g.season and p.week=g.week and p.game_id=g.game_id)
        ) order by g.kickoff),'[]'::jsonb)
          from public.family_games g where g.season=v_season and g.week=ws.week)
      ) item
      from public.family_week_scores ws
      where ws.season=v_season
      group by ws.week
    ) h)
  ) into v_result;
  return v_result;
end;
$$;

create or replace function public.family_set_pick(p_token text, p_game_id text, p_team text, p_margin integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player text;
  v_season integer;
  v_week integer;
  v_game public.family_games%rowtype;
  v_all_submitted boolean;
  v_override_id uuid;
begin
  v_player := private.session_player(p_token);
  if p_margin is null or p_margin < 1 or p_margin > 99 then
    return jsonb_build_object('ok',false,'error','Margin must be between 1 and 99.');
  end if;
  select season,current_week into v_season,v_week from public.family_settings order by season desc limit 1;
  select * into v_game from public.family_games where season=v_season and week=v_week and game_id=p_game_id;
  if not found then return jsonb_build_object('ok',false,'error','Game not found. Refresh the schedule.'); end if;
  if p_team not in (v_game.away,v_game.home) then return jsonb_build_object('ok',false,'error','Invalid team for this matchup.'); end if;
  if v_game.final then return jsonb_build_object('ok',false,'error','This game is already final.'); end if;

  update public.family_overrides
     set status='expired'
   where season=v_season and week=v_week and game_id=p_game_id and player_id=v_player
     and status='active' and kind='late_pick' and expires_at is not null and expires_at<=now();

  select count(*)=4 into v_all_submitted
    from public.family_submissions where season=v_season and week=v_week;
  select override_id into v_override_id
    from public.family_overrides
   where season=v_season and week=v_week and game_id=p_game_id and player_id=v_player
     and status='active' and kind='late_pick' and (expires_at is null or expires_at>now())
   order by authorized_at desc limit 1;

  if (v_all_submitted or v_game.kickoff <= now()) and v_override_id is null then
    return jsonb_build_object('ok',false,'error','This game is locked. Yasin must authorize a late-pick override.');
  end if;

  insert into public.family_picks(season,week,game_id,player_id,team,margin,late_override,updated_at)
    values(v_season,v_week,p_game_id,v_player,p_team,p_margin,(v_override_id is not null),now())
  on conflict(season,week,game_id,player_id) do update
    set team=excluded.team,margin=excluded.margin,
        late_override=(public.family_picks.late_override or excluded.late_override),updated_at=now();

  if v_override_id is not null then
    update public.family_overrides
       set status='used',used_at=now(),new_team=p_team,new_margin=p_margin
     where override_id=v_override_id;
  end if;

  return jsonb_build_object('ok',true,'lateOverride',(v_override_id is not null));
end;
$$;

create or replace function public.family_submit_week(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player text;
  v_season integer;
  v_week integer;
  v_games integer;
  v_picks integer;
begin
  v_player := private.session_player(p_token);
  select season,current_week into v_season,v_week from public.family_settings order by season desc limit 1;
  select count(*) into v_games from public.family_games where season=v_season and week=v_week;
  select count(*) into v_picks from public.family_picks
    where season=v_season and week=v_week and player_id=v_player and team is not null and margin between 1 and 99;
  if v_games=0 then return jsonb_build_object('ok',false,'error','No games are loaded yet.'); end if;
  if v_picks<>v_games then
    return jsonb_build_object('ok',false,'error',format('You have %s of %s complete picks.',v_picks,v_games));
  end if;
  insert into public.family_submissions(season,week,player_id,submitted_at)
    values(v_season,v_week,v_player,now())
  on conflict(season,week,player_id) do update set submitted_at=now();
  return jsonb_build_object('ok',true,'submittedAt',now());
end;
$$;

create or replace function public.family_authorize_late_pick(p_token text, p_target_player_id text, p_game_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin text;
  v_season integer;
  v_week integer;
  v_game public.family_games%rowtype;
  v_id uuid;
  v_expires timestamptz;
begin
  v_admin := private.session_player(p_token);
  if not private.is_admin(v_admin) then return jsonb_build_object('ok',false,'error','Commissioner access required.'); end if;
  select season,current_week into v_season,v_week from public.family_settings order by season desc limit 1;
  if p_target_player_id<>v_admin and not exists(
    select 1 from public.family_submissions where season=v_season and week=v_week and player_id=v_admin
  ) then return jsonb_build_object('ok',false,'error','You must submit your own picks before authorizing another player''s late pick.'); end if;
  if not exists(select 1 from public.family_players where player_id=p_target_player_id) then
    return jsonb_build_object('ok',false,'error','Player not found.');
  end if;
  select * into v_game from public.family_games where season=v_season and week=v_week and game_id=p_game_id;
  if not found then return jsonb_build_object('ok',false,'error','Game not found.'); end if;
  if v_game.kickoff > now() then return jsonb_build_object('ok',false,'error','The game is still open; no override is needed.'); end if;
  if v_game.final then return jsonb_build_object('ok',false,'error','The game is already final and cannot be reopened.'); end if;
  if exists(select 1 from public.family_picks where season=v_season and week=v_week and game_id=p_game_id and player_id=p_target_player_id) then
    return jsonb_build_object('ok',false,'error','That player already has a saved pick. Use Commissioner Edit if a correction is needed.');
  end if;

  update public.family_overrides set status='expired'
   where season=v_season and week=v_week and game_id=p_game_id and player_id=p_target_player_id
     and status='active' and kind='late_pick';

  v_expires := now() + interval '5 minutes';
  insert into public.family_overrides(
    season,week,game_id,player_id,kind,status,authorized_by,authorized_at,expires_at
  ) values(
    v_season,v_week,p_game_id,p_target_player_id,'late_pick','active',v_admin,now(),v_expires
  ) returning override_id into v_id;

  return jsonb_build_object('ok',true,'overrideId',v_id::text,'expiresAt',v_expires);
end;
$$;

create or replace function public.family_commissioner_edit_pick(
  p_token text,
  p_target_player_id text,
  p_game_id text,
  p_team text,
  p_margin integer,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin text;
  v_season integer;
  v_week integer;
  v_game public.family_games%rowtype;
  v_old public.family_picks%rowtype;
  v_all_submitted boolean;
begin
  v_admin := private.session_player(p_token);
  if not private.is_admin(v_admin) then return jsonb_build_object('ok',false,'error','Commissioner access required.'); end if;
  select season,current_week into v_season,v_week from public.family_settings order by season desc limit 1;
  if p_target_player_id<>v_admin and not exists(
    select 1 from public.family_submissions where season=v_season and week=v_week and player_id=v_admin
  ) then return jsonb_build_object('ok',false,'error','You must submit your own picks before editing another player''s pick.'); end if;
  if p_margin is null or p_margin<1 or p_margin>99 then return jsonb_build_object('ok',false,'error','Margin must be between 1 and 99.'); end if;
  if length(trim(coalesce(p_reason,'')))<2 then return jsonb_build_object('ok',false,'error','Enter a short reason for the commissioner edit.'); end if;

  select * into v_game from public.family_games where season=v_season and week=v_week and game_id=p_game_id;
  if not found then return jsonb_build_object('ok',false,'error','Game not found.'); end if;
  if v_game.final then return jsonb_build_object('ok',false,'error','A final game cannot be edited.'); end if;
  if p_team not in (v_game.away,v_game.home) then return jsonb_build_object('ok',false,'error','Invalid team for this matchup.'); end if;
  select count(*)=4 into v_all_submitted from public.family_submissions where season=v_season and week=v_week;
  if v_game.kickoff>now() and not v_all_submitted then
    return jsonb_build_object('ok',false,'error','This game is still open. The player can edit their own pick without an override.');
  end if;

  select * into v_old from public.family_picks
    where season=v_season and week=v_week and game_id=p_game_id and player_id=p_target_player_id;
  if not found then return jsonb_build_object('ok',false,'error','There is no saved pick to edit. Use Allow Late Pick for a missed game.'); end if;
  if v_old.team=p_team and v_old.margin=p_margin then return jsonb_build_object('ok',false,'error','That is already the saved pick.'); end if;

  insert into public.family_overrides(
    season,week,game_id,player_id,kind,status,authorized_by,authorized_at,used_at,note,
    old_team,old_margin,new_team,new_margin
  ) values(
    v_season,v_week,p_game_id,p_target_player_id,'commissioner_edit','used',v_admin,now(),now(),trim(p_reason),
    v_old.team,v_old.margin,p_team,p_margin
  );

  update public.family_picks
     set team=p_team,margin=p_margin,late_override=true,updated_at=now()
   where season=v_season and week=v_week and game_id=p_game_id and player_id=p_target_player_id;

  return jsonb_build_object('ok',true);
end;
$$;

create or replace function public.family_mark_week_result_seen(p_token text, p_week integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player text;
  v_season integer;
begin
  v_player:=private.session_player(p_token);
  select season into v_season from public.family_settings order by season desc limit 1;
  if not exists(select 1 from public.family_week_scores where season=v_season and week=p_week) then
    return jsonb_build_object('ok',false,'error','That week has not been scored yet.');
  end if;
  insert into public.family_result_views(season,week,player_id,seen_at)
    values(v_season,p_week,v_player,now())
  on conflict(season,week,player_id) do update set seen_at=now();
  return jsonb_build_object('ok',true);
end;
$$;

revoke execute on function public.family_commissioner_edit_pick(text,text,text,text,integer,text) from public;
revoke execute on function public.family_mark_week_result_seen(text,integer) from public;
grant execute on function public.family_commissioner_edit_pick(text,text,text,text,integer,text) to anon, authenticated;
grant execute on function public.family_mark_week_result_seen(text,integer) to anon, authenticated;

-- Re-grant replaced RPC functions in case earlier grants were altered.
grant execute on function public.family_snapshot(text) to anon, authenticated;
grant execute on function public.family_set_pick(text,text,text,integer) to anon, authenticated;
grant execute on function public.family_submit_week(text) to anon, authenticated;
grant execute on function public.family_authorize_late_pick(text,text,text) to anon, authenticated;
