import { PLAYERS, resolveGameChecks, normalizeChecks, playoffRoundMultiplier, predictionBonus, canAdminInspectPicks, shouldRevealToPlayers, getSuperBowlField, resolveSuperBowlChampion } from './logic.mjs';

const KEY='family-nfl-picks-v01';
const DEMO_GAMES=[
  {id:'g1',away:'NE',awayName:'Patriots',home:'SEA',homeName:'Seahawks',kickoff:'2026-09-09T20:20:00-04:00',status:'scheduled',round:'regular'},
  {id:'g2',away:'SF',awayName:'49ers',home:'LA',homeName:'Rams',kickoff:'2026-09-10T20:35:00-04:00',status:'scheduled',round:'regular'},
  {id:'g3',away:'DAL',awayName:'Cowboys',home:'PHI',homeName:'Eagles',kickoff:'2026-09-13T13:00:00-04:00',status:'scheduled',round:'regular'},
  {id:'g4',away:'NO',awayName:'Saints',home:'ATL',homeName:'Falcons',kickoff:'2026-09-13T16:25:00-04:00',status:'scheduled',round:'regular'}
];

function baseState(){return {
  season:2026,currentWeek:1,currentUser:null,screen:'home',scheduleSource:'demo',
  pins:{}, totals:Object.fromEntries(PLAYERS.map(p=>[p.id,0])),
  weeks:{'1':{round:'regular',games:DEMO_GAMES,picks:{},submissions:{},results:{},overrides:[]}},
  predictions:{conference:{},superBowl:{}}, predictionLockWeek:12,
  superBowl:{firstChoice:null,secondMargins:{},lockedMargins:{},champion:null}
}}
let state=load();
function load(){try{return {...baseState(),...JSON.parse(localStorage.getItem(KEY)||'{}')}}catch{return baseState()}}
function save(){localStorage.setItem(KEY,JSON.stringify(state))}
function wk(){return state.weeks[String(state.currentWeek)]}
function user(){return PLAYERS.find(p=>p.id===state.currentUser)}
function allSubmitted(){return PLAYERS.every(p=>wk().submissions?.[p.id]?.submittedAt)}
function fmtKickoff(s){return new Date(s).toLocaleString([], {weekday:'short',month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}
function isGameLocked(g){return allSubmitted() || Date.now()>=new Date(g.kickoff).getTime()}
function esc(s=''){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}
function pickFor(uid,gid){return wk().picks?.[gid]?.[uid]}
function ensurePickMap(gid){wk().picks[gid] ||= {}}
function submitted(uid){return Boolean(wk().submissions?.[uid]?.submittedAt)}

async function tryLoadSchedule(){
  const url=`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${state.season}&seasontype=2&week=${state.currentWeek}`;
  try{
    const r=await fetch(url,{cache:'no-store'}); if(!r.ok) throw new Error('schedule'); const d=await r.json();
    if(!Array.isArray(d.events)||!d.events.length) throw new Error('empty');
    const games=d.events.map(e=>{const c=e.competitions?.[0];const comps=c?.competitors||[];const h=comps.find(x=>x.homeAway==='home');const a=comps.find(x=>x.homeAway==='away');return {
      id:e.id,away:a?.team?.abbreviation||'AWY',awayName:a?.team?.displayName||'Away',home:h?.team?.abbreviation||'HME',homeName:h?.team?.displayName||'Home',kickoff:e.date,status:e.status?.type?.state||'scheduled',round:'regular',homeScore:Number(h?.score),awayScore:Number(a?.score)
    }});
    wk().games=games; state.scheduleSource='live-prototype'; save(); render();
  }catch{state.scheduleSource='demo';save();render()}
}

function shell(content,active='home'){
  const u=user();
  return `<div class="shell"><div class="topbar"><div><div class="brand">🏈 Family NFL Picks</div><div class="sub">2026 Season · Week ${state.currentWeek}</div></div>${u?`<button class="btn secondary" data-act="logout">${esc(u.name)} ↗</button>`:''}</div>${content}</div>${u?`<div class="nav"><div class="nav-inner"><button data-nav="picks" class="${active==='picks'?'active':''}">Picks</button><button data-nav="standings" class="${active==='standings'?'active':''}">Standings</button><button data-nav="predictions" class="${active==='predictions'?'active':''}">Predictions</button><button data-nav="commissioner" class="${active==='commissioner'?'active':''}">${u.admin?'Commissioner':'Status'}</button></div></div>`:''}`
}

function renderHome(){
 return shell(`<div class="card"><div class="title">Who’s picking?</div><p class="sub">Choose your name, then enter your 4-digit PIN.</p><div class="grid">${PLAYERS.map(p=>`<button class="player ${p.admin?'admin':''}" data-player="${p.id}">${p.name}</button>`).join('')}</div></div><div class="notice">This first coded version uses local browser storage so we can test the full game logic and UI. Multi-phone syncing is the next backend step.</div>`);
}

function renderPicks(){
 const u=user(), w=wk();
 const lockedByAll=allSubmitted();
 const games=w.games.map(g=>{
   const p=pickFor(u.id,g.id)||{}; const locked=isGameLocked(g); const res=w.results?.[g.id];
   return `<div class="game ${locked?'lock':''}"><div class="game-head"><span>${fmtKickoff(g.kickoff)}</span><span>${locked?'🔒 LOCKED':'OPEN'}</span></div><div class="teams"><button class="team ${p.team===g.away?'selected':''}" data-pick="${g.id}|${g.away}" ${locked?'disabled':''}>${esc(g.awayName)}<br><span class="tiny">${g.away}</span></button><button class="team ${p.team===g.home?'selected':''}" data-pick="${g.id}|${g.home}" ${locked?'disabled':''}>${esc(g.homeName)}<br><span class="tiny">${g.home}</span></button></div><div class="margin-wrap"><span><b>Winning margin</b><br><span class="tiny">Always enter it; ignored when not needed.</span></span><input class="margin" type="number" min="1" max="99" inputmode="numeric" data-margin="${g.id}" value="${p.margin??''}" ${locked?'disabled':''}></div>${res?`<div class="tiny" style="margin-top:10px">Final: ${g.away} ${res.awayScore} · ${g.home} ${res.homeScore}</div>`:''}</div>`
 }).join('');
 const complete=w.games.every(g=>{const p=pickFor(u.id,g.id);return p?.team && Number(p?.margin)>0});
 return shell(`<div class="row between"><div><div class="title">Week ${state.currentWeek} Picks</div><div class="sub">${w.games.length} games · ${state.scheduleSource==='demo'?'Demo schedule':'Auto-loaded schedule'}</div></div><button class="btn secondary" data-act="refresh-schedule">↻ Schedule</button></div>${submitted(u.id)?`<div class="notice">Submitted ✓ ${lockedByAll?'Everyone is in, so the week is locked.':'You can still edit games that have not kicked off until everyone submits.'}</div>`:''}${games}<button class="btn" data-act="submit-week" ${!complete?'disabled':''}>${submitted(u.id)?'Update Submission':'Submit Week'}</button>`, 'picks');
}

function weeklyCheckCounts(){
 const counts=Object.fromEntries(PLAYERS.map(p=>[p.id,0]));
 for(const g of wk().games){const r=wk().results?.[g.id]; if(!r) continue; const checks=resolveGameChecks({picksByUser:wk().picks?.[g.id]||{},homeTeam:g.home,awayTeam:g.away,homeScore:r.homeScore,awayScore:r.awayScore}); for(const p of PLAYERS) if(checks[p.id]) counts[p.id]++}
 return counts;
}
function renderStandings(){
 const counts=weeklyCheckCounts(); const mult=playoffRoundMultiplier(wk().round); const earned=normalizeChecks(counts,mult);
 const ranked=PLAYERS.map(p=>({p,...p,total:state.totals[p.id]||0})).sort((a,b)=>b.total-a.total);
 return shell(`<div class="title">Season Standings</div><div class="card"><table><thead><tr><th>#</th><th>Player</th><th class="right">Total</th></tr></thead><tbody>${ranked.map((x,i)=>`<tr><td>${i+1}</td><td>${x.p.name}${x.p.admin?' 🛡️':''}</td><td class="right"><b>${x.total}</b></td></tr>`).join('')}</tbody></table></div><div class="section-title">Current round preview</div><div class="statgrid">${PLAYERS.map(p=>`<div class="stat"><b>${counts[p.id]}</b><span>${p.name} checks</span></div>`).join('')}</div><div class="card"><div class="row between"><span>Round multiplier</span><b>×${mult}</b></div><div class="divider"></div>${PLAYERS.map(p=>`<div class="row between"><span>${p.name}</span><b>+${earned[p.id]}</b></div>`).join('')}</div>`, 'standings');
}

function renderPredictions(){
 const u=user(), locked=state.currentWeek>state.predictionLockWeek;
 const c=state.predictions.conference[u.id]||[]; const s=state.predictions.superBowl[u.id]||[];
 return shell(`<div class="title">Week 12 Predictions</div><div class="notice ${locked?'warn':''}">${locked?'Predictions are locked after Week 12. Commissioner override is required to change them.':'You can edit these anytime through Week 12.'}</div><div class="card"><div class="section-title">Conference Championship · +2 each</div><p class="sub">Choose 4 teams you think will reach the conference championships.</p><textarea id="confPred" rows="4" style="width:100%;border-radius:12px;padding:12px;background:#08111f;color:white;border:1px solid var(--line)" ${locked?'disabled':''}>${esc(c.join(', '))}</textarea><div class="section-title">Super Bowl · +3 each</div><p class="sub">Choose the 2 teams you think will reach the Super Bowl.</p><textarea id="sbPred" rows="2" style="width:100%;border-radius:12px;padding:12px;background:#08111f;color:white;border:1px solid var(--line)" ${locked?'disabled':''}>${esc(s.join(', '))}</textarea>${!locked?`<button class="btn" style="margin-top:14px" data-act="save-predictions">Save Predictions</button>`:''}</div>`, 'predictions');
}

function renderCommissioner(){
 const u=user(), admin=u.admin, allowInspect=admin && canAdminInspectPicks({adminUserId:'yasin',submissions:wk().submissions});
 const statuses=PLAYERS.map(p=>`<div class="row between" style="padding:10px 0;border-bottom:1px solid var(--line)"><span>${p.name}</span><span class="pill ${submitted(p.id)?'good':'warn'}">${submitted(p.id)?'Submitted':'Not submitted'}</span></div>`).join('');
 let inspect='';
 if(admin){
   inspect = allowInspect ? `<div class="section-title">Pick Audit</div>${wk().games.map(g=>`<div class="game"><b>${g.away} @ ${g.home}</b>${PLAYERS.map(p=>{const x=pickFor(p.id,g.id);return `<div class="row between" style="margin-top:8px"><span>${p.name}</span><span>${x?`${x.team} by ${x.margin}`:'—'}</span></div>`}).join('')}</div>`).join('')}` : `<div class="notice warn">You can see who submitted, but you cannot inspect anyone’s picks until <b>you submit your own Week ${state.currentWeek} picks</b>.</div>`;
 }
 return shell(`<div class="title">${admin?'Commissioner Dashboard':'Submission Status'}</div><div class="card"><div class="row between"><b>Week ${state.currentWeek}</b><span class="pill">${wk().overrides.length} override${wk().overrides.length===1?'':'s'}</span></div>${statuses}</div>${inspect}${admin?`<div class="card"><div class="section-title">Commissioner tools</div><div class="row"><button class="btn secondary" data-act="demo-results">Enter Demo Finals</button><button class="btn secondary" data-act="score-week">Score + Add to Total</button><button class="btn secondary" data-act="reset-pin">Reset Player PIN</button></div><p class="tiny">Every commissioner edit after lock should be recorded as an override. This prototype counts them in the week audit trail.</p></div>`:''}`, 'commissioner');
}

function render(){
 let html;
 if(!state.currentUser) html=renderHome(); else if(state.screen==='standings') html=renderStandings(); else if(state.screen==='predictions') html=renderPredictions(); else if(state.screen==='commissioner') html=renderCommissioner(); else html=renderPicks();
 document.querySelector('#app').innerHTML=html; bind();
}

function pinModal(player){
 const has=Boolean(state.pins[player.id]);
 document.body.insertAdjacentHTML('beforeend',`<div class="modal"><div class="modal-box"><div class="title">${has?'Enter':'Create'} ${player.name} PIN</div><p class="sub">4 digits</p><input class="pin" id="pinInput" maxlength="4" inputmode="numeric" type="password"><div class="row" style="margin-top:14px"><button class="btn" id="pinGo">Continue</button><button class="btn secondary" id="pinCancel">Cancel</button></div></div></div>`);
 const input=document.querySelector('#pinInput'); input.focus();
 document.querySelector('#pinCancel').onclick=()=>document.querySelector('.modal').remove();
 document.querySelector('#pinGo').onclick=()=>{const v=input.value.trim(); if(!/^\d{4}$/.test(v)) return alert('Enter exactly 4 digits.'); if(!has){state.pins[player.id]=v;save()} else if(state.pins[player.id]!==v) return alert('Wrong PIN.'); state.currentUser=player.id;state.screen='picks';save();document.querySelector('.modal').remove();render()};
}

function bind(){
 document.querySelectorAll('[data-player]').forEach(b=>b.onclick=()=>pinModal(PLAYERS.find(p=>p.id===b.dataset.player)));
 document.querySelectorAll('[data-nav]').forEach(b=>b.onclick=()=>{state.screen=b.dataset.nav;save();render()});
 document.querySelectorAll('[data-pick]').forEach(b=>b.onclick=()=>{const [gid,team]=b.dataset.pick.split('|');ensurePickMap(gid);wk().picks[gid][user().id]={...(wk().picks[gid][user().id]||{}),team,updatedAt:new Date().toISOString()};save();render()});
 document.querySelectorAll('[data-margin]').forEach(i=>i.onchange=()=>{const gid=i.dataset.margin;ensurePickMap(gid);wk().picks[gid][user().id]={...(wk().picks[gid][user().id]||{}),margin:Number(i.value),updatedAt:new Date().toISOString()};save();render()});
 document.querySelectorAll('[data-act]').forEach(b=>b.onclick=async()=>{
   const a=b.dataset.act;
   if(a==='logout'){state.currentUser=null;state.screen='home';save();render()}
   if(a==='refresh-schedule'){await tryLoadSchedule()}
   if(a==='submit-week'){wk().submissions[user().id]={submittedAt:new Date().toISOString()};save();render()}
   if(a==='save-predictions'){const split=v=>v.split(',').map(x=>x.trim()).filter(Boolean);const c=split(document.querySelector('#confPred').value),s=split(document.querySelector('#sbPred').value);if(c.length!==4)return alert('Enter exactly 4 Conference Championship teams, separated by commas.');if(s.length!==2)return alert('Enter exactly 2 Super Bowl teams, separated by commas.');state.predictions.conference[user().id]=c;state.predictions.superBowl[user().id]=s;save();alert('Predictions saved.');render()}
   if(a==='demo-results'){if(!user().admin)return;const scores=[[24,27],[17,31],[20,23],[14,21]];wk().games.forEach((g,i)=>{wk().results[g.id]={awayScore:scores[i%4][0],homeScore:scores[i%4][1]}});wk().overrides.push({type:'manual-results',by:'yasin',at:new Date().toISOString()});save();render()}
   if(a==='score-week'){if(!user().admin)return;const counts=weeklyCheckCounts();const pts=normalizeChecks(counts,playoffRoundMultiplier(wk().round));PLAYERS.forEach(p=>state.totals[p.id]=(state.totals[p.id]||0)+pts[p.id]);wk().scoredAt=new Date().toISOString();save();alert('Week scored and added to season totals.');render()}
   if(a==='reset-pin'){if(!user().admin)return;const n=prompt('Whose PIN? Yasin, Yezan, Samer, or Limar');const p=PLAYERS.find(x=>x.name.toLowerCase()===String(n||'').toLowerCase());if(!p)return alert('Player not found.');delete state.pins[p.id];wk().overrides.push({type:'pin-reset',target:p.id,by:'yasin',at:new Date().toISOString()});save();alert(`${p.name}'s PIN will be recreated next login.`);render()}
 })
}

if('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./service-worker.js').catch(()=>{});
render();
