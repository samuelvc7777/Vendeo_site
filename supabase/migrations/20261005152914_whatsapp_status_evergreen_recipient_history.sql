-- Persistent anti-repeat ledger for WhatsApp Evergreen Status distribution.
-- Backend-only: the gateway (service role) records and reads recipients.

create table if not exists public.whatsapp_status_story_recipients (
  story_key text not null,
  contact_key text not null,
  contact_id text,
  contact_number text,
  status_post_id text,
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (story_key, contact_key)
);

create index if not exists whatsapp_status_story_recipients_story_key_idx
  on public.whatsapp_status_story_recipients (story_key);

alter table public.whatsapp_status_story_recipients
  enable row level security;

revoke all on table public.whatsapp_status_story_recipients from anon, authenticated;
grant all on table public.whatsapp_status_story_recipients to service_role;

comment on table public.whatsapp_status_story_recipients is
  'Backend-only ledger of contacts that already received a deterministic Evergreen WhatsApp Status story.';
