-- Harden internal SECURITY DEFINER functions exposed through PostgREST.
-- Both are server-internal: the projection patch is called only by the Edge API,
-- while sync_autopilot_projection_enabled is executed by a database trigger.

revoke all on function public.patch_autopilot_projection_state_atomic(
  text,
  jsonb,
  timestamptz
) from public, anon, authenticated;

grant execute on function public.patch_autopilot_projection_state_atomic(
  text,
  jsonb,
  timestamptz
) to service_role;

revoke all on function public.sync_autopilot_projection_enabled()
  from public, anon, authenticated;

grant execute on function public.sync_autopilot_projection_enabled()
  to service_role;
