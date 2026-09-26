DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'autopilot-cron-tick') THEN
    PERFORM cron.unschedule('autopilot-cron-tick');
  END IF;
END $$;

SELECT cron.schedule(
  'autopilot-cron-tick',
  '* * * * *',
  $$
  SELECT net.http_post(
    url := 'https://wsdualhvopidgqcumonr.supabase.co/functions/v1/api/autopilot/cron-tick',
    headers := jsonb_build_object(
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  $$
);;
