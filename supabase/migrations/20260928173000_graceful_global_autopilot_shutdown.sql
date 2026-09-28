-- Graceful global AutoPilot shutdown.
-- Idle chats are disabled immediately; chats with an owned Brain cycle drain first.

create or replace function public.request_global_autopilot_disable_graceful()
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_row record;
  v_rules jsonb;
  v_immediate integer := 0;
  v_draining integer := 0;
begin
  for v_row in
    select id, ai_auto_respond, stage_completed_rules
    from public.instagram_conversations
    where left(id, 2) <> '__'
    for update
  loop
    v_rules := case when jsonb_typeof(v_row.stage_completed_rules) = 'object'
      then v_row.stage_completed_rules else '{}'::jsonb end;

    if v_row.ai_auto_respond is true
       and nullif(v_rules->>'active_cycle_token', '') is not null then
      v_rules := jsonb_set(v_rules, '{disable_after_cycle}', 'true'::jsonb, true);
      v_rules := jsonb_set(v_rules, '{disable_after_cycle_reason}', '"global_toggle_off"'::jsonb, true);
      v_rules := jsonb_set(v_rules, '{cancel_current_cycle}', 'false'::jsonb, true);
      update public.instagram_conversations
      set ai_debounce_until = null,
          stage_completed_rules = v_rules,
          updated_at = clock_timestamp()
      where id = v_row.id;
      v_draining := v_draining + 1;
    else
      v_rules := jsonb_set(v_rules, '{status}', '"disabled"'::jsonb, true);
      v_rules := jsonb_set(v_rules, '{cancel_current_cycle}', 'false'::jsonb, true);
      v_rules := jsonb_set(v_rules, '{disable_after_cycle}', 'false'::jsonb, true);
      v_rules := jsonb_set(v_rules, '{disable_after_cycle_reason}', 'null'::jsonb, true);
      v_rules := jsonb_set(v_rules, '{pause_reason}', '"global_toggle_off"'::jsonb, true);

      update public.instagram_conversations
      set ai_auto_respond = false,
          ai_debounce_until = null,
          stage_completed_rules = v_rules,
          updated_at = clock_timestamp()
      where id = v_row.id;
      v_immediate := v_immediate + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'success', true,
    'disabledImmediately', v_immediate,
    'draining', v_draining
  );
end;
$$;
revoke all on function public.request_global_autopilot_disable_graceful() from public, anon, authenticated;
grant execute on function public.request_global_autopilot_disable_graceful() to service_role;

create or replace function public.finalize_autopilot_disable_after_cycle_atomic(
  p_conversation_id text
)
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_rules jsonb;
begin
  select stage_completed_rules
  into v_rules
  from public.instagram_conversations
  where id = p_conversation_id
  for update;

  if not found then
    return jsonb_build_object('success', false, 'reason', 'conversation_not_found');
  end if;

  v_rules := case when jsonb_typeof(v_rules) = 'object' then v_rules else '{}'::jsonb end;

  if coalesce((v_rules->>'disable_after_cycle')::boolean, false) is not true then
    return jsonb_build_object('success', true, 'disabled', false, 'reason', 'not_pending');
  end if;
  if nullif(v_rules->>'active_cycle_token', '') is not null then
    return jsonb_build_object('success', true, 'disabled', false, 'reason', 'cycle_still_active');
  end if;

  v_rules := jsonb_set(v_rules, '{status}', '"disabled"'::jsonb, true);
  v_rules := jsonb_set(v_rules, '{cancel_current_cycle}', 'false'::jsonb, true);
  v_rules := jsonb_set(v_rules, '{disable_after_cycle}', 'false'::jsonb, true);
  v_rules := jsonb_set(v_rules, '{disable_after_cycle_reason}', 'null'::jsonb, true);
  v_rules := jsonb_set(v_rules, '{pause_reason}', '"global_toggle_off_after_cycle"'::jsonb, true);

  update public.instagram_conversations
  set ai_auto_respond = false,
      ai_debounce_until = null,
      stage_completed_rules = v_rules,
      updated_at = clock_timestamp()
  where id = p_conversation_id;

  return jsonb_build_object('success', true, 'disabled', true, 'reason', 'cycle_finished');
end;
$$;

revoke all on function public.finalize_autopilot_disable_after_cycle_atomic(text) from public, anon, authenticated;
grant execute on function public.finalize_autopilot_disable_after_cycle_atomic(text) to service_role;
create or replace function public.cancel_global_autopilot_disable_drain()
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_count integer;
begin
  update public.instagram_conversations
  set stage_completed_rules =
        jsonb_set(
          jsonb_set(
            coalesce(stage_completed_rules, '{}'::jsonb),
            '{disable_after_cycle}',
            'false'::jsonb,
            true
          ),
          '{disable_after_cycle_reason}',
          'null'::jsonb,
          true
        ),
      updated_at = clock_timestamp()
  where left(id, 2) <> '__'
    and coalesce((stage_completed_rules->>'disable_after_cycle')::boolean, false) is true;

  get diagnostics v_count = row_count;
  return jsonb_build_object('success', true, 'cleared', v_count);
end;
$$;

revoke all on function public.cancel_global_autopilot_disable_drain() from public, anon, authenticated;
grant execute on function public.cancel_global_autopilot_disable_drain() to service_role;
