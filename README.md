# Family NFL Picks — coded prototype v0.4

This is the second working prototype for Yasin's family NFL game.

## Run it
From this folder:

```bash
python3 -m http.server 8080
```
Then open `http://localhost:8080`.

## New in v0.2
- **History tab for everyone.** Once a week is scored, any player can reopen it and see every person's picks, margins, checks, final scores, weekly checks, and weekly points.
- History only exposes completed/scored weeks, so it does not bypass the current-week pick privacy rules.
- Week chips make it easy to jump back to Week 1, Week 2, etc.
- Team records are shown under team names when the schedule feed provides them.
- Scored weeks save a score summary into history.
- The commissioner scoring action is protected against accidentally adding the same week to season totals twice.

## Core rules already implemented
- Four players: Yasin (commissioner), Yezan, Samer, Limar.
- 4-digit PIN creation/login.
- Pick a team by tapping; winning margin is always entered.
- Individual games lock at kickoff; entire week also locks once everyone submits.
- Other players' picks are hidden in normal play until kickoff/all submitted.
- Commissioner status page always shows who submitted.
- **Yasin cannot inspect anyone else's actual picks until Yasin submits his own picks.**
- 2-2 split: both correct pickers receive checks.
- 3-1 lone correct picker: lone picker receives the check.
- 3+ correct-team pickers: margin contest.
- Equal distance with different margins: lower prediction wins.
- Same exact closest margin: both get the check.
- NFL tie: nobody gets a check.
- Weekly normalization: subtract the lowest check count from all players.
- Wild Card ×2, Divisional ×2, Conference Championship ×3.
- Cumulative season totals.
- Week 12 prediction entry: Conference Championship +2 each; Super Bowl +3 each.
- Commissioner override audit count scaffold.
- Super Bowl scoring engine includes first-place team choice and tied-second margin resolution.
- Auto schedule prototype attempts to load the NFL week from ESPN's public scoreboard endpoint and falls back to demo games.

## Important production step
This version still stores data in one browser. The actual four-phone app needs a shared backend (for example Supabase) so submissions, PINs, locks, history, live results, and Super Bowl margin races sync in real time.

The current schedule endpoint is useful for prototyping but is not an official guaranteed API. Production should use a stable NFL data provider or a small server-side adapter.


## v0.3 update note
- History is a permanent bottom-navigation tab for all players.
- Commissioner 'Pick Audit' was renamed to 'Commissioner Review'.
- The app now shows `v0.3` in the header so you can verify the deployed build.
- The service worker cache was versioned and now clears older app-shell caches, preventing GitHub Pages from continuing to show v0.1 after an update.
- Existing browser/localStorage game data is not intentionally cleared by this update.


## v0.4 scoring-safety fix
- Removed the **Enter Demo Finals** control. It was only a prototype test button and could create fake finals for games that had not been played.
- A week can no longer be scored until **every scheduled game has a confirmed FINAL result**.
- Schedule refresh only promotes scores into official results when the schedule feed marks the game complete/final.
- Future/in-progress games no longer display fake `Final:` lines. In-progress scores are labeled `LIVE`; completed games are labeled `FINAL`.
- Standings do not award or preview weekly points before the whole week is final.
- v0.4 automatically detects v0.3 demo-final contamination, removes those fake results, and rolls back points that were added from them while preserving picks, PINs, submissions, and non-demo overrides.

## v0.5 weekly report upgrade
- Header now identifies v0.5.
- After a scored week, the commissioner gets a Weekly Email Report card.
- The report includes every final score, every family pick/margin, check winners, weekly points, season totals, leaderboard, and override count.
- A commissioner can preview the exact report in the browser.
- `report.mjs` creates a stable report snapshot so later changes do not silently alter the historical report.
- A Supabase Edge Function + database migration are included for secure email delivery via Resend.
- The report recipient stays in a backend secret rather than being exposed in public GitHub Pages source.
- If the email backend is not configured yet, scoring/history still work; the report is retained locally and marked setup-required instead of pretending it was sent.

See `EMAIL_REPORT_SETUP.md` for backend configuration.
