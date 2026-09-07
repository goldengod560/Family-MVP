# Supabase setup for v0.6

The GitHub site remains the link everyone opens. Supabase only stores the shared family data behind the scenes.

## One-time setup

1. Open your Supabase project.
2. Open **SQL Editor**.
3. Create a **New query**.
4. Open this file from the v0.6 download:
   `supabase/migrations/002_shared_family_backend.sql`
5. Copy the entire SQL file into the SQL Editor and press **Run** once.
6. Upload the v0.6 website files to GitHub, replacing the old version.
7. Open the GitHub Pages link. The top should say **v0.6 · Shared online**.

The Project URL and publishable key are already placed in `config.js`. The app uses the base project URL, not the `/rest/v1/` URL.

## First login

Each person taps their name and enters a 4-digit PIN. The first 4-digit PIN used for that name becomes that player's PIN. After that, the same PIN works from another phone.

If someone forgets a PIN, Yasin can reset it from **Commish -> Reset Player PIN**. The player then creates a new PIN on the next login.

## Late-pick override

After a game starts, a missing pick is locked. In Yasin's Commissioner Review, that game will show **Allow Late Pick** next to a player who has no saved pick.

When Yasin authorizes it:
- only that player + that game are reopened;
- the player makes the pick on their own phone;
- nobody else's picks are shown to the late picker;
- the game stays open only under the active override;
- once the player submits the week, that override is marked used and the game relocks;
- the week's override counter increases.

Yasin must submit his own picks before he can inspect other people's picks or authorize someone else's late pick.

## Live NFL data in v0.6

Whenever a family member opens the app, and every two minutes while it is open, the browser asks the NFL scoreboard feed for the current schedule, records, status, and scores and saves that shared data to Supabase. When every game for the active week is FINAL, the backend automatically calculates the week and puts it into History.

This means v0.6 no longer requires Yasin to press a scoring button. It still depends on at least one family member opening the app for score refreshes. A later backend job can refresh scores even when nobody has the site open.
