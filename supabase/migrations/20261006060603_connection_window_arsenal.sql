-- connection_window_arsenal
-- Adds a time/opportunity-driven schedule mode without changing goal_driven sales semantics.

alter table public.conversation_schedules
  add column if not exists execution_mode text not null default 'goal_driven',
  add column if not exists connection_intent text,
  add column if not exists temporal_phases jsonb not null default
    '[
      {"id":"opening","label":"Início","fromPercent":0,"toPercent":30,"guidance":"Retomar proximidade e conversa leve sem forçar recursos."},
      {"id":"middle","label":"Meio","fromPercent":30,"toPercent":75,"guidance":"Manter conexão, aprofundar assuntos e usar o arsenal apenas quando encaixar naturalmente."},
      {"id":"closing","label":"Fechamento","fromPercent":75,"toPercent":100,"guidance":"Preservar naturalidade e procurar oportunidade real para a ação final."}
    ]'::jsonb,
  add column if not exists final_action jsonb;

alter table public.conversation_schedules
  drop constraint if exists conversation_schedules_execution_mode_check;

alter table public.conversation_schedules
  add constraint conversation_schedules_execution_mode_check
  check (execution_mode in ('goal_driven','connection_window'));

update public.conversation_schedules
   set execution_mode = 'connection_window',
       connection_intent = coalesce(
         nullif(btrim(connection_intent), ''),
         nullif(btrim(description), ''),
         'Manter uma conversa natural, fortalecer a conexão e criar oportunidade para uma nova oferta futura.'
       )
 where category = 'post_sale';

-- connection_window is never semantically blocked by ChatStage checkpoints.
update public.chat_stages s
   set is_required = false,
       goals = '[]'::jsonb,
       updated_at = clock_timestamp()
  from public.conversation_schedules cs
 where cs.id = s.schedule_id
   and cs.execution_mode = 'connection_window';

-- Keep one internal compatibility stage so the existing transition/runtime RPCs stay stable.
create or replace function public.ensure_connection_window_compat_stage()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.execution_mode = 'connection_window'
     and not exists (
       select 1 from public.chat_stages where schedule_id = new.id
     )
  then
    insert into public.chat_stages (
      id, name, stage_order, color, icon, description, goals,
      schedule_id, is_required, created_at, updated_at
    ) values (
      'stage_connection_' || regexp_replace(new.id, '[^a-zA-Z0-9_]+', '_', 'g'),
      'Janela de conexão',
      0,
      '#8b5cf6',
      'sparkles',
      'Etapa interna de compatibilidade. connection_window é orientado por tempo e oportunidades, não por checkpoints.',
      '[]'::jsonb,
      new.id,
      false,
      clock_timestamp(),
      clock_timestamp()
    )
    on conflict (id) do nothing;
  end if;
  return new;
end;
$$;

revoke all on function public.ensure_connection_window_compat_stage() from public, anon, authenticated;

drop trigger if exists trg_conversation_schedule_connection_compat_stage
  on public.conversation_schedules;

create trigger trg_conversation_schedule_connection_compat_stage
after insert or update of execution_mode on public.conversation_schedules
for each row
execute function public.ensure_connection_window_compat_stage();

-- Backfill any existing connection schedule that currently has no stage.
insert into public.chat_stages (
  id, name, stage_order, color, icon, description, goals,
  schedule_id, is_required, created_at, updated_at
)
select
  'stage_connection_' || regexp_replace(cs.id, '[^a-zA-Z0-9_]+', '_', 'g'),
  'Janela de conexão',
  0,
  '#8b5cf6',
  'sparkles',
  'Etapa interna de compatibilidade. connection_window é orientado por tempo e oportunidades, não por checkpoints.',
  '[]'::jsonb,
  cs.id,
  false,
  clock_timestamp(),
  clock_timestamp()
from public.conversation_schedules cs
where cs.execution_mode = 'connection_window'
  and not exists (
    select 1 from public.chat_stages s where s.schedule_id = cs.id
  )
on conflict (id) do nothing;

create table if not exists public.conversation_arsenal_items (
  id text primary key,
  schedule_id text not null references public.conversation_schedules(id) on delete cascade,
  item_type text not null,
  title text not null,
  description text,
  semantic_content text,
  usage_instruction text,
  social_function text,
  asset_id text,
  media_url text,
  whatsapp_media_url text,
  transcript text,
  visual_description text,
  validity_type text not null default 'evergreen',
  valid_from timestamptz,
  valid_until timestamptz,
  recurring_rules jsonb not null default '{}'::jsonb,
  max_uses_per_conversation integer,
  cooldown_minutes integer not null default 0,
  priority integer not null default 50,
  enabled boolean not null default true,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint conversation_arsenal_items_type_check
    check (item_type in ('topic','question','story','audio','photo')),
  constraint conversation_arsenal_items_validity_check
    check (validity_type in ('evergreen','recurring','moment')),
  constraint conversation_arsenal_items_max_uses_check
    check (max_uses_per_conversation is null or max_uses_per_conversation > 0),
  constraint conversation_arsenal_items_cooldown_check
    check (cooldown_minutes >= 0),
  constraint conversation_arsenal_items_priority_check
    check (priority between 0 and 100),
  constraint conversation_arsenal_items_valid_range_check
    check (valid_until is null or valid_from is null or valid_until > valid_from)
);

create index if not exists conversation_arsenal_items_schedule_enabled_idx
  on public.conversation_arsenal_items(schedule_id, enabled, priority desc);

create index if not exists conversation_arsenal_items_validity_idx
  on public.conversation_arsenal_items(schedule_id, validity_type, valid_from, valid_until);

alter table public.conversation_arsenal_items enable row level security;

drop policy if exists vendeo_anon_app_access on public.conversation_arsenal_items;
create policy vendeo_anon_app_access
on public.conversation_arsenal_items
for all
to anon, authenticated
using (true)
with check (true);

grant select, insert, update, delete on public.conversation_arsenal_items
  to anon, authenticated, service_role;

create table if not exists public.conversation_arsenal_usage (
  id uuid primary key default gen_random_uuid(),
  conversation_id text not null references public.instagram_conversations(id) on delete cascade,
  schedule_run_id uuid not null references public.conversation_schedule_runs(id) on delete cascade,
  arsenal_item_id text not null references public.conversation_arsenal_items(id) on delete cascade,
  cycle_id text,
  action_id text,
  status text not null default 'sent',
  used_at timestamptz,
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint conversation_arsenal_usage_status_check
    check (status in ('reserved','sending','sent','failed','cancelled'))
);

create unique index if not exists conversation_arsenal_usage_action_uidx
  on public.conversation_arsenal_usage(action_id)
  where action_id is not null;

create unique index if not exists conversation_arsenal_usage_cycle_item_uidx
  on public.conversation_arsenal_usage(schedule_run_id, arsenal_item_id, cycle_id)
  where cycle_id is not null;

create index if not exists conversation_arsenal_usage_lookup_idx
  on public.conversation_arsenal_usage(conversation_id, schedule_run_id, arsenal_item_id, status, used_at desc);

alter table public.conversation_arsenal_usage enable row level security;

drop policy if exists vendeo_anon_app_access on public.conversation_arsenal_usage;
create policy vendeo_anon_app_access
on public.conversation_arsenal_usage
for all
to anon, authenticated
using (true)
with check (true);

grant select, insert, update, delete on public.conversation_arsenal_usage
  to anon, authenticated, service_role;

alter table public.conversation_schedule_runs
  add column if not exists final_action_status text,
  add column if not exists final_action_delivered_at timestamptz,
  add column if not exists final_action_provider_message_id text,
  add column if not exists manual_action_note text;

alter table public.conversation_schedule_runs
  drop constraint if exists conversation_schedule_runs_final_action_status_check;

alter table public.conversation_schedule_runs
  add constraint conversation_schedule_runs_final_action_status_check
  check (
    final_action_status is null
    or final_action_status in ('pending','available','delivered','manual_required','failed')
  );

alter table public.conversation_schedule_runs
  drop constraint if exists conversation_schedule_runs_status_check;

alter table public.conversation_schedule_runs
  add constraint conversation_schedule_runs_status_check
  check (
    status in (
      'active','completed','expired','expired_incomplete',
      'completed_with_manual_action','cancelled'
    )
  );

-- Initialize final-action state when a connection run is created.
create or replace function public.initialize_connection_window_run()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mode text;
  v_final_action jsonb;
begin
  select execution_mode, final_action
    into v_mode, v_final_action
    from public.conversation_schedules
   where id = new.schedule_id;

  if v_mode = 'connection_window' then
    new.final_action_status := case
      when v_final_action is null
        or jsonb_typeof(v_final_action) <> 'object'
        or coalesce(v_final_action->>'type','') = ''
      then null
      else 'pending'
    end;
  end if;

  return new;
end;
$$;

revoke all on function public.initialize_connection_window_run() from public, anon, authenticated;

drop trigger if exists trg_initialize_connection_window_run
  on public.conversation_schedule_runs;

create trigger trg_initialize_connection_window_run
before insert on public.conversation_schedule_runs
for each row
execute function public.initialize_connection_window_run();

-- Existing active post-sale runs inherit the configured final-action state.
update public.conversation_schedule_runs r
   set final_action_status = case
     when cs.final_action is null
       or jsonb_typeof(cs.final_action) <> 'object'
       or coalesce(cs.final_action->>'type','') = ''
     then null
     else coalesce(r.final_action_status, 'pending')
   end
  from public.conversation_schedules cs
 where cs.id = r.schedule_id
   and cs.execution_mode = 'connection_window'
   and r.status = 'active';

-- Deterministic/idempotent usage projection. Semantic selection never happens here.
create or replace function public.record_conversation_arsenal_usage_atomic(
  p_conversation_id text,
  p_schedule_run_id uuid,
  p_arsenal_item_id text,
  p_cycle_id text,
  p_action_id text,
  p_provider_message_id text,
  p_status text default 'sent',
  p_last_error text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.conversation_schedule_runs%rowtype;
  v_item public.conversation_arsenal_items%rowtype;
  v_usage public.conversation_arsenal_usage%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_status not in ('reserved','sending','sent','failed','cancelled') then
    return jsonb_build_object('success',false,'reason','invalid_status');
  end if;

  select * into v_run
    from public.conversation_schedule_runs
   where id = p_schedule_run_id
     and conversation_id = p_conversation_id
   limit 1;

  if not found then
    return jsonb_build_object('success',false,'reason','run_not_found');
  end if;

  select * into v_item
    from public.conversation_arsenal_items
   where id = p_arsenal_item_id
     and schedule_id = v_run.schedule_id
   limit 1;

  if not found then
    return jsonb_build_object('success',false,'reason','arsenal_item_not_authorized');
  end if;

  insert into public.conversation_arsenal_usage (
    conversation_id, schedule_run_id, arsenal_item_id,
    cycle_id, action_id, status, used_at,
    provider_message_id, last_error, created_at, updated_at
  ) values (
    p_conversation_id, p_schedule_run_id, p_arsenal_item_id,
    nullif(btrim(coalesce(p_cycle_id,'')), ''),
    nullif(btrim(coalesce(p_action_id,'')), ''),
    p_status,
    case when p_status = 'sent' then v_now else null end,
    p_provider_message_id,
    p_last_error,
    v_now,
    v_now
  )
  on conflict (action_id) where action_id is not null
  do update set
    status = excluded.status,
    used_at = case
      when excluded.status = 'sent'
      then coalesce(public.conversation_arsenal_usage.used_at, excluded.used_at)
      else public.conversation_arsenal_usage.used_at
    end,
    provider_message_id = coalesce(excluded.provider_message_id, public.conversation_arsenal_usage.provider_message_id),
    last_error = excluded.last_error,
    updated_at = excluded.updated_at
  returning * into v_usage;

  return jsonb_build_object(
    'success', true,
    'usage_id', v_usage.id,
    'status', v_usage.status,
    'used_at', v_usage.used_at
  );
end;
$$;

revoke all on function public.record_conversation_arsenal_usage_atomic(
  text, uuid, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.record_conversation_arsenal_usage_atomic(
  text, uuid, text, text, text, text, text, text
) to service_role;

-- Delivery of the configured final audio makes the connection window terminally complete.
-- The expiration worker will perform the normal schedule transition/finalization immediately after.
create or replace function public.mark_connection_final_action_delivered_atomic(
  p_conversation_id text,
  p_asset_id text,
  p_provider_message_id text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_run public.conversation_schedule_runs%rowtype;
  v_schedule public.conversation_schedules%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  select r.*
    into v_run
    from public.conversation_schedule_runs r
   where r.conversation_id = p_conversation_id
     and r.status = 'active'
   order by r.started_at desc
   limit 1
   for update;

  if not found then
    return jsonb_build_object('success',false,'reason','active_run_not_found');
  end if;

  select * into v_schedule
    from public.conversation_schedules
   where id = v_run.schedule_id;

  if v_schedule.execution_mode <> 'connection_window' then
    return jsonb_build_object('success',true,'matched',false,'reason','not_connection_window');
  end if;

  if v_schedule.final_action is null
     or jsonb_typeof(v_schedule.final_action) <> 'object'
     or coalesce(v_schedule.final_action->>'assetId','') <> coalesce(p_asset_id,'')
  then
    return jsonb_build_object('success',true,'matched',false,'reason','asset_not_final_action');
  end if;

  update public.conversation_schedule_runs
     set final_action_status = 'delivered',
         final_action_delivered_at = coalesce(final_action_delivered_at, v_now),
         final_action_provider_message_id = coalesce(p_provider_message_id, final_action_provider_message_id),
         expires_at = least(coalesce(expires_at, v_now), v_now),
         updated_at = v_now
   where id = v_run.id;

  return jsonb_build_object(
    'success',true,
    'matched',true,
    'run_id',v_run.id,
    'schedule_id',v_run.schedule_id,
    'final_action_status','delivered'
  );
end;
$$;

revoke all on function public.mark_connection_final_action_delivered_atomic(text,text,text)
  from public, anon, authenticated;
grant execute on function public.mark_connection_final_action_delivered_atomic(text,text,text)
  to service_role;

-- Wrap the existing expiration worker: connection windows with a pending required final action
-- finish as completed_with_manual_action instead of being treated as a technical failure.
do $$
begin
  if to_regprocedure('public.process_conversation_schedule_expirations_goal_driven_atomic(integer)') is null
     and to_regprocedure('public.process_conversation_schedule_expirations_atomic(integer)') is not null
  then
    alter function public.process_conversation_schedule_expirations_atomic(integer)
      rename to process_conversation_schedule_expirations_goal_driven_atomic;
  end if;
end;
$$;

create or replace function public.process_conversation_schedule_expirations_atomic(
  p_limit integer default 50
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_now timestamptz;
  v_note text;
  v_rules jsonb;
  v_orch jsonb;
  v_manual integer := 0;
  v_base jsonb;
begin
  for v_row in
    select
      r.id as run_id,
      r.conversation_id,
      r.schedule_id,
      r.final_action_status,
      cs.name as schedule_name,
      cs.final_action
    from public.conversation_schedule_runs r
    join public.conversation_schedules cs on cs.id = r.schedule_id
    where r.status = 'active'
      and r.expires_at is not null
      and r.expires_at <= clock_timestamp()
      and cs.execution_mode = 'connection_window'
      and cs.final_action is not null
      and jsonb_typeof(cs.final_action) = 'object'
      and coalesce(cs.final_action->>'type','') <> ''
      and coalesce(r.final_action_status,'pending') <> 'delivered'
    order by r.expires_at asc, r.created_at asc
    for update of r skip locked
    limit greatest(1, least(coalesce(p_limit,50),200))
  loop
    v_now := clock_timestamp();
    v_note := format(
      'Cronograma "%s" encerrado por expiração. A ação final não pôde ser enviada porque não houve oportunidade adequada antes do fim da janela. Ação manual pendente: %s.',
      v_row.schedule_name,
      coalesce(v_row.final_action->>'title', v_row.final_action->>'assetId', 'enviar a ação final configurada')
    );

    update public.conversation_schedule_runs
       set status = 'completed_with_manual_action',
           final_action_status = 'manual_required',
           manual_action_note = v_note,
           completed_at = v_now,
           updated_at = v_now
     where id = v_row.run_id;

    select coalesce(stage_completed_rules,'{}'::jsonb)
      into v_rules
      from public.instagram_conversations
     where id = v_row.conversation_id
     for update;

    v_orch := case
      when jsonb_typeof(v_rules->'orchestration') = 'object'
      then v_rules->'orchestration'
      else '{}'::jsonb
    end;

    v_rules := jsonb_set(v_rules,'{schedule_status}','"completed_with_manual_action"'::jsonb,true);
    v_rules := jsonb_set(v_rules,'{schedule_expired_at}',to_jsonb(v_now::text),true);
    v_rules := jsonb_set(v_rules,'{current_schedule_id}',to_jsonb(v_row.schedule_id),true);
    v_rules := jsonb_set(v_rules,'{manual_action_note}',to_jsonb(v_note),true);
    v_rules := jsonb_set(v_rules,'{workflow_finalized}','false'::jsonb,true);

    v_orch := jsonb_set(v_orch,'{lastProcessingStatus}','"needs_human"'::jsonb,true);
    v_orch := jsonb_set(v_orch,'{lastError}','"schedule_final_action_manual_required"'::jsonb,true);
    v_orch := jsonb_set(v_orch,'{manualActionNote}',to_jsonb(v_note),true);
    v_rules := jsonb_set(v_rules,'{orchestration}',v_orch,true);

    update public.instagram_conversations
       set stage_completed_rules = v_rules,
           ai_auto_respond = false,
           ai_debounce_started_at = null,
           ai_debounce_until = null,
           updated_at = v_now
     where id = v_row.conversation_id;

    insert into public.autopilot_chat_states (
      conversation_id,is_enabled,status,state,
      state_revision,state_updated_at,updated_at
    ) values (
      v_row.conversation_id,
      false,
      'waiting_human',
      jsonb_build_object(
        'status','waiting_human',
        'pauseReason',v_note,
        'currentScheduleId',v_row.schedule_id,
        'manualActionRequired',true
      ),
      1,
      v_now,
      v_now
    )
    on conflict (conversation_id) do update
       set is_enabled = false,
           status = 'waiting_human',
           state = coalesce(public.autopilot_chat_states.state,'{}'::jsonb)
             || jsonb_build_object(
                  'status','waiting_human',
                  'pauseReason',v_note,
                  'currentScheduleId',v_row.schedule_id,
                  'manualActionRequired',true
                ),
           state_revision = public.autopilot_chat_states.state_revision + 1,
           state_updated_at = v_now,
           updated_at = v_now;

    v_manual := v_manual + 1;
  end loop;

  v_base := public.process_conversation_schedule_expirations_goal_driven_atomic(p_limit);

  return coalesce(v_base,'{}'::jsonb)
    || jsonb_build_object(
      'success',true,
      'completed_with_manual_action',v_manual
    );
end;
$$;

revoke all on function public.process_conversation_schedule_expirations_atomic(integer)
  from public, anon, authenticated;
grant execute on function public.process_conversation_schedule_expirations_atomic(integer)
  to service_role;

-- Final action delivered: the wrapper can immediately perform normal advance/finalization
-- when explicitly invoked by backend, while the cron remains a durable fallback.

comment on table public.conversation_arsenal_items is
  'Optional semantic resources for connection_window schedules. Not goals/checkpoints.';

comment on table public.conversation_arsenal_usage is
  'Confirmed technical usage ledger for arsenal resources; does not represent objective completion.';
