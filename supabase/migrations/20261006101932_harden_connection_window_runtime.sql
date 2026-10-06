-- harden_connection_window_runtime
-- Keeps schedule_sales goal-driven and makes arsenal usage a backend-only,
-- atomic reservation/confirmation ledger.

-- Venda is a compatibility anchor and must never become connection_window.
update public.conversation_schedules
   set execution_mode = 'goal_driven',
       updated_at = clock_timestamp()
 where id = 'schedule_sales'
   and execution_mode <> 'goal_driven';

alter table public.conversation_schedules
  drop constraint if exists conversation_schedules_sales_goal_driven_check;

alter table public.conversation_schedules
  add constraint conversation_schedules_sales_goal_driven_check
  check (id <> 'schedule_sales' or execution_mode = 'goal_driven');

-- Usage is an internal deterministic ledger. The configuration catalog remains
-- editable by the operator UI, but usage transitions are service-role only.
drop policy if exists vendeo_anon_app_access on public.conversation_arsenal_usage;
drop policy if exists conversation_arsenal_usage_service_role on public.conversation_arsenal_usage;
create policy conversation_arsenal_usage_service_role
on public.conversation_arsenal_usage
for all
to service_role
using (true)
with check (true);

revoke all privileges on table public.conversation_arsenal_usage from anon, authenticated;
revoke all privileges on table public.conversation_arsenal_usage from service_role;
grant select, insert, update, delete on table public.conversation_arsenal_usage to service_role;

create index if not exists conversation_arsenal_usage_item_idx
  on public.conversation_arsenal_usage(arsenal_item_id);

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
set search_path = public, pg_temp
as $$
declare
  v_run public.conversation_schedule_runs%rowtype;
  v_item public.conversation_arsenal_items%rowtype;
  v_usage public.conversation_arsenal_usage%rowtype;
  v_existing public.conversation_arsenal_usage%rowtype;
  v_now timestamptz := clock_timestamp();
  v_effective_status text;
  v_inflight_uses integer := 0;
  v_last_sent_at timestamptz;
  v_timezone text;
  v_requested_timezone text;
  v_local_dow integer;
  v_local_time text;
  v_start_time text;
  v_end_time text;
  v_schedule_mode text;
begin
  if p_status not in ('reserved','sending','sent','failed','cancelled') then
    return jsonb_build_object('success',false,'reason','invalid_status');
  end if;

  if nullif(btrim(coalesce(p_action_id,'')), '') is null then
    return jsonb_build_object('success',false,'reason','action_id_required');
  end if;

  -- Serializes only the same contact+resource pair, not the whole arsenal.
  perform pg_advisory_xact_lock(
    hashtextextended(coalesce(p_conversation_id,'') || ':' || coalesce(p_arsenal_item_id,''), 0)
  );

  select *
    into v_existing
    from public.conversation_arsenal_usage
   where action_id = p_action_id
   limit 1
   for update;

  if found then
    if v_existing.conversation_id <> p_conversation_id
       or v_existing.schedule_run_id <> p_schedule_run_id
       or v_existing.arsenal_item_id <> p_arsenal_item_id
    then
      return jsonb_build_object('success',false,'reason','action_id_conflict');
    end if;

    -- A confirmed send is terminal and can never be downgraded by a late retry/failure.
    v_effective_status := case
      when v_existing.status = 'sent' then 'sent'
      else p_status
    end;

    update public.conversation_arsenal_usage
       set status = v_effective_status,
           used_at = case
             when v_effective_status = 'sent' then coalesce(used_at, v_now)
             else used_at
           end,
           provider_message_id = coalesce(p_provider_message_id, provider_message_id),
           last_error = case when v_effective_status = 'sent' then null else p_last_error end,
           updated_at = v_now
     where id = v_existing.id
     returning * into v_usage;

    return jsonb_build_object(
      'success', true,
      'usage_id', v_usage.id,
      'status', v_usage.status,
      'used_at', v_usage.used_at,
      'idempotent', true
    );
  end if;

  select *
    into v_run
    from public.conversation_schedule_runs
   where id = p_schedule_run_id
     and conversation_id = p_conversation_id
   limit 1;

  if not found then
    return jsonb_build_object('success',false,'reason','run_not_found');
  end if;

  if v_run.status <> 'active' then
    return jsonb_build_object('success',false,'reason','run_not_active');
  end if;

  select execution_mode
    into v_schedule_mode
    from public.conversation_schedules
   where id = v_run.schedule_id;

  if coalesce(v_schedule_mode,'goal_driven') <> 'connection_window' then
    return jsonb_build_object('success',false,'reason','not_connection_window');
  end if;

  select *
    into v_item
    from public.conversation_arsenal_items
   where id = p_arsenal_item_id
     and schedule_id = v_run.schedule_id
   limit 1;

  if not found then
    return jsonb_build_object('success',false,'reason','arsenal_item_not_authorized');
  end if;

  if v_item.enabled is not true then
    return jsonb_build_object('success',false,'reason','arsenal_item_disabled');
  end if;

  -- New successful/reservable transitions must still be valid at execution time.
  if p_status in ('reserved','sending','sent') then
    if v_item.validity_type = 'moment' then
      if v_item.valid_from is not null and v_now < v_item.valid_from then
        return jsonb_build_object('success',false,'reason','arsenal_item_not_yet_valid');
      end if;
      if v_item.valid_until is not null and v_now > v_item.valid_until then
        return jsonb_build_object('success',false,'reason','arsenal_item_expired');
      end if;
    elsif v_item.validity_type = 'recurring' then
      v_requested_timezone := nullif(btrim(coalesce(v_item.recurring_rules->>'timezone','')), '');
      if v_requested_timezone is not null then
        select name
          into v_timezone
          from pg_timezone_names
         where name = v_requested_timezone
         limit 1;
      end if;
      v_timezone := coalesce(v_timezone, 'America/Sao_Paulo');
      v_local_dow := extract(dow from (v_now at time zone v_timezone))::integer;
      v_local_time := to_char(v_now at time zone v_timezone, 'HH24:MI');

      if jsonb_typeof(v_item.recurring_rules->'weekdays') = 'array'
         and jsonb_array_length(v_item.recurring_rules->'weekdays') > 0
         and not exists (
           select 1
             from jsonb_array_elements_text(v_item.recurring_rules->'weekdays') as day(value)
            where day.value ~ '^[0-6]$'
              and day.value::integer = v_local_dow
         )
      then
        return jsonb_build_object('success',false,'reason','arsenal_item_outside_recurring_day');
      end if;

      v_start_time := nullif(v_item.recurring_rules->>'startTime','');
      v_end_time := nullif(v_item.recurring_rules->>'endTime','');
      if v_start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
         and v_end_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
      then
        if v_start_time <= v_end_time then
          if not (v_local_time >= v_start_time and v_local_time <= v_end_time) then
            return jsonb_build_object('success',false,'reason','arsenal_item_outside_recurring_time');
          end if;
        else
          if not (v_local_time >= v_start_time or v_local_time <= v_end_time) then
            return jsonb_build_object('success',false,'reason','arsenal_item_outside_recurring_time');
          end if;
        end if;
      end if;
    end if;

    -- "Per conversation" intentionally spans schedule runs. Reserved/sending rows
    -- count too so concurrent cycles cannot overbook the same resource.
    select count(*)
      into v_inflight_uses
      from public.conversation_arsenal_usage
     where conversation_id = p_conversation_id
       and arsenal_item_id = p_arsenal_item_id
       and status in ('reserved','sending','sent');

    if v_item.max_uses_per_conversation is not null
       and v_inflight_uses >= v_item.max_uses_per_conversation
    then
      return jsonb_build_object('success',false,'reason','arsenal_item_max_uses_reached');
    end if;

    select max(used_at)
      into v_last_sent_at
      from public.conversation_arsenal_usage
     where conversation_id = p_conversation_id
       and arsenal_item_id = p_arsenal_item_id
       and status = 'sent'
       and used_at is not null;

    if v_last_sent_at is not null
       and coalesce(v_item.cooldown_minutes,0) > 0
       and v_now < v_last_sent_at + make_interval(mins => v_item.cooldown_minutes)
    then
      return jsonb_build_object('success',false,'reason','arsenal_item_cooldown_active');
    end if;
  end if;

  begin
    insert into public.conversation_arsenal_usage (
      conversation_id, schedule_run_id, arsenal_item_id,
      cycle_id, action_id, status, used_at,
      provider_message_id, last_error, created_at, updated_at
    ) values (
      p_conversation_id,
      p_schedule_run_id,
      p_arsenal_item_id,
      nullif(btrim(coalesce(p_cycle_id,'')), ''),
      p_action_id,
      p_status,
      case when p_status = 'sent' then v_now else null end,
      p_provider_message_id,
      case when p_status = 'sent' then null else p_last_error end,
      v_now,
      v_now
    )
    returning * into v_usage;
  exception
    when unique_violation then
      return jsonb_build_object('success',false,'reason','arsenal_item_already_reserved');
  end;

  return jsonb_build_object(
    'success', true,
    'usage_id', v_usage.id,
    'status', v_usage.status,
    'used_at', v_usage.used_at,
    'idempotent', false
  );
end;
$$;

revoke all on function public.record_conversation_arsenal_usage_atomic(
  text, uuid, text, text, text, text, text, text
) from public, anon, authenticated;
grant execute on function public.record_conversation_arsenal_usage_atomic(
  text, uuid, text, text, text, text, text, text
) to service_role;

comment on table public.conversation_arsenal_usage is
  'Backend-only atomic reservation/delivery ledger for connection_window arsenal resources; never objective progress.';
