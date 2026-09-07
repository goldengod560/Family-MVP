# Family NFL Picks v0.6

v0.6 is the first shared multi-phone test build.

## New in v0.6

- Shared Supabase backend: all four phones use the same picks, submissions, standings, history, and overrides.
- 4-digit family PINs stored as hashes in the database; the browser keeps a random session token rather than the PIN.
- Yasin's privacy rule is enforced on the backend: Yasin cannot receive other players' current-week picks until Yasin submits his own picks.
- Game-by-game kickoff locks.
- Late-pick override: Yasin can reopen one missed game for one player after kickoff; that player makes the pick on their own phone.
- Override events are logged and counted for the week.
- Team records appear under teams when provided by the NFL feed.
- Live/current NFL score refresh while the app is open.
- When all current-week games are final, the shared backend automatically calculates checks, normalization, and regular/playoff multipliers and makes the week available in History.
- History is shared with everyone and shows all completed picks, final scores, checks, weekly points, and override flags.
- Service worker no longer caches cross-origin NFL score responses.

## Before uploading to GitHub

Complete the one-time steps in `SUPABASE_SETUP.md`.

## Important v0.6 scope

The regular-season shared workflow is the priority in this build. Week 12 predictions are stored online, but their end-of-season bonus settlement and the special Super Bowl finalist/margin race are still scheduled for the playoff-logic build. Weekly email delivery also still needs its private sender function configured.
