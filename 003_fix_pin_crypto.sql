-- Family NFL Picks hotfix: qualify pgcrypto functions inside family_login.
-- Run this once in Supabase Dashboard -> SQL Editor.

create extension if not exists pgcrypto with schema extensions;

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
  if p_pin !~ '^\d{4}$' then
    return jsonb_build_object('ok',false,'error','PIN must be exactly 4 digits.');
  end if;

  select * into v
  from public.family_players
  where player_id=lower(p_player_id)
  for update;

  if not found then
    return jsonb_build_object('ok',false,'error','Player not found.');
  end if;

  if v.lock_until is not null and v.lock_until > now() then
    return jsonb_build_object('ok',false,'error','Too many wrong attempts. Try again in a few minutes.');
  end if;

  if v.pin_hash is null then
    update public.family_players
      set pin_hash=extensions.crypt(p_pin,extensions.gen_salt('bf')),
          failed_attempts=0,
          lock_until=null
      where player_id=v.player_id;
    v_created := true;
  elsif extensions.crypt(p_pin,v.pin_hash) <> v.pin_hash then
    update public.family_players
      set failed_attempts=failed_attempts+1,
          lock_until=case when failed_attempts+1 >= 6 then now()+interval '5 minutes' else null end
      where player_id=v.player_id;
    return jsonb_build_object('ok',false,'error','Wrong PIN.');
  else
    update public.family_players
      set failed_attempts=0,lock_until=null
      where player_id=v.player_id;
  end if;

  delete from public.family_sessions
  where player_id=v.player_id and expires_at <= now();

  insert into public.family_sessions(player_id)
  values(v.player_id)
  returning token into v_token;

  return jsonb_build_object(
    'ok',true,
    'token',v_token::text,
    'player_id',v.player_id,
    'name',v.display_name,
    'admin',v.is_admin,
    'created_pin',v_created
  );
end;
$$;

grant execute on function public.family_login(text,text) to anon, authenticated;
