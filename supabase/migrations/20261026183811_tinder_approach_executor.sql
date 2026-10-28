-- Executor textual independente, autorizado por conta e destinatário.
create table public.tinder_approach_runs (
  account_id text not null,
  match_id text not null,
  schedule_id uuid not null,
  config jsonb not null,
  phase text not null default 'waiting' check (phase in ('waiting','planning','sending','completed','failed')),
  next_index integer not null default 0 check (next_index >= 0),
  next_at timestamptz not null,
  lease_token uuid,
  lease_until timestamptz,
  attempts integer not null default 0,
  handled_inbound_ids jsonb not null default '[]',
  pending_text text,
  pending_inbound_ids jsonb,
  error_code text,
  primary key (account_id, match_id),
  foreign key (account_id, match_id) references public.tinder_approach_recipients(account_id, match_id) on delete cascade
);
create index tinder_approach_runs_due_idx on public.tinder_approach_runs(next_at) where phase in ('waiting','planning','sending');
create table public.tinder_approach_events (
  id bigint generated always as identity primary key,
  account_id text not null,
  match_id text not null,
  event text not null,
  detail jsonb not null default '{}',
  created_at timestamptz not null default now(),
  foreign key (account_id, match_id) references public.tinder_approach_recipients(account_id, match_id) on delete cascade
);
create index tinder_approach_events_chat_idx on public.tinder_approach_events(account_id, match_id, id desc);
create table public.tinder_approach_worker_state (
  id boolean primary key default true check(id),
  last_tick timestamptz not null
);
alter table public.tinder_approach_worker_state enable row level security;
alter table public.tinder_approach_runs enable row level security;
alter table public.tinder_approach_events enable row level security;
revoke all on public.tinder_approach_runs, public.tinder_approach_events from public, anon, authenticated;
revoke all on public.tinder_approach_worker_state from public,anon,authenticated;
grant select,insert,update on public.tinder_approach_worker_state to service_role;
grant select, insert, update on public.tinder_approach_runs, public.tinder_approach_events to service_role;
grant usage, select on sequence public.tinder_approach_events_id_seq to service_role;

create function public.tinder_approach_delay(p_config jsonb)
returns integer language sql volatile security invoker set search_path = public as $$
  select case when p_config->>'responseDelayMode' = 'range' then
    least(31536000, greatest(0, (p_config->>'responseDelayMinSeconds')::integer + floor(random() *
      (1 + (p_config->>'responseDelayMaxSeconds')::integer - (p_config->>'responseDelayMinSeconds')::integer))::integer))
    else least(31536000, greatest(0, (p_config->>'responseDelayFixedSeconds')::integer)) end;
$$;

create function public.tinder_approach_executor_ready()
returns boolean language sql stable security invoker set search_path = public as $$
  select coalesce((select last_tick > now()-interval '90 seconds' from public.tinder_approach_worker_state where id),false);
$$;

create function public.claim_tinder_approaches(p_limit integer default 3)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare v_jobs jsonb;
begin
  insert into public.tinder_approach_worker_state(id,last_tick) values(true,now()) on conflict(id) do update set last_tick=excluded.last_tick;
  -- Falha após começar um POST pode ter sido entrega real: nunca repetir cegamente.
  with expired as (
    update public.tinder_approach_runs set phase='failed', error_code='DELIVERY_UNKNOWN', lease_token=null, lease_until=null
    where phase='sending' and lease_until < now() returning account_id, match_id
  ), failed as (
    update public.tinder_approach_recipients r set status='failed' from expired e
    where r.account_id=e.account_id and r.match_id=e.match_id returning r.account_id, r.match_id
  ) insert into public.tinder_approach_events(account_id,match_id,event,detail)
    select account_id,match_id,'delivery_unknown','{"reason":"worker_interrupted"}' from failed;

  with added as (
    insert into public.tinder_approach_runs(account_id,match_id,schedule_id,config,next_at)
    select e.account_id,e.match_id,e.schedule_id,c.config,now()+make_interval(secs=>public.tinder_approach_delay(c.config))
    from public.tinder_approach_eligible_recipients e
    join public.tinder_conversation_schedules c on c.id=e.schedule_id and c.account_id=e.account_id
    join public.match_tinder_config t on t.id='default' and t.user_id=e.account_id and coalesce(t.auth_token,'')<>''
    where jsonb_array_length(e.delivered_message_ids)=0
    on conflict do nothing returning *
  ) insert into public.tinder_approach_events(account_id,match_id,event,detail)
    select account_id,match_id,'scheduled',jsonb_build_object('index',0,'total',jsonb_array_length(config->'messages'),'nextAt',next_at) from added;

  with candidates as (
    select j.account_id,j.match_id from public.tinder_approach_runs j
    join public.tinder_approach_eligible_recipients e using(account_id,match_id)
    join public.match_tinder_config t on t.id='default' and t.user_id=j.account_id and coalesce(t.auth_token,'')<>''
    where j.schedule_id=e.schedule_id and j.next_at<=now()
      and (j.phase='waiting' or (j.phase='planning' and j.lease_until<now()))
    order by j.next_at limit greatest(0,least(p_limit,6)) for update of j skip locked
  ), claimed as (
    update public.tinder_approach_runs j set phase='planning',lease_token=gen_random_uuid(),lease_until=now()+interval '180 seconds'
    from candidates c where j.account_id=c.account_id and j.match_id=c.match_id returning j.*
  ), logged as (
    insert into public.tinder_approach_events(account_id,match_id,event,detail)
    select account_id,match_id,'planning',jsonb_build_object('index',next_index,'model',config->>'brainModel') from claimed
  ) select coalesce(jsonb_agg(to_jsonb(claimed)), '[]') into v_jobs from claimed;
  return v_jobs;
end;
$$;

create function public.begin_tinder_approach_send(p_account_id text,p_match_id text,p_lease uuid,p_text text,p_inbound_ids jsonb,p_diagnostic jsonb)
returns boolean language plpgsql security invoker set search_path = public as $$
declare j public.tinder_approach_runs; s public.tinder_ai_settings; r public.tinder_approach_recipients;
begin
  select * into s from public.tinder_ai_settings where account_id=p_account_id for update;
  select * into r from public.tinder_approach_recipients where account_id=p_account_id and match_id=p_match_id for update;
  select * into j from public.tinder_approach_runs where account_id=p_account_id and match_id=p_match_id for update;
  if p_lease is null or j.lease_token is distinct from p_lease or j.phase<>'planning' or j.lease_until<=now() then return false; end if;
  if not coalesce(s.is_enabled and r.is_authorized and r.status in ('pending','running') and s.schedule_id=j.schedule_id,false)
    or not exists(select 1 from public.tinder_conversation_schedules where id=j.schedule_id and account_id=p_account_id and config->>'isActive'='true')
    or not exists(select 1 from public.match_tinder_config where id='default' and user_id=p_account_id and coalesce(auth_token,'')<>'') then
    update public.tinder_approach_runs set phase='waiting',lease_token=null,lease_until=null where account_id=p_account_id and match_id=p_match_id;
    return false;
  end if;
  if p_text is null or length(btrim(p_text)) not between 1 and 4000 or p_inbound_ids is null or jsonb_typeof(p_inbound_ids)<>'array' then raise exception 'Mensagem inválida'; end if;
  update public.tinder_approach_runs set phase='sending',pending_text=p_text,pending_inbound_ids=p_inbound_ids,
    lease_until=now()+interval '60 seconds' where account_id=p_account_id and match_id=p_match_id;
  update public.tinder_approach_recipients set status='running' where account_id=p_account_id and match_id=p_match_id;
  insert into public.tinder_approach_events(account_id,match_id,event,detail) values(p_account_id,p_match_id,'sending',
    jsonb_build_object('index',j.next_index,'text',p_text,'diagnostic',p_diagnostic));
  return true;
end;
$$;

create function public.finish_tinder_approach_send(p_account_id text,p_match_id text,p_lease uuid,p_provider_id text)
returns boolean language plpgsql security invoker set search_path = public as $$
declare j public.tinder_approach_runs; v_done boolean; v_next timestamptz;
begin
  select * into j from public.tinder_approach_runs where account_id=p_account_id and match_id=p_match_id for update;
  if p_lease is null or j.lease_token is distinct from p_lease or j.phase<>'sending' then return false; end if;
  if p_provider_id is null or btrim(p_provider_id)='' then raise exception 'Confirmação de entrega ausente'; end if;
  v_done := j.next_index+1>=jsonb_array_length(j.config->'messages');
  v_next := now()+make_interval(secs=>public.tinder_approach_delay(j.config));
  update public.tinder_approach_runs set phase=case when v_done then 'completed' else 'waiting' end,
    next_index=j.next_index+1,next_at=v_next,handled_inbound_ids=j.pending_inbound_ids,
    pending_text=null,pending_inbound_ids=null,lease_token=null,lease_until=null,attempts=0,error_code=null
    where account_id=p_account_id and match_id=p_match_id;
  update public.tinder_approach_recipients set delivered_message_ids=delivered_message_ids||jsonb_build_array(j.config->'messages'->j.next_index->>'id'),
    status=case when v_done then 'completed' else 'running' end,completed_at=case when v_done then now() else null end
    where account_id=p_account_id and match_id=p_match_id;
  insert into public.tinder_approach_events(account_id,match_id,event,detail) values(p_account_id,p_match_id,'delivered',
    jsonb_build_object('index',j.next_index,'providerMessageId',p_provider_id));
  insert into public.tinder_approach_events(account_id,match_id,event,detail) values(p_account_id,p_match_id,case when v_done then 'completed' else 'scheduled' end,
    jsonb_build_object('index',j.next_index+1,'total',jsonb_array_length(j.config->'messages'),'nextAt',case when v_done then null else v_next end));
  return true;
end;
$$;

create function public.release_tinder_approach(p_account_id text,p_match_id text,p_lease uuid,p_reason text)
returns boolean language plpgsql security invoker set search_path = public as $$
declare j public.tinder_approach_runs; v_failed boolean; v_unknown boolean;
begin
  select * into j from public.tinder_approach_runs where account_id=p_account_id and match_id=p_match_id for update;
  if p_lease is null or j.lease_token is distinct from p_lease or j.phase not in ('planning','sending') then return false; end if;
  v_unknown := j.phase='sending';
  v_failed := v_unknown or j.attempts>=2;
  update public.tinder_approach_runs set phase=case when v_failed then 'failed' else 'waiting' end,
    attempts=attempts+1,error_code=case when v_unknown then 'DELIVERY_UNKNOWN' else p_reason end,
    next_at=now()+make_interval(secs=>15*(j.attempts+1)),lease_token=null,lease_until=null
    where account_id=p_account_id and match_id=p_match_id;
  if v_failed then update public.tinder_approach_recipients set status='failed' where account_id=p_account_id and match_id=p_match_id; end if;
  insert into public.tinder_approach_events(account_id,match_id,event,detail) values(p_account_id,p_match_id,
    case when v_unknown then 'delivery_unknown' when v_failed then 'failed' else 'retry_scheduled' end,
    jsonb_build_object('index',j.next_index,'reason',case when v_unknown then 'DELIVERY_UNKNOWN' else p_reason end));
  return true;
end;
$$;

-- Consultas com sessão usam a conta resolvida no servidor, nunca account_id do cliente.
create function public.get_tinder_approach_console(p_account_id text,p_match_id text)
returns jsonb language sql stable security invoker set search_path=public as $$
  select jsonb_build_object('success',true,'run',(
    select jsonb_build_object('phase',phase,'index',next_index,'total',jsonb_array_length(config->'messages'),'nextAt',
      case when phase='waiting' then next_at else null end,'errorCode',error_code,'model',config->>'brainModel','scheduleName',config->>'name')
    from public.tinder_approach_runs where account_id=p_account_id and match_id=p_match_id
  ),'events',coalesce((select jsonb_agg(e order by e.id) from (
    select id,event,detail,created_at from public.tinder_approach_events where account_id=p_account_id and match_id=p_match_id order by id desc limit 100
  ) e),'[]'::jsonb));
$$;

revoke all on function public.tinder_approach_delay(jsonb),public.tinder_approach_executor_ready(),public.claim_tinder_approaches(integer),
  public.begin_tinder_approach_send(text,text,uuid,text,jsonb,jsonb),public.finish_tinder_approach_send(text,text,uuid,text),
  public.release_tinder_approach(text,text,uuid,text),public.get_tinder_approach_console(text,text) from public,anon,authenticated;
grant execute on function public.tinder_approach_delay(jsonb),public.tinder_approach_executor_ready(),public.claim_tinder_approaches(integer),
  public.begin_tinder_approach_send(text,text,uuid,text,jsonb,jsonb),public.finish_tinder_approach_send(text,text,uuid,text),
  public.release_tinder_approach(text,text,uuid,text),public.get_tinder_approach_console(text,text) to service_role;

;
