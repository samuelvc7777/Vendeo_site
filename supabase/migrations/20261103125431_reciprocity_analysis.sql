-- Observação independente: nenhuma mensagem, objetivo ou decisão do atendimento é alterada.
create table public.reciprocity_settings (
  scope_id text primary key,
  model text not null default 'gpt-6-luna' check (model in ('gpt-6-luna','gpt-6.1-terra','gpt-6.1-sol')),
  reasoning text not null default 'low' check (reasoning in ('low','medium','high')),
  updated_at timestamptz not null default now()
);
create table public.reciprocity_attempts (
  id uuid primary key default gen_random_uuid(),
  scope_id text not null,
  conversation_id text not null references public.instagram_conversations(id) on delete cascade,
  reason text not null check (reason in ('manual','retry','reevaluation','automatic')),
  state text not null default 'queued' check (state in ('queued','processing','completed','failed')),
  configuration jsonb not null,
  criteria_version text not null default 'reciprocity-v1',
  messages jsonb not null,
  result jsonb,
  usage jsonb,
  estimated_cost_usd numeric,
  duration_ms integer,
  error text,
  lease_token text,
  lease_expires_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz
);
create unique index reciprocity_one_active on public.reciprocity_attempts(scope_id,conversation_id)
  where state in ('queued','processing');
create unique index reciprocity_one_automatic on public.reciprocity_attempts(scope_id,conversation_id)
  where reason='automatic';
create index reciprocity_history on public.reciprocity_attempts(scope_id,conversation_id,created_at desc,id desc);
alter table public.reciprocity_settings enable row level security;
alter table public.reciprocity_attempts enable row level security;
revoke all on public.reciprocity_settings,public.reciprocity_attempts from public,anon,authenticated;
grant all on public.reciprocity_settings,public.reciprocity_attempts to service_role;

create function public.reciprocity_rules_checklist_complete(p_rules jsonb,p_goals jsonb)
returns boolean language sql stable security invoker set search_path=public as $$
  with canonical as (
    select case when jsonb_typeof(p_goals)='array' then
      case when jsonb_array_length(p_goals)=1 and jsonb_typeof(p_goals->0)='array' then p_goals->0 else p_goals end
      else '[]'::jsonb end as goals,
    case when jsonb_typeof(p_rules->'completed_goals')='array' then p_rules->'completed_goals'
      when jsonb_typeof(p_rules->'orchestration'->'completedGoalIds')='array' then p_rules->'orchestration'->'completedGoalIds'
      else '[]'::jsonb end as completed,
    case when jsonb_typeof(p_rules->'objective_progress')='object' then p_rules->'objective_progress'
      when jsonb_typeof(p_rules->'orchestration'->'objectiveProgress')='object' then p_rules->'orchestration'->'objectiveProgress'
      else '{}'::jsonb end as progress
  )
  select exists(select 1 from canonical,jsonb_array_elements(goals) g where coalesce(g->'enabled','true'::jsonb)<>'false'::jsonb)
    and not exists(select 1 from canonical,jsonb_array_elements(goals) g
      where coalesce(g->'enabled','true'::jsonb)<>'false'::jsonb
      and (jsonb_typeof(g)<>'object' or nullif(trim(g->>'id'),'') is null
        or not(completed ? (g->>'id') or coalesce(progress->(g->>'id')->>'status','')='completed')));
$$;
create function public.reciprocity_checklist_complete(p_conversation_id text)
returns boolean language sql stable security invoker set search_path=public as $$
  select coalesce((select public.reciprocity_rules_checklist_complete(c.stage_completed_rules,s.goals)
    from public.chat_stages s,public.instagram_conversations c
    where s.id='stage_1_conexao' and s.schedule_id='schedule_sales' and c.id=p_conversation_id),false);
$$;

create function public.reciprocity_attempt_json(a public.reciprocity_attempts)
returns jsonb language sql stable security invoker set search_path=public as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'id',a.id,'scopeId',a.scope_id,'conversationId',a.conversation_id,'reason',a.reason,'state',a.state,
    'configuration',a.configuration,'criteriaVersion',a.criteria_version,'createdAt',a.created_at,
    'completedAt',a.completed_at,'messages',a.messages,'result',a.result,'usage',a.usage,
    'estimatedCostUsd',a.estimated_cost_usd,'durationMs',a.duration_ms,'error',a.error,'leaseToken',a.lease_token
  ));
$$;

create function public.enqueue_reciprocity_analysis(p_scope_id text,p_conversation_id text,p_reason text,p_configuration jsonb)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_attempt public.reciprocity_attempts; v_messages jsonb;
begin
  if nullif(trim(p_scope_id),'') is null then raise exception 'scope required'; end if;
  -- Mesmo lock para solicitação manual, evento automático e cliques concorrentes.
  perform pg_advisory_xact_lock(hashtextextended(p_scope_id||':'||p_conversation_id,0));
  select * into v_attempt from public.reciprocity_attempts
    where scope_id=p_scope_id and conversation_id=p_conversation_id and state in ('queued','processing') limit 1;
  if found then return public.reciprocity_attempt_json(v_attempt); end if;
  if not public.reciprocity_checklist_complete(p_conversation_id) then raise exception 'checklist_incomplete'; end if;
  if p_reason='automatic' then
    select * into v_attempt from public.reciprocity_attempts
      where scope_id=p_scope_id and conversation_id=p_conversation_id and reason='automatic' order by created_at desc limit 1;
    if found then return public.reciprocity_attempt_json(v_attempt); end if;
  end if;
  -- Um SELECT fixa todo o histórico disponível de ambos os lados no mesmo snapshot MVCC.
  -- Não há LIMIT nem recuperação por telefone: somente a identidade canônica exata.
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',m.id,'role',case when m.is_mine then 'larissa' else 'contact' end,
    'text',concat_ws(E'\n',nullif(m.text,''),nullif(to_jsonb(m)->>'audio_transcript',''),nullif(to_jsonb(m)->>'image_description','')),
    'at',coalesce(m.timestamp,m.created_at),
    'mediaMissing',coalesce(nullif(m.media_type,''),'text')<>'text'
      and coalesce(nullif(to_jsonb(m)->>'audio_transcript',''),nullif(to_jsonb(m)->>'image_description','')) is null
  ) order by coalesce(m.timestamp,m.created_at),m.id),'[]'::jsonb)
  into v_messages from public.instagram_messages m where m.conversation_id=p_conversation_id
    and coalesce(to_jsonb(m)->>'status','sent') not in ('failed','sending','pending','queued');
  if jsonb_array_length(v_messages)=0 then raise exception 'no_messages_available'; end if;
  insert into public.reciprocity_attempts(scope_id,conversation_id,reason,configuration,messages)
    values(p_scope_id,p_conversation_id,p_reason,p_configuration,v_messages) returning * into v_attempt;
  return public.reciprocity_attempt_json(v_attempt);
end;
$$;

create function public.claim_reciprocity_analysis(p_lease_token text)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_attempt public.reciprocity_attempts;
begin
  if nullif(trim(p_lease_token),'') is null then raise exception 'lease required'; end if;
  -- Uma execução interrompida não é refeita cegamente: pode ter sido faturada.
  update public.reciprocity_attempts set state='failed',error='Execução interrompida. Solicite nova tentativa.',
    completed_at=clock_timestamp(),lease_token=null,lease_expires_at=null
    where state='processing' and lease_expires_at<clock_timestamp();
  select * into v_attempt from public.reciprocity_attempts where state='queued'
    order by created_at,id limit 1 for update skip locked;
  if not found then return null; end if;
  update public.reciprocity_attempts set state='processing',lease_token=p_lease_token,
    lease_expires_at=clock_timestamp()+interval '5 minutes' where id=v_attempt.id returning * into v_attempt;
  return public.reciprocity_attempt_json(v_attempt);
end;
$$;

create function public.finish_reciprocity_analysis(p_id uuid,p_lease_token text,p_state text,p_values jsonb)
returns boolean language plpgsql security invoker set search_path=public as $$
declare v_count integer;
begin
  if p_state not in ('completed','failed') then raise exception 'invalid_state'; end if;
  update public.reciprocity_attempts set state=p_state,result=p_values->'result',usage=p_values->'usage',
    estimated_cost_usd=(p_values->>'estimatedCostUsd')::numeric,duration_ms=(p_values->>'durationMs')::integer,
    error=p_values->>'error',completed_at=clock_timestamp(),lease_token=null,lease_expires_at=null
    where id=p_id and state='processing' and lease_token=p_lease_token and lease_expires_at>clock_timestamp();
  get diagnostics v_count=row_count;
  return v_count=1;
end;
$$;
revoke all on function public.reciprocity_rules_checklist_complete(jsonb,jsonb),public.reciprocity_checklist_complete(text),public.reciprocity_attempt_json(public.reciprocity_attempts),
  public.enqueue_reciprocity_analysis(text,text,text,jsonb),public.claim_reciprocity_analysis(text),
  public.finish_reciprocity_analysis(uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.reciprocity_rules_checklist_complete(jsonb,jsonb),public.reciprocity_checklist_complete(text),public.reciprocity_attempt_json(public.reciprocity_attempts),
  public.enqueue_reciprocity_analysis(text,text,text,jsonb),public.claim_reciprocity_analysis(text),
  public.finish_reciprocity_analysis(uuid,text,text,jsonb) to service_role;
do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    alter publication supabase_realtime add table public.reciprocity_attempts;
  end if;
end $$;
