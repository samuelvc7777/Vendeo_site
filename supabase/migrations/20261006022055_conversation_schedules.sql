-- Conversation schedules / multi-journey orchestration
-- Preserves the current sales funnel as schedule_sales while allowing later schedules
-- with optional stages/objectives, per-schedule model and fixed/range response timing.

create table if not exists public.conversation_schedules (
  id text primary key,
  name text not null,
  description text,
  category text not null default 'custom',
  schedule_order integer not null default 0,
  is_active boolean not null default true,
  duration_minutes integer,
  response_delay_mode text not null default 'fixed',
  response_delay_fixed_seconds integer,
  response_delay_min_seconds integer,
  response_delay_max_seconds integer,
  brain_model text not null default 'gpt-6.1-sol',
  created_at timestamptz not null default timezone('America/Sao_Paulo'::text, now()),
  updated_at timestamptz not null default timezone('America/Sao_Paulo'::text, now()),
  constraint conversation_schedules_duration_check
    check (duration_minutes is null or duration_minutes > 0),
  constraint conversation_schedules_category_check
    check (category in ('sales', 'post_sale', 'relationship', 'reactivation', 'custom')),
  constraint conversation_schedules_delay_mode_check
    check (response_delay_mode in ('fixed', 'range')),
  constraint conversation_schedules_brain_model_check
    check (brain_model in ('gpt-6-luna', 'gpt-6-sol', 'gpt-6.1-sol')),
  constraint conversation_schedules_delay_contract_check
    check (
      (
        response_delay_mode = 'fixed'
        and response_delay_fixed_seconds is not null
        and response_delay_fixed_seconds >= 0
      )
      or
      (
        response_delay_mode = 'range'
        and response_delay_min_seconds is not null
        and response_delay_max_seconds is not null
        and response_delay_min_seconds >= 0
        and response_delay_max_seconds >= response_delay_min_seconds
      )
    )
);

create index if not exists conversation_schedules_order_idx
  on public.conversation_schedules (is_active, schedule_order, id);

alter table public.conversation_schedules enable row level security;

drop policy if exists vendeo_anon_app_access on public.conversation_schedules;
create policy vendeo_anon_app_access
  on public.conversation_schedules
  for all
  to anon, authenticated
  using (true)
  with check (true);

grant select, insert, update, delete on public.conversation_schedules to anon, authenticated, service_role;

insert into public.conversation_schedules (
  id,
  name,
  description,
  category,
  schedule_order,
  is_active,
  duration_minutes,
  response_delay_mode,
  response_delay_fixed_seconds,
  brain_model
) values (
  'schedule_sales',
  'Venda',
  'Cronograma comercial original do Vendeo, migrado sem alterar o comportamento existente.',
  'sales',
  0,
  true,
  null,
  'fixed',
  180,
  coalesce(
    nullif((select app_secret from public.instagram_config where id = 'openai_brain_model'), ''),
    'gpt-6.1-sol'
  )
)
on conflict (id) do update
set updated_at = timezone('America/Sao_Paulo'::text, now());

alter table public.chat_stages
  add column if not exists schedule_id text,
  add column if not exists is_required boolean not null default true;

update public.chat_stages
   set schedule_id = 'schedule_sales'
 where schedule_id is null;

alter table public.chat_stages
  alter column schedule_id set not null;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conname = 'chat_stages_schedule_id_fkey'
       and conrelid = 'public.chat_stages'::regclass
  ) then
    alter table public.chat_stages
      add constraint chat_stages_schedule_id_fkey
      foreign key (schedule_id)
      references public.conversation_schedules(id)
      on delete restrict;
  end if;
end
$$;

-- Remove empates históricos de stage_order sem alterar a sequência lógica atual.
-- created_at preserva a ordem anterior quando duas etapas tinham a mesma posição.
with ranked_stages as (
  select
    id,
    row_number() over (
      partition by schedule_id
      order by stage_order asc, created_at asc, id asc
    ) - 1 as normalized_order
  from public.chat_stages
)
update public.chat_stages s
   set stage_order = r.normalized_order,
       updated_at = timezone('America/Sao_Paulo'::text, now())
  from ranked_stages r
 where r.id = s.id
   and s.stage_order is distinct from r.normalized_order;

create index if not exists chat_stages_schedule_order_idx
  on public.chat_stages (schedule_id, stage_order, id);

-- Existing objectives remain mandatory. Missing required flags are normalized to true.
update public.chat_stages s
set goals = coalesce((
  select jsonb_agg(
    case
      when jsonb_typeof(g.goal) = 'object' and not (g.goal ? 'required')
        then g.goal || jsonb_build_object('required', true)
      else g.goal
    end
    order by g.ord
  )
  from jsonb_array_elements(
    case when jsonb_typeof(s.goals) = 'array' then s.goals else '[]'::jsonb end
  ) with ordinality as g(goal, ord)
), '[]'::jsonb),
updated_at = timezone('America/Sao_Paulo'::text, now());

create table if not exists public.conversation_schedule_runs (
  id uuid primary key default gen_random_uuid(),
  conversation_id text not null references public.instagram_conversations(id) on delete cascade,
  schedule_id text not null references public.conversation_schedules(id) on delete restrict,
  status text not null default 'active',
  started_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz,
  current_stage_id text references public.chat_stages(id) on delete set null,
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint conversation_schedule_runs_status_check
    check (status in ('active', 'completed', 'expired', 'expired_incomplete', 'cancelled'))
);

create unique index if not exists conversation_schedule_runs_one_active_idx
  on public.conversation_schedule_runs (conversation_id)
  where status = 'active';

create index if not exists conversation_schedule_runs_schedule_idx
  on public.conversation_schedule_runs (schedule_id, status, expires_at);

create index if not exists conversation_schedule_runs_expiry_idx
  on public.conversation_schedule_runs (expires_at)
  where status = 'active' and expires_at is not null;

alter table public.conversation_schedule_runs enable row level security;
revoke all on public.conversation_schedule_runs from public, anon, authenticated;
grant select, insert, update, delete on public.conversation_schedule_runs to service_role;

create or replace function public.ensure_conversation_schedule_run_atomic(
  p_conversation_id text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conv public.instagram_conversations%rowtype;
  v_run public.conversation_schedule_runs%rowtype;
  v_last_run public.conversation_schedule_runs%rowtype;
  v_schedule public.conversation_schedules%rowtype;
  v_stage public.chat_stages%rowtype;
  v_next_schedule public.conversation_schedules%rowtype;
  v_next_stage public.chat_stages%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  select *
    into v_conv
    from public.instagram_conversations
   where id = p_conversation_id
   for update;

  if not found then
    return jsonb_build_object('success', false, 'reason', 'conversation_not_found');
  end if;

  select *
    into v_run
    from public.conversation_schedule_runs
   where conversation_id = p_conversation_id
     and status = 'active'
   order by started_at desc
   limit 1
   for update;

  if found then
    select * into v_schedule
      from public.conversation_schedules
     where id = v_run.schedule_id;

    select * into v_stage
      from public.chat_stages
     where id = coalesce(v_conv.current_stage_id, v_run.current_stage_id)
       and schedule_id = v_run.schedule_id;

    if not found then
      select * into v_stage
        from public.chat_stages
       where schedule_id = v_run.schedule_id
       order by stage_order asc, id asc
       limit 1;
    end if;

    if v_stage.id is not null then
      update public.conversation_schedule_runs
         set current_stage_id = v_stage.id,
             updated_at = v_now
       where id = v_run.id;
      update public.instagram_conversations
         set current_stage_id = v_stage.id
       where id = p_conversation_id
         and current_stage_id is distinct from v_stage.id;
    end if;
  else
    select *
      into v_last_run
      from public.conversation_schedule_runs
     where conversation_id = p_conversation_id
     order by started_at desc, created_at desc
     limit 1;

    if found and v_last_run.status = 'expired_incomplete' then
      return jsonb_build_object(
        'success', false,
        'reason', 'schedule_expired_incomplete',
        'schedule_id', v_last_run.schedule_id,
        'run_id', v_last_run.id
      );
    end if;

    if coalesce(v_conv.stage_completed_rules->>'workflow_finalized', 'false') = 'true' then
      return jsonb_build_object('success', false, 'reason', 'workflow_finalized');
    end if;

    select s.*
      into v_stage
      from public.chat_stages s
      join public.conversation_schedules cs on cs.id = s.schedule_id
     where s.id = v_conv.current_stage_id
       and cs.is_active = true
     limit 1;

    if found then
      select * into v_schedule
        from public.conversation_schedules
       where id = v_stage.schedule_id;
    else
      select * into v_schedule
        from public.conversation_schedules
       where is_active = true
       order by schedule_order asc, id asc
       limit 1;

      if v_schedule.id is null then
        return jsonb_build_object('success', false, 'reason', 'no_active_schedule');
      end if;

      select * into v_stage
        from public.chat_stages
       where schedule_id = v_schedule.id
       order by stage_order asc, id asc
       limit 1;
    end if;

    if v_stage.id is null then
      return jsonb_build_object('success', false, 'reason', 'schedule_has_no_stage', 'schedule_id', v_schedule.id);
    end if;

    insert into public.conversation_schedule_runs (
      conversation_id,
      schedule_id,
      status,
      started_at,
      expires_at,
      current_stage_id
    ) values (
      p_conversation_id,
      v_schedule.id,
      'active',
      v_now,
      case
        when v_schedule.duration_minutes is null then null
        else v_now + make_interval(mins => v_schedule.duration_minutes)
      end,
      v_stage.id
    )
    returning * into v_run;

    update public.instagram_conversations
       set current_stage_id = v_stage.id
     where id = p_conversation_id;
  end if;

  select *
    into v_next_schedule
    from public.conversation_schedules cs
   where cs.is_active = true
     and cs.schedule_order > v_schedule.schedule_order
     and exists (
       select 1
         from public.chat_stages candidate_stage
        where candidate_stage.schedule_id = cs.id
     )
   order by cs.schedule_order asc, cs.id asc
   limit 1;

  if v_next_schedule.id is not null then
    select *
      into v_next_stage
      from public.chat_stages
     where schedule_id = v_next_schedule.id
     order by stage_order asc, id asc
     limit 1;
  end if;

  return jsonb_build_object(
    'success', true,
    'run_id', v_run.id,
    'schedule_id', v_schedule.id,
    'schedule_name', v_schedule.name,
    'schedule_description', v_schedule.description,
    'schedule_category', v_schedule.category,
    'schedule_order', v_schedule.schedule_order,
    'duration_minutes', v_schedule.duration_minutes,
    'started_at', v_run.started_at,
    'expires_at', v_run.expires_at,
    'response_delay_mode', v_schedule.response_delay_mode,
    'response_delay_fixed_seconds', v_schedule.response_delay_fixed_seconds,
    'response_delay_min_seconds', v_schedule.response_delay_min_seconds,
    'response_delay_max_seconds', v_schedule.response_delay_max_seconds,
    'brain_model', v_schedule.brain_model,
    'current_stage_id', v_stage.id,
    'current_stage_required', coalesce(v_stage.is_required, true),
    'next_schedule_id', v_next_schedule.id,
    'next_schedule_name', v_next_schedule.name,
    'next_schedule_first_stage_id', v_next_stage.id
  );
end;
$$;

revoke all on function public.ensure_conversation_schedule_run_atomic(text)
  from public, anon, authenticated;
grant execute on function public.ensure_conversation_schedule_run_atomic(text)
  to service_role;

create or replace function public.advance_conversation_schedule_atomic(
  p_conversation_id text,
  p_expected_schedule_id text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conv public.instagram_conversations%rowtype;
  v_run public.conversation_schedule_runs%rowtype;
  v_schedule public.conversation_schedules%rowtype;
  v_next_schedule public.conversation_schedules%rowtype;
  v_next_stage public.chat_stages%rowtype;
  v_next_run public.conversation_schedule_runs%rowtype;
  v_rules jsonb;
  v_orch jsonb;
  v_chat_progress jsonb;
  v_now timestamptz := clock_timestamp();
  v_sales_completed boolean := false;
begin
  select *
    into v_conv
    from public.instagram_conversations
   where id = p_conversation_id
   for update;

  if not found then
    return jsonb_build_object('success', false, 'reason', 'conversation_not_found');
  end if;

  select *
    into v_run
    from public.conversation_schedule_runs
   where conversation_id = p_conversation_id
     and status = 'active'
   order by started_at desc
   limit 1
   for update;

  if not found then
    return jsonb_build_object('success', false, 'reason', 'active_schedule_run_not_found');
  end if;

  if nullif(btrim(p_expected_schedule_id), '') is not null
     and v_run.schedule_id <> p_expected_schedule_id then
    return jsonb_build_object(
      'success', false,
      'reason', 'schedule_changed',
      'active_schedule_id', v_run.schedule_id
    );
  end if;

  select * into v_schedule
    from public.conversation_schedules
   where id = v_run.schedule_id;

  select *
    into v_next_schedule
    from public.conversation_schedules cs
   where cs.is_active = true
     and cs.schedule_order > v_schedule.schedule_order
     and exists (
       select 1
         from public.chat_stages candidate_stage
        where candidate_stage.schedule_id = cs.id
     )
   order by cs.schedule_order asc, cs.id asc
   limit 1;

  if v_next_schedule.id is null then
    return jsonb_build_object(
      'success', true,
      'advanced', false,
      'has_next_schedule', false,
      'completed_schedule_id', v_schedule.id
    );
  end if;

  select *
    into v_next_stage
    from public.chat_stages
   where schedule_id = v_next_schedule.id
   order by stage_order asc, id asc
   limit 1;

  if v_next_stage.id is null then
    return jsonb_build_object(
      'success', false,
      'reason', 'next_schedule_has_no_stage',
      'next_schedule_id', v_next_schedule.id
    );
  end if;

  update public.conversation_schedule_runs
     set status = 'completed',
         completed_at = v_now,
         updated_at = v_now
   where id = v_run.id;

  insert into public.conversation_schedule_runs (
    conversation_id,
    schedule_id,
    status,
    started_at,
    expires_at,
    current_stage_id
  ) values (
    p_conversation_id,
    v_next_schedule.id,
    'active',
    v_now,
    case
      when v_next_schedule.duration_minutes is null then null
      else v_now + make_interval(mins => v_next_schedule.duration_minutes)
    end,
    v_next_stage.id
  )
  returning * into v_next_run;

  v_sales_completed := v_schedule.category = 'sales';
  v_rules := case
    when jsonb_typeof(v_conv.stage_completed_rules) = 'object' then v_conv.stage_completed_rules
    else '{}'::jsonb
  end;
  v_orch := case
    when jsonb_typeof(v_rules->'orchestration') = 'object' then v_rules->'orchestration'
    else '{}'::jsonb
  end;
  v_chat_progress := case
    when jsonb_typeof(v_rules->'chat_progress') = 'object' then v_rules->'chat_progress'
    else '{}'::jsonb
  end;

  v_orch := jsonb_set(v_orch, '{currentStageId}', to_jsonb(v_next_stage.id), true);
  v_orch := jsonb_set(v_orch, '{currentPhase}', to_jsonb(v_next_stage.id), true);
  v_orch := jsonb_set(v_orch, '{workflowFinalized}', 'false'::jsonb, true);
  v_orch := jsonb_set(v_orch, '{workflowCompletedAt}', 'null'::jsonb, true);
  if v_sales_completed then
    v_orch := jsonb_set(v_orch, '{isConverted}', 'true'::jsonb, true);
  end if;

  v_chat_progress := jsonb_set(v_chat_progress, '{currentStageId}', to_jsonb(v_next_stage.id), true);
  v_chat_progress := jsonb_set(v_chat_progress, '{updatedAt}', to_jsonb(v_now::text), true);
  if v_sales_completed then
    v_chat_progress := jsonb_set(v_chat_progress, '{isConverted}', 'true'::jsonb, true);
  end if;

  v_rules := jsonb_set(v_rules, '{status}', '"active"'::jsonb, true);
  v_rules := jsonb_set(v_rules, '{workflow_finalized}', 'false'::jsonb, true);
  v_rules := jsonb_set(v_rules, '{finalized_at}', 'null'::jsonb, true);
  v_rules := jsonb_set(v_rules, '{finalized_reason}', '"schedule_transition"'::jsonb, true);
  v_rules := jsonb_set(v_rules, '{current_schedule_id}', to_jsonb(v_next_schedule.id), true);
  v_rules := jsonb_set(v_rules, '{current_schedule_run_id}', to_jsonb(v_next_run.id::text), true);
  v_rules := jsonb_set(v_rules, '{schedule_status}', '"active"'::jsonb, true);
  v_rules := jsonb_set(v_rules, '{schedule_completed_at}', 'null'::jsonb, true);
  v_rules := jsonb_set(v_rules, '{orchestration}', v_orch, true);
  v_rules := jsonb_set(v_rules, '{chat_progress}', v_chat_progress, true);

  update public.instagram_conversations
     set current_stage_id = v_next_stage.id,
         stage_completed_rules = v_rules,
         ai_debounce_started_at = null,
         ai_debounce_until = null,
         is_converted = case when v_sales_completed then true else is_converted end,
         updated_at = v_now
   where id = p_conversation_id;

  update public.autopilot_chat_states
     set status = case when is_enabled then 'idle' else status end,
         state = jsonb_set(
           jsonb_set(coalesce(state, '{}'::jsonb), '{currentScheduleId}', to_jsonb(v_next_schedule.id), true),
           '{currentStageId}', to_jsonb(v_next_stage.id), true
         ),
         state_revision = state_revision + 1,
         state_updated_at = v_now,
         updated_at = v_now
   where conversation_id = p_conversation_id;

  return jsonb_build_object(
    'success', true,
    'advanced', true,
    'has_next_schedule', true,
    'completed_schedule_id', v_schedule.id,
    'next_schedule_id', v_next_schedule.id,
    'next_schedule_name', v_next_schedule.name,
    'next_run_id', v_next_run.id,
    'next_stage_id', v_next_stage.id
  );
end;
$$;

revoke all on function public.advance_conversation_schedule_atomic(text, text)
  from public, anon, authenticated;
grant execute on function public.advance_conversation_schedule_atomic(text, text)
  to service_role;

-- Schedule-aware authoritative response gate.
-- Range timing is chosen once per pending batch, persisted in ai_debounce_until,
-- and reused by retries/workers/new inbound messages in the same batch.
create or replace function public.enforce_autopilot_response_delay_atomic(
  p_conversation_id text,
  p_quiet_seconds integer,
  p_max_window_seconds integer,
  p_now timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rules jsonb;
  v_orch jsonb;
  v_current_stage_id text;
  v_existing_started_at timestamptz;
  v_existing_until timestamptz;
  v_mode text := 'fixed';
  v_schedule_id text;
  v_quiet_seconds integer := greatest(coalesce(p_quiet_seconds, 0), 0);
  v_max_seconds integer := greatest(coalesce(p_max_window_seconds, p_quiet_seconds, 0), greatest(coalesce(p_quiet_seconds, 0), 0));
  v_min_seconds integer;
  v_range_max_seconds integer;
  v_watermark_rev bigint;
  v_first_pending timestamptz;
  v_last_pending timestamptz;
  v_desired_at timestamptz;
  v_cap_at timestamptz;
  v_scheduled_at timestamptz;
  v_random_offset integer;
begin
  select c.stage_completed_rules,
         c.current_stage_id,
         c.ai_debounce_started_at,
         c.ai_debounce_until
    into v_rules, v_current_stage_id, v_existing_started_at, v_existing_until
    from public.instagram_conversations c
   where c.id = p_conversation_id
   for update;

  if not found then
    return jsonb_build_object('success', false, 'reason', 'conversation_not_found');
  end if;

  select cs.id,
         cs.response_delay_mode,
         cs.response_delay_fixed_seconds,
         cs.response_delay_min_seconds,
         cs.response_delay_max_seconds
    into v_schedule_id, v_mode, v_quiet_seconds, v_min_seconds, v_range_max_seconds
    from public.chat_stages s
    join public.conversation_schedules cs on cs.id = s.schedule_id
   where s.id = v_current_stage_id
     and cs.is_active = true
   limit 1;

  if v_schedule_id is null then
    v_mode := 'fixed';
    v_quiet_seconds := greatest(coalesce(p_quiet_seconds, 0), 0);
    v_max_seconds := greatest(coalesce(p_max_window_seconds, p_quiet_seconds, 0), v_quiet_seconds);
  elsif v_mode = 'fixed' then
    v_quiet_seconds := greatest(coalesce(v_quiet_seconds, p_quiet_seconds, 0), 0);
    v_max_seconds := greatest(coalesce(p_max_window_seconds, 0), v_quiet_seconds);
  else
    v_min_seconds := greatest(coalesce(v_min_seconds, 0), 0);
    v_range_max_seconds := greatest(coalesce(v_range_max_seconds, v_min_seconds), v_min_seconds);
  end if;

  v_rules := case when jsonb_typeof(v_rules) = 'object' then v_rules else '{}'::jsonb end;
  v_orch := case
    when jsonb_typeof(v_rules->'orchestration') = 'object' then v_rules->'orchestration'
    else '{}'::jsonb
  end;

  begin
    if coalesce(v_orch->'activation_watermark'->>'inboundRevision', '') ~ '^[0-9]+$' then
      v_watermark_rev := (v_orch->'activation_watermark'->>'inboundRevision')::bigint;
    end if;
  exception when others then
    v_watermark_rev := null;
  end;

  select min(m.created_at), max(m.created_at)
    into v_first_pending, v_last_pending
    from public.instagram_messages m
   where m.conversation_id = p_conversation_id
     and m.is_mine is false
     and m.created_at >= p_now - interval '48 hours'
     and coalesce(v_orch->'messageLedger'->>m.id, 'pending') <> 'processed'
     and coalesce(v_orch->>'lastProcessedMessageId', '') <> m.id
     and (
       v_watermark_rev is null
       or (
         coalesce(v_orch->'messageInboundRevisions'->>m.id, '') ~ '^[0-9]+$'
         and (v_orch->'messageInboundRevisions'->>m.id)::bigint > v_watermark_rev
       )
     );

  if v_first_pending is null or v_last_pending is null then
    return jsonb_build_object(
      'success', true,
      'due_now', true,
      'reason', 'no_pending_inbound',
      'response_delay_mode', v_mode,
      'schedule_id', v_schedule_id
    );
  end if;

  if v_mode = 'range' then
    if v_range_max_seconds = 0 then
      v_scheduled_at := v_first_pending;
    elsif v_existing_started_at = v_first_pending
      and v_existing_until is not null
      and v_existing_until >= v_first_pending + make_interval(secs => v_min_seconds)
      and v_existing_until <= v_first_pending + make_interval(secs => v_range_max_seconds)
    then
      v_scheduled_at := v_existing_until;
    else
      if v_range_max_seconds = v_min_seconds then
        v_random_offset := v_min_seconds;
      else
        v_random_offset := v_min_seconds
          + floor(random() * ((v_range_max_seconds - v_min_seconds) + 1))::integer;
      end if;
      v_scheduled_at := v_first_pending + make_interval(secs => v_random_offset);
      update public.instagram_conversations
         set ai_debounce_started_at = v_first_pending,
             ai_debounce_until = v_scheduled_at
       where id = p_conversation_id;
    end if;

    return jsonb_build_object(
      'success', true,
      'due_now', v_scheduled_at <= p_now,
      'scheduled_at', v_scheduled_at,
      'first_pending_at', v_first_pending,
      'last_pending_at', v_last_pending,
      'response_delay_mode', 'range',
      'min_seconds', v_min_seconds,
      'max_seconds', v_range_max_seconds,
      'schedule_id', v_schedule_id,
      'persisted_choice', true
    );
  end if;

  if v_quiet_seconds = 0 then
    return jsonb_build_object(
      'success', true,
      'due_now', true,
      'reason', 'delay_disabled',
      'response_delay_mode', 'fixed',
      'schedule_id', v_schedule_id
    );
  end if;

  v_desired_at := v_last_pending + make_interval(secs => v_quiet_seconds);
  v_cap_at := v_first_pending + make_interval(secs => v_max_seconds);
  v_scheduled_at := least(v_desired_at, v_cap_at);

  if v_scheduled_at > p_now then
    update public.instagram_conversations
       set ai_debounce_started_at = v_first_pending,
           ai_debounce_until = v_scheduled_at
     where id = p_conversation_id;
  end if;

  return jsonb_build_object(
    'success', true,
    'due_now', v_scheduled_at <= p_now,
    'scheduled_at', v_scheduled_at,
    'first_pending_at', v_first_pending,
    'last_pending_at', v_last_pending,
    'quiet_seconds', v_quiet_seconds,
    'max_window_seconds', v_max_seconds,
    'response_delay_mode', 'fixed',
    'schedule_id', v_schedule_id,
    'capped', v_desired_at > v_cap_at
  );
end;
$$;

-- With multiple schedules, sale conversion is no longer synonymous with the
-- entire conversational workflow being finalized. Only the explicit
-- workflow_finalized flag disables AutoPilot.
create or replace function public.commit_experimental_cycle_if_owned(
  p_conversation_id text,
  p_cycle_token text,
  p_new_stage_completed_rules jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rules jsonb;
  v_active_token text;
  v_preempt_requested boolean;
  v_final_rules jsonb;
  v_next_stage_id text;
  v_workflow_finalized boolean := false;
  v_is_converted boolean := false;
  v_now timestamptz := clock_timestamp();
begin
  select stage_completed_rules, current_stage_id
    into v_rules, v_next_stage_id
    from public.instagram_conversations
   where id = p_conversation_id
   for update;

  if not found then
    return jsonb_build_object('committed', false, 'reason', 'not_found');
  end if;

  v_rules := case when jsonb_typeof(v_rules) = 'object' then v_rules else '{}'::jsonb end;
  v_active_token := v_rules->>'active_cycle_token';
  v_preempt_requested := coalesce((v_rules->>'preempt_requested')::boolean, false);

  if v_active_token is null or v_active_token <> p_cycle_token then
    return jsonb_build_object('committed', false, 'reason', 'lost_lock', 'activeToken', v_active_token);
  end if;
  if v_preempt_requested is true then
    return jsonb_build_object('committed', false, 'reason', 'preempted');
  end if;

  v_final_rules := jsonb_set(coalesce(p_new_stage_completed_rules, '{}'::jsonb), '{active_cycle_token}', 'null'::jsonb);
  v_final_rules := jsonb_set(v_final_rules, '{preempt_requested}', 'false'::jsonb);
  v_next_stage_id := coalesce(v_final_rules->'orchestration'->>'currentStageId', v_next_stage_id);

  begin
    v_workflow_finalized := coalesce((v_final_rules->>'workflow_finalized')::boolean, false);
  exception when others then
    v_workflow_finalized := false;
  end;

  begin
    v_is_converted :=
      coalesce((v_final_rules->'chat_progress'->>'isConverted')::boolean, false)
      or coalesce((v_final_rules->'orchestration'->>'isConverted')::boolean, false);
  exception when others then
    v_is_converted := false;
  end;

  update public.instagram_conversations
     set stage_completed_rules = v_final_rules,
         current_stage_id = v_next_stage_id,
         ai_auto_respond = case when v_workflow_finalized then false else ai_auto_respond end,
         ai_debounce_until = case when v_workflow_finalized then null else ai_debounce_until end,
         is_converted = case when v_is_converted then true else is_converted end,
         updated_at = v_now
   where id = p_conversation_id;

  update public.conversation_schedule_runs
     set current_stage_id = v_next_stage_id,
         updated_at = v_now
   where conversation_id = p_conversation_id
     and status = 'active';

  if v_workflow_finalized then
    insert into public.autopilot_chat_states (
      conversation_id,
      is_enabled,
      status,
      state,
      state_revision,
      state_updated_at,
      updated_at
    )
    values (
      p_conversation_id,
      false,
      'disabled',
      jsonb_build_object(
        'status', 'disabled',
        'workflowFinalized', true,
        'finalizedAt', coalesce(v_final_rules->>'finalized_at', v_now::text)
      ),
      1,
      v_now,
      v_now
    )
    on conflict (conversation_id) do update
       set is_enabled = false,
           status = 'disabled',
           state = jsonb_set(
             jsonb_set(
               coalesce(public.autopilot_chat_states.state, '{}'::jsonb),
               '{status}',
               '"disabled"'::jsonb,
               true
             ),
             '{workflowFinalized}',
             'true'::jsonb,
             true
           ),
           state_revision = public.autopilot_chat_states.state_revision + 1,
           state_updated_at = v_now,
           updated_at = v_now;
  end if;

  return jsonb_build_object(
    'committed', true,
    'reason', 'committed',
    'workflowFinalized', v_workflow_finalized,
    'isConverted', v_is_converted
  );
end;
$$;

revoke all on function public.commit_experimental_cycle_if_owned(text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.commit_experimental_cycle_if_owned(text, text, jsonb)
  to service_role;


-- Expiração determinística de cronogramas temporizados.
-- Objetivos opcionais nunca bloqueiam. Requisitos obrigatórios pendentes não são
-- falsamente concluídos e pausam o AutoPilot para intervenção do operador.
create or replace function public.process_conversation_schedule_expirations_atomic(
  p_limit integer default 50
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.conversation_schedule_runs%rowtype;
  v_conv public.instagram_conversations%rowtype;
  v_schedule public.conversation_schedules%rowtype;
  v_stage public.chat_stages%rowtype;
  v_next_schedule public.conversation_schedules%rowtype;
  v_next_stage public.chat_stages%rowtype;
  v_next_run public.conversation_schedule_runs%rowtype;
  v_rules jsonb;
  v_orch jsonb;
  v_chat_progress jsonb;
  v_now timestamptz;
  v_required_pending boolean;
  v_processed integer := 0;
  v_advanced integer := 0;
  v_incomplete integer := 0;
  v_finalized integer := 0;
begin
  for v_run in
    select r.*
      from public.conversation_schedule_runs r
     where r.status = 'active'
       and r.expires_at is not null
       and r.expires_at <= clock_timestamp()
     order by r.expires_at asc, r.created_at asc
     for update skip locked
     limit greatest(1, least(coalesce(p_limit, 50), 200))
  loop
    v_now := clock_timestamp();
    v_processed := v_processed + 1;

    select *
      into v_conv
      from public.instagram_conversations
     where id = v_run.conversation_id
     for update;

    if not found then
      update public.conversation_schedule_runs
         set status = 'cancelled',
             completed_at = v_now,
             updated_at = v_now
       where id = v_run.id;
      continue;
    end if;

    select *
      into v_schedule
      from public.conversation_schedules
     where id = v_run.schedule_id;

    select *
      into v_stage
      from public.chat_stages
     where id = coalesce(v_run.current_stage_id, v_conv.current_stage_id)
       and schedule_id = v_run.schedule_id
     limit 1;

    if not found then
      select *
        into v_stage
        from public.chat_stages
       where schedule_id = v_run.schedule_id
       order by stage_order asc, created_at asc, id asc
       limit 1;
    end if;

    v_rules := case
      when jsonb_typeof(v_conv.stage_completed_rules) = 'object'
        then v_conv.stage_completed_rules
      else '{}'::jsonb
    end;
    v_orch := case
      when jsonb_typeof(v_rules->'orchestration') = 'object'
        then v_rules->'orchestration'
      else '{}'::jsonb
    end;
    v_chat_progress := case
      when jsonb_typeof(v_rules->'chat_progress') = 'object'
        then v_rules->'chat_progress'
      else '{}'::jsonb
    end;

    v_required_pending := v_stage.id is null;

    if not v_required_pending and coalesce(v_stage.is_required, true) then
      select exists (
        select 1
          from jsonb_array_elements(
            case
              when jsonb_typeof(v_stage.goals) = 'array' then v_stage.goals
              else '[]'::jsonb
            end
          ) as g(goal)
         where coalesce(g.goal->>'enabled', 'true') <> 'false'
           and coalesce(g.goal->>'required', 'true') <> 'false'
           and not (
             exists (
               select 1
                 from jsonb_array_elements_text(
                   case
                     when jsonb_typeof(v_rules->'completed_goals') = 'array'
                       then v_rules->'completed_goals'
                     else '[]'::jsonb
                   end
                 ) as cg(goal_id)
                where cg.goal_id = g.goal->>'id'
             )
             or coalesce(v_rules->'objective_progress'->(g.goal->>'id')->>'status', '') = 'completed'
             or coalesce(v_orch->'objectiveProgress'->(g.goal->>'id')->>'status', '') = 'completed'
             or exists (
               select 1
                 from jsonb_array_elements_text(
                   case
                     when jsonb_typeof(v_orch->'completedGoalIds') = 'array'
                       then v_orch->'completedGoalIds'
                     else '[]'::jsonb
                   end
                 ) as ocg(goal_id)
                where ocg.goal_id = g.goal->>'id'
             )
           )
      ) into v_required_pending;
    end if;

    if not v_required_pending and v_stage.id is not null then
      select exists (
        select 1
          from public.chat_stages future_stage
         where future_stage.schedule_id = v_run.schedule_id
           and future_stage.is_required = true
           and future_stage.stage_order > v_stage.stage_order
      ) into v_required_pending;
    end if;

    if v_required_pending then
      update public.conversation_schedule_runs
         set status = 'expired_incomplete',
             completed_at = v_now,
             updated_at = v_now
       where id = v_run.id;

      v_rules := jsonb_set(v_rules, '{schedule_status}', '"expired_incomplete"'::jsonb, true);
      v_rules := jsonb_set(v_rules, '{schedule_expired_at}', to_jsonb(v_now::text), true);
      v_rules := jsonb_set(v_rules, '{current_schedule_id}', to_jsonb(v_run.schedule_id), true);
      v_rules := jsonb_set(v_rules, '{workflow_finalized}', 'false'::jsonb, true);
      v_orch := jsonb_set(v_orch, '{lastProcessingStatus}', '"needs_human"'::jsonb, true);
      v_orch := jsonb_set(v_orch, '{lastError}', '"schedule_expired_incomplete"'::jsonb, true);
      v_rules := jsonb_set(v_rules, '{orchestration}', v_orch, true);

      update public.instagram_conversations
         set stage_completed_rules = v_rules,
             ai_auto_respond = false,
             ai_debounce_started_at = null,
             ai_debounce_until = null,
             updated_at = v_now
       where id = v_run.conversation_id;

      insert into public.autopilot_chat_states (
        conversation_id, is_enabled, status, state,
        state_revision, state_updated_at, updated_at
      ) values (
        v_run.conversation_id,
        false,
        'waiting_human',
        jsonb_build_object(
          'status', 'waiting_human',
          'pauseReason', 'Cronograma expirou com requisito obrigatório pendente.',
          'currentScheduleId', v_run.schedule_id,
          'expiredIncomplete', true
        ),
        1,
        v_now,
        v_now
      )
      on conflict (conversation_id) do update
         set is_enabled = false,
             status = 'waiting_human',
             state = coalesce(public.autopilot_chat_states.state, '{}'::jsonb)
               || jsonb_build_object(
                    'status', 'waiting_human',
                    'pauseReason', 'Cronograma expirou com requisito obrigatório pendente.',
                    'currentScheduleId', v_run.schedule_id,
                    'expiredIncomplete', true
                  ),
             state_revision = public.autopilot_chat_states.state_revision + 1,
             state_updated_at = v_now,
             updated_at = v_now;

      v_incomplete := v_incomplete + 1;
      continue;
    end if;

    select *
      into v_next_schedule
      from public.conversation_schedules cs
     where cs.is_active = true
       and cs.schedule_order > v_schedule.schedule_order
       and exists (
         select 1
           from public.chat_stages candidate_stage
          where candidate_stage.schedule_id = cs.id
       )
     order by cs.schedule_order asc, cs.id asc
     limit 1;

    if v_next_schedule.id is not null then
      select *
        into v_next_stage
        from public.chat_stages
       where schedule_id = v_next_schedule.id
       order by stage_order asc, created_at asc, id asc
       limit 1;

      if v_next_stage.id is null then
        update public.conversation_schedule_runs
           set status = 'expired_incomplete',
               completed_at = v_now,
               updated_at = v_now
         where id = v_run.id;

        update public.instagram_conversations
           set ai_auto_respond = false,
               ai_debounce_started_at = null,
               ai_debounce_until = null,
               updated_at = v_now
         where id = v_run.conversation_id;

        v_incomplete := v_incomplete + 1;
        continue;
      end if;

      update public.conversation_schedule_runs
         set status = 'expired',
             completed_at = v_now,
             updated_at = v_now
       where id = v_run.id;

      insert into public.conversation_schedule_runs (
        conversation_id, schedule_id, status,
        started_at, expires_at, current_stage_id
      ) values (
        v_run.conversation_id,
        v_next_schedule.id,
        'active',
        v_now,
        case
          when v_next_schedule.duration_minutes is null then null
          else v_now + make_interval(mins => v_next_schedule.duration_minutes)
        end,
        v_next_stage.id
      )
      returning * into v_next_run;

      v_orch := jsonb_set(v_orch, '{currentStageId}', to_jsonb(v_next_stage.id), true);
      v_orch := jsonb_set(v_orch, '{currentPhase}', to_jsonb(v_next_stage.id), true);
      v_orch := jsonb_set(v_orch, '{workflowFinalized}', 'false'::jsonb, true);
      v_orch := jsonb_set(v_orch, '{workflowCompletedAt}', 'null'::jsonb, true);
      v_orch := jsonb_set(v_orch, '{lastError}', 'null'::jsonb, true);

      v_chat_progress := jsonb_set(v_chat_progress, '{currentStageId}', to_jsonb(v_next_stage.id), true);
      v_chat_progress := jsonb_set(v_chat_progress, '{updatedAt}', to_jsonb(v_now::text), true);

      v_rules := jsonb_set(v_rules, '{status}', '"active"'::jsonb, true);
      v_rules := jsonb_set(v_rules, '{workflow_finalized}', 'false'::jsonb, true);
      v_rules := jsonb_set(v_rules, '{finalized_at}', 'null'::jsonb, true);
      v_rules := jsonb_set(v_rules, '{finalized_reason}', '"schedule_duration_elapsed"'::jsonb, true);
      v_rules := jsonb_set(v_rules, '{current_schedule_id}', to_jsonb(v_next_schedule.id), true);
      v_rules := jsonb_set(v_rules, '{current_schedule_run_id}', to_jsonb(v_next_run.id::text), true);
      v_rules := jsonb_set(v_rules, '{schedule_status}', '"active"'::jsonb, true);
      v_rules := jsonb_set(v_rules, '{schedule_expired_at}', to_jsonb(v_now::text), true);
      v_rules := jsonb_set(v_rules, '{orchestration}', v_orch, true);
      v_rules := jsonb_set(v_rules, '{chat_progress}', v_chat_progress, true);

      update public.instagram_conversations
         set current_stage_id = v_next_stage.id,
             stage_completed_rules = v_rules,
             ai_debounce_started_at = null,
             ai_debounce_until = null,
             updated_at = v_now
       where id = v_run.conversation_id;

      update public.autopilot_chat_states
         set status = case when is_enabled then 'idle' else status end,
             state = coalesce(state, '{}'::jsonb)
               || jsonb_build_object(
                    'currentScheduleId', v_next_schedule.id,
                    'currentStageId', v_next_stage.id,
                    'expiredPreviousScheduleId', v_run.schedule_id
                  ),
             state_revision = state_revision + 1,
             state_updated_at = v_now,
             updated_at = v_now
       where conversation_id = v_run.conversation_id;

      v_advanced := v_advanced + 1;
      continue;
    end if;

    update public.conversation_schedule_runs
       set status = 'expired',
           completed_at = v_now,
           updated_at = v_now
     where id = v_run.id;

    v_orch := jsonb_set(v_orch, '{workflowFinalized}', 'true'::jsonb, true);
    v_orch := jsonb_set(v_orch, '{workflowCompletedAt}', to_jsonb(v_now::text), true);
    v_orch := jsonb_set(v_orch, '{lastProcessingStatus}', '"completed"'::jsonb, true);

    v_rules := jsonb_set(v_rules, '{status}', '"completed"'::jsonb, true);
    v_rules := jsonb_set(v_rules, '{workflow_finalized}', 'true'::jsonb, true);
    v_rules := jsonb_set(v_rules, '{finalized_at}', to_jsonb(v_now::text), true);
    v_rules := jsonb_set(v_rules, '{finalized_reason}', '"schedule_duration_elapsed"'::jsonb, true);
    v_rules := jsonb_set(v_rules, '{schedule_status}', '"expired"'::jsonb, true);
    v_rules := jsonb_set(v_rules, '{schedule_expired_at}', to_jsonb(v_now::text), true);
    v_rules := jsonb_set(v_rules, '{orchestration}', v_orch, true);

    update public.instagram_conversations
       set stage_completed_rules = v_rules,
           ai_auto_respond = false,
           ai_debounce_started_at = null,
           ai_debounce_until = null,
           updated_at = v_now
     where id = v_run.conversation_id;

    insert into public.autopilot_chat_states (
      conversation_id, is_enabled, status, state,
      state_revision, state_updated_at, updated_at
    ) values (
      v_run.conversation_id,
      false,
      'disabled',
      jsonb_build_object(
        'status', 'disabled',
        'workflowFinalized', true,
        'finalizedAt', v_now,
        'currentScheduleId', v_run.schedule_id
      ),
      1,
      v_now,
      v_now
    )
    on conflict (conversation_id) do update
       set is_enabled = false,
           status = 'disabled',
           state = coalesce(public.autopilot_chat_states.state, '{}'::jsonb)
             || jsonb_build_object(
                  'status', 'disabled',
                  'workflowFinalized', true,
                  'finalizedAt', v_now,
                  'currentScheduleId', v_run.schedule_id
                ),
           state_revision = public.autopilot_chat_states.state_revision + 1,
           state_updated_at = v_now,
           updated_at = v_now;

    v_finalized := v_finalized + 1;
  end loop;

  return jsonb_build_object(
    'success', true,
    'processed', v_processed,
    'advanced', v_advanced,
    'expired_incomplete', v_incomplete,
    'finalized', v_finalized
  );
end;
$$;

revoke all on function public.process_conversation_schedule_expirations_atomic(integer)
  from public, anon, authenticated;
grant execute on function public.process_conversation_schedule_expirations_atomic(integer)
  to service_role;


-- Progresso manual/delivery-confirmed passa a respeitar o cronograma atual.
-- Concluir a venda mantém is_converted para relatórios, mas só finaliza toda a
-- automação quando não existe próximo cronograma ativo.
create or replace function public.patch_chat_progress_atomic(
  p_conversation_id text,
  p_current_stage_id text default null,
  p_completed_goal_ids text[] default null,
  p_completed_item_ids text[] default null,
  p_objective_progress jsonb default null,
  p_is_converted boolean default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conv_id text;
  v_rules jsonb;
  v_orch jsonb;
  v_chat_progress jsonb;
  v_current_stage_id text;
  v_effective_stage_id text;
  v_stage_order integer;
  v_max_stage_order integer;
  v_stage_goals jsonb;
  v_schedule_id text;
  v_schedule_category text;
  v_next_schedule_id text;
  v_schedule_complete boolean := false;
  v_workflow_finalized boolean := false;
  v_is_converted boolean := false;
  v_existing_converted boolean := false;
  v_now_ts timestamptz := clock_timestamp();
  v_now text := v_now_ts::text;
begin
  select id, stage_completed_rules, current_stage_id, is_converted
    into v_conv_id, v_rules, v_current_stage_id, v_existing_converted
    from public.instagram_conversations
   where id = p_conversation_id or contact_id = p_conversation_id
   limit 1
   for update;

  if not found then
    return jsonb_build_object('success', false, 'reason', 'conversation_not_found');
  end if;

  v_rules := case when jsonb_typeof(v_rules) = 'object' then v_rules else '{}'::jsonb end;
  v_orch := case
    when jsonb_typeof(v_rules->'orchestration') = 'object' then v_rules->'orchestration'
    else '{}'::jsonb
  end;
  v_chat_progress := case
    when jsonb_typeof(v_rules->'chat_progress') = 'object' then v_rules->'chat_progress'
    else '{}'::jsonb
  end;

  if p_current_stage_id is not null and btrim(p_current_stage_id) <> '' then
    v_rules := jsonb_set(v_rules, '{current_stage_id}', to_jsonb(p_current_stage_id), true);
    v_chat_progress := jsonb_set(v_chat_progress, '{currentStageId}', to_jsonb(p_current_stage_id), true);
    v_orch := jsonb_set(v_orch, '{currentStageId}', to_jsonb(p_current_stage_id), true);
  end if;

  if p_completed_goal_ids is not null then
    v_rules := jsonb_set(v_rules, '{completed_goals}', to_jsonb(p_completed_goal_ids), true);
    v_chat_progress := jsonb_set(v_chat_progress, '{completedGoalIds}', to_jsonb(p_completed_goal_ids), true);
    v_orch := jsonb_set(v_orch, '{completedGoalIds}', to_jsonb(p_completed_goal_ids), true);
  end if;

  if p_completed_item_ids is not null then
    v_chat_progress := jsonb_set(v_chat_progress, '{completedItemIds}', to_jsonb(p_completed_item_ids), true);
  end if;

  if p_objective_progress is not null and jsonb_typeof(p_objective_progress) = 'object' then
    v_rules := jsonb_set(v_rules, '{objective_progress}', p_objective_progress, true);
    v_chat_progress := jsonb_set(v_chat_progress, '{objectiveProgress}', p_objective_progress, true);
    v_orch := jsonb_set(v_orch, '{objectiveProgress}', p_objective_progress, true);
  end if;

  v_effective_stage_id := coalesce(nullif(btrim(p_current_stage_id), ''), v_current_stage_id);

  select s.stage_order, s.goals, s.schedule_id, cs.category
    into v_stage_order, v_stage_goals, v_schedule_id, v_schedule_category
    from public.chat_stages s
    join public.conversation_schedules cs on cs.id = s.schedule_id
   where s.id = v_effective_stage_id
   limit 1;

  if v_schedule_id is not null then
    select max(stage_order)
      into v_max_stage_order
      from public.chat_stages
     where schedule_id = v_schedule_id;

    select id
      into v_next_schedule_id
      from public.conversation_schedules cs
     where cs.is_active = true
       and cs.schedule_order > (
         select schedule_order
           from public.conversation_schedules
          where id = v_schedule_id
       )
       and exists (
         select 1
           from public.chat_stages candidate_stage
          where candidate_stage.schedule_id = cs.id
       )
     order by cs.schedule_order asc, cs.id asc
     limit 1;
  end if;

  if p_is_converted is distinct from false
     and v_stage_order is not null
     and v_stage_order = v_max_stage_order
     and jsonb_typeof(v_stage_goals) = 'array'
  then
    select
      not exists (
        select 1
          from jsonb_array_elements(v_stage_goals) as g(goal)
         where coalesce(g.goal->>'enabled', 'true') <> 'false'
           and coalesce(g.goal->>'required', 'true') <> 'false'
           and (
             coalesce(g.goal->'actionConfig'->>'finalizeWorkflowOnCompletion', 'true') = 'false'
             or not (
               exists (
                 select 1
                   from jsonb_array_elements_text(
                     case
                       when jsonb_typeof(v_rules->'completed_goals') = 'array'
                         then v_rules->'completed_goals'
                       else '[]'::jsonb
                     end
                   ) as cg(goal_id)
                  where cg.goal_id = g.goal->>'id'
               )
               or coalesce(v_rules->'objective_progress'->(g.goal->>'id')->>'status', '') = 'completed'
               or coalesce(v_orch->'objectiveProgress'->(g.goal->>'id')->>'status', '') = 'completed'
             )
           )
      )
      and exists (
        select 1
          from jsonb_array_elements(v_stage_goals) as g(goal)
         where coalesce(g.goal->>'enabled', 'true') <> 'false'
           and coalesce(g.goal->>'required', 'true') <> 'false'
           and coalesce(g.goal->>'completionPolicy', '') = 'delivery_confirmed'
           and (
             (
               coalesce(v_rules->'objective_progress'->(g.goal->>'id')->>'status', '') = 'completed'
               and coalesce(v_rules->'objective_progress'->(g.goal->>'id')->>'source', '') = 'delivery_confirmed'
             )
             or (
               coalesce(v_orch->'objectiveProgress'->(g.goal->>'id')->>'status', '') = 'completed'
               and coalesce(v_orch->'objectiveProgress'->(g.goal->>'id')->>'source', '') = 'delivery_confirmed'
             )
           )
      )
      into v_schedule_complete;
  end if;

  v_is_converted := case
    when p_is_converted is not null then p_is_converted
    when v_schedule_complete and v_schedule_category = 'sales' then true
    else coalesce(v_existing_converted, false)
  end;
  v_workflow_finalized := v_schedule_complete and v_next_schedule_id is null;

  v_chat_progress := jsonb_set(v_chat_progress, '{isConverted}', to_jsonb(v_is_converted), true);
  v_chat_progress := jsonb_set(v_chat_progress, '{updatedAt}', to_jsonb(v_now), true);
  v_orch := jsonb_set(v_orch, '{isConverted}', to_jsonb(v_is_converted), true);

  if v_workflow_finalized then
    v_orch := jsonb_set(v_orch, '{workflowFinalized}', 'true'::jsonb, true);
    v_orch := jsonb_set(v_orch, '{workflowCompletedAt}', to_jsonb(v_now), true);
    v_rules := jsonb_set(v_rules, '{status}', '"completed"'::jsonb, true);
    v_rules := jsonb_set(v_rules, '{workflow_finalized}', 'true'::jsonb, true);
    v_rules := jsonb_set(v_rules, '{finalized_at}', to_jsonb(v_now), true);
    v_rules := jsonb_set(v_rules, '{finalized_reason}', '"all_required_objectives_completed"'::jsonb, true);
  elsif v_schedule_complete then
    v_orch := jsonb_set(v_orch, '{workflowFinalized}', 'false'::jsonb, true);
    v_rules := jsonb_set(v_rules, '{status}', '"active"'::jsonb, true);
    v_rules := jsonb_set(v_rules, '{workflow_finalized}', 'false'::jsonb, true);
    v_rules := jsonb_set(v_rules, '{finalized_reason}', '"schedule_transition_pending"'::jsonb, true);
    v_rules := jsonb_set(v_rules, '{current_schedule_id}', to_jsonb(v_schedule_id), true);
    v_rules := jsonb_set(v_rules, '{schedule_status}', '"ready_for_transition"'::jsonb, true);
    v_rules := jsonb_set(v_rules, '{schedule_completed_at}', to_jsonb(v_now), true);
  end if;

  v_rules := jsonb_set(v_rules, '{chat_progress}', v_chat_progress, true);
  v_rules := jsonb_set(v_rules, '{orchestration}', v_orch, true);

  update public.instagram_conversations
     set stage_completed_rules = v_rules,
         current_stage_id = coalesce(nullif(btrim(p_current_stage_id), ''), current_stage_id),
         ai_auto_respond = case when v_workflow_finalized then false else ai_auto_respond end,
         ai_debounce_until = case when v_workflow_finalized then null else ai_debounce_until end,
         is_converted = v_is_converted,
         updated_at = v_now_ts
   where id = v_conv_id;

  update public.conversation_schedule_runs
     set current_stage_id = v_effective_stage_id,
         updated_at = v_now_ts
   where conversation_id = v_conv_id
     and status = 'active';

  if v_workflow_finalized then
    insert into public.autopilot_chat_states (
      conversation_id, is_enabled, status, state,
      state_revision, state_updated_at, updated_at
    ) values (
      v_conv_id,
      false,
      'disabled',
      jsonb_build_object(
        'status', 'disabled',
        'workflowFinalized', true,
        'finalizedAt', v_now
      ),
      1,
      v_now_ts,
      v_now_ts
    )
    on conflict (conversation_id) do update
       set is_enabled = false,
           status = 'disabled',
           state = coalesce(public.autopilot_chat_states.state, '{}'::jsonb)
             || jsonb_build_object(
                  'status', 'disabled',
                  'workflowFinalized', true,
                  'finalizedAt', v_now
                ),
           state_revision = public.autopilot_chat_states.state_revision + 1,
           state_updated_at = v_now_ts,
           updated_at = v_now_ts;
  end if;

  return jsonb_build_object(
    'success', true,
    'reason', case
      when v_workflow_finalized then 'progress_patched_and_workflow_finalized'
      when v_schedule_complete and v_next_schedule_id is not null then 'progress_patched_schedule_ready'
      else 'progress_patched'
    end,
    'conversationId', v_conv_id,
    'currentStageId', v_effective_stage_id,
    'scheduleId', v_schedule_id,
    'scheduleComplete', v_schedule_complete,
    'workflowFinalized', v_workflow_finalized,
    'isConverted', v_is_converted,
    'scheduleTransitionPending', v_schedule_complete and v_next_schedule_id is not null,
    'updatedAt', v_now
  );
end;
$$;

revoke all on function public.patch_chat_progress_atomic(text, text, text[], text[], jsonb, boolean)
  from public, anon, authenticated;
grant execute on function public.patch_chat_progress_atomic(text, text, text[], text[], jsonb, boolean)
  to service_role;


create or replace function public.process_conversation_schedule_ready_transitions_atomic(
  p_limit integer default 50
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_candidate record;
  v_result jsonb;
  v_processed integer := 0;
  v_advanced integer := 0;
  v_conflicts integer := 0;
begin
  for v_candidate in
    select r.conversation_id, r.schedule_id
      from public.conversation_schedule_runs r
      join public.instagram_conversations c on c.id = r.conversation_id
     where r.status = 'active'
       and coalesce(c.stage_completed_rules->>'schedule_status', '') = 'ready_for_transition'
     order by r.updated_at asc, r.started_at asc
     limit greatest(1, least(coalesce(p_limit, 50), 200))
  loop
    v_processed := v_processed + 1;
    v_result := public.advance_conversation_schedule_atomic(
      v_candidate.conversation_id,
      v_candidate.schedule_id
    );

    if coalesce((v_result->>'success')::boolean, false)
       and coalesce((v_result->>'advanced')::boolean, false)
    then
      v_advanced := v_advanced + 1;
    else
      v_conflicts := v_conflicts + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'success', true,
    'processed', v_processed,
    'advanced', v_advanced,
    'conflicts', v_conflicts
  );
end;
$$;

revoke all on function public.process_conversation_schedule_ready_transitions_atomic(integer)
  from public, anon, authenticated;
grant execute on function public.process_conversation_schedule_ready_transitions_atomic(integer)
  to service_role;
