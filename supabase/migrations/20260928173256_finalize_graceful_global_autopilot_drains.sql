create or replace function public.finalize_all_pending_autopilot_disables_atomic()
returns jsonb
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_count integer;
begin
  update public.instagram_conversations
  set ai_auto_respond = false,
      ai_debounce_until = null,
      stage_completed_rules =
        jsonb_set(
          jsonb_set(
            jsonb_set(
              jsonb_set(
                jsonb_set(coalesce(stage_completed_rules, '{}'::jsonb),
                  '{status}', '"disabled"'::jsonb, true),
                '{cancel_current_cycle}', 'false'::jsonb, true),
              '{disable_after_cycle}', 'false'::jsonb, true),
            '{disable_after_cycle_reason}', 'null'::jsonb, true),
          '{pause_reason}', '"global_toggle_off_after_cycle"'::jsonb, true),
      updated_at = clock_timestamp()
  where left(id, 2) <> '__'
    and coalesce((stage_completed_rules->>'disable_after_cycle')::boolean, false) is true
    and nullif(stage_completed_rules->>'active_cycle_token', '') is null;

  get diagnostics v_count = row_count;
  return jsonb_build_object('success', true, 'disabled', v_count);
end;
$$;

revoke all on function public.finalize_all_pending_autopilot_disables_atomic() from public, anon, authenticated;
grant execute on function public.finalize_all_pending_autopilot_disables_atomic() to service_role;
