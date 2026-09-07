# Automatic weekly email report setup (v0.5)

The public GitHub Pages site cannot safely store an email provider secret, so automatic email is handled by a Supabase Edge Function.

## What the report contains
- Every NFL game and final score
- Winning team
- Yasin, Yezan, Samer, and Limar's picks and margins
- Check winners for each matchup
- Weekly checks and normalized points
- Season totals and leaderboard
- Commissioner override count

## Supabase / Resend setup
1. Create a Supabase project.
2. Run `supabase/migrations/001_weekly_reports.sql`.
3. Deploy `supabase/functions/send-weekly-report`.
4. Add these Edge Function secrets:
   - `RESEND_API_KEY`
   - `REPORT_RECIPIENT` — set this to the email address that should receive the family report.
   - `REPORT_FROM` — a sender address/domain accepted by Resend.
   - `ALLOWED_ORIGIN` — your GitHub Pages origin, e.g. `https://YOURNAME.github.io`
5. Put the deployed Edge Function URL in `config.js` as `reportWebhookUrl`.

The recipient is intentionally NOT hard-coded in the public repository so a personal email address does not get published on GitHub.

## Current v0.5 trigger
When a completed week is scored, the app generates the report and tries to send it immediately if `reportWebhookUrl` is configured. A report can also be previewed/retried from the Commissioner page.

## Final-version trigger
Once the shared backend/live score worker is connected, the report should be queued automatically after the final game is confirmed and the week's scoring is finalized. Nobody will need to keep the browser open.
