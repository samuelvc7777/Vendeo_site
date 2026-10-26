-- Mantém o histórico legado como primary; atribuição de número exige evidência.
begin;
alter table public.whatsapp_status_posts
  add column if not exists gateway_account_id text not null default 'primary';
create index if not exists idx_whatsapp_status_posts_account_created
  on public.whatsapp_status_posts (gateway_account_id, created_at desc);

alter table public.whatsapp_status_story_recipients
  add column if not exists gateway_account_id text not null default 'primary';
-- A PK antiga permanece compatível durante o rollout. Contas novas incluem
-- seu account-id no story_key; a conexão original mantém as chaves já publicadas.
create index if not exists idx_whatsapp_story_recipients_account_story
  on public.whatsapp_status_story_recipients (gateway_account_id, story_key);
commit;
