-- Cronogramas são a única autoridade de modelo e tempo de resposta.
-- Remove somente valores globais legados; demais configurações do AutoPilot permanecem.
update public.autopilot_settings
   set config = coalesce(config, '{}'::jsonb)
     - 'responseDelayMinutes'
     - 'maxDebounceWindowMinutes',
       updated_at = now()
 where id = 'global';

delete from public.instagram_config
 where id = 'openai_brain_model';
