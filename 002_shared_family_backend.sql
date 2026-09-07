-- Family NFL Picks v0.6 shared backend
-- Run this entire file once in Supabase Dashboard -> SQL Editor.

create extension if not exists pgcrypto;
create schema if not exists private;

create table if not exists public.family_players (
  player_id text primary key,
  display_name text not null,
  is_admin boolean not null default false,
  pin_hash text,
  failed_attempts integer not null default 0,
  lock_until timestamptz,
  created_at timestamptz not null default now()
);

insert into public.family_players(player_id,display_name,is_admin) values
  ('yasin','Yasin',true),
  ('yezan','Yezan',false),
  ('samer','Samer',false),
  ('limar','Limar',false)
on conflict (player_id) do update set display_name=excluded.display_name,is_admin=excluded.is_admin;

create table if not exists public.family_sessions (
  token uuid primary key default gen_random_uuid(),
  player_id text not null references public.family_players(player_id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 days')
);
create index if not exists family_sessions_player_idx on public.family_sessions(player_id);

create table if not exists public.family_settings (
  season integer primary key,
  current_week integer not null default 1,
  prediction_lock_week integer not null default 12,
  updated_at timestamptz not null default now()
);
insert into public.family_settings(season,current_week,prediction_lock_week)
values (2026,1,12)
on conflict (season) do nothing;

create table if not exists public.family_games (
  season integer not null,
  week integer not null,
  game_id text not null,
  away text not null,
  away_name text not null,
  away_record text,
  home text not null,
  home_name text not null,
  home_record text,
  kickoff timestamptz not null,
  status text not null default 'pre',
  final boolean not null default false,
  away_score integer,
  home_score integer,
  round text not null default 'regular',
  updated_at timestamptz not null default now(),
  primary key(season,week,game_id)
);
create index if not exists family_games_week_idx on public.family_games(season,week,kickoff);

create table if not exists public.family_picks (
  season integer not null,
  week integer not null,
  game_id text not null,
  player_id text not null references public.family_players(player_id),
  team text not null,
  margin integer not null check (margin between 1 and 99),
  late_override boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key(season,week,game_id,player_id),
  foreign key(season,week,game_id) references public.family_games(season,week,game_id) on delete cascade
);

create table if not exists public.family_submissions (
  season integer not null,
  week integer not null,
  player_id text not null references public.family_players(player_id),
  submitted_at timestamptz not null default now(),
  primary key(season,week,player_id)
);

create table if not exists public.family_overrides (
  override_id uuid primary key default gen_random_uuid(),
  season integer not null,
  week integer not null,
  game_id text not null,
  player_id text not null references public.family_players(player_id),
  kind text not null default 'late_pick',
  status text not null default 'active' check (status in ('active','used','cancelled')),
  authorized_by text not null references public.family_players(player_id),
  authorized_at timestamptz not null default now(),
  used_at timestamptz,
  note text
);
create index if not exists family_overrides_week_idx on public.family_overrides(season,week,status);

create table if not exists public.family_week_scores (
  season integer not null,
  week integer not null,
  player_id text not null references public.family_players(player_id),
  checks integer not null,
  points integer not null,
  multiplier integer not null,
  scored_at timestamptz not null default now(),
  primary key(season,week,player_id)
);

create table if not exists public.family_predictions (
  season integer not null,
  player_id text not null references public.family_players(player_id),
  conference text[] not null default '{}',
  super_bowl text[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key(season,player_id)
);

-- Do not expose the backing tables through the public Data API.
alter table public.family_players enable row level security;
alter table public.family_sessions enable row level security;
alter table public.family_settings enable row level security;
alter table public.family_games enable row level security;
alter table public.family_picks enable row level security;
alter table public.family_submissions enable row level security;
alter table public.family_overrides enable row level security;
alter table public.family_week_scores enable row level security;
alter table public.family_predictions enable row level security;

revoke all on public.family_players, public.family_sessions, public.family_settings, public.family_games,
  public.family_picks, public.family_submissions, public.family_overrides, public.family_week_scores,
  public.family_predictions from anon, authenticated;

create or replace function private.session_player(p_token text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare v_player text;
begin
  delete from public.family_sessions where expires_at <= now();
  select player_id into v_player
  from public.family_sessions
  where token::text = p_token and expires_at > now();
  if v_player is null then raise exception 'Session expired. Please sign in again.'; end if;
  return v_player;
end;
$$;

create or replace function private.is_admin(p_player text)
returns boolean
language sql
security definer
set search_path = ''
stable
as $$
  select coalesce((select is_admin from public.family_players where player_id=p_player),false)
$$;

create or replace function public.family_login(p_player_id text, p_pin text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.family_players%rowtype;
  v_token uuid;
  v_created boolean := false;
begin
  if p_pin !~ '^\d{4}$' then return jsonb_build_object('ok',false,'error','PIN must be exactly 4 digits.'); end if;
  select * into v from public.family_players where player_id=lower(p_player_id) for update;
  if not found then return jsonb_build_object('ok',false,'error','Player not found.'); end if;
  if v.lock_until is not null and v.lock_until > now() then
    return jsonb_build_object('ok',false,'error','Too many wrong attempts. Try again in a few minutes.');
  end if;

  if v.pin_hash is null then
    update public.family_players
      set pin_hash=extensions.crypt(p_pin,extensions.gen_salt('bf')),failed_attempts=0,lock_until=null
      where player_id=v.player_id;
    v_created := true;
  elsif extensions.crypt(p_pin,v.pin_hash) <> v.pin_hash then
    update public.family_players
      set failed_attempts=failed_attempts+1,
          lock_until=case when failed_attempts+1 >= 6 then now()+interval '5 minutes' else null end
      where player_id=v.player_id;
    return jsonb_build_object('ok',false,'error','Wrong PIN.');
  else
    update public.family_players set failed_attempts=0,lock_until=null where player_id=v.player_id;
  end if;

  delete from public.family_sessions where player_id=v.player_id and expires_at <= now();
  insert into public.family_sessions(player_id) values(v.player_id) returning token into v_token;
  return jsonb_build_object('ok',true,'token',v_token::text,'player_id',v.player_id,'name',v.display_name,'admin',v.is_admin,'created_pin',v_created);
end;
$$;

create or replace function public.family_logout(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.family_sessions where token::text=p_token;
  return jsonb_build_object('ok',true);
end;
$$;

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
  v_admin_submitted boolean;
  v_result jsonb;
begin
  v_player := private.session_player(p_token);
  select season,current_week,prediction_lock_week into v_season,v_week,v_lock_week
    from public.family_settings order by season desc limit 1;
  v_admin := private.is_admin(v_player);
  select count(*)=4 into v_all_submitted from public.family_submissions where season=v_season and week=v_week;
  select exists(select 1 from public.family_submissions where season=v_season and week=v_week and player_id=v_player)
    into v_admin_submitted;

  select jsonb_build_object(
    'season',v_season,
    'currentWeek',v_week,
    'predictionLockWeek',v_lock_week,
    'serverNow',now(),
    'viewer',(select jsonb_build_object('id',player_id,'name',display_name,'admin',is_admin) from public.family_players where player_id=v_player),
    'players',(select coalesce(jsonb_agg(jsonb_build_object('id',player_id,'name',display_name,'admin',is_admin) order by case player_id when 'yasin' then 1 when 'yezan' then 2 when 'samer' then 3 else 4 end),'[]'::jsonb) from public.family_players),
    'games',(select coalesce(jsonb_agg(jsonb_build_object(
      'id',game_id,'away',away,'awayName',away_name,'awayRecord',coalesce(away_record,''),
      'home',home,'homeName',home_name,'homeRecord',coalesce(home_record,''),
      'kickoff',kickoff,'status',status,'final',final,'awayScore',away_score,'homeScore',home_score,'round',round
    ) order by kickoff),'[]'::jsonb) from public.family_games where season=v_season and week=v_week),
    'visiblePicks',(select coalesce(jsonb_agg(jsonb_build_object(
      'gameId',p.game_id,'playerId',p.player_id,'team',p.team,'margin',p.margin,'lateOverride',p.late_override,'updatedAt',p.updated_at
    )),'[]'::jsonb)
      from public.family_picks p
      join public.family_games g on g.season=p.season and g.week=p.week and g.game_id=p.game_id
      where p.season=v_season and p.week=v_week
        and (p.player_id=v_player or (v_admin and v_admin_submitted) or ((not v_admin) and (v_all_submitted or g.kickoff<=now())))),
    'submissions',(select coalesce(jsonb_agg(jsonb_build_object('playerId',player_id,'submittedAt',submitted_at)),'[]'::jsonb)
      from public.family_submissions where season=v_season and week=v_week),
    'standings',(select coalesce(jsonb_agg(jsonb_build_object('playerId',fp.player_id,'name',fp.display_name,'total',coalesce(t.total,0)) order by coalesce(t.total,0) desc, fp.display_name),'[]'::jsonb)
      from public.family_players fp
      left join (select player_id,sum(points)::int total from public.family_week_scores where season=v_season group by player_id) t using(player_id)),
    'currentScores',(select coalesce(jsonb_agg(jsonb_build_object('playerId',player_id,'checks',checks,'points',points,'multiplier',multiplier,'scoredAt',scored_at)),'[]'::jsonb)
      from public.family_week_scores where season=v_season and week=v_week),
    'overrides',jsonb_build_object(
      'count',(select count(*) from public.family_overrides where season=v_season and week=v_week and kind in ('late_pick','commissioner_edit') and status<>'cancelled'),
      'activeForViewer',(select coalesce(jsonb_agg(jsonb_build_object('id',override_id,'gameId',game_id,'playerId',player_id,'kind',kind,'authorizedAt',authorized_at)),'[]'::jsonb)
        from public.family_overrides where season=v_season and week=v_week and player_id=v_player and status='active'),
      'all',(case when v_admin then (select coalesce(jsonb_agg(jsonb_build_object('id',override_id,'gameId',game_id,'playerId',player_id,'kind',kind,'status',status,'authorizedAt',authorized_at,'usedAt',used_at) order by authorized_at desc),'[]'::jsonb)
        from public.family_overrides where season=v_season and week=v_week) else '[]'::jsonb end)
    ),
    'predictions',(select coalesce(jsonb_build_object('conference',conference,'superBowl',super_bowl),jsonb_build_object('conference','[]'::jsonb,'superBowl','[]'::jsonb)) from public.family_predictions where season=v_season and player_id=v_player),
    'history',(select coalesce(jsonb_agg(h.item order by (h.item->>'week')::int desc),'[]'::jsonb) from (
      select jsonb_build_object(
        'week',ws.week,
        'multiplier',max(ws.multiplier),
        'scoredAt',max(ws.scored_at),
        'scores',(select jsonb_agg(jsonb_build_object('playerId',s2.player_id,'checks',s2.checks,'points',s2.points) order by s2.player_id) from public.family_week_scores s2 where s2.season=v_season and s2.week=ws.week),
        'overrideCount',(select count(*) from public.family_overrides o where o.season=v_season and o.week=ws.week and o.kind in ('late_pick','commissioner_edit') and o.status<>'cancelled'),
        'games',(select coalesce(jsonb_agg(jsonb_build_object(
          'id',g.game_id,'away',g.away,'awayName',g.away_name,'awayScore',g.away_score,
          'home',g.home,'homeName',g.home_name,'homeScore',g.home_score,'final',g.final,'kickoff',g.kickoff,
          'picks',(select coalesce(jsonb_agg(jsonb_build_object('playerId',p.player_id,'team',p.team,'margin',p.margin,'lateOverride',p.late_override)),'[]'::jsonb) from public.family_picks p where p.season=g.season and p.week=g.week and p.game_id=g.game_id)
        ) order by g.kickoff),'[]'::jsonb) from public.family_games g where g.season=v_season and g.week=ws.week)
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
  v_override boolean;
begin
  v_player := private.session_player(p_token);
  if p_margin is null or p_margin < 1 or p_margin > 99 then return jsonb_build_object('ok',false,'error','Margin must be between 1 and 99.'); end if;
  select season,current_week into v_season,v_week from public.family_settings order by season desc limit 1;
  select * into v_game from public.family_games where season=v_season and week=v_week and game_id=p_game_id;
  if not found then return jsonb_build_object('ok',false,'error','Game not found. Refresh the schedule.'); end if;
  if p_team not in (v_game.away,v_game.home) then return jsonb_build_object('ok',false,'error','Invalid team for this matchup.'); end if;
  if v_game.final then return jsonb_build_object('ok',false,'error','This game is already final.'); end if;
  select count(*)=4 into v_all_submitted from public.family_submissions where season=v_season and week=v_week;
  select exists(select 1 from public.family_overrides where season=v_season and week=v_week and game_id=p_game_id and player_id=v_player and status='active' and kind='late_pick') into v_override;
  if (v_all_submitted or v_game.kickoff <= now()) and not v_override then
    return jsonb_build_object('ok',false,'error','This game is locked. Yasin must authorize a late-pick override.');
  end if;
  insert into public.family_picks(season,week,game_id,player_id,team,margin,late_override,updated_at)
    values(v_season,v_week,p_game_id,v_player,p_team,p_margin,v_override,now())
  on conflict(season,week,game_id,player_id) do update
    set team=excluded.team,margin=excluded.margin,late_override=(public.family_picks.late_override or excluded.late_override),updated_at=now();
  return jsonb_build_object('ok',true,'lateOverride',v_override);
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
  select count(*) into v_picks from public.family_picks where season=v_season and week=v_week and player_id=v_player and team is not null and margin between 1 and 99;
  if v_games=0 then return jsonb_build_object('ok',false,'error','No games are loaded yet.'); end if;
  if v_picks<>v_games then return jsonb_build_object('ok',false,'error',format('You have %s of %s complete picks.',v_picks,v_games)); end if;
  if exists(
    select 1 from public.family_overrides o join public.family_games g using(season,week,game_id)
    where o.season=v_season and o.week=v_week and o.player_id=v_player and o.status='active' and g.final
  ) then return jsonb_build_object('ok',false,'error','A late-pick override expired because that game is already final. Ask Yasin for help.'); end if;

  insert into public.family_submissions(season,week,player_id,submitted_at) values(v_season,v_week,v_player,now())
    on conflict(season,week,player_id) do update set submitted_at=now();
  update public.family_overrides set status='used',used_at=now()
    where season=v_season and week=v_week and player_id=v_player and status='active' and kind='late_pick';
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
begin
  v_admin := private.session_player(p_token);
  if not private.is_admin(v_admin) then return jsonb_build_object('ok',false,'error','Commissioner access required.'); end if;
  select season,current_week into v_season,v_week from public.family_settings order by season desc limit 1;
  if p_target_player_id<>v_admin and not exists(select 1 from public.family_submissions where season=v_season and week=v_week and player_id=v_admin) then
    return jsonb_build_object('ok',false,'error','You must submit your own picks before authorizing another player''s late pick.');
  end if;
  if not exists(select 1 from public.family_players where player_id=p_target_player_id) then return jsonb_build_object('ok',false,'error','Player not found.'); end if;
  select * into v_game from public.family_games where season=v_season and week=v_week and game_id=p_game_id;
  if not found then return jsonb_build_object('ok',false,'error','Game not found.'); end if;
  if v_game.kickoff > now() then return jsonb_build_object('ok',false,'error','The game is still open; no override is needed.'); end if;
  if v_game.final then return jsonb_build_object('ok',false,'error','The game is already final and cannot be reopened.'); end if;
  if exists(select 1 from public.family_picks where season=v_season and week=v_week and game_id=p_game_id and player_id=p_target_player_id) then
    return jsonb_build_object('ok',false,'error','That player already has a saved pick for this game. Use commissioner edit in a later version if a correction is needed.');
  end if;
  select override_id into v_id from public.family_overrides
    where season=v_season and week=v_week and game_id=p_game_id and player_id=p_target_player_id and status='active' and kind='late_pick' limit 1;
  if v_id is null then
    insert into public.family_overrides(season,week,game_id,player_id,kind,status,authorized_by)
      values(v_season,v_week,p_game_id,p_target_player_id,'late_pick','active',v_admin) returning override_id into v_id;
  end if;
  return jsonb_build_object('ok',true,'overrideId',v_id::text);
end;
$$;

create or replace function public.family_cancel_late_pick(p_token text, p_override_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_admin text;
begin
  v_admin:=private.session_player(p_token);
  if not private.is_admin(v_admin) then return jsonb_build_object('ok',false,'error','Commissioner access required.'); end if;
  update public.family_overrides set status='cancelled' where override_id::text=p_override_id and status='active';
  return jsonb_build_object('ok',true);
end;
$$;

create or replace function public.family_reset_player_pin(p_token text, p_target_player_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_admin text;
begin
  v_admin:=private.session_player(p_token);
  if not private.is_admin(v_admin) then return jsonb_build_object('ok',false,'error','Commissioner access required.'); end if;
  if not exists(select 1 from public.family_players where player_id=p_target_player_id) then return jsonb_build_object('ok',false,'error','Player not found.'); end if;
  update public.family_players set pin_hash=null,failed_attempts=0,lock_until=null where player_id=p_target_player_id;
  delete from public.family_sessions where player_id=p_target_player_id;
  return jsonb_build_object('ok',true);
end;
$$;

create or replace function public.family_save_predictions(p_token text, p_conference text[], p_super_bowl text[])
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_player text; v_season integer; v_week integer; v_lock integer;
begin
  v_player:=private.session_player(p_token);
  select season,current_week,prediction_lock_week into v_season,v_week,v_lock from public.family_settings order by season desc limit 1;
  if v_week>v_lock then return jsonb_build_object('ok',false,'error','Predictions are locked after Week 12.'); end if;
  if coalesce(array_length(p_conference,1),0)<>4 then return jsonb_build_object('ok',false,'error','Choose exactly 4 Conference Championship teams.'); end if;
  if coalesce(array_length(p_super_bowl,1),0)<>2 then return jsonb_build_object('ok',false,'error','Choose exactly 2 Super Bowl teams.'); end if;
  insert into public.family_predictions(season,player_id,conference,super_bowl,updated_at)
    values(v_season,v_player,p_conference,p_super_bowl,now())
  on conflict(season,player_id) do update set conference=excluded.conference,super_bowl=excluded.super_bowl,updated_at=now();
  return jsonb_build_object('ok',true);
end;
$$;

create or replace function public.family_sync_games(p_token text, p_games jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_player text;
  v_season integer;
  v_week integer;
  x jsonb;
  v_count integer:=0;
begin
  v_player:=private.session_player(p_token);
  select season,current_week into v_season,v_week from public.family_settings order by season desc limit 1;
  if jsonb_typeof(p_games)<>'array' then return jsonb_build_object('ok',false,'error','Games payload must be an array.'); end if;
  for x in select value from jsonb_array_elements(p_games)
  loop
    if coalesce(x->>'id','')='' or coalesce(x->>'away','')='' or coalesce(x->>'home','')='' or coalesce(x->>'kickoff','')='' then continue; end if;
    insert into public.family_games(season,week,game_id,away,away_name,away_record,home,home_name,home_record,kickoff,status,final,away_score,home_score,round,updated_at)
    values(
      v_season,v_week,x->>'id',x->>'away',coalesce(x->>'awayName',x->>'away'),coalesce(x->>'awayRecord',''),
      x->>'home',coalesce(x->>'homeName',x->>'home'),coalesce(x->>'homeRecord',''),(x->>'kickoff')::timestamptz,
      coalesce(x->>'status','pre'),coalesce((x->>'final')::boolean,false),
      case when nullif(x->>'awayScore','') is null then null else (x->>'awayScore')::int end,
      case when nullif(x->>'homeScore','') is null then null else (x->>'homeScore')::int end,
      coalesce(x->>'round','regular'),now()
    )
    on conflict(season,week,game_id) do update set
      away=excluded.away,away_name=excluded.away_name,away_record=excluded.away_record,
      home=excluded.home,home_name=excluded.home_name,home_record=excluded.home_record,
      kickoff=excluded.kickoff,status=excluded.status,final=excluded.final,away_score=excluded.away_score,home_score=excluded.home_score,updated_at=now();
    v_count:=v_count+1;
  end loop;
  return jsonb_build_object('ok',true,'games',v_count);
end;
$$;

create or replace function public.family_try_score_week(p_token text)
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
  v_finals integer;
  v_multiplier integer;
  v_round text;
begin
  v_player:=private.session_player(p_token);
  select season,current_week into v_season,v_week from public.family_settings order by season desc limit 1;
  if exists(select 1 from public.family_week_scores where season=v_season and week=v_week) then
    return jsonb_build_object('ok',true,'status','already-scored');
  end if;
  select count(*),count(*) filter(where final) into v_games,v_finals from public.family_games where season=v_season and week=v_week;
  if v_games=0 or v_games<>v_finals then return jsonb_build_object('ok',true,'status','not-ready','finals',v_finals,'games',v_games); end if;
  select coalesce(max(round),'regular') into v_round from public.family_games where season=v_season and week=v_week;
  if v_round='superbowl' then return jsonb_build_object('ok',true,'status','superbowl-special'); end if;
  v_multiplier:=case when v_round in ('wildcard','divisional') then 2 when v_round='conference' then 3 else 1 end;

  insert into public.family_week_scores(season,week,player_id,checks,points,multiplier,scored_at)
  with gi as (
    select game_id,
      case when home_score>away_score then home when away_score>home_score then away else null end winner,
      abs(coalesce(home_score,0)-coalesce(away_score,0)) actual_margin
    from public.family_games where season=v_season and week=v_week and final
  ),
  wp as (
    select p.player_id,p.game_id,p.margin,gi.actual_margin,
      count(*) over(partition by p.game_id) correct_count,
      abs(p.margin-gi.actual_margin) diff
    from public.family_picks p join gi on gi.game_id=p.game_id and gi.winner is not null and p.team=gi.winner
    where p.season=v_season and p.week=v_week
  ),
  md as (select game_id,min(diff) min_diff from wp group by game_id),
  lm as (
    select wp.game_id,min(wp.margin) lower_margin
    from wp join md on md.game_id=wp.game_id and wp.diff=md.min_diff
    group by wp.game_id
  ),
  awarded as (
    select wp.player_id,wp.game_id
    from wp left join md using(game_id) left join lm using(game_id)
    where wp.correct_count<3 or (wp.diff=md.min_diff and wp.margin=lm.lower_margin)
  ),
  counts as (
    select fp.player_id,count(a.game_id)::int checks
    from public.family_players fp left join awarded a on a.player_id=fp.player_id
    group by fp.player_id
  ),
  mn as (select min(checks) min_checks from counts)
  select v_season,v_week,c.player_id,c.checks,(c.checks-mn.min_checks)*v_multiplier,v_multiplier,now()
  from counts c cross join mn;

  return jsonb_build_object('ok',true,'status','scored','multiplier',v_multiplier);
end;
$$;

create or replace function public.family_set_current_week(p_token text, p_week integer, p_round text default 'regular')
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_admin text; v_season integer;
begin
  v_admin:=private.session_player(p_token);
  if not private.is_admin(v_admin) then return jsonb_build_object('ok',false,'error','Commissioner access required.'); end if;
  if p_week<1 or p_week>30 then return jsonb_build_object('ok',false,'error','Invalid week.'); end if;
  select season into v_season from public.family_settings order by season desc limit 1;
  update public.family_settings set current_week=p_week,updated_at=now() where season=v_season;
  update public.family_games set round=coalesce(nullif(p_round,''),'regular') where season=v_season and week=p_week;
  return jsonb_build_object('ok',true,'week',p_week);
end;
$$;

-- Only our RPC functions are callable from the browser key.
revoke execute on function public.family_login(text,text) from public;
revoke execute on function public.family_logout(text) from public;
revoke execute on function public.family_snapshot(text) from public;
revoke execute on function public.family_set_pick(text,text,text,integer) from public;
revoke execute on function public.family_submit_week(text) from public;
revoke execute on function public.family_authorize_late_pick(text,text,text) from public;
revoke execute on function public.family_cancel_late_pick(text,text) from public;
revoke execute on function public.family_reset_player_pin(text,text) from public;
revoke execute on function public.family_save_predictions(text,text[],text[]) from public;
revoke execute on function public.family_sync_games(text,jsonb) from public;
revoke execute on function public.family_try_score_week(text) from public;
revoke execute on function public.family_set_current_week(text,integer,text) from public;

grant execute on function public.family_login(text,text) to anon, authenticated;
grant execute on function public.family_logout(text) to anon, authenticated;
grant execute on function public.family_snapshot(text) to anon, authenticated;
grant execute on function public.family_set_pick(text,text,text,integer) to anon, authenticated;
grant execute on function public.family_submit_week(text) to anon, authenticated;
grant execute on function public.family_authorize_late_pick(text,text,text) to anon, authenticated;
grant execute on function public.family_cancel_late_pick(text,text) to anon, authenticated;
grant execute on function public.family_reset_player_pin(text,text) to anon, authenticated;
grant execute on function public.family_save_predictions(text,text[],text[]) to anon, authenticated;
grant execute on function public.family_sync_games(text,jsonb) to anon, authenticated;
grant execute on function public.family_try_score_week(text) to anon, authenticated;
grant execute on function public.family_set_current_week(text,integer,text) to anon, authenticated;
