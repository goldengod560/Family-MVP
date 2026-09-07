# Family NFL Picks v0.7

v0.7 is the feature-complete regular-season test build for Yasin, Yezan, Samer, and Limar.

## New in v0.7

- End-of-week celebration shown once per player:
  - Week winner(s) + points earned.
  - Automatically transitions after 1.8 seconds to the updated leaderboard.
  - White X to close and a button to open that week's History.
- Leaderboard now shows weekly `+points`, season total, and rank movement.
- Pick progress for all players (`12 / 16 picked`) on Status/Commissioner screens.
- Clear matchup states: `OPEN / LOCKS IN / LOCKED / MISSED / OVERRIDE OPEN / LIVE / FINAL`.
- Warning when the logged-in player is within 60 minutes of kickoff and still has no complete pick.
- Five-minute late-pick override:
  - Yasin authorizes one player + one game.
  - Player makes the pick on their own phone.
  - Visible countdown.
  - The game relocks immediately when the late pick is saved or when five minutes expire.
- Commissioner Edit for an already locked saved pick:
  - Requires a reason.
  - Stores old pick -> new pick.
  - Permanently logged.
- Override activity is visible to everyone on the existing Status/Commish page; no extra tab.
- Completed History now includes:
  - every matchup and final score,
  - every pick/margin/check,
  - that week's points,
  - total leaderboard after that week,
  - rank movement,
  - full override details.
- Shared state refreshes every 15 seconds while the page is idle; NFL scores refresh every 2 minutes.
- Weekly email report payload now includes games, picks, checks, weekly points, totals, leaderboard, and overrides.

## REQUIRED Supabase update

Do **not** rerun the old 002 backend setup.

Run only:

`RUN_THIS_IN_SUPABASE_FOR_V07.sql`

in Supabase -> SQL Editor -> New query -> Run.

It is an incremental migration and does not intentionally clear existing PINs, picks, or scores.

Then upload the v0.7 website files to GitHub, replacing v0.6.1.

## Weekly email

The web app is wired to the `send-weekly-report` Supabase Edge Function. The function still needs to be deployed once and needs the private Resend/email secrets described in `EMAIL_REPORT_SETUP.md`. Do not put those private secrets in GitHub.
