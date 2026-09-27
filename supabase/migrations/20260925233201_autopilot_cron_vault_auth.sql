-- Authenticate the scheduled watcher with a dedicated Vault token. The cron
-- authorization no longer depends on the Edge Function service-role env value,
-- which may rotate independently from the database job.

do $$
declare
  v_token text;
begin
  if not exists (
    select 1
    from vault.decrypted_secrets
    where name = 'autopilot_cron_token'
  ) then
    v_token := replace(pg_catalog.gen_random_uuid()::text, '-', '')
      || replace(pg_catalog.gen_random_uuid()::text, '-', '')
      || replace(pg_catalog.gen_random_uuid()::text, '-', '')
      || replace(pg_catalog.gen_random_uuid()::text, '-', '');
    perform vault.create_secret(v_token, 'autopilot_cron_token');
  end if;
end;
$$;

create or replace function public.verify_autopilot_cron_token(p_token text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select coalesce(bool_or(s.decrypted_secret = p_token), false)
  from vault.decrypted_secrets as s
  where s.name = 'autopilot_cron_token'
    and p_token is not null;
$$;

revoke all on function public.verify_autopilot_cron_token(text) from public, anon, authenticated;
grant execute on function public.verify_autopilot_cron_token(text) to service_role;

do $$
declare
  v_new_command text;
begin
  if exists (select 1 from cron.job where jobname = 'autopilot-cron-tick') then
    perform cron.unschedule('autopilot-cron-tick');
  end if;

  v_new_command := $job$
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
      body := '{}'::jsonb
    );
  $job$;

  perform cron.schedule('autopilot-cron-tick', '* * * * *', v_new_command);
end;
$$;
