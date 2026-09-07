create table if not exists public.weekly_report_delivery (
  season integer not null,
  week integer not null,
  sent_at timestamptz,
  provider_id text,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (season, week)
);

alter table public.weekly_report_delivery enable row level security;
-- No public policies: this table is server-only through the Edge Function service role.
