-- Add is_demo_user flag to profiles
-- Demo users get read-only (low-risk) tools only; write tools are blocked at the API layer.
alter table public.profiles
  add column if not exists is_demo_user boolean not null default false;

comment on column public.profiles.is_demo_user is
  'When true, the chat API restricts this user to low-risk (read-only) tools only. Used for the live portfolio demo account.';
