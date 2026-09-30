-- Normalize cron discovery and throttle maintenance lanes without slowing
-- inbound processing or mature outbox delivery.

create index if not exists idx_brain_actions_due_global
  on public.brain_decision_actions (not_before, conversation_id, action_index)
  where status in ('pending', 'waiting_delay', 'sending', 'failed_retryable', 'dispatch_uncertain');

create or replace function public.list_due_brain_action_conversations(
  p_now timestamptz default now(),
  p_limit integer default 30
) returns table (
  conversation_id text,
  due_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    a.conversation_id,
    min(coalesce(a.not_before, a.created_at)) as due_at
  from public.brain_decision_actions a
  where a.status in ('pending', 'waiting_delay', 'sending', 'failed_retryable', 'dispatch_uncertain')
    and (a.not_before is null or a.not_before <= p_now)
  group by a.conversation_id
  order by min(coalesce(a.not_before, a.created_at)) asc
  limit greatest(1, least(coalesce(p_limit, 30), 100));
$$;

revoke all on function public.list_due_brain_action_conversations(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.list_due_brain_action_conversations(timestamptz, integer)
  to service_role;

create table if not exists public.autopilot_scheduler_lanes (
  lane text primary key,
  last_started_at timestamptz,
  updated_at timestamptz not null default clock_timestamp()
);

alter table public.autopilot_scheduler_lanes enable row level security;
revoke all on public.autopilot_scheduler_lanes from public, anon, authenticated;
grant select, insert, update on public.autopilot_scheduler_lanes to service_role;

create or replace function public.claim_autopilot_scheduler_lane(
  p_lane text,
  p_min_interval_seconds integer default 60
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_last_started timestamptz;
begin
  if nullif(btrim(p_lane), '') is null then
    return jsonb_build_object('success', false, 'reason', 'invalid_lane');
  end if;

  insert into public.autopilot_scheduler_lanes (lane)
  values (p_lane)
  on conflict (lane) do nothing;

  select l.last_started_at
    into v_last_started
  from public.autopilot_scheduler_lanes l
  where l.lane = p_lane
  for update;

  if v_last_started is not null
     and v_last_started > v_now - make_interval(
       secs => greatest(1, coalesce(p_min_interval_seconds, 60))
     ) then
    return jsonb_build_object(
      'success', true,
      'acquired', false,
      'last_started_at', v_last_started
    );
  end if;

  update public.autopilot_scheduler_lanes
  set last_started_at = v_now,
      updated_at = v_now
  where lane = p_lane;

  return jsonb_build_object(
    'success', true,
    'acquired', true,
    'started_at', v_now
  );
end;
$$;

revoke all on function public.claim_autopilot_scheduler_lane(text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_autopilot_scheduler_lane(text, integer)
  to service_role;

-- Legacy-only recovery: inspect JSON outbox only for entries that do not have
-- a normalized brain_decision_actions row. This lane runs infrequently.
create or replace function public.list_legacy_outbox_conversations(
  p_limit integer default 5
) returns table (
  conversation_id text
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id
  from public.instagram_conversations c
  where exists (
    select 1
    from jsonb_each(
      coalesce(c.stage_completed_rules->'orchestration'->'outbox', '{}'::jsonb)
    ) e
    left join public.brain_decision_actions a
      on a.id::text = coalesce(e.value->>'brainActionId', e.value->>'actionId')
      or a.idempotency_key = e.key
    where e.value->>'status' in ('pending', 'sending', 'dispatch_uncertain')
      and a.id is null
  )
  order by c.updated_at asc nulls first
  limit greatest(1, least(coalesce(p_limit, 5), 20));
$$;

revoke all on function public.list_legacy_outbox_conversations(integer)
  from public, anon, authenticated;
grant execute on function public.list_legacy_outbox_conversations(integer)
  to service_role;
