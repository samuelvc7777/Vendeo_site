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
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndzZHVhbGh2b3BpZGdxY3Vtb25yIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4ODkwODM4OSwiZXhwIjoyMTA0NDg0Mzg5fQ.ebpH41NJdrNgRbgch4ciTxTS6SppRRoJzSPoyEmN2MU'
    ),
    body := '{}'::jsonb
  );
  $$
);;
