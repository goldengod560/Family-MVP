import { PLAYERS, resolveGameChecks } from './logic.mjs';

function esc(s='') {
  return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
}

export function buildWeeklyReportData({ season, weekNumber, week, totals }) {
  if (!week?.scoredAt || !week?.scoreSummary) return null;
  const checks = week.scoreSummary.checks || {};
  const points = week.scoreSummary.points || {};
  const games = (week.games || []).map(g => {
    const r = week.results?.[g.id];
    const gameChecks = r?.final ? resolveGameChecks({
      picksByUser: week.picks?.[g.id] || {},
      homeTeam: g.home,
      awayTeam: g.away,
      homeScore: Number(r.homeScore),
      awayScore: Number(r.awayScore),
    }) : Object.fromEntries(PLAYERS.map(p => [p.id, false]));
    const winner = !r?.final || Number(r.homeScore) === Number(r.awayScore)
      ? null
      : (Number(r.homeScore) > Number(r.awayScore) ? g.home : g.away);
    return {
      id: g.id,
      away: g.away,
      awayName: g.awayName,
      home: g.home,
      homeName: g.homeName,
      awayScore: r?.final ? Number(r.awayScore) : null,
      homeScore: r?.final ? Number(r.homeScore) : null,
      winner,
      picks: PLAYERS.map(p => {
        const x = week.picks?.[g.id]?.[p.id];
        return {
          playerId: p.id,
          playerName: p.name,
          team: x?.team || null,
          margin: Number.isFinite(Number(x?.margin)) ? Number(x.margin) : null,
          check: Boolean(gameChecks[p.id]),
        };
      }),
    };
  });
  const leaderboard = PLAYERS
    .map(p => ({ playerId: p.id, playerName: p.name, total: Number(totals?.[p.id] || 0) }))
    .sort((a,b) => b.total - a.total || a.playerName.localeCompare(b.playerName));
  return {
    season: Number(season),
    week: Number(weekNumber),
    round: week.round || 'regular',
    scoredAt: week.scoredAt,
    overrideCount: (week.overrides || []).length,
    multiplier: Number(week.scoreSummary.multiplier || 1),
    weekly: PLAYERS.map(p => ({
      playerId: p.id,
      playerName: p.name,
      checks: Number(checks[p.id] || 0),
      points: Number(points[p.id] || 0),
      total: Number(totals?.[p.id] || 0),
    })),
    games,
    leaderboard,
  };
}

export function buildWeeklyReportHtml(report) {
  if (!report) return '';
  const games = report.games.map(g => `
    <div style="border:1px solid #dbe2ea;border-radius:12px;padding:14px;margin:12px 0">
      <div style="font-weight:800;font-size:16px">${esc(g.awayName)} ${g.awayScore ?? '—'} — ${g.homeScore ?? '—'} ${esc(g.homeName)}</div>
      <div style="color:#64748b;margin:4px 0 10px">${g.winner ? `Winner: ${esc(g.winner)}` : 'NFL tie / no winner'}</div>
      ${g.picks.map(p => `<div style="padding:3px 0">${esc(p.playerName)} — ${p.team ? `${esc(p.team)} by ${p.margin ?? '—'}` : 'No pick'} ${p.check ? '✅' : ''}</div>`).join('')}
    </div>`).join('');
  const weekly = report.weekly.map(x => `<tr><td style="padding:7px;border-bottom:1px solid #e5e7eb">${esc(x.playerName)}</td><td style="padding:7px;text-align:right;border-bottom:1px solid #e5e7eb">${x.checks}</td><td style="padding:7px;text-align:right;border-bottom:1px solid #e5e7eb">+${x.points}</td><td style="padding:7px;text-align:right;border-bottom:1px solid #e5e7eb"><b>${x.total}</b></td></tr>`).join('');
  const leaderboard = report.leaderboard.map((x,i) => `<tr><td style="padding:7px;border-bottom:1px solid #e5e7eb">${i+1}</td><td style="padding:7px;border-bottom:1px solid #e5e7eb">${esc(x.playerName)}</td><td style="padding:7px;text-align:right;border-bottom:1px solid #e5e7eb"><b>${x.total}</b></td></tr>`).join('');
  return `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#0f172a;max-width:760px;margin:auto;padding:20px">
    <h1 style="margin-bottom:4px">🏈 Family NFL Picks — Week ${report.week}</h1>
    <div style="color:#64748b">${report.season} season · ${esc(report.round)} · ${report.overrideCount} commissioner override${report.overrideCount===1?'':'s'}</div>
    <h2>Weekly results</h2>
    <table style="width:100%;border-collapse:collapse"><thead><tr><th style="text-align:left;padding:7px">Player</th><th style="text-align:right;padding:7px">Checks</th><th style="text-align:right;padding:7px">Week points</th><th style="text-align:right;padding:7px">Season total</th></tr></thead><tbody>${weekly}</tbody></table>
    <h2>Every game</h2>${games}
    <h2>Leaderboard</h2>
    <table style="width:100%;border-collapse:collapse"><thead><tr><th style="text-align:left;padding:7px">#</th><th style="text-align:left;padding:7px">Player</th><th style="text-align:right;padding:7px">Total</th></tr></thead><tbody>${leaderboard}</tbody></table>
  </body></html>`;
}
