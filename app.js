import { PLAYERS, resolveGameChecks, normalizeChecks, playoffRoundMultiplier, predictionBonus, canAdminInspectPicks, shouldRevealToPlayers, getSuperBowlField, resolveSuperBowlChampion } from './logic.mjs';

const KEY='family-nfl-picks-v01'; // preserve existing picks/PINs across prototype updates
const SCHEMA_VERSION=4;
const DEMO_GAMES=[
  {id:'g1',away:'NE',awayName:'Patriots',awayRecord:'0-0',home:'SEA',homeName:'Seahawks',homeRecord:'0-0',kickoff:'2026-09-09T20:20:00-04:00',status:'scheduled',round:'regular'},
  {id:'g2',away:'SF',awayName:'49ers',awayRecord:'0-0',home:'LA',homeName:'Rams',homeRecord:'0-0',kickoff:'2026-09-10T20:35:00-04:00',status:'scheduled',round:'regular'},
  {id:'g3',away:'DAL',awayName:'Cowboys',awayRecord:'0-0',home:'PHI',homeName:'Eagles',homeRecord:'0-0',kickoff:'2026-09-13T13:00:00-04:00',status:'scheduled',round:'regular'},
  {id:'g4',away:'NO',awayName:'Saints',awayRecord:'0-0',home:'ATL',homeName:'Falcons',homeRecord:'0-0',kickoff:'2026-09-13T16:25:00-04:00',status:'scheduled',round:'regular'}
];

function baseState(){return {
  schemaVersion:SCHEMA_VERSION,season:2026,currentWeek:1,currentUser:null,screen:'home',historyWeek:null,scheduleSource:'demo',
  pins:{}, totals:Object.fromEntries(PLAYERS.map(p=>[p.id,0])),
  weeks:{'1':{round:'regular',games:DEMO_GAMES,picks:{},submissions:{},results:{},overrides:[]}},
  predictions:{conference:{},superBowl:{}}, predictionLockWeek:12,
  superBowl:{firstChoice:null,secondMargins:{},lockedMargins:{},champion:null}
}}
let state=load();
function migrateState(next){
  const previousVersion=Number(next.schemaVersion||1);
  if(previousVersion<4){
    // v0.3 had a visible demo-final button that could inject fake scores and then
    // incorrectly allow the week to be scored. Remove only that prototype data
    // while preserving real picks, submissions, PINs, and other overrides.
    for(const w of Object.values(next.weeks||{})){
      const hadDemoResults=(w.overrides||[]).some(o=>o.type==='manual-results');
      if(!hadDemoResults) continue;
      if(w.scoredAt && w.scoreSummary?.points){
        for(const p of PLAYERS){
          next.totals[p.id]=Math.max(0,Number(next.totals?.[p.id]||0)-Number(w.scoreSummary.points?.[p.id]||0));
        }
      }
      w.results={};
      delete w.scoredAt;
      delete w.scoreSummary;
      w.overrides=(w.overrides||[]).filter(o=>o.type!=='manual-results');
    }
  }
  next.schemaVersion=SCHEMA_VERSION;
  return next;
}
function load(){
  try{
    const raw=JSON.parse(localStorage.getItem(KEY)||'{}');
    const merged={...baseState(),...raw};
    // Older builds had no schemaVersion field, so do not let the new default
    // accidentally make old saved data look already migrated.
    if(!Object.prototype.hasOwnProperty.call(raw,'schemaVersion')) merged.schemaVersion=1;
    const next=migrateState(merged);
    localStorage.setItem(KEY,JSON.stringify(next));
    return next;
  }catch{return baseState()}
}
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
function isConfirmedFinal(g,w=wk()){
  const r=w.results?.[g.id];
  return Boolean(r?.final && Number.isFinite(Number(r.awayScore)) && Number.isFinite(Number(r.homeScore)));
}
function finalGameCount(w=wk()){return (w.games||[]).filter(g=>isConfirmedFinal(g,w)).length}
function weekReadyToScore(w=wk()){return Boolean((w.games||[]).length) && (w.games||[]).every(g=>isConfirmedFinal(g,w))}

async function tryLoadSchedule(){
  const url=`https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?dates=${state.season}&seasontype=2&week=${state.currentWeek}`;
  try{
    const r=await fetch(url,{cache:'no-store'}); if(!r.ok) throw new Error('schedule'); const d=await r.json();
    if(!Array.isArray(d.events)||!d.events.length) throw new Error('empty');
    const games=d.events.map(e=>{const c=e.competitions?.[0];const comps=c?.competitors||[];const h=comps.find(x=>x.homeAway==='home');const a=comps.find(x=>x.homeAway==='away');const statusState=e.status?.type?.state||'pre';const final=Boolean(e.status?.type?.completed||statusState==='post');return {
      id:e.id,
      away:a?.team?.abbreviation||'AWY',awayName:a?.team?.displayName||'Away',awayRecord:a?.records?.find(r=>r.type==='total')?.summary||a?.records?.[0]?.summary||'',
      home:h?.team?.abbreviation||'HME',homeName:h?.team?.displayName||'Home',homeRecord:h?.records?.find(r=>r.type==='total')?.summary||h?.records?.[0]?.summary||'',
      kickoff:e.date,status:statusState,final,round:'regular',homeScore:Number(h?.score),awayScore:Number(a?.score)
    }});
    wk().games=games;
    wk().results ||= {};
    for(const g of games){
      if(g.final && Number.isFinite(g.homeScore) && Number.isFinite(g.awayScore)){
        wk().results[g.id]={awayScore:g.awayScore,homeScore:g.homeScore,final:true,source:'schedule',confirmedAt:new Date().toISOString()};
      }
    }
    state.scheduleSource='live-prototype'; save(); render();
  }catch{state.scheduleSource='demo';save();render()}
}

function shell(content,active='home'){
  const u=user();
  return `<div class="shell"><div class="topbar"><div><div class="brand">🏈 Family NFL Picks</div><div class="sub">2026 Season · Week ${state.currentWeek} · v0.4</div></div>${u?`<button class="btn secondary" data-act="logout">${esc(u.name)} ↗</button>`:''}</div>${content}</div>${u?`<div class="nav"><div class="nav-inner"><button data-nav="picks" class="${active==='picks'?'active':''}">Picks</button><button data-nav="standings" class="${active==='standings'?'active':''}">Standings</button><button data-nav="history" class="${active==='history'?'active':''}">History</button><button data-nav="predictions" class="${active==='predictions'?'active':''}">Predictions</button><button data-nav="commissioner" class="${active==='commissioner'?'active':''}">${u.admin?'Commish':'Status'}</button></div></div>`:''}`
}

function renderHome(){
 return shell(`<div class="card"><div class="title">Who’s picking?</div><p class="sub">Choose your name, then enter your 4-digit PIN.</p><div class="grid">${PLAYERS.map(p=>`<button class="player ${p.admin?'admin':''}" data-player="${p.id}">${p.name}</button>`).join('')}</div></div><div class="notice">This first coded version uses local browser storage so we can test the full game logic and UI. Multi-phone syncing is the next backend step.</div>`);
}

function renderPicks(){
 const u=user(), w=wk();
 const lockedByAll=allSubmitted();
 const games=w.games.map(g=>{
   const p=pickFor(u.id,g.id)||{}; const locked=isGameLocked(g); const res=w.results?.[g.id];
   const scoreLine=res?.final?`<div class="tiny" style="margin-top:10px">FINAL · ${g.away} ${res.awayScore} · ${g.home} ${res.homeScore}</div>`:(g.status==='in'&&Number.isFinite(g.awayScore)&&Number.isFinite(g.homeScore)?`<div class="tiny" style="margin-top:10px">LIVE · ${g.away} ${g.awayScore} · ${g.home} ${g.homeScore}</div>`:'');
   return `<div class="game ${locked?'lock':''}"><div class="game-head"><span>${fmtKickoff(g.kickoff)}</span><span>${locked?'🔒 LOCKED':'OPEN'}</span></div><div class="teams"><button class="team ${p.team===g.away?'selected':''}" data-pick="${g.id}|${g.away}" ${locked?'disabled':''}>${esc(g.awayName)}<br><span class="tiny">${g.away}${g.awayRecord?` · ${esc(g.awayRecord)}`:''}</span></button><button class="team ${p.team===g.home?'selected':''}" data-pick="${g.id}|${g.home}" ${locked?'disabled':''}>${esc(g.homeName)}<br><span class="tiny">${g.home}${g.homeRecord?` · ${esc(g.homeRecord)}`:''}</span></button></div><div class="margin-wrap"><span><b>Winning margin</b><br><span class="tiny">Always enter it; ignored when not needed.</span></span><input class="margin" type="number" min="1" max="99" inputmode="numeric" data-margin="${g.id}" value="${p.margin??''}" ${locked?'disabled':''}></div>${scoreLine}</div>`
 }).join('');
 const complete=w.games.every(g=>{const p=pickFor(u.id,g.id);return p?.team && Number(p?.margin)>0});
 return shell(`<div class="row between"><div><div class="title">Week ${state.currentWeek} Picks</div><div class="sub">${w.games.length} games · ${state.scheduleSource==='demo'?'Demo schedule':'Auto-loaded schedule'}</div></div><button class="btn secondary" data-act="refresh-schedule">↻ Schedule</button></div>${submitted(u.id)?`<div class="notice">Submitted ✓ ${lockedByAll?'Everyone is in, so the week is locked.':'You can still edit games that have not kicked off until everyone submits.'}</div>`:''}${games}<button class="btn" data-act="submit-week" ${!complete?'disabled':''}>${submitted(u.id)?'Update Submission':'Submit Week'}</button>`, 'picks');
}

function checkCountsForWeek(w){
 const counts=Object.fromEntries(PLAYERS.map(p=>[p.id,0]));
 for(const g of w.games||[]){const r=w.results?.[g.id]; if(!r?.final) continue; const checks=resolveGameChecks({picksByUser:w.picks?.[g.id]||{},homeTeam:g.home,awayTeam:g.away,homeScore:r.homeScore,awayScore:r.awayScore}); for(const p of PLAYERS) if(checks[p.id]) counts[p.id]++}
 return counts;
}
function weeklyCheckCounts(){return checkCountsForWeek(wk())}
function renderStandings(){
 const w=wk();
 const ranked=PLAYERS.map(p=>({p,...p,total:state.totals[p.id]||0})).sort((a,b)=>b.total-a.total);
 const finals=finalGameCount(w), totalGames=(w.games||[]).length;
 let roundBlock;
 if(w.scoredAt && w.scoreSummary){
   const counts=w.scoreSummary.checks||weeklyCheckCounts();
   const mult=w.scoreSummary.multiplier||playoffRoundMultiplier(w.round);
   const earned=w.scoreSummary.points||normalizeChecks(counts,mult);
   roundBlock=`<div class="section-title">Week ${state.currentWeek} final</div><div class="statgrid">${PLAYERS.map(p=>`<div class="stat"><b>${counts[p.id]||0}</b><span>${p.name} checks</span></div>`).join('')}</div><div class="card"><div class="row between"><span>Round multiplier</span><b>×${mult}</b></div><div class="divider"></div>${PLAYERS.map(p=>`<div class="row between"><span>${p.name}</span><b>+${earned[p.id]||0}</b></div>`).join('')}</div>`;
 }else{
   roundBlock=`<div class="section-title">Current week</div><div class="notice"><b>${finals} of ${totalGames} games final.</b><br>No Week ${state.currentWeek} points are awarded until every game has a confirmed final result.</div>`;
 }
 return shell(`<div class="title">Season Standings</div><div class="card"><table><thead><tr><th>#</th><th>Player</th><th class="right">Total</th></tr></thead><tbody>${ranked.map((x,i)=>`<tr><td>${i+1}</td><td>${x.p.name}${x.p.admin?' 🛡️':''}</td><td class="right"><b>${x.total}</b></td></tr>`).join('')}</tbody></table></div>${roundBlock}`, 'standings');
}
function completedWeekEntries(){
 return Object.entries(state.weeks||{}).filter(([,w])=>Boolean(w.scoredAt)).sort((a,b)=>Number(b[0])-Number(a[0]));
}
function renderHistory(){
 const completed=completedWeekEntries();
 if(!completed.length) return shell(`<div class="title">History</div><div class="notice">Completed weeks will appear here after the commissioner scores them. Current-week picks stay private until the normal reveal rules are met.</div>`, 'history');
 const validKeys=completed.map(([k])=>k);
 const selectedKey=validKeys.includes(String(state.historyWeek))?String(state.historyWeek):validKeys[0];
 const w=state.weeks[selectedKey];
 const counts=w.scoreSummary?.checks||checkCountsForWeek(w);
 const mult=w.scoreSummary?.multiplier||playoffRoundMultiplier(w.round);
 const points=w.scoreSummary?.points||normalizeChecks(counts,mult);
 const games=(w.games||[]).map(g=>{
   const r=w.results?.[g.id]?.final?w.results[g.id]:null;
   const checks=r?resolveGameChecks({picksByUser:w.picks?.[g.id]||{},homeTeam:g.home,awayTeam:g.away,homeScore:r.homeScore,awayScore:r.awayScore}):Object.fromEntries(PLAYERS.map(p=>[p.id,false]));
   return `<div class="game history-game"><div class="game-head"><span>${r?'FINAL':'No final result'}</span><span>${esc(g.away)} @ ${esc(g.home)}</span></div><div class="history-score"><span>${esc(g.awayName)} <b>${r?.awayScore??'—'}</b></span><span>${esc(g.homeName)} <b>${r?.homeScore??'—'}</b></span></div><div class="divider"></div>${PLAYERS.map(p=>{const x=w.picks?.[g.id]?.[p.id];return `<div class="history-pick row between"><span>${p.name}${checks[p.id]?' ✅':''}</span><b>${x?`${esc(x.team)} by ${Number(x.margin)||'—'}`:'No pick'}</b></div>`}).join('')}</div>`;
 }).join('');
 return shell(`<div class="row between"><div><div class="title">History</div><div class="sub">Everyone can see all picks once a week is completed and scored.</div></div><span class="pill">${w.overrides?.length||0} overrides</span></div><div class="week-tabs">${completed.map(([k])=>`<button class="week-chip ${k===selectedKey?'active':''}" data-history-week="${k}">Week ${k}</button>`).join('')}</div><div class="card"><div class="row between"><b>Week ${selectedKey} summary</b><span class="pill">×${mult}</span></div><table><thead><tr><th>Player</th><th class="right">Checks</th><th class="right">Points</th></tr></thead><tbody>${PLAYERS.map(p=>`<tr><td>${p.name}</td><td class="right">${counts[p.id]||0}</td><td class="right"><b>+${points[p.id]||0}</b></td></tr>`).join('')}</tbody></table></div><div class="section-title">Every pick</div>${games}`, 'history');
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
   inspect = allowInspect ? `<div class="section-title">Commissioner Review</div>${wk().games.map(g=>`<div class="game"><b>${g.away} @ ${g.home}</b>${PLAYERS.map(p=>{const x=pickFor(p.id,g.id);return `<div class="row between" style="margin-top:8px"><span>${p.name}</span><span>${x?`${x.team} by ${x.margin}`:'—'}</span></div>`}).join('')}</div>`).join('')}` : `<div class="notice warn">You can see who submitted, but you cannot inspect anyone’s picks until <b>you submit your own Week ${state.currentWeek} picks</b>.</div>`;
 }
 const ready=weekReadyToScore(wk());
 const finalCount=finalGameCount(wk());
 return shell(`<div class="title">${admin?'Commissioner Dashboard':'Submission Status'}</div><div class="card"><div class="row between"><b>Week ${state.currentWeek}</b><span class="pill">${wk().overrides.length} override${wk().overrides.length===1?'':'s'}</span></div>${statuses}</div>${inspect}${admin?`<div class="card"><div class="section-title">Commissioner tools</div><div class="notice"><b>${finalCount} of ${(wk().games||[]).length} games final.</b><br>${wk().scoredAt?'This week has already been scored.':ready?'All games are final. You can score the week now.':'Scoring stays locked until every game is FINAL.'}</div><div class="row"><button class="btn secondary" data-act="score-week" ${wk().scoredAt||!ready?'disabled':''}>${wk().scoredAt?'Week Scored ✓':ready?'Score Completed Week':'Waiting for Finals'}</button><button class="btn secondary" data-act="reset-pin">Reset Player PIN</button></div><p class="tiny">There are no demo final scores in v0.4. Only confirmed final NFL results can be used for scoring. Commissioner overrides remain recorded in the weekly audit count.</p></div>`:''}`, 'commissioner');
}

function render(){
 let html;
 if(!state.currentUser) html=renderHome(); else if(state.screen==='standings') html=renderStandings(); else if(state.screen==='history') html=renderHistory(); else if(state.screen==='predictions') html=renderPredictions(); else if(state.screen==='commissioner') html=renderCommissioner(); else html=renderPicks();
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
 document.querySelectorAll('[data-history-week]').forEach(b=>b.onclick=()=>{state.historyWeek=b.dataset.historyWeek;save();render()});
 document.querySelectorAll('[data-pick]').forEach(b=>b.onclick=()=>{const [gid,team]=b.dataset.pick.split('|');ensurePickMap(gid);wk().picks[gid][user().id]={...(wk().picks[gid][user().id]||{}),team,updatedAt:new Date().toISOString()};save();render()});
 document.querySelectorAll('[data-margin]').forEach(i=>i.onchange=()=>{const gid=i.dataset.margin;ensurePickMap(gid);wk().picks[gid][user().id]={...(wk().picks[gid][user().id]||{}),margin:Number(i.value),updatedAt:new Date().toISOString()};save();render()});
 document.querySelectorAll('[data-act]').forEach(b=>b.onclick=async()=>{
   const a=b.dataset.act;
   if(a==='logout'){state.currentUser=null;state.screen='home';save();render()}
   if(a==='refresh-schedule'){await tryLoadSchedule()}
   if(a==='submit-week'){wk().submissions[user().id]={submittedAt:new Date().toISOString()};save();render()}
   if(a==='save-predictions'){const split=v=>v.split(',').map(x=>x.trim()).filter(Boolean);const c=split(document.querySelector('#confPred').value),s=split(document.querySelector('#sbPred').value);if(c.length!==4)return alert('Enter exactly 4 Conference Championship teams, separated by commas.');if(s.length!==2)return alert('Enter exactly 2 Super Bowl teams, separated by commas.');state.predictions.conference[user().id]=c;state.predictions.superBowl[user().id]=s;save();alert('Predictions saved.');render()}
   if(a==='score-week'){if(!user().admin)return;if(wk().scoredAt)return alert('This week is already scored. It will not be added to the season total twice.');if(!weekReadyToScore())return alert('The week cannot be scored until every NFL game has a confirmed FINAL result.');const counts=weeklyCheckCounts();const mult=playoffRoundMultiplier(wk().round);const pts=normalizeChecks(counts,mult);PLAYERS.forEach(p=>state.totals[p.id]=(state.totals[p.id]||0)+pts[p.id]);const at=new Date().toISOString();wk().scoredAt=at;wk().scoreSummary={checks:counts,points:pts,multiplier:mult,scoredAt:at};state.historyWeek=String(state.currentWeek);save();alert('Week scored, added to season totals, and saved to History.');render()}
   if(a==='reset-pin'){if(!user().admin)return;const n=prompt('Whose PIN? Yasin, Yezan, Samer, or Limar');const p=PLAYERS.find(x=>x.name.toLowerCase()===String(n||'').toLowerCase());if(!p)return alert('Player not found.');delete state.pins[p.id];wk().overrides.push({type:'pin-reset',target:p.id,by:'yasin',at:new Date().toISOString()});save();alert(`${p.name}'s PIN will be recreated next login.`);render()}
 })
}

if('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./service-worker.js').catch(()=>{});
render();
