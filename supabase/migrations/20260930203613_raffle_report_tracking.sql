-- Historical commercial tracking for the raffle report.
-- Keeps the current status on instagram_conversations and records every transition
-- so daily/weekly/monthly/yearly reports remain historically accurate.

alter table public.instagram_conversations
  add column if not exists raffle_status_updated_at timestamptz,
  add column if not exists workflow_finalized_at timestamptz;

comment on column public.instagram_conversations.raffle_status_updated_at is
  'Timestamp of the latest manual raffle commercial status transition.';
comment on column public.instagram_conversations.workflow_finalized_at is
  'Normalized timestamp of the current workflow finalization; cleared when the chat is reopened.';

update public.instagram_conversations
set workflow_finalized_at = coalesce(
  case
    when coalesce(stage_completed_rules->>'finalized_at', '') ~ '^\\d{4}-\\d{2}-\\d{2}T'
      then (stage_completed_rules->>'finalized_at')::timestamptz
    else null
  end,
  case
    when coalesce(stage_completed_rules->'orchestration'->>'workflowCompletedAt', '') ~ '^\\d{4}-\\d{2}-\\d{2}T'
      then (stage_completed_rules->'orchestration'->>'workflowCompletedAt')::timestamptz
    else null
  end,
  case
    when coalesce(stage_completed_rules->'chat_progress'->>'updatedAt', '') ~ '^\\d{4}-\\d{2}-\\d{2}T'
      then (stage_completed_rules->'chat_progress'->>'updatedAt')::timestamptz
    else null
  end,
  updated_at,
  created_at,
  clock_timestamp()
)
where is_converted = true
  and workflow_finalized_at is null;

update public.instagram_conversations
set raffle_status_updated_at = coalesce(updated_at, clock_timestamp())
where raffle_status is not null
  and raffle_status_updated_at is null;

create index if not exists instagram_conversations_workflow_finalized_at_idx
  on public.instagram_conversations (workflow_finalized_at desc)
  where is_converted = true;

create index if not exists instagram_conversations_raffle_status_updated_at_idx
  on public.instagram_conversations (raffle_status_updated_at desc)
  where raffle_status is not null;

create table if not exists public.raffle_commercial_events (
  id bigint generated always as identity primary key,
  conversation_id text not null
    references public.instagram_conversations(id) on delete cascade,
  previous_status text,
  status text,
  changed_at timestamptz not null default clock_timestamp(),
  source text not null default 'operator',
  constraint raffle_commercial_events_previous_status_check check (
    previous_status is null
    or previous_status in ('offered', 'bought', 'not_bought')
  ),
  constraint raffle_commercial_events_status_check check (
    status is null
    or status in ('offered', 'bought', 'not_bought')
  )
);

comment on table public.raffle_commercial_events is
  'Append-only history of raffle commercial status transitions for reporting.';

alter table public.raffle_commercial_events enable row level security;

revoke all on table public.raffle_commercial_events from public, anon, authenticated;
grant select, insert on table public.raffle_commercial_events to service_role;
grant usage, select on sequence public.raffle_commercial_events_id_seq to service_role;

create index if not exists raffle_commercial_events_changed_at_idx
  on public.raffle_commercial_events (changed_at desc);

create index if not exists raffle_commercial_events_conversation_changed_at_idx
  on public.raffle_commercial_events (conversation_id, changed_at desc);

insert into public.raffle_commercial_events (
  conversation_id,
  previous_status,
  status,
  changed_at,
  source
)
select
  c.id,
  null,
  c.raffle_status,
  coalesce(c.raffle_status_updated_at, c.updated_at, clock_timestamp()),
  'backfill'
from public.instagram_conversations c
where c.raffle_status is not null
  and not exists (
    select 1
    from public.raffle_commercial_events e
    where e.conversation_id = c.id
  );

create or replace function public.maintain_raffle_report_tracking_fields()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.raffle_status is distinct from new.raffle_status then
    new.raffle_status_updated_at := clock_timestamp();
  end if;

  if coalesce(old.is_converted, false) is distinct from coalesce(new.is_converted, false) then
    if new.is_converted = true then
      new.workflow_finalized_at := clock_timestamp();
    else
      new.workflow_finalized_at := null;
    end if;
  elsif new.is_converted = true and new.workflow_finalized_at is null then
    new.workflow_finalized_at := clock_timestamp();
  end if;

  return new;
end;
$$;

revoke all on function public.maintain_raffle_report_tracking_fields() from public, anon, authenticated;

drop trigger if exists trg_maintain_raffle_report_tracking_fields
  on public.instagram_conversations;

create trigger trg_maintain_raffle_report_tracking_fields
before update on public.instagram_conversations
for each row
execute function public.maintain_raffle_report_tracking_fields();

create or replace function public.append_raffle_commercial_event()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.raffle_status is distinct from new.raffle_status then
    insert into public.raffle_commercial_events (
      conversation_id,
      previous_status,
      status,
      changed_at,
      source
    )
    values (
      new.id,
      old.raffle_status,
      new.raffle_status,
      coalesce(new.raffle_status_updated_at, clock_timestamp()),
      'operator'
    );
  end if;

  return new;
end;
$$;

revoke all on function public.append_raffle_commercial_event() from public, anon, authenticated;

drop trigger if exists trg_append_raffle_commercial_event
  on public.instagram_conversations;

create trigger trg_append_raffle_commercial_event
after update of raffle_status on public.instagram_conversations
for each row
execute function public.append_raffle_commercial_event();
