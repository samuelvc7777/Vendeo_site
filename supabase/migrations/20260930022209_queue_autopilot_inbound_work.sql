-- Durable, coalescing inbound queue for AutoPilot/Brain work.
-- The Meta webhook only persists/enqueues; workers own expensive orchestration.

create table if not exists public.autopilot_inbound_jobs (
  conversation_id text primary key
    references public.instagram_conversations(id) on delete cascade,
  latest_message_id text not null
    references public.instagram_messages(id) on delete cascade,
  revision bigint not null default 1 check (revision > 0),
  status text not null default 'pending'
    check (status in ('pending', 'processing')),
  due_at timestamptz not null default clock_timestamp(),
  lease_token text,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_error text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create index if not exists idx_autopilot_inbound_jobs_due
  on public.autopilot_inbound_jobs (status, due_at, updated_at);

create index if not exists idx_autopilot_inbound_jobs_lease
  on public.autopilot_inbound_jobs (lease_expires_at)
  where status = 'processing';

alter table public.autopilot_inbound_jobs enable row level security;
revoke all on public.autopilot_inbound_jobs from public, anon, authenticated;
grant select, insert, update, delete on public.autopilot_inbound_jobs to service_role;

create or replace function public.enqueue_autopilot_inbound_job(
  p_conversation_id text,
  p_message_id text,
  p_due_at timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.autopilot_inbound_jobs%rowtype;
begin
  if nullif(btrim(p_conversation_id), '') is null
     or nullif(btrim(p_message_id), '') is null then
    return jsonb_build_object('success', false, 'reason', 'invalid_job');
  end if;

  if not exists (
    select 1 from public.instagram_messages m
    where m.id = p_message_id
      and m.conversation_id = p_conversation_id
  ) then
    return jsonb_build_object('success', false, 'reason', 'message_not_found');
  end if;

  insert into public.autopilot_inbound_jobs (
    conversation_id, latest_message_id, due_at
  ) values (
    p_conversation_id, p_message_id, coalesce(p_due_at, clock_timestamp())
  )
  on conflict (conversation_id) do update
  set latest_message_id = excluded.latest_message_id,
      revision = public.autopilot_inbound_jobs.revision + 1,
      status = case
        when public.autopilot_inbound_jobs.status = 'processing'
         and public.autopilot_inbound_jobs.lease_expires_at > clock_timestamp()
          then 'processing'
        else 'pending'
      end,
      due_at = excluded.due_at,
      lease_token = case
        when public.autopilot_inbound_jobs.status = 'processing'
         and public.autopilot_inbound_jobs.lease_expires_at > clock_timestamp()
          then public.autopilot_inbound_jobs.lease_token
        else null
      end,
      lease_expires_at = case
        when public.autopilot_inbound_jobs.status = 'processing'
         and public.autopilot_inbound_jobs.lease_expires_at > clock_timestamp()
          then public.autopilot_inbound_jobs.lease_expires_at
        else null
      end,
      last_error = null,
      updated_at = clock_timestamp()
  returning * into v_row;

  return jsonb_build_object(
    'success', true,
    'conversation_id', v_row.conversation_id,
    'latest_message_id', v_row.latest_message_id,
    'revision', v_row.revision,
    'status', v_row.status,
    'due_at', v_row.due_at
  );
end;
$$;

revoke all on function public.enqueue_autopilot_inbound_job(text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.enqueue_autopilot_inbound_job(text, text, timestamptz)
  to service_role;

create or replace function public.claim_autopilot_inbound_jobs(
  p_worker_token text,
  p_limit integer default 3,
  p_lease_seconds integer default 180
) returns table(
  conversation_id text,
  latest_message_id text,
  revision bigint,
  attempt_count integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inflight integer := 0;
  v_available integer := 0;
begin
  if nullif(btrim(p_worker_token), '') is null then
    return;
  end if;

  -- Global OFF/manual mode suspends new inference without polling every queued chat.
  if exists (
    select 1
    from public.autopilot_settings a
    where a.id = 'global'
      and (
        coalesce(a.config->>'isEnabledGlobally', 'true') = 'false'
        or coalesce(a.config->>'mode', '') = 'manual'
      )
  ) then
    return;
  end if;

  -- Serializa somente o claim global. Sem isso, dois cron ticks simultâneos
  -- poderiam ambos observar inflight=0 e reivindicar 3 jobs cada.
  perform pg_advisory_xact_lock(
    hashtext('autopilot_inbound_global_claim')::bigint
  );

  update public.autopilot_inbound_jobs
     set status = 'pending',
         lease_token = null,
         lease_expires_at = null,
         due_at = least(due_at, clock_timestamp()),
         last_error = coalesce(last_error, 'stale_worker_lease_recovered'),
         updated_at = clock_timestamp()
   where status = 'processing'
     and lease_expires_at <= clock_timestamp();

  -- Limite global de trabalhos pesados em andamento. Como o cron roda a cada
  -- 15s, isso impede ticks sobrepostos de acumularem pré-processamento de áudio
  -- e chamadas ao Brain além da capacidade real do sistema.
  select count(*)
    into v_inflight
    from public.autopilot_inbound_jobs j
   where j.status = 'processing'
     and j.lease_expires_at > clock_timestamp();

  v_available := greatest(0, 3 - v_inflight);
  if v_available = 0 then
    return;
  end if;

  return query
  with candidate as (
    select j.conversation_id
      from public.autopilot_inbound_jobs j
     where j.status = 'pending'
       and j.due_at <= clock_timestamp()
     order by j.due_at asc, j.updated_at asc
     for update skip locked
     limit least(
       greatest(1, least(coalesce(p_limit, 3), 20)),
       v_available
     )
  )
  update public.autopilot_inbound_jobs j
     set status = 'processing',
         lease_token = p_worker_token,
         lease_expires_at = clock_timestamp()
           + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 180), 900))),
         attempt_count = j.attempt_count + 1,
         updated_at = clock_timestamp()
    from candidate c
   where j.conversation_id = c.conversation_id
  returning j.conversation_id, j.latest_message_id, j.revision, j.attempt_count;
end;
$$;

revoke all on function public.claim_autopilot_inbound_jobs(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_autopilot_inbound_jobs(text, integer, integer)
  to service_role;

create or replace function public.complete_autopilot_inbound_job(
  p_conversation_id text,
  p_worker_token text,
  p_claimed_revision bigint
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_revision bigint;
begin
  select j.revision
    into v_revision
    from public.autopilot_inbound_jobs j
   where j.conversation_id = p_conversation_id
     and j.status = 'processing'
     and j.lease_token = p_worker_token
   for update;

  if not found then
    return jsonb_build_object('success', false, 'reason', 'lease_not_owned');
  end if;

  if v_revision > p_claimed_revision then
    update public.autopilot_inbound_jobs
       set status = 'pending',
           due_at = clock_timestamp(),
           lease_token = null,
           lease_expires_at = null,
           last_error = null,
           updated_at = clock_timestamp()
     where conversation_id = p_conversation_id;
    return jsonb_build_object(
      'success', true,
      'completed', false,
      'superseded', true,
      'current_revision', v_revision
    );
  end if;

  delete from public.autopilot_inbound_jobs
   where conversation_id = p_conversation_id
     and status = 'processing'
     and lease_token = p_worker_token;

  return jsonb_build_object(
    'success', true,
    'completed', true,
    'superseded', false,
    'current_revision', v_revision
  );
end;
$$;

revoke all on function public.complete_autopilot_inbound_job(text, text, bigint)
  from public, anon, authenticated;
grant execute on function public.complete_autopilot_inbound_job(text, text, bigint)
  to service_role;

create or replace function public.reschedule_autopilot_inbound_job(
  p_conversation_id text,
  p_worker_token text,
  p_claimed_revision bigint,
  p_due_at timestamptz,
  p_last_error text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_revision bigint;
begin
  select j.revision
    into v_revision
    from public.autopilot_inbound_jobs j
   where j.conversation_id = p_conversation_id
     and j.status = 'processing'
     and j.lease_token = p_worker_token
   for update;

  if not found then
    return jsonb_build_object('success', false, 'reason', 'lease_not_owned');
  end if;

  update public.autopilot_inbound_jobs
     set status = 'pending',
         due_at = case
           when v_revision > p_claimed_revision then clock_timestamp()
           else greatest(coalesce(p_due_at, clock_timestamp()), clock_timestamp())
         end,
         lease_token = null,
         lease_expires_at = null,
         last_error = case
           when v_revision > p_claimed_revision then null
           else left(coalesce(p_last_error, ''), 1000)
         end,
         updated_at = clock_timestamp()
   where conversation_id = p_conversation_id;

  return jsonb_build_object(
    'success', true,
    'rescheduled', true,
    'superseded', v_revision > p_claimed_revision,
    'current_revision', v_revision
  );
end;
$$;

revoke all on function public.reschedule_autopilot_inbound_job(
  text, text, bigint, timestamptz, text
) from public, anon, authenticated;

grant execute on function public.reschedule_autopilot_inbound_job(
  text, text, bigint, timestamptz, text
) to service_role;

create or replace function public.get_autopilot_inbound_job_context(
  p_conversation_id text,
  p_message_id text
) returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'config', coalesce(
      (select a.config from public.autopilot_settings a where a.id = 'global'),
      '{}'::jsonb
    ),
    'conversation', jsonb_build_object(
      'status', c.status,
      'is_restricted', c.is_restricted,
      'ai_auto_respond', c.ai_auto_respond,
      'ai_debounce_until', c.ai_debounce_until,
      'ai_debounce_started_at', c.ai_debounce_started_at,
      'stage_completed_rules', c.stage_completed_rules
    ),
    'state', jsonb_build_object(
      'is_enabled', s.is_enabled,
      'status', s.status
    ),
    'message', jsonb_build_object(
      'id', m.id,
      'text', m.text,
      'timestamp', m.timestamp,
      'created_at', m.created_at,
      'sender_id', m.sender_id,
      'is_mine', m.is_mine,
      'media_type', m.media_type,
      'media_url', m.media_url,
      'audio_transcript', m.audio_transcript
    )
  )
  from public.instagram_conversations c
  join public.instagram_messages m
    on m.id = p_message_id
   and m.conversation_id = c.id
  left join public.autopilot_chat_states s
    on s.conversation_id = c.id
  where c.id = p_conversation_id
  limit 1;
$$;

revoke all on function public.get_autopilot_inbound_job_context(text, text)
  from public, anon, authenticated;
grant execute on function public.get_autopilot_inbound_job_context(text, text)
  to service_role;

create or replace function public.record_and_queue_inbound_atomic(
  p_conversation_id text,
  p_message_id text,
  p_contact_id text,
  p_sender_id text,
  p_text text,
  p_timestamp text,
  p_media_url text default null,
  p_media_type text default null,
  p_reply_to_message_id text default null,
  p_audio_transcript text default null,
  p_audio_transcription_error text default null,
  p_actionable boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_rules jsonb;
  v_orch jsonb;
  v_active_token text;
  v_queue jsonb;
  v_preempted boolean := false;
begin
  v_result := public.record_inbound_message_atomic(
    p_conversation_id,
    p_message_id,
    p_contact_id,
    p_sender_id,
    p_text,
    p_timestamp,
    p_media_url,
    p_media_type,
    p_reply_to_message_id,
    p_audio_transcript,
    p_audio_transcription_error
  );

  if coalesce((v_result->>'success')::boolean, false) is not true then
    return v_result;
  end if;

  if coalesce((v_result->>'duplicate')::boolean, false) is true then
    return v_result || jsonb_build_object(
      'queued', false,
      'preempt_requested', false
    );
  end if;

  if coalesce((v_result->>'eligible_after_activation')::boolean, false)
     and coalesce(p_actionable, true) then
    select c.stage_completed_rules
      into v_rules
      from public.instagram_conversations c
     where c.id = p_conversation_id
     for update;

    v_rules := coalesce(v_rules, '{}'::jsonb);
    v_active_token := nullif(v_rules->>'active_cycle_token', '');

    if v_active_token is not null then
      v_orch := case
        when jsonb_typeof(v_rules->'orchestration') = 'object'
          then v_rules->'orchestration'
        else '{}'::jsonb
      end;
      v_orch := jsonb_set(v_orch, '{preemptRequested}', 'true'::jsonb, true);
      v_rules := jsonb_set(v_rules, '{preempt_requested}', 'true'::jsonb, true);
      v_rules := jsonb_set(v_rules, '{orchestration}', v_orch, true);

      update public.instagram_conversations
         set stage_completed_rules = v_rules
       where id = p_conversation_id;
      v_preempted := true;
    end if;

    v_queue := public.enqueue_autopilot_inbound_job(
      p_conversation_id,
      p_message_id,
      clock_timestamp()
    );

    -- A fila durável é a autoridade. Se uma inbound elegível não puder ser
    -- enfileirada, falhamos a transação inteira para a Meta redeliver o evento.
    if coalesce((v_queue->>'success')::boolean, false) is not true then
      raise exception 'autopilot_inbound_enqueue_failed: %',
        coalesce(v_queue->>'reason', 'unknown')
        using errcode = 'P0001';
    end if;
  end if;

  return v_result || jsonb_build_object(
    'queued', coalesce((v_queue->>'success')::boolean, false),
    'queue_reason', v_queue->>'reason',
    'queue_revision', v_queue->'revision',
    'preempt_requested', v_preempted,
    'active_cycle_token', v_active_token
  );
end;
$$;

revoke all on function public.record_and_queue_inbound_atomic(
  text, text, text, text, text, text,
  text, text, text, text, text, boolean
) from public, anon, authenticated;

grant execute on function public.record_and_queue_inbound_atomic(
  text, text, text, text, text, text,
  text, text, text, text, text, boolean
) to service_role;

-- One-time handoff: preserve pending work that existed before this queue.
-- The Brain still applies activation-watermark, ledger and timing gates.
insert into public.autopilot_inbound_jobs (
  conversation_id,
  latest_message_id,
  due_at
)
select
  c.id,
  pending.id,
  greatest(
    coalesce(c.ai_debounce_until, clock_timestamp()),
    clock_timestamp()
  )
from public.instagram_conversations c
cross join lateral (
  select m.id
  from public.instagram_messages m
  where m.conversation_id = c.id
    and m.is_mine is false
    and m.created_at >= clock_timestamp() - interval '48 hours'
    and coalesce(
      c.stage_completed_rules->'orchestration'->'messageLedger'->>m.id,
      'pending'
    ) <> 'processed'
  order by m.created_at desc
  limit 1
) pending
where c.ai_auto_respond is true
  and left(c.id, 2) <> '__'
on conflict (conversation_id) do nothing;
