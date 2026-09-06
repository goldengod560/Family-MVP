# Family NFL Picks — coded prototype v0.2

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
