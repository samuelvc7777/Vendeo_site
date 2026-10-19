-- Programacao semanal da chave global do Brain, independente da tela aberta.
-- Nao altera ai_auto_respond por conversa: ao religar, so chats previamente ativos retomam.
create or replace function public.autopilot_schedule_active_at(
  p_schedule jsonb,
  p_instant timestamptz
)
returns boolean
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_local timestamp;
  v_day int;
  v_selected_day int;
  v_time text;
  v_start text := p_schedule->>'startTime';
  v_end text := p_schedule->>'endTime';
  v_days jsonb := p_schedule->'days';
begin
  if coalesce(p_schedule->>'enabled', 'false') <> 'true' then
    return null;
  end if;
  if coalesce(p_schedule->>'timeZone', '') <> 'America/Sao_Paulo'
     or v_start is null or v_end is null
     or v_start !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     or v_end !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
     or v_start = v_end
     or jsonb_typeof(v_days) is distinct from 'array'
     or jsonb_array_length(v_days) = 0
  then
    return null;
  end if;

  v_local := p_instant at time zone 'America/Sao_Paulo';
  v_time := to_char(v_local, 'HH24:MI');
  v_day := extract(dow from v_local)::int;

  if v_start < v_end then
    if v_time < v_start or v_time >= v_end then return false; end if;
    v_selected_day := v_day;
  elsif v_time >= v_start then
    v_selected_day := v_day;
  elsif v_time < v_end then
    v_selected_day := (v_day + 6) % 7;
  else
    return false;
  end if;

  return exists(
    select 1
    from jsonb_array_elements_text(v_days) as d(value)
    where d.value = v_selected_day::text
  );
end;
$$;

revoke all on function public.autopilot_schedule_active_at(jsonb, timestamptz)
  from public, anon, authenticated;
grant execute on function public.autopilot_schedule_active_at(jsonb, timestamptz)
  to service_role;

create or replace function public.apply_global_autopilot_schedule()
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_config jsonb;
  v_should_enable boolean;
  v_current_enabled boolean;
  v_when timestamptz := clock_timestamp();
begin
  -- Serializa com outros ticks do agendador e impede escrita em cima de configuracao antiga.
  select config into v_config
  from public.autopilot_settings
  where id = 'global'
  for update;

  if not found then
    return jsonb_build_object('applied', false, 'reason', 'config_missing');
  end if;

  v_should_enable := public.autopilot_schedule_active_at(v_config->'autoSchedule', v_when);
  if v_should_enable is null then
    return jsonb_build_object('applied', false, 'reason', 'schedule_disabled_or_invalid');
  end if;

  v_current_enabled := coalesce((v_config->>'isEnabledGlobally')::boolean, true);
  if v_current_enabled = v_should_enable then
    return jsonb_build_object('applied', false, 'enabled', v_should_enable);
  end if;

  update public.autopilot_settings
  set config = jsonb_set(
      jsonb_set(v_config, '{isEnabledGlobally}', to_jsonb(v_should_enable), true),
      '{updatedAt}', to_jsonb(v_when::text), true
    ),
    updated_at = v_when
  where id = 'global';

  -- Pausa apenas novas inferencias; ciclos em andamento terminam.
  -- Nao desativa o estado individual dos chats (diferente do desligamento manual).
  return jsonb_build_object('applied', true, 'enabled', v_should_enable);
end;
$$;

revoke all on function public.apply_global_autopilot_schedule()
  from public, anon, authenticated;
grant execute on function public.apply_global_autopilot_schedule() to service_role;

-- A programacao continua mesmo com o navegador e o gateway fechados.
select cron.schedule(
  'autopilot-global-schedule',
  '* * * * *',
  $$select public.apply_global_autopilot_schedule();$$
);
