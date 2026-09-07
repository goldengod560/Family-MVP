import { PLAYERS, resolveGameChecks } from './logic.mjs';
import { backend, isConfigured } from './api.mjs';

const SESSION_KEY='family-nfl-session-v06';
let session=loadSession();
let state=null;
let screen='home';
let historyWeek=null;
let drafts={};
let busy=false;
let lastScheduleSource='Supabase';

function loadSession(){try{return JSON.parse(localStorage.getItem(SESSION_KEY)||'null')}catch{return null}}
function saveSession(){if(session)localStorage.setItem(SESSION_KEY,JSON.stringify(session));else localStorage.removeItem(SESSION_KEY)}
function viewer(){return state?.viewer||null}
function playerById(id){return (state?.players||PLAYERS).find(p=>p.id===id)}
function esc(s=''){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function fmtKickoff(s){return new Date(s).toLocaleString([], {weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}
function allSubmitted(){return (state?.submissions||[]).length===4}
function submitted(id){return Boolean((state?.submissions||[]).find(x=>x.playerId===id))}
function gameById(id){return (state?.games||[]).find(g=>g.id===id)}
function visiblePick(playerId,gameId){return (state?.visiblePicks||[]).find(x=>x.playerId===playerId&&x.gameId===gameId)}
function ownPick(gameId){return visiblePick(viewer()?.id,gameId)}
function activeOverride(gameId){return (state?.overrides?.activeForViewer||[]).find(o=>o.gameId===gameId)}
function isGameLocked(g){
  if(g.final) return true;
  const baseLocked=allSubmitted() || Date.now()>=new Date(g.kickoff).getTime();
  return baseLocked && !activeOverride(g.id);
}
function revealedForPlayers(g){return allSubmitted() || Date.now()>=new Date(g.kickoff).getTime()}
function currentWeekScored(){return Array.isArray(state?.currentScores)&&state.currentScores.length>0}
function finalCount(){return (state?.games||[]).filter(g=>g.final).length}
function currentTotals(){return Object.fromEntries((state?.standings||[]).map(x=>[x.playerId,Number(x.total||0)]))}

function toast(msg){alert(msg)}
function setBusy(v){busy=v;render()}

async function loadSnapshot(){
  if(!session?.token) return;
  try{
    state=await backend.snapshot(session.token);
    if(!state?.viewer) throw new Error('Invalid session.');
    session.playerId=state.viewer.id;saveSession();
    hydrateDrafts();
  }catch(e){
    if(String(e.message||'').toLowerCase().includes('session')){session=null;saveSession();state=null;screen='home';}
    else throw e;
  }
}
function hydrateDrafts(){
  for(const g of state?.games||[]){
    const p=ownPick(g.id);
    drafts[g.id]={team:p?.team||drafts[g.id]?.team||'',margin:p?.margin??drafts[g.id]?.margin??''};
  }
}

async function fetchEspnGames(){
  const season=state?.season||2026, week=state?.currentWeek||1;
  const url=`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${season}&seasontype=2&week=${week}`;
  const r=await fetch(url,{cache:'no-store'});
  if(!r.ok) throw new Error('NFL schedule could not be loaded.');
  const d=await r.json();
  if(!Array.isArray(d.events)||!d.events.length) throw new Error('No NFL games returned for this week.');
  return d.events.map(e=>{
    const c=e.competitions?.[0], comps=c?.competitors||[];
    const h=comps.find(x=>x.homeAway==='home'), a=comps.find(x=>x.homeAway==='away');
    const status=e.status?.type?.state||'pre';
    const final=Boolean(e.status?.type?.completed||status==='post');
    return {
      id:String(e.id),away:a?.team?.abbreviation||'AWY',awayName:a?.team?.displayName||'Away',awayRecord:a?.records?.find(r=>r.type==='total')?.summary||a?.records?.[0]?.summary||'',
      home:h?.team?.abbreviation||'HME',homeName:h?.team?.displayName||'Home',homeRecord:h?.records?.find(r=>r.type==='total')?.summary||h?.records?.[0]?.summary||'',
      kickoff:e.date,status,final,awayScore:a?.score==null?null:Number(a.score),homeScore:h?.score==null?null:Number(h.score),round:'regular'
    };
  });
}

async function syncSchedule({quiet=false}={}){
  if(!session?.token||!state) return;
  try{
    const games=await fetchEspnGames();
    await backend.syncGames(session.token,games);
    await backend.tryScore(session.token);
    lastScheduleSource='NFL live feed';
    await loadSnapshot();
    if(!quiet) toast('NFL schedule, records, and scores refreshed.');
  }catch(e){
    lastScheduleSource='Last saved schedule';
    if(!quiet) toast(`Schedule refresh failed: ${e.message}`);
  }
  render();
}

async function refreshAll({sync=true,quiet=true}={}){
  if(!session?.token) return render();
  try{
    await loadSnapshot();
    if(sync) await syncSchedule({quiet});
  }catch(e){toast(e.message||String(e));}
  render();
}

function shell(content,active='home'){
  const u=viewer();
  const backendLabel=isConfigured()?'Shared online':'Not connected';
  return `<div class="shell"><div class="topbar"><div><div class="brand">🏈 Family NFL Picks</div><div class="sub">${state?.season||2026} Season · Week ${state?.currentWeek||1} · v0.6 · ${backendLabel}</div></div>${u?`<button class="btn secondary" data-act="logout">${esc(u.name)} ↗</button>`:''}</div>${content}</div>${u?`<div class="nav"><div class="nav-inner"><button data-nav="picks" class="${active==='picks'?'active':''}">Picks</button><button data-nav="standings" class="${active==='standings'?'active':''}">Standings</button><button data-nav="history" class="${active==='history'?'active':''}">History</button><button data-nav="predictions" class="${active==='predictions'?'active':''}">Predictions</button><button data-nav="commissioner" class="${active==='commissioner'?'active':''}">${u.admin?'Commish':'Status'}</button></div></div>`:''}`;
}

function renderHome(){
  const warn=!isConfigured()?`<div class="notice warn">Supabase is not configured yet.</div>`:'';
  return shell(`<div class="card"><div class="title">Who’s picking?</div><p class="sub">Choose your name and enter your 4-digit PIN. On your first login, that PIN becomes your code.</p><div class="grid">${PLAYERS.map(p=>`<button class="player ${p.admin?'admin':''}" data-player="${p.id}" ${busy?'disabled':''}>${p.name}</button>`).join('')}</div></div>${warn}<div class="notice"><b>v0.6 shared mode:</b> picks, submissions, standings, History, and late-pick overrides are stored in the same online database for all four phones.</div>`);
}

function revealedBlock(g){
  if(!revealedForPlayers(g)) return '';
  const rows=PLAYERS.map(p=>{const x=visiblePick(p.id,g.id);return `<div class="row between" style="margin-top:6px"><span>${p.name}</span><b>${x?`${esc(x.team)} by ${x.margin}`:'No pick'}</b></div>`}).join('');
  return `<div class="divider"></div><div class="tiny"><b>Revealed picks</b></div>${rows}`;
}

function renderPicks(){
  const u=viewer(),games=state?.games||[];
  if(!games.length) return shell(`<div class="row between"><div><div class="title">Week ${state.currentWeek} Picks</div><div class="sub">No games loaded yet.</div></div><button class="btn secondary" data-act="refresh-schedule">↻ Schedule</button></div><div class="notice">Press Schedule to load this week's NFL games.</div>`,'picks');
  const cards=games.map(g=>{
    const p=ownPick(g.id),d=drafts[g.id]||{team:p?.team||'',margin:p?.margin||''};
    const locked=isGameLocked(g),ov=activeOverride(g.id);
    const liveLine=g.final?`<div class="tiny" style="margin-top:10px">FINAL · ${g.away} ${g.awayScore} · ${g.home} ${g.homeScore}</div>`:(g.status==='in'&&Number.isFinite(Number(g.awayScore))&&Number.isFinite(Number(g.homeScore))?`<div class="tiny" style="margin-top:10px">LIVE · ${g.away} ${g.awayScore} · ${g.home} ${g.homeScore}</div>`:'');
    const status=ov?'⚠️ OVERRIDE OPEN':locked?'🔒 LOCKED':'OPEN';
    const rec=(name,abbr,record)=>`${esc(name)}<br><span class="tiny">${esc(abbr)}${record?` · ${esc(record)}`:''}</span>`;
    return `<div class="game ${locked?'lock':''}"><div class="game-head"><span>${fmtKickoff(g.kickoff)}</span><span>${status}</span></div>${ov?`<div class="notice warn" style="margin:8px 0">Yasin reopened this game for your late pick. It locks again when you submit your week.</div>`:''}<div class="teams"><button class="team ${d.team===g.away?'selected':''}" data-pick="${g.id}|${g.away}" ${locked||busy?'disabled':''}>${rec(g.awayName,g.away,g.awayRecord)}</button><button class="team ${d.team===g.home?'selected':''}" data-pick="${g.id}|${g.home}" ${locked||busy?'disabled':''}>${rec(g.homeName,g.home,g.homeRecord)}</button></div><div class="margin-wrap"><span><b>Winning margin</b><br><span class="tiny">Always enter it; ignored when not needed.</span></span><input class="margin" type="number" min="1" max="99" inputmode="numeric" data-margin="${g.id}" value="${esc(d.margin)}" ${locked||busy?'disabled':''}></div>${liveLine}${revealedBlock(g)}</div>`;
  }).join('');
  const complete=games.every(g=>{const p=ownPick(g.id);return p?.team&&Number(p.margin)>0});
  return shell(`<div class="row between"><div><div class="title">Week ${state.currentWeek} Picks</div><div class="sub">${games.length} games · ${lastScheduleSource}</div></div><button class="btn secondary" data-act="refresh-schedule" ${busy?'disabled':''}>↻ Schedule</button></div>${submitted(u.id)?`<div class="notice">Submitted ✓ ${allSubmitted()?'Everyone is in, so all games are locked.':'Future games can still be updated until kickoff or until everyone submits.'}</div>`:''}${cards}<button class="btn" data-act="submit-week" ${!complete||busy?'disabled':''}>${submitted(u.id)?'Update Submission':'Submit Week'}</button>`,'picks');
}

function renderStandings(){
  const ranked=[...(state?.standings||[])];
  const current=state?.currentScores||[];
  const currentBlock=current.length?`<div class="section-title">Week ${state.currentWeek} final</div><div class="statgrid">${PLAYERS.map(p=>{const s=current.find(x=>x.playerId===p.id)||{};return `<div class="stat"><b>${s.checks||0}</b><span>${p.name} checks</span></div>`}).join('')}</div><div class="card">${PLAYERS.map(p=>{const s=current.find(x=>x.playerId===p.id)||{};return `<div class="row between"><span>${p.name}</span><b>+${s.points||0}</b></div>`}).join('')}</div>`:`<div class="section-title">Current week</div><div class="notice"><b>${finalCount()} of ${(state?.games||[]).length} games final.</b><br>No Week ${state.currentWeek} points are awarded until every game is final.</div>`;
  return shell(`<div class="title">Season Standings</div><div class="card"><table><thead><tr><th>#</th><th>Player</th><th class="right">Total</th></tr></thead><tbody>${ranked.map((x,i)=>`<tr><td>${i+1}</td><td>${esc(x.name)}${x.playerId==='yasin'?' 🛡️':''}</td><td class="right"><b>${x.total||0}</b></td></tr>`).join('')}</tbody></table></div>${currentBlock}`,'standings');
}

function checksForHistoryGame(g){
  const map={};for(const p of g.picks||[])map[p.playerId]={team:p.team,margin:p.margin};
  return resolveGameChecks({picksByUser:map,homeTeam:g.home,awayTeam:g.away,homeScore:Number(g.homeScore),awayScore:Number(g.awayScore)});
}
function renderHistory(){
  const hist=state?.history||[];
  if(!hist.length) return shell(`<div class="title">History</div><div class="notice">Completed weeks will appear here automatically after all games are final and the week is scored.</div>`,'history');
  const selected=hist.find(h=>String(h.week)===String(historyWeek))||hist[0];historyWeek=selected.week;
  const scoreMap=Object.fromEntries((selected.scores||[]).map(s=>[s.playerId,s]));
  const games=(selected.games||[]).map(g=>{const checks=checksForHistoryGame(g);return `<div class="game history-game"><div class="game-head"><span>FINAL</span><span>${esc(g.away)} @ ${esc(g.home)}</span></div><div class="history-score"><span>${esc(g.awayName)} <b>${g.awayScore}</b></span><span>${esc(g.homeName)} <b>${g.homeScore}</b></span></div><div class="divider"></div>${PLAYERS.map(p=>{const x=(g.picks||[]).find(q=>q.playerId===p.id);return `<div class="history-pick row between"><span>${p.name}${checks[p.id]?' ✅':''}${x?.lateOverride?' ⚠️':''}</span><b>${x?`${esc(x.team)} by ${x.margin}`:'No pick'}</b></div>`}).join('')}</div>`}).join('');
  return shell(`<div class="row between"><div><div class="title">History</div><div class="sub">Everyone can review every completed week.</div></div><span class="pill">${selected.overrideCount||0} overrides</span></div><div class="week-tabs">${hist.map(h=>`<button class="week-chip ${String(h.week)===String(selected.week)?'active':''}" data-history-week="${h.week}">Week ${h.week}</button>`).join('')}</div><div class="card"><div class="row between"><b>Week ${selected.week} summary</b><span class="pill">×${selected.multiplier||1}</span></div><table><thead><tr><th>Player</th><th class="right">Checks</th><th class="right">Points</th></tr></thead><tbody>${PLAYERS.map(p=>`<tr><td>${p.name}</td><td class="right">${scoreMap[p.id]?.checks||0}</td><td class="right"><b>+${scoreMap[p.id]?.points||0}</b></td></tr>`).join('')}</tbody></table></div><div class="section-title">Every pick</div>${games}`,'history');
}

function renderPredictions(){
  const locked=state.currentWeek>state.predictionLockWeek,pr=state.predictions||{};
  const c=pr.conference||[],s=pr.superBowl||[];
  return shell(`<div class="title">Week 12 Predictions</div><div class="notice ${locked?'warn':''}">${locked?'Predictions are locked after Week 12. Commissioner override for prediction changes will be added before Week 12 ends.':'You can edit these anytime through Week 12.'}</div><div class="card"><div class="section-title">Conference Championship · +2 each</div><p class="sub">Choose 4 teams, separated by commas.</p><textarea id="confPred" rows="4" style="width:100%;border-radius:12px;padding:12px;background:#08111f;color:white;border:1px solid var(--line)" ${locked?'disabled':''}>${esc(c.join(', '))}</textarea><div class="section-title">Super Bowl · +3 each</div><p class="sub">Choose 2 teams, separated by commas.</p><textarea id="sbPred" rows="2" style="width:100%;border-radius:12px;padding:12px;background:#08111f;color:white;border:1px solid var(--line)" ${locked?'disabled':''}>${esc(s.join(', '))}</textarea>${!locked?`<button class="btn" style="margin-top:14px" data-act="save-predictions" ${busy?'disabled':''}>Save Predictions</button>`:''}</div>`,'predictions');
}

function renderOverrideControls(g){
  const kickoffPassed=Date.now()>=new Date(g.kickoff).getTime();
  if(!kickoffPassed||g.final) return '';
  const rows=PLAYERS.filter(p=>p.id!=='yasin').map(p=>{
    const has=visiblePick(p.id,g.id); const active=(state.overrides?.all||[]).find(o=>o.playerId===p.id&&o.gameId===g.id&&o.status==='active');
    if(has) return `<div class="row between"><span>${p.name}</span><span class="tiny">Pick already saved</span></div>`;
    return `<div class="row between" style="margin-top:8px"><span>${p.name}</span>${active?`<span class="pill warn">Late pick open</span>`:`<button class="btn secondary" data-late="${p.id}|${g.id}" ${busy?'disabled':''}>Allow Late Pick</button>`}</div>`;
  }).join('');
  return `<div class="divider"></div><div class="tiny"><b>Late-pick override</b> · game already started</div>${rows}`;
}

function renderCommissioner(){
  const u=viewer(),admin=u.admin;
  const statuses=PLAYERS.map(p=>`<div class="row between" style="padding:10px 0;border-bottom:1px solid var(--line)"><span>${p.name}</span><span class="pill ${submitted(p.id)?'good':'warn'}">${submitted(p.id)?'Submitted':'Not submitted'}</span></div>`).join('');
  if(!admin) return shell(`<div class="title">Submission Status</div><div class="card">${statuses}</div>`,'commissioner');
  const allowInspect=submitted('yasin');
  const review=allowInspect?`<div class="section-title">Commissioner Review</div>${(state.games||[]).map(g=>`<div class="game"><b>${g.away} @ ${g.home}</b>${PLAYERS.map(p=>{const x=visiblePick(p.id,g.id);return `<div class="row between" style="margin-top:8px"><span>${p.name}</span><span>${x?`${x.team} by ${x.margin}${x.lateOverride?' ⚠️':''}`:'—'}</span></div>`}).join('')}${renderOverrideControls(g)}</div>`).join('')}`:`<div class="notice warn">You can see submission status, but you cannot inspect anyone else's picks until <b>you submit your own Week ${state.currentWeek} picks</b>.</div><div class="section-title">Late-pick overrides</div><div class="notice">You can still authorize your own missed game if needed. Overrides for other players unlock after you submit your picks.</div>`;
  const scoreStatus=currentWeekScored()?'Week scored automatically ✓':`${finalCount()} of ${(state.games||[]).length} games final`;
  return shell(`<div class="title">Commissioner Dashboard</div><div class="card"><div class="row between"><b>Week ${state.currentWeek}</b><span class="pill">${state.overrides?.count||0} override${Number(state.overrides?.count||0)===1?'':'s'}</span></div>${statuses}</div>${review}<div class="card"><div class="section-title">Commissioner tools</div><div class="notice"><b>${scoreStatus}</b><br>v0.6 automatically tries to score the week when the NFL feed shows every game FINAL.</div><div class="row"><button class="btn secondary" data-act="refresh-schedule" ${busy?'disabled':''}>Refresh NFL Data</button><button class="btn secondary" data-act="reset-pin" ${busy?'disabled':''}>Reset Player PIN</button></div><div class="divider"></div><div class="row between"><span>Current week</span><button class="btn secondary" data-act="change-week" ${busy?'disabled':''}>Change Week</button></div><p class="tiny">A late-pick override reopens only that player's missed game. The player makes the pick on their own phone; the override is logged and counted for the week.</p></div>`,'commissioner');
}

function render(){
  let html;
  if(!session?.token||!state) html=renderHome();
  else if(screen==='standings')html=renderStandings();
  else if(screen==='history')html=renderHistory();
  else if(screen==='predictions')html=renderPredictions();
  else if(screen==='commissioner')html=renderCommissioner();
  else html=renderPicks();
  document.querySelector('#app').innerHTML=html;bind();
}

function pinModal(player){
  document.body.insertAdjacentHTML('beforeend',`<div class="modal"><div class="modal-box"><div class="title">${player.name} PIN</div><p class="sub">Enter 4 digits. If this is your first login, this becomes your PIN.</p><input class="pin" id="pinInput" maxlength="4" inputmode="numeric" type="password"><div class="row" style="margin-top:14px"><button class="btn" id="pinGo">Continue</button><button class="btn secondary" id="pinCancel">Cancel</button></div></div></div>`);
  const input=document.querySelector('#pinInput');input.focus();
  document.querySelector('#pinCancel').onclick=()=>document.querySelector('.modal').remove();
  document.querySelector('#pinGo').onclick=async()=>{
    const pin=input.value.trim();if(!/^\d{4}$/.test(pin))return toast('Enter exactly 4 digits.');
    const btn=document.querySelector('#pinGo');btn.disabled=true;btn.textContent='Signing in…';
    try{
      const res=await backend.login(player.id,pin);if(!res?.ok)throw new Error(res?.error||'Login failed.');
      session={token:res.token,playerId:res.player_id};saveSession();screen='picks';document.querySelector('.modal').remove();
      await loadSnapshot();await syncSchedule({quiet:true});render();
      if(res.created_pin)toast(`${player.name}'s PIN was created.`);
    }catch(e){btn.disabled=false;btn.textContent='Continue';toast(e.message||String(e));}
  };
}

async function saveDraft(gid){
  const d=drafts[gid];if(!d?.team||!(Number(d.margin)>=1&&Number(d.margin)<=99))return;
  setBusy(true);
  try{const r=await backend.setPick(session.token,gid,d.team,Number(d.margin));if(!r?.ok)throw new Error(r?.error||'Pick could not be saved.');await loadSnapshot();}
  catch(e){toast(e.message||String(e));await loadSnapshot().catch(()=>{});}finally{busy=false;render();}
}

function bind(){
  document.querySelectorAll('[data-player]').forEach(b=>b.onclick=()=>pinModal(PLAYERS.find(p=>p.id===b.dataset.player)));
  document.querySelectorAll('[data-nav]').forEach(b=>b.onclick=()=>{screen=b.dataset.nav;render()});
  document.querySelectorAll('[data-history-week]').forEach(b=>b.onclick=()=>{historyWeek=b.dataset.historyWeek;render()});
  document.querySelectorAll('[data-pick]').forEach(b=>b.onclick=async()=>{const [gid,team]=b.dataset.pick.split('|');drafts[gid] ||= {};drafts[gid].team=team;render();await saveDraft(gid)});
  document.querySelectorAll('[data-margin]').forEach(i=>i.onchange=async()=>{const gid=i.dataset.margin;drafts[gid] ||= {};drafts[gid].margin=Number(i.value);await saveDraft(gid)});
  document.querySelectorAll('[data-late]').forEach(b=>b.onclick=async()=>{const [pid,gid]=b.dataset.late.split('|');if(!confirm(`Allow ${playerById(pid)?.name||pid} to make a late pick for this game?`))return;setBusy(true);try{const r=await backend.authorizeLatePick(session.token,pid,gid);if(!r?.ok)throw new Error(r?.error||'Override failed.');await loadSnapshot();toast(`${playerById(pid)?.name||pid}'s game is reopened. They can pick it from their phone now.`);}catch(e){toast(e.message||String(e))}finally{busy=false;render()}});
  document.querySelectorAll('[data-act]').forEach(b=>b.onclick=async()=>{
    const a=b.dataset.act;
    if(a==='logout'){try{await backend.logout(session.token)}catch{}session=null;state=null;saveSession();screen='home';render();return;}
    if(a==='refresh-schedule'){setBusy(true);await syncSchedule({quiet:false});busy=false;render();return;}
    if(a==='submit-week'){setBusy(true);try{const r=await backend.submitWeek(session.token);if(!r?.ok)throw new Error(r?.error||'Submission failed.');await loadSnapshot();toast('Picks submitted.');}catch(e){toast(e.message||String(e))}finally{busy=false;render()}return;}
    if(a==='save-predictions'){const split=v=>v.split(',').map(x=>x.trim()).filter(Boolean);const c=split(document.querySelector('#confPred').value),s=split(document.querySelector('#sbPred').value);setBusy(true);try{const r=await backend.savePredictions(session.token,c,s);if(!r?.ok)throw new Error(r?.error||'Could not save predictions.');await loadSnapshot();toast('Predictions saved.');}catch(e){toast(e.message||String(e))}finally{busy=false;render()}return;}
    if(a==='reset-pin'){const n=prompt('Reset whose PIN? Yasin, Yezan, Samer, or Limar');const p=PLAYERS.find(x=>x.name.toLowerCase()===String(n||'').trim().toLowerCase());if(!p)return toast('Player not found.');if(!confirm(`Reset ${p.name}'s PIN? They will create a new 4-digit PIN next login.`))return;setBusy(true);try{const r=await backend.resetPin(session.token,p.id);if(!r?.ok)throw new Error(r?.error||'PIN reset failed.');toast(`${p.name}'s PIN was reset.`);if(p.id===viewer().id){session=null;state=null;saveSession();screen='home';}}catch(e){toast(e.message||String(e))}finally{busy=false;render()}return;}
    if(a==='change-week'){const w=prompt('Enter the week number to open:',String(state.currentWeek));if(!w)return;const n=Number(w);if(!Number.isInteger(n))return toast('Enter a whole week number.');setBusy(true);try{const r=await backend.setWeek(session.token,n,'regular');if(!r?.ok)throw new Error(r?.error||'Week change failed.');await loadSnapshot();await syncSchedule({quiet:true});toast(`Week ${n} is now active.`);}catch(e){toast(e.message||String(e))}finally{busy=false;render()}return;}
  });
}

async function boot(){
  render();
  if(session?.token){
    try{await loadSnapshot();screen='picks';render();await syncSchedule({quiet:true});}
    catch(e){toast(`Could not connect to the shared database: ${e.message}`);session=null;state=null;saveSession();render();}
  }
}

if('serviceWorker' in navigator&&location.protocol.startsWith('http'))navigator.serviceWorker.register('./service-worker.js').catch(()=>{});
boot();

let refreshing=false;
async function backgroundRefresh(){
  if(refreshing||!session?.token||document.hidden)return;refreshing=true;
  try{await syncSchedule({quiet:true});}finally{refreshing=false}
}
setInterval(backgroundRefresh,120000);
window.addEventListener('focus',()=>backgroundRefresh());
