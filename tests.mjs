import assert from 'node:assert/strict';
import { resolveGameChecks, normalizeChecks, predictionBonus, canAdminInspectPicks, resolveSuperBowlChampion } from './logic.mjs';

// 3 correct -> margin contest, lower number wins equal difference.
let x=resolveGameChecks({homeTeam:'BAL',awayTeam:'NO',homeScore:24,awayScore:20,picksByUser:{yasin:{team:'BAL',margin:3},yezan:{team:'BAL',margin:5},samer:{team:'BAL',margin:9},limar:{team:'NO',margin:2}}});
assert.equal(x.yasin,true);assert.equal(x.yezan,false);
// Same exact closest margin -> both get check.
x=resolveGameChecks({homeTeam:'BAL',awayTeam:'NO',homeScore:24,awayScore:20,picksByUser:{yasin:{team:'BAL',margin:3},yezan:{team:'BAL',margin:3},samer:{team:'BAL',margin:9},limar:{team:'NO',margin:2}}});
assert.equal(x.yasin,true);assert.equal(x.yezan,true);
// 2-2 -> both correct get checks.
x=resolveGameChecks({homeTeam:'BAL',awayTeam:'NO',homeScore:24,awayScore:20,picksByUser:{yasin:{team:'BAL',margin:3},yezan:{team:'BAL',margin:8},samer:{team:'NO',margin:1},limar:{team:'NO',margin:2}}});
assert.equal(x.yasin,true);assert.equal(x.yezan,true);
// lone picker wins 3-1.
x=resolveGameChecks({homeTeam:'BAL',awayTeam:'NO',homeScore:20,awayScore:24,picksByUser:{yasin:{team:'BAL',margin:3},yezan:{team:'BAL',margin:8},samer:{team:'BAL',margin:1},limar:{team:'NO',margin:2}}});
assert.equal(x.limar,true);assert.equal(x.yasin,false);
// NFL tie -> nobody.
x=resolveGameChecks({homeTeam:'BAL',awayTeam:'NO',homeScore:20,awayScore:20,picksByUser:{yasin:{team:'BAL',margin:3},yezan:{team:'NO',margin:8}}});
assert.equal(Object.values(x).some(Boolean),false);
assert.deepEqual(normalizeChecks({yasin:3,yezan:4,samer:4,limar:5},1),{yasin:0,yezan:1,samer:1,limar:2});
assert.deepEqual(normalizeChecks({yasin:3,yezan:2,samer:1,limar:1},2),{yasin:4,yezan:2,samer:0,limar:0});
assert.deepEqual(predictionBonus({yasin:2,yezan:3,samer:3,limar:1},2),{yasin:2,yezan:4,samer:4,limar:0});
assert.equal(canAdminInspectPicks({adminUserId:'yasin',submissions:{yezan:{submittedAt:'x'}}}),false);
assert.equal(canAdminInspectPicks({adminUserId:'yasin',submissions:{yasin:{submittedAt:'x'}}}),true);
let sb=resolveSuperBowlChampion({firstUserId:'limar',firstTeam:'SEA',secondUserIds:['yezan','samer'],secondMargins:{yezan:3,samer:5},homeTeam:'SEA',awayTeam:'NE',homeScore:20,awayScore:24});
assert.deepEqual(sb.championUserIds,['yezan']); // actual margin 4, 3 beats 5 by lower-number rule
console.log('All scoring tests passed.');
