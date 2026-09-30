-- Manual commercial follow-up status for finalized Instagram conversations.
-- This status is intentionally independent from Brain stages/objectives.

alter table public.instagram_conversations
  add column if not exists raffle_status text;

alter table public.instagram_conversations
  drop constraint if exists instagram_conversations_raffle_status_check;

alter table public.instagram_conversations
  add constraint instagram_conversations_raffle_status_check
  check (
    raffle_status is null
    or raffle_status in ('offered', 'bought', 'not_bought')
  );

comment on column public.instagram_conversations.raffle_status is
  'Manual raffle commercial follow-up status. Null means not offered yet; allowed values: offered, bought, not_bought.';
