-- O marco é persistido junto à conclusão; nenhum provedor ou segredo é consultado no atendimento.
create table public.reciprocity_milestone_events (
  conversation_id text primary key references public.instagram_conversations(id) on delete cascade,
  milestone text not null default 'connection_first_checklist_v1' check (milestone='connection_first_checklist_v1'),
  goals jsonb not null,
  completed_rules jsonb not null,
  created_at timestamptz not null default clock_timestamp()
);
create table public.reciprocity_automatic_receipts (
  scope_id text not null,
  conversation_id text not null references public.reciprocity_milestone_events(conversation_id) on delete cascade,
  attempt_id uuid not null references public.reciprocity_attempts(id),
  created_at timestamptz not null default clock_timestamp(),
  primary key(scope_id,conversation_id)
);
alter table public.reciprocity_milestone_events enable row level security;
alter table public.reciprocity_automatic_receipts enable row level security;
revoke all on public.reciprocity_milestone_events,public.reciprocity_automatic_receipts from public,anon,authenticated;
grant all on public.reciprocity_milestone_events,public.reciprocity_automatic_receipts to service_role;

create function public.record_reciprocity_checklist_milestone()
returns trigger language plpgsql security invoker set search_path=public as $$
declare v_goals jsonb;
begin
  select goals into v_goals from public.chat_stages where id='stage_1_conexao' and schedule_id='schedule_sales';
  if public.reciprocity_rules_checklist_complete(new.stage_completed_rules,v_goals)
    and not public.reciprocity_rules_checklist_complete(old.stage_completed_rules,v_goals) then
    insert into public.reciprocity_milestone_events(conversation_id,goals,completed_rules)
      values(new.id,v_goals,jsonb_build_object(
        'completed_goals',new.stage_completed_rules->'completed_goals',
        'objective_progress',new.stage_completed_rules->'objective_progress',
        'orchestration',jsonb_build_object(
          'completedGoalIds',new.stage_completed_rules->'orchestration'->'completedGoalIds',
          'objectiveProgress',new.stage_completed_rules->'orchestration'->'objectiveProgress'
        )
      )) on conflict(conversation_id) do nothing;
  end if;
  return new;
end;
$$;
create trigger reciprocity_checklist_milestone
  after update of stage_completed_rules on public.instagram_conversations
  for each row when (old.stage_completed_rules is distinct from new.stage_completed_rules)
  execute function public.record_reciprocity_checklist_milestone();

-- Só lista eventos posteriores à instalação do trigger. Não existe varredura/backfill de chats.
create function public.pending_reciprocity_automatic_events(p_scope_id text,p_limit integer default 20,p_scope jsonb default null)
returns setof public.reciprocity_milestone_events language sql stable security invoker set search_path=public as $$
  select e.* from public.reciprocity_milestone_events e where (
    p_scope is null or p_scope->'allConversations'='true'::jsonb
    or coalesce(p_scope->'conversationIds','[]'::jsonb) ? e.conversation_id
    or exists(select 1 from public.conversation_channel_identities i
      where i.conversation_id=e.conversation_id and i.status in ('active','transferred')
      and coalesce(p_scope->'accountIds','[]'::jsonb) ? (i.channel||':'||i.external_account_id))
  ) and public.reciprocity_checklist_complete(e.conversation_id)
  and exists(select 1 from public.instagram_messages m where m.conversation_id=e.conversation_id
    and coalesce(to_jsonb(m)->>'status','sent') not in ('failed','sending','pending','queued'))
  and not exists(
    select 1 from public.reciprocity_automatic_receipts r where r.scope_id=p_scope_id and r.conversation_id=e.conversation_id
  ) order by e.created_at,e.conversation_id limit greatest(1,least(coalesce(p_limit,20),100));
$$;

-- Enqueue e recibo compartilham transação e lock com solicitações manuais.
-- Uma análise manual ativa pode satisfazer o marco sem ser alterada ou repetida após um crash.
create function public.enqueue_reciprocity_automatic_event(
  p_scope_id text,p_conversation_id text,p_configuration jsonb,p_error text default null
) returns jsonb language plpgsql security invoker set search_path=public as $$
declare v_attempt public.reciprocity_attempts; v_enqueued jsonb; v_existing_ids uuid[];
begin
  if nullif(trim(p_scope_id),'') is null then raise exception 'scope required'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_scope_id||':'||p_conversation_id,0));
  select a.* into v_attempt from public.reciprocity_automatic_receipts r
    join public.reciprocity_attempts a on a.id=r.attempt_id
    where r.scope_id=p_scope_id and r.conversation_id=p_conversation_id;
  if found then return public.reciprocity_attempt_json(v_attempt); end if;
  if not exists(select 1 from public.reciprocity_milestone_events where conversation_id=p_conversation_id) then
    raise exception 'milestone_not_found';
  end if;
  select coalesce(array_agg(id),array[]::uuid[]) into v_existing_ids from public.reciprocity_attempts
    where scope_id=p_scope_id and conversation_id=p_conversation_id;
  v_enqueued := public.enqueue_reciprocity_analysis(p_scope_id,p_conversation_id,'automatic',p_configuration);
  select * into strict v_attempt from public.reciprocity_attempts where id=(v_enqueued->>'id')::uuid;
  if nullif(trim(p_error),'') is not null and not(v_attempt.id=any(v_existing_ids)) then
    update public.reciprocity_attempts set state='failed',error=left(p_error,1000),completed_at=clock_timestamp()
      where id=v_attempt.id returning * into v_attempt;
  end if;
  insert into public.reciprocity_automatic_receipts(scope_id,conversation_id,attempt_id)
    values(p_scope_id,p_conversation_id,v_attempt.id);
  return public.reciprocity_attempt_json(v_attempt);
end;
$$;
revoke all on function public.record_reciprocity_checklist_milestone(),
  public.pending_reciprocity_automatic_events(text,integer,jsonb),public.enqueue_reciprocity_automatic_event(text,text,jsonb,text)
  from public,anon,authenticated;
grant execute on function public.record_reciprocity_checklist_milestone(),
  public.pending_reciprocity_automatic_events(text,integer,jsonb),public.enqueue_reciprocity_automatic_event(text,text,jsonb,text)
  to service_role;
