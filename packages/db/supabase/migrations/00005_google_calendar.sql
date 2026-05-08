-- Google Calendar OAuth: track access token expiry for refresh flow
alter table public.user_integrations
  add column if not exists expires_at timestamptz null;

comment on column public.user_integrations.expires_at is
  'When the OAuth access token expires (e.g. Google). Null for providers without expiry (e.g. GitHub PAT).';
