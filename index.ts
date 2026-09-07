import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors={
  'Access-Control-Allow-Origin':Deno.env.get('ALLOWED_ORIGIN')||'*',
  'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type',
};
const esc=(s:unknown)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]||c));

function reportHtml(r:any){
  const games=(r.games||[]).map((g:any)=>`<div style="border:1px solid #ddd;border-radius:10px;padding:12px;margin:10px 0"><b>${esc(g.awayName)} ${g.awayScore} — ${g.homeScore} ${esc(g.homeName)}</b><div style="color:#666;margin:4px 0 8px">Winner: ${g.winner?esc(g.winner):'NFL tie / no winner'}</div>${(g.picks||[]).map((p:any)=>`<div>${esc(p.playerName)} — ${p.team?`${esc(p.team)} by ${esc(p.margin)}`:'No pick'} ${p.check?'✅':''}${p.override?' ⚠️':''}</div>`).join('')}</div>`).join('');
  const weekly=(r.weekly||[]).map((x:any)=>`<tr><td>${esc(x.playerName)}</td><td align="right">${x.checks}</td><td align="right">+${x.points}</td><td align="right"><b>${x.total}</b></td></tr>`).join('');
  const leaders=(r.leaderboard||[]).map((x:any,i:number)=>`<tr><td>${i+1}</td><td>${esc(x.playerName)}</td><td align="right"><b>${x.total}</b></td></tr>`).join('');
  const overrides=(r.overrides||[]).length?`<h2>Commissioner overrides</h2>${(r.overrides||[]).map((o:any)=>`<div style="border-left:4px solid #f59e0b;padding:8px 10px;margin:8px 0"><b>${esc(o.playerId)} — ${esc(o.kind==='commissioner_edit'?'Commissioner Edit':'Late Pick')}</b><br>${o.kind==='commissioner_edit'&&o.oldTeam?`${esc(o.oldTeam)} by ${esc(o.oldMargin)} → ${esc(o.newTeam)} by ${esc(o.newMargin)}`:o.newTeam?`${esc(o.newTeam)} by ${esc(o.newMargin)}`:esc(o.status)}${o.note?`<br>Reason: ${esc(o.note)}`:''}</div>`).join('')}`:'';
  return `<html><body style="font-family:Arial,sans-serif;max-width:760px;margin:auto;padding:20px;color:#111827"><h1>🏈 Family NFL Picks — Week ${r.week}</h1><p>${r.season} season · ${r.overrideCount||0} commissioner override${Number(r.overrideCount||0)===1?'':'s'}</p><h2>Weekly results</h2><table width="100%" cellpadding="7"><tr><th align="left">Player</th><th align="right">Checks</th><th align="right">Week points</th><th align="right">Season total</th></tr>${weekly}</table><h2>Every game</h2>${games}${overrides}<h2>Leaderboard</h2><table width="100%" cellpadding="7"><tr><th align="left">#</th><th align="left">Player</th><th align="right">Total</th></tr>${leaders}</table></body></html>`;
}

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  if(req.method!=='POST')return new Response('Method not allowed',{status:405,headers:cors});
  try{
    const payload=await req.json();
    const report=payload?.report||payload;
    const season=Number(payload?.season??report?.season),week=Number(payload?.week??report?.week);
    if(!Number.isInteger(season)||!Number.isInteger(week)||week<1||week>30||!Array.isArray(report?.games)||!Array.isArray(report?.leaderboard)){
      return new Response(JSON.stringify({error:'invalid report'}),{status:400,headers:{...cors,'content-type':'application/json'}});
    }
    const url=Deno.env.get('SUPABASE_URL')!,service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,resendKey=Deno.env.get('RESEND_API_KEY')!,recipient=Deno.env.get('REPORT_RECIPIENT')!,from=Deno.env.get('REPORT_FROM')||'Family NFL Picks <onboarding@resend.dev>';
    if(!url||!service||!resendKey||!recipient)throw new Error('Missing backend secrets');
    const supabase=createClient(url,service);

    const {count}=await supabase.from('family_week_scores').select('*',{count:'exact',head:true}).eq('season',season).eq('week',week);
    if(count!==4)return new Response(JSON.stringify({error:'week is not fully scored'}),{status:409,headers:{...cors,'content-type':'application/json'}});
    const {data:existing}=await supabase.from('weekly_report_delivery').select('sent_at,provider_id').eq('season',season).eq('week',week).maybeSingle();
    if(existing?.sent_at)return new Response(JSON.stringify({ok:true,deduped:true,id:existing.provider_id}),{headers:{...cors,'content-type':'application/json'}});
    await supabase.from('weekly_report_delivery').upsert({season,week,payload:report},{onConflict:'season,week'});

    const rr=await fetch('https://api.resend.com/emails',{method:'POST',headers:{authorization:`Bearer ${resendKey}`,'content-type':'application/json'},body:JSON.stringify({from,to:[recipient],subject:`Family NFL Picks — Week ${week} Report`,html:reportHtml(report)})});
    const out=await rr.json();if(!rr.ok)throw new Error(out?.message||`Resend HTTP ${rr.status}`);
    await supabase.from('weekly_report_delivery').update({sent_at:new Date().toISOString(),provider_id:out.id}).eq('season',season).eq('week',week);
    return new Response(JSON.stringify({ok:true,id:out.id}),{headers:{...cors,'content-type':'application/json'}});
  }catch(e){return new Response(JSON.stringify({error:String(e?.message||e)}),{status:500,headers:{...cors,'content-type':'application/json'}});}
});
