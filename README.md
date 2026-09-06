# Family NFL Picks — coded prototype v0.1

This is the first working prototype for Yasin's family NFL game.

## Run it
From this folder:

```bash
python3 -m http.server 8080
```
Then open `http://localhost:8080`.

## Already implemented
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

## Important next step
This version stores data in the browser so the UI and rules can be tested immediately. For the actual four-phone family app, the data layer needs to move to a shared backend (Supabase/Firebase/etc.) so submissions, PINs, locks, races for Super Bowl margins, and commissioner overrides sync in real time.

The current schedule endpoint is useful for prototyping but is not an official guaranteed API. Production should use a stable NFL data provider or a small server-side adapter.
