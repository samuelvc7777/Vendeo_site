-- Scale AutoPilot state/realtime beyond hundreds of simultaneously enabled chats.
-- Removes the single __autopilot_states__ hot-row from the write path.

alter table public.instagram_conversations
  add column if not exists is_converted boolean not null default false;

update public.instagram_conversations
set is_converted = case
  when stage_completed_rules->'chat_progress'->>'isConverted' in ('true','false')
    then (stage_completed_rules->'chat_progress'->>'isConverted')::boolean
  when stage_completed_rules->'orchestration'->>'isConverted' in ('true','false')
    then (stage_completed_rules->'orchestration'->>'isConverted')::boolean
  else false
end
where left(id, 2) <> '__';

create table if not exists public.autopilot_chat_states (
  conversation_id text primary key references public.instagram_conversations(id) on delete cascade,
  is_enabled boolean not null default false,
  status text not null default 'idle',
  state jsonb not null default '{}'::jsonb,
  state_revision bigint not null default 0,
  state_updated_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create index if not exists idx_autopilot_chat_states_enabled_status
  on public.autopilot_chat_states (is_enabled, status);
create index if not exists idx_autopilot_chat_states_updated
  on public.autopilot_chat_states (state_updated_at desc);
create index if not exists idx_instagram_conversations_autopilot_due
  on public.instagram_conversations (ai_debounce_until, last_message_at)
  where ai_auto_respond is true and left(id, 2) <> '__';
create index if not exists idx_instagram_conversations_stage_summary
  on public.instagram_conversations (current_stage_id, is_converted)
  where left(id, 2) <> '__';

alter table public.autopilot_chat_states enable row level security;
drop policy if exists autopilot_chat_states_read on public.autopilot_chat_states;
create policy autopilot_chat_states_read
  on public.autopilot_chat_states for select
  to anon, authenticated
  using (true);
grant select on public.autopilot_chat_states to anon, authenticated;
grant select, insert, update, delete on public.autopilot_chat_states to service_role;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'autopilot_chat_states'
  ) then
    alter publication supabase_realtime add table public.autopilot_chat_states;
  end if;
end $$;
-- Backfill the old global projection once, stripping the bulky cycleEvents array.
insert into public.autopilot_chat_states (
  conversation_id, is_enabled, status, state, state_revision, state_updated_at, updated_at
)
select
  e.key,
  coalesce(c.ai_auto_respond, false),
  case
    when coalesce(c.ai_auto_respond, false) is false then 'disabled'
    else coalesce(nullif(e.value->>'status', ''), 'idle')
  end,
  (e.value - 'cycleEvents' - 'isEnabled' - 'conversationId' - 'stateRevision' - 'stateUpdatedAt')
    || jsonb_build_object(
      'conversationId', e.key,
      'isEnabled', coalesce(c.ai_auto_respond, false),
      'status', case when coalesce(c.ai_auto_respond, false) is false then 'disabled'
                     else coalesce(nullif(e.value->>'status', ''), 'idle') end,
      'stateRevision', 1,
      'stateUpdatedAt', coalesce(c.updated_at, clock_timestamp())
    ),
  1,
  coalesce(c.updated_at, clock_timestamp()),
  clock_timestamp()
from public.instagram_conversations sys
cross join lateral jsonb_each(coalesce(sys.stage_completed_rules->'states', '{}'::jsonb)) e
join public.instagram_conversations c on c.id = e.key
where sys.id = '__autopilot_states__'
on conflict (conversation_id) do nothing;
create or replace function public.patch_autopilot_projection_state_atomic(
  p_conversation_id text,
  p_state_patch jsonb,
  p_expected_state_updated_at timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_enabled boolean;
  v_current jsonb;
  v_next jsonb;
  v_current_at timestamptz;
  v_patch_at timestamptz;
  v_revision bigint;
  v_now timestamptz;
begin
  if p_conversation_id is null
     or p_conversation_id in ('__autopilot_states__', '__autopilot_config__')
     or p_state_patch is null
     or jsonb_typeof(p_state_patch) <> 'object'
     or octet_length(p_state_patch::text) > 32768 then
    return jsonb_build_object('success', false, 'reason', 'invalid_projection_patch');
  end if;

  select coalesce(ai_auto_respond, false)
    into v_enabled
  from public.instagram_conversations
  where id = p_conversation_id;
  if not found then
    return jsonb_build_object('success', false, 'reason', 'conversation_not_found');
  end if;
  insert into public.autopilot_chat_states (
    conversation_id, is_enabled, status, state, state_revision
  ) values (
    p_conversation_id,
    v_enabled,
    case when v_enabled then 'idle' else 'disabled' end,
    jsonb_build_object(
      'conversationId', p_conversation_id,
      'isEnabled', v_enabled,
      'status', case when v_enabled then 'idle' else 'disabled' end
    ),
    0
  )
  on conflict (conversation_id) do nothing;

  select state, state_updated_at, state_revision
    into v_current, v_current_at, v_revision
  from public.autopilot_chat_states
  where conversation_id = p_conversation_id
  for update;

  begin
    v_patch_at := nullif(p_state_patch->>'stateUpdatedAt', '')::timestamptz;
  exception when others then
    return jsonb_build_object('success', false, 'reason', 'invalid_state_version');
  end;

  if v_patch_at is not null and v_patch_at < v_current_at then
    return jsonb_build_object(
      'success', true, 'applied', false, 'isEnabled', v_enabled,
      'stateUpdatedAt', v_current_at, 'stateRevision', v_revision,
      'state', v_current
    );
  end if;
  if p_expected_state_updated_at is not null
     and v_current_at is distinct from p_expected_state_updated_at then
    return jsonb_build_object(
      'success', true, 'applied', false, 'isEnabled', v_enabled,
      'stateUpdatedAt', v_current_at, 'stateRevision', v_revision,
      'state', v_current
    );
  end if;

  v_now := clock_timestamp();
  v_revision := v_revision + 1;
  v_next := coalesce(v_current, '{}'::jsonb)
    || (p_state_patch - 'isEnabled' - 'conversationId' - 'stateRevision' - 'cycleEvents');
  v_next := jsonb_set(v_next, '{conversationId}', to_jsonb(p_conversation_id), true);
  v_next := jsonb_set(v_next, '{isEnabled}', to_jsonb(v_enabled), true);
  v_next := jsonb_set(v_next, '{stateUpdatedAt}', to_jsonb(v_now), true);
  v_next := jsonb_set(v_next, '{stateRevision}', to_jsonb(v_revision), true);
  v_next := v_next - 'cycleEvents';

  if not v_enabled then
    v_next := jsonb_set(v_next, '{status}', '"disabled"'::jsonb, true);
  elsif v_next->>'status' = 'disabled' then
    v_next := jsonb_set(v_next, '{status}', '"idle"'::jsonb, true);
  end if;

  update public.autopilot_chat_states
  set is_enabled = v_enabled,
      status = coalesce(nullif(v_next->>'status', ''), case when v_enabled then 'idle' else 'disabled' end),
      state = v_next,
      state_revision = v_revision,
      state_updated_at = v_now,
      updated_at = v_now
  where conversation_id = p_conversation_id;
  return jsonb_build_object(
    'success', true,
    'applied', true,
    'isEnabled', v_enabled,
    'stateUpdatedAt', v_now,
    'stateRevision', v_revision,
    'previousState', v_current,
    'state', v_next
  );
end;
$$;

revoke all on function public.patch_autopilot_projection_state_atomic(text, jsonb, timestamptz) from public;
grant execute on function public.patch_autopilot_projection_state_atomic(text, jsonb, timestamptz)
  to anon, authenticated, service_role;

create or replace function public.sync_autopilot_projection_enabled()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_state jsonb;
begin
  if left(new.id, 2) = '__' then return new; end if;

  insert into public.autopilot_chat_states (
    conversation_id, is_enabled, status, state, state_revision, state_updated_at, updated_at
  ) values (
    new.id,
    coalesce(new.ai_auto_respond, false),
    case when coalesce(new.ai_auto_respond, false) then 'idle' else 'disabled' end,
    jsonb_build_object(
      'conversationId', new.id,
      'isEnabled', coalesce(new.ai_auto_respond, false),
      'status', case when coalesce(new.ai_auto_respond, false) then 'idle' else 'disabled' end,
      'stateRevision', 1,
      'stateUpdatedAt', v_now
    ),
    1, v_now, v_now
  )
  on conflict (conversation_id) do nothing;
  select state into v_state
  from public.autopilot_chat_states
  where conversation_id = new.id
  for update;

  v_state := coalesce(v_state, '{}'::jsonb);
  v_state := jsonb_set(v_state, '{conversationId}', to_jsonb(new.id), true);
  v_state := jsonb_set(v_state, '{isEnabled}', to_jsonb(coalesce(new.ai_auto_respond, false)), true);

  if coalesce(new.ai_auto_respond, false) is false then
    v_state := jsonb_set(v_state, '{status}', '"disabled"'::jsonb, true);
    v_state := jsonb_set(v_state, '{activity}', 'null'::jsonb, true);
    v_state := jsonb_set(v_state, '{scheduledResponseAt}', 'null'::jsonb, true);
  elsif v_state->>'status' = 'disabled' then
    v_state := jsonb_set(v_state, '{status}', '"idle"'::jsonb, true);
  end if;

  update public.autopilot_chat_states
  set is_enabled = coalesce(new.ai_auto_respond, false),
      status = coalesce(v_state->>'status', 'idle'),
      state_revision = state_revision + 1,
      state_updated_at = v_now,
      updated_at = v_now,
      state = jsonb_set(
        jsonb_set(v_state, '{stateUpdatedAt}', to_jsonb(v_now), true),
        '{stateRevision}', to_jsonb(state_revision + 1), true
      )
  where conversation_id = new.id;

  return new;
end;
$$;

drop trigger if exists trg_sync_autopilot_projection_enabled on public.instagram_conversations;
create trigger trg_sync_autopilot_projection_enabled
after insert or update of ai_auto_respond on public.instagram_conversations
for each row execute function public.sync_autopilot_projection_enabled();

-- Normalize the conversion bit used by the inbox filters. This keeps list reads
-- independent from the large stage_completed_rules JSON without changing Brain authority.
create or replace function public.sync_conversation_is_converted()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if left(new.id, 2) = '__' then return new; end if;
  new.is_converted := case
    when new.stage_completed_rules->'chat_progress'->>'isConverted' in ('true','false')
      then (new.stage_completed_rules->'chat_progress'->>'isConverted')::boolean
    when new.stage_completed_rules->'orchestration'->>'isConverted' in ('true','false')
      then (new.stage_completed_rules->'orchestration'->>'isConverted')::boolean
    else coalesce(new.is_converted, false)
  end;
  return new;
end;
$$;

drop trigger if exists trg_sync_conversation_is_converted on public.instagram_conversations;
create trigger trg_sync_conversation_is_converted
before insert or update of stage_completed_rules on public.instagram_conversations
for each row execute function public.sync_conversation_is_converted();

-- Lightweight scheduler query: return only fields consumed by the worker.
create or replace function public.list_autopilot_due_work(
  p_now timestamptz default now(),
  p_limit integer default 20
) returns table(id text, stage_completed_rules jsonb)
language sql
security definer
set search_path = public
as $$
  select c.id, c.stage_completed_rules
  from public.instagram_conversations c
  where c.ai_auto_respond is true
    and left(c.id, 2) <> '__'
    and (c.ai_debounce_until is null or c.ai_debounce_until <= p_now)
    and exists (
      select 1
      from public.instagram_messages m
      where m.conversation_id = c.id
        and m.is_mine is false
        and m.created_at >= p_now - interval '48 hours'
        and coalesce(c.stage_completed_rules->'orchestration'->'messageLedger'->>m.id, 'pending') <> 'processed'
    )
    and (
      coalesce((c.stage_completed_rules->'orchestration'->>'technicalRetryCount')::int, 0) < 3
      or exists (
        select 1
        from public.instagram_messages newer
        where newer.conversation_id = c.id
          and newer.is_mine is false
          and newer.created_at >
            (c.stage_completed_rules->'orchestration'->>'technicalRetryExhaustedAt')::timestamptz
          and coalesce(c.stage_completed_rules->'orchestration'->'messageLedger'->>newer.id, 'pending') <> 'processed'
      )
    )
  order by c.ai_debounce_until asc nulls first, c.last_message_at asc nulls first
  limit greatest(1, least(coalesce(p_limit, 20), 100));
$$;
revoke all on function public.list_autopilot_due_work(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.list_autopilot_due_work(timestamptz, integer)
  to service_role;

-- Cover Brain foreign keys used by joins, cleanup and recovery paths.
create index if not exists idx_brain_decisions_conversation_id
  on public.brain_decisions(conversation_id);
create index if not exists idx_brain_decisions_session_id
  on public.brain_decisions(session_id);
create index if not exists idx_brain_manual_facts_session_id
  on public.brain_manual_facts(session_id);
create index if not exists idx_brain_manual_facts_turn_id
  on public.brain_manual_facts(turn_id);
create index if not exists idx_brain_turn_events_action_id
  on public.brain_turn_events(action_id);
create index if not exists idx_brain_turn_events_decision_id
  on public.brain_turn_events(decision_id);
create index if not exists idx_brain_turn_events_session_id
  on public.brain_turn_events(session_id);
create index if not exists idx_brain_turn_events_turn_id
  on public.brain_turn_events(turn_id);

-- The worker is backend-owned. 15s keeps the queue responsive without one
-- additional cron request for every open browser tab.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'autopilot-cron-tick') then
    perform cron.unschedule('autopilot-cron-tick');
  end if;
end $$;

select cron.schedule(
  'autopilot-cron-tick',
  '15 seconds',
  $job$
    select net.http_post(
      url := 'https://wsdualhvopidgqcumonr.supabase.co/functions/v1/api/autopilot/cron-tick',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'X-Autopilot-Cron-Token', (
          select decrypted_secret
          from vault.decrypted_secrets
          where name = 'autopilot_cron_token'
          order by created_at desc
          limit 1
        )
      ),
      body := '{}'::jsonb,
      timeout_milliseconds := 15000
    );
  $job$
);
-- Global Brain execution semaphore. Hundreds of chats may be enabled, while
-- a bounded number of expensive orchestration cycles execute concurrently.
create table if not exists public.brain_execution_slots (
  slot_no smallint primary key check (slot_no > 0),
  lease_token text,
  conversation_id text references public.instagram_conversations(id) on delete set null,
  cycle_token text,
  acquired_at timestamptz,
  leased_until timestamptz,
  updated_at timestamptz not null default clock_timestamp()
);

insert into public.brain_execution_slots(slot_no)
select generate_series(1, 6)::smallint
on conflict (slot_no) do nothing;

create unique index if not exists uq_brain_execution_slots_lease
  on public.brain_execution_slots(lease_token)
  where lease_token is not null;
create unique index if not exists uq_brain_execution_slots_cycle
  on public.brain_execution_slots(cycle_token)
  where cycle_token is not null;

alter table public.brain_execution_slots enable row level security;
revoke all on public.brain_execution_slots from public, anon, authenticated;
grant select, insert, update, delete on public.brain_execution_slots to service_role;
create or replace function public.claim_brain_execution_slot(
  p_conversation_id text,
  p_cycle_token text,
  p_lease_seconds integer default 600
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot_no smallint;
  v_lease_token text;
  v_leased_until timestamptz;
  v_active integer;
  v_capacity integer;
begin
  if nullif(btrim(p_conversation_id), '') is null
     or nullif(btrim(p_cycle_token), '') is null then
    return jsonb_build_object('success', false, 'reason', 'invalid_slot_claim');
  end if;

  select slot_no, lease_token, leased_until
    into v_slot_no, v_lease_token, v_leased_until
  from public.brain_execution_slots
  where cycle_token = p_cycle_token
    and leased_until > clock_timestamp()
  limit 1;

  if found then
    return jsonb_build_object(
      'success', true, 'acquired', true, 'slotNo', v_slot_no,
      'leaseToken', v_lease_token, 'leasedUntil', v_leased_until
    );
  end if;
  with candidate as (
    select slot_no
    from public.brain_execution_slots
    where lease_token is null
       or leased_until is null
       or leased_until <= clock_timestamp()
    order by slot_no
    for update skip locked
    limit 1
  )
  update public.brain_execution_slots s
  set lease_token = p_cycle_token || ':' || txid_current()::text || ':' || s.slot_no::text,
      conversation_id = p_conversation_id,
      cycle_token = p_cycle_token,
      acquired_at = clock_timestamp(),
      leased_until = clock_timestamp()
        + make_interval(secs => greatest(60, least(coalesce(p_lease_seconds, 600), 900))),
      updated_at = clock_timestamp()
  from candidate c
  where s.slot_no = c.slot_no
  returning s.slot_no, s.lease_token, s.leased_until
  into v_slot_no, v_lease_token, v_leased_until;

  if found then
    return jsonb_build_object(
      'success', true, 'acquired', true, 'slotNo', v_slot_no,
      'leaseToken', v_lease_token, 'leasedUntil', v_leased_until
    );
  end if;

  select count(*)::integer into v_active
  from public.brain_execution_slots
  where leased_until > clock_timestamp();
  select count(*)::integer into v_capacity
  from public.brain_execution_slots;
  return jsonb_build_object(
    'success', true,
    'acquired', false,
    'reason', 'capacity_busy',
    'active', coalesce(v_active, 0),
    'capacity', coalesce(v_capacity, 0)
  );
end;
$$;

create or replace function public.release_brain_execution_slot(
  p_lease_token text,
  p_cycle_token text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot_no smallint;
begin
  update public.brain_execution_slots
  set lease_token = null,
      conversation_id = null,
      cycle_token = null,
      acquired_at = null,
      leased_until = null,
      updated_at = clock_timestamp()
  where lease_token = p_lease_token
    and cycle_token = p_cycle_token
  returning slot_no into v_slot_no;

  return jsonb_build_object(
    'success', true,
    'released', found,
    'slotNo', v_slot_no
  );
end;
$$;
revoke all on function public.claim_brain_execution_slot(text, text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_brain_execution_slot(text, text, integer)
  to service_role;

revoke all on function public.release_brain_execution_slot(text, text)
  from public, anon, authenticated;
grant execute on function public.release_brain_execution_slot(text, text)
  to service_role;
