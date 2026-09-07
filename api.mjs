const cfg = window.APP_CONFIG || {};
const base = String(cfg.supabaseUrl || '').replace(/\/$/, '');
const key = String(cfg.supabasePublishableKey || '').trim();

export function isConfigured(){ return Boolean(base && key); }

async function rpc(name, body={}){
  if(!isConfigured()) throw new Error('Supabase is not configured.');
  const r = await fetch(`${base}/rest/v1/rpc/${name}`, {
    method:'POST',
    headers:{
      'content-type':'application/json',
      'apikey': key,
      'authorization': `Bearer ${key}`
    },
    body: JSON.stringify(body)
  });
  const text = await r.text();
  let data = null;
  try{ data = text ? JSON.parse(text) : null; }catch{ data = text; }
  if(!r.ok){
    const msg = data?.message || data?.error || data?.hint || text || `HTTP ${r.status}`;
    const err = new Error(msg);
    err.status = r.status;
    err.payload = data;
    throw err;
  }
  return data;
}

export const backend = {
  login(playerId, pin){ return rpc('family_login', {p_player_id:playerId, p_pin:pin}); },
  logout(token){ return rpc('family_logout', {p_token:token}); },
  snapshot(token){ return rpc('family_snapshot', {p_token:token}); },
  setPick(token, gameId, team, margin){ return rpc('family_set_pick', {p_token:token,p_game_id:gameId,p_team:team,p_margin:Number(margin)}); },
  submitWeek(token){ return rpc('family_submit_week', {p_token:token}); },
  savePredictions(token, conference, superBowl){ return rpc('family_save_predictions',{p_token:token,p_conference:conference,p_super_bowl:superBowl}); },
  authorizeLatePick(token, targetPlayerId, gameId){ return rpc('family_authorize_late_pick',{p_token:token,p_target_player_id:targetPlayerId,p_game_id:gameId}); },
  cancelLatePick(token, overrideId){ return rpc('family_cancel_late_pick',{p_token:token,p_override_id:overrideId}); },
  resetPin(token, targetPlayerId){ return rpc('family_reset_player_pin',{p_token:token,p_target_player_id:targetPlayerId}); },
  syncGames(token, games){ return rpc('family_sync_games',{p_token:token,p_games:games}); },
  tryScore(token){ return rpc('family_try_score_week',{p_token:token}); },
  setWeek(token, week, round='regular'){ return rpc('family_set_current_week',{p_token:token,p_week:Number(week),p_round:round}); },
};
