-- Harden WhatsApp 2 retention without changing the existing cron schedule.
-- Uncertain deliveries are preserved indefinitely because delivery may have happened.

create or replace function public.cleanup_whatsapp2_terminal_jobs(
  p_completed_retention interval default interval '14 days',
  p_failed_retention interval default interval '30 days'
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inbound_deleted integer := 0;
  v_transcription_deleted integer := 0;
  v_delivery_deleted integer := 0;
begin
  if p_completed_retention is null or p_completed_retention <= interval '0 seconds' then
    raise exception 'p_completed_retention must be positive' using errcode = '22023';
  end if;
  if p_failed_retention is null or p_failed_retention <= interval '0 seconds' then
    raise exception 'p_failed_retention must be positive' using errcode = '22023';
  end if;

  delete from public.whatsapp2_inbound_jobs
   where (
     status = 'completed'
     and completed_at < clock_timestamp() - p_completed_retention
   ) or (
     status = 'failed'
     and failed_at < clock_timestamp() - p_failed_retention
   );
  get diagnostics v_inbound_deleted = row_count;

  delete from public.whatsapp2_transcription_jobs
   where (
     status = 'completed'
     and completed_at < clock_timestamp() - p_completed_retention
   ) or (
     status = 'failed'
     and failed_at < clock_timestamp() - p_failed_retention
   );
  get diagnostics v_transcription_deleted = row_count;

  delete from public.whatsapp2_delivery_queue
   where (
     status in ('sent', 'cancelled')
     and coalesce(completed_at, updated_at) < clock_timestamp() - p_completed_retention
   ) or (
     status = 'failed'
     and updated_at < clock_timestamp() - p_failed_retention
   );
  get diagnostics v_delivery_deleted = row_count;

  return jsonb_build_object(
    'success', true,
    'inbound_deleted', v_inbound_deleted,
    'transcription_deleted', v_transcription_deleted,
    'delivery_deleted', v_delivery_deleted
  );
end;
$$;

revoke all on function public.cleanup_whatsapp2_terminal_jobs(interval, interval)
  from public, anon, authenticated;
grant execute on function public.cleanup_whatsapp2_terminal_jobs(interval, interval)
  to service_role;
