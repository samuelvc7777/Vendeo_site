-- Avoid WAL/Realtime churn when a Brain publish repeats the same visible state.
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
  v_current_cmp jsonb;
  v_next_cmp jsonb;
  v_patch_clean jsonb;
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

  v_patch_clean := p_state_patch
    - 'isEnabled'
    - 'conversationId'
    - 'stateRevision'
    - 'stateUpdatedAt'
    - 'cycleEvents';

  v_next := coalesce(v_current, '{}'::jsonb) || v_patch_clean;
  v_next := jsonb_set(v_next, '{conversationId}', to_jsonb(p_conversation_id), true);
  v_next := jsonb_set(v_next, '{isEnabled}', to_jsonb(v_enabled), true);
  v_next := v_next - 'cycleEvents';

  if not v_enabled then
    v_next := jsonb_set(v_next, '{status}', '"disabled"'::jsonb, true);
  elsif v_next->>'status' = 'disabled' then
    v_next := jsonb_set(v_next, '{status}', '"idle"'::jsonb, true);
  end if;

  -- updatedAt inside activity is observational metadata, not a visible state change.
  v_current_cmp := (coalesce(v_current, '{}'::jsonb) - 'stateUpdatedAt' - 'stateRevision')
    #- '{activity,updatedAt}';
  v_next_cmp := (v_next - 'stateUpdatedAt' - 'stateRevision')
    #- '{activity,updatedAt}';

  if v_current_cmp = v_next_cmp then
    return jsonb_build_object(
      'success', true,
      'applied', false,
      'reason', 'projection_unchanged',
      'isEnabled', v_enabled,
      'stateUpdatedAt', v_current_at,
      'stateRevision', v_revision,
      'state', v_current
    );
  end if;

  v_now := clock_timestamp();
  v_revision := v_revision + 1;
  v_next := jsonb_set(v_next, '{stateUpdatedAt}', to_jsonb(v_now), true);
  v_next := jsonb_set(v_next, '{stateRevision}', to_jsonb(v_revision), true);

  update public.autopilot_chat_states
  set is_enabled = v_enabled,
      status = coalesce(
        nullif(v_next->>'status', ''),
        case when v_enabled then 'idle' else 'disabled' end
      ),
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

revoke all on function public.patch_autopilot_projection_state_atomic(text, jsonb, timestamptz)
  from public;
grant execute on function public.patch_autopilot_projection_state_atomic(text, jsonb, timestamptz)
  to anon, authenticated, service_role;
