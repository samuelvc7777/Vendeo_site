-- Task 7: long-term retention guards for WhatsApp 2 durable queues.
-- Keep terminal rows long enough for idempotency/diagnostics without unbounded growth.

create index if not exists idx_whatsapp2_inbound_completed_at
  on public.whatsapp2_inbound_jobs (completed_at)
  where status = 'completed';

create index if not exists idx_whatsapp2_inbound_failed_at
  on public.whatsapp2_inbound_jobs (failed_at)
  where status = 'failed';

create index if not exists idx_whatsapp2_transcription_completed_at
  on public.whatsapp2_transcription_jobs (completed_at)
  where status = 'completed';

create index if not exists idx_whatsapp2_transcription_failed_at
  on public.whatsapp2_transcription_jobs (failed_at)
  where status = 'failed';
create index if not exists idx_whatsapp2_delivery_terminal_completed_at
  on public.whatsapp2_delivery_queue (completed_at)
  where status in ('sent', 'cancelled');

create index if not exists idx_whatsapp2_delivery_terminal_updated_at
  on public.whatsapp2_delivery_queue (updated_at)
  where status in ('failed', 'uncertain');

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
     status in ('failed', 'uncertain')
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
do $$
begin
  if exists (
    select 1
    from cron.job
    where jobname = 'whatsapp2-terminal-retention-cleanup'
  ) then
    perform cron.unschedule('whatsapp2-terminal-retention-cleanup');
  end if;
end $$;

select cron.schedule(
  'whatsapp2-terminal-retention-cleanup',
  '37 3 * * *',
  $job$
    select public.cleanup_whatsapp2_terminal_jobs(
      interval '14 days',
      interval '30 days'
    );
  $job$
);
