-- Durable transcription phase for WhatsApp 2 inbound audio.
-- Audio is staged first with actionable=false; Brain is released only after a valid transcript.

create table if not exists public.whatsapp2_transcription_jobs (
  message_id text primary key
    references public.instagram_messages(id) on delete cascade,
  conversation_id text not null
    references public.instagram_conversations(id) on delete cascade,
  media_url text not null,
  release_brain boolean not null default false,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed')),
  due_at timestamptz not null default clock_timestamp(),
  lease_token text,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  last_error text,
  brain_released_at timestamptz,
  completed_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create index if not exists idx_whatsapp2_transcription_jobs_due
  on public.whatsapp2_transcription_jobs (status, due_at, updated_at)
  where status = 'pending';

create index if not exists idx_whatsapp2_transcription_jobs_lease
  on public.whatsapp2_transcription_jobs (lease_expires_at)
  where status = 'processing';

alter table public.whatsapp2_transcription_jobs enable row level security;
revoke all on public.whatsapp2_transcription_jobs from public, anon, authenticated;
grant select, insert, update, delete on public.whatsapp2_transcription_jobs to service_role;

create or replace function public.enqueue_whatsapp2_transcription_job(
  p_message_id text,
  p_conversation_id text,
  p_media_url text,
  p_release_brain boolean default false,
  p_due_at timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.whatsapp2_transcription_jobs%rowtype;
begin
  if nullif(btrim(p_message_id), '') is null
     or nullif(btrim(p_conversation_id), '') is null
     or nullif(btrim(p_media_url), '') is null then
    return jsonb_build_object('success', false, 'reason', 'invalid_transcription_job');
  end if;

  if not exists (
    select 1
    from public.instagram_messages m
    where m.id = p_message_id
      and m.conversation_id = p_conversation_id
      and m.channel = 'whatsapp2'
      and m.media_type = 'audio'
  ) then
    return jsonb_build_object('success', false, 'reason', 'whatsapp2_audio_message_not_found');
  end if;

  insert into public.whatsapp2_transcription_jobs (
    message_id, conversation_id, media_url, release_brain, due_at
  ) values (
    p_message_id, p_conversation_id, p_media_url,
    coalesce(p_release_brain, false), coalesce(p_due_at, clock_timestamp())
  )
  on conflict (message_id) do update
  set conversation_id = excluded.conversation_id,
      media_url = excluded.media_url,
      release_brain = public.whatsapp2_transcription_jobs.release_brain
        or excluded.release_brain,
      status = case
        when public.whatsapp2_transcription_jobs.status in ('completed', 'failed')
          then public.whatsapp2_transcription_jobs.status
        when public.whatsapp2_transcription_jobs.status = 'processing'
         and public.whatsapp2_transcription_jobs.lease_expires_at > clock_timestamp()
          then 'processing'
        else 'pending'
      end,
      due_at = case
        when public.whatsapp2_transcription_jobs.status in ('completed', 'failed')
          then public.whatsapp2_transcription_jobs.due_at
        when public.whatsapp2_transcription_jobs.status = 'processing'
         and public.whatsapp2_transcription_jobs.lease_expires_at > clock_timestamp()
          then public.whatsapp2_transcription_jobs.due_at
        else least(public.whatsapp2_transcription_jobs.due_at, excluded.due_at)
      end,
      lease_token = case
        when public.whatsapp2_transcription_jobs.status = 'processing'
         and public.whatsapp2_transcription_jobs.lease_expires_at > clock_timestamp()
          then public.whatsapp2_transcription_jobs.lease_token
        else null
      end,
      lease_expires_at = case
        when public.whatsapp2_transcription_jobs.status = 'processing'
         and public.whatsapp2_transcription_jobs.lease_expires_at > clock_timestamp()
          then public.whatsapp2_transcription_jobs.lease_expires_at
        else null
      end,
      updated_at = clock_timestamp()
  returning * into v_row;

  return jsonb_build_object(
    'success', true,
    'message_id', v_row.message_id,
    'status', v_row.status,
    'release_brain', v_row.release_brain,
    'attempt_count', v_row.attempt_count,
    'terminal', v_row.status in ('completed', 'failed')
  );
end;
$$;

revoke all on function public.enqueue_whatsapp2_transcription_job(
  text, text, text, boolean, timestamptz
) from public, anon, authenticated;
grant execute on function public.enqueue_whatsapp2_transcription_job(
  text, text, text, boolean, timestamptz
) to service_role;
create or replace function public.stage_whatsapp2_audio_inbound_atomic(
  p_conversation_id text,
  p_raw_contact_id text,
  p_message_id text,
  p_sender_id text,
  p_contact_name text,
  p_text text,
  p_timestamp text,
  p_preview_text text,
  p_avatar_url text,
  p_media_url text,
  p_reply_to_message_id text default null,
  p_actionable boolean default true
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.whatsapp2_transcription_jobs%rowtype;
  v_result jsonb;
  v_queue jsonb;
  v_release_brain boolean := false;
  v_rules jsonb;
  v_orch jsonb;
  v_ledger jsonb;
  v_message_revision bigint;
  v_watermark_revision bigint;
  v_ai_enabled boolean := false;
  v_restricted boolean := false;
begin
  if nullif(btrim(p_message_id), '') is null
     or nullif(btrim(p_conversation_id), '') is null
     or nullif(btrim(p_media_url), '') is null then
    return jsonb_build_object('success', false, 'reason', 'invalid_audio_stage');
  end if;

  select *
    into v_existing
    from public.whatsapp2_transcription_jobs
   where message_id = p_message_id;

  if found then
    return jsonb_build_object(
      'success', true,
      'duplicate', true,
      'transcription_queued', true,
      'transcription_status', v_existing.status,
      'release_brain', v_existing.release_brain
    );
  end if;

  v_result := public.ingest_whatsapp2_inbound_atomic(
    p_conversation_id,
    p_raw_contact_id,
    p_message_id,
    p_sender_id,
    p_contact_name,
    p_text,
    p_timestamp,
    p_preview_text,
    p_avatar_url,
    p_media_url,
    'audio',
    p_reply_to_message_id,
    null,
    'transcription_pending',
    false
  );

  if coalesce((v_result->>'success')::boolean, false) is not true then
    raise exception 'whatsapp2_audio_stage_failed: %',
      coalesce(v_result->>'reason', 'unknown') using errcode = 'P0001';
  end if;

  select
    c.stage_completed_rules,
    coalesce(c.ai_auto_respond, false),
    coalesce(c.is_restricted, false)
  into v_rules, v_ai_enabled, v_restricted
  from public.instagram_conversations c
  where c.id = p_conversation_id
  for update;

  v_rules := coalesce(v_rules, '{}'::jsonb);
  v_orch := case
    when jsonb_typeof(v_rules->'orchestration') = 'object'
      then v_rules->'orchestration'
    else '{}'::jsonb
  end;
  v_ledger := case
    when jsonb_typeof(v_orch->'messageLedger') = 'object'
      then v_orch->'messageLedger'
    else '{}'::jsonb
  end;

  -- While transcription is pending, hide this audio from every Brain cycle.
  -- Success will atomically restore it to pending immediately before Brain enqueue.
  v_ledger := jsonb_set(v_ledger, array[p_message_id], '"processed"'::jsonb, true);
  v_orch := jsonb_set(v_orch, '{messageLedger}', v_ledger, true);
  v_rules := jsonb_set(v_rules, '{orchestration}', v_orch, true);

  update public.instagram_conversations
     set stage_completed_rules = v_rules
   where id = p_conversation_id;

  v_release_brain :=
    coalesce((v_result->>'eligible_after_activation')::boolean, false)
    and coalesce(p_actionable, true);

  -- Rollout/retry safety for a pre-existing staged message without a transcription job.
  if coalesce((v_result->>'duplicate')::boolean, false) and coalesce(p_actionable, true) then
    begin
      v_message_revision :=
        nullif(v_orch->'messageInboundRevisions'->>p_message_id, '')::bigint;
    exception when others then
      v_message_revision := null;
    end;

    begin
      v_watermark_revision :=
        nullif(v_orch->'activation_watermark'->>'inboundRevision', '')::bigint;
    exception when others then
      v_watermark_revision := null;
    end;

    v_release_brain :=
      v_ai_enabled
      and not v_restricted
      and v_message_revision is not null
      and (v_watermark_revision is null or v_message_revision > v_watermark_revision);
  end if;

  v_queue := public.enqueue_whatsapp2_transcription_job(
    p_message_id,
    p_conversation_id,
    p_media_url,
    v_release_brain,
    clock_timestamp()
  );

  if coalesce((v_queue->>'success')::boolean, false) is not true then
    raise exception 'whatsapp2_transcription_enqueue_failed: %',
      coalesce(v_queue->>'reason', 'unknown') using errcode = 'P0001';
  end if;

  return v_result || jsonb_build_object(
    'transcription_queued', true,
    'transcription_status', v_queue->>'status',
    'release_brain', coalesce((v_queue->>'release_brain')::boolean, v_release_brain)
  );
end;
$$;

revoke all on function public.stage_whatsapp2_audio_inbound_atomic(
  text, text, text, text, text, text, text, text,
  text, text, text, boolean
) from public, anon, authenticated;
grant execute on function public.stage_whatsapp2_audio_inbound_atomic(
  text, text, text, text, text, text, text, text,
  text, text, text, boolean
) to service_role;
create or replace function public.claim_whatsapp2_transcription_jobs(
  p_worker_token text,
  p_limit integer default 1,
  p_lease_seconds integer default 120,
  p_global_limit integer default 1
) returns table (
  message_id text,
  conversation_id text,
  media_url text,
  release_brain boolean,
  attempt_count integer,
  max_attempts integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inflight integer := 0;
  v_available integer := 0;
  v_global_limit integer := 1;
begin
  if nullif(btrim(p_worker_token), '') is null then
    return;
  end if;

  perform pg_advisory_xact_lock(
    hashtext('whatsapp2_transcription_global_claim')::bigint
  );
  update public.whatsapp2_transcription_jobs
     set status = 'failed',
         lease_token = null,
         lease_expires_at = null,
         failed_at = coalesce(failed_at, clock_timestamp()),
         last_error = left(
           coalesce(nullif(last_error, ''), 'transcription_stale_lease_exhausted'),
           1000
         ),
         updated_at = clock_timestamp()
   where status = 'processing'
     and (lease_expires_at is null or lease_expires_at <= clock_timestamp())
     and attempt_count >= max_attempts;

  update public.instagram_messages m
     set audio_transcription_error = coalesce(
       nullif(j.last_error, ''),
       'transcription_retry_exhausted'
     )
    from public.whatsapp2_transcription_jobs j
   where j.message_id = m.id
     and j.status = 'failed'
     and m.audio_transcript is null
     and coalesce(m.audio_transcription_error, '') in ('', 'transcription_pending');

  update public.whatsapp2_transcription_jobs
     set status = 'pending',
         lease_token = null,
         lease_expires_at = null,
         due_at = least(due_at, clock_timestamp()),
         last_error = left(
           coalesce(nullif(last_error, ''), 'transcription_stale_lease_recovered'),
           1000
         ),
         updated_at = clock_timestamp()
   where status = 'processing'
     and (lease_expires_at is null or lease_expires_at <= clock_timestamp())
     and attempt_count < max_attempts;

  update public.whatsapp2_transcription_jobs
     set status = 'failed',
         failed_at = coalesce(failed_at, clock_timestamp()),
         last_error = left(coalesce(nullif(last_error, ''), 'max_attempts_exhausted'), 1000),
         updated_at = clock_timestamp()
   where status = 'pending'
     and attempt_count >= max_attempts;

  update public.instagram_messages m
     set audio_transcription_error = coalesce(
       nullif(j.last_error, ''),
       'transcription_retry_exhausted'
     )
    from public.whatsapp2_transcription_jobs j
   where j.message_id = m.id
     and j.status = 'failed'
     and m.audio_transcript is null;

  v_global_limit := greatest(1, least(coalesce(p_global_limit, 1), 16));

  select count(*)
    into v_inflight
    from public.whatsapp2_transcription_jobs j
   where j.status = 'processing'
     and j.lease_expires_at > clock_timestamp();

  v_available := greatest(0, v_global_limit - v_inflight);
  if v_available = 0 then
    return;
  end if;

  return query
  with candidates as (
    select j.message_id
      from public.whatsapp2_transcription_jobs j
     where j.status = 'pending'
       and j.due_at <= clock_timestamp()
       and j.attempt_count < j.max_attempts
     order by j.due_at asc, j.created_at asc
     for update skip locked
     limit least(
       greatest(1, least(coalesce(p_limit, 1), 25)),
       v_available
     )
  )
  update public.whatsapp2_transcription_jobs j
     set status = 'processing',
         lease_token = p_worker_token,
         lease_expires_at = clock_timestamp()
           + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 120), 600))),
         attempt_count = j.attempt_count + 1,
         updated_at = clock_timestamp()
    from candidates c
   where j.message_id = c.message_id
  returning
    j.message_id,
    j.conversation_id,
    j.media_url,
    j.release_brain,
    j.attempt_count,
    j.max_attempts;
end;
$$;

revoke all on function public.claim_whatsapp2_transcription_jobs(
  text, integer, integer, integer
) from public, anon, authenticated;
grant execute on function public.claim_whatsapp2_transcription_jobs(
  text, integer, integer, integer
) to service_role;

create or replace function public.complete_whatsapp2_transcription_job(
  p_message_id text,
  p_worker_token text,
  p_transcript text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conversation_id text;
  v_job public.whatsapp2_transcription_jobs%rowtype;
  v_rules jsonb;
  v_orch jsonb;
  v_ledger jsonb;
  v_active_token text;
  v_queue jsonb;
  v_released boolean := false;
  v_message_updated integer := 0;
begin
  if nullif(btrim(p_transcript), '') is null then
    return jsonb_build_object('success', false, 'reason', 'empty_transcript');
  end if;

  select j.conversation_id
    into v_conversation_id
    from public.whatsapp2_transcription_jobs j
   where j.message_id = p_message_id;

  if v_conversation_id is null then
    return jsonb_build_object('success', false, 'reason', 'transcription_job_not_found');
  end if;

  -- Keep lock order deterministic: conversation first, then transcription job.
  select c.stage_completed_rules
    into v_rules
    from public.instagram_conversations c
   where c.id = v_conversation_id
   for update;

  if not found then
    return jsonb_build_object('success', false, 'reason', 'conversation_not_found');
  end if;
  select *
    into v_job
    from public.whatsapp2_transcription_jobs j
   where j.message_id = p_message_id
   for update;

  if v_job.status = 'completed' then
    return jsonb_build_object(
      'success', true,
      'completed', true,
      'duplicate', true,
      'brain_released', v_job.brain_released_at is not null
    );
  end if;

  if v_job.status <> 'processing' or v_job.lease_token is distinct from p_worker_token then
    return jsonb_build_object('success', false, 'reason', 'lease_not_owned');
  end if;

  update public.instagram_messages
     set audio_transcript = btrim(p_transcript),
         audio_transcribed_at = clock_timestamp(),
         audio_transcription_error = null
   where id = p_message_id
     and conversation_id = v_conversation_id
     and channel = 'whatsapp2'
     and media_type = 'audio';

  get diagnostics v_message_updated = row_count;
  if v_message_updated <> 1 then
    raise exception 'whatsapp2_audio_message_update_failed'
      using errcode = 'P0001';
  end if;

  if v_job.release_brain and v_job.brain_released_at is null then
    v_rules := coalesce(v_rules, '{}'::jsonb);
    v_orch := case
      when jsonb_typeof(v_rules->'orchestration') = 'object'
        then v_rules->'orchestration'
      else '{}'::jsonb
    end;
    v_ledger := case
      when jsonb_typeof(v_orch->'messageLedger') = 'object'
        then v_orch->'messageLedger'
      else '{}'::jsonb
    end;

    -- Transcript is already durable. Only now make this inbound visible to Brain.
    v_ledger := jsonb_set(v_ledger, array[p_message_id], '"pending"'::jsonb, true);
    v_orch := jsonb_set(v_orch, '{messageLedger}', v_ledger, true);
    v_active_token := nullif(v_rules->>'active_cycle_token', '');

    if v_active_token is not null then
      v_orch := jsonb_set(v_orch, '{preemptRequested}', 'true'::jsonb, true);
      v_rules := jsonb_set(v_rules, '{preempt_requested}', 'true'::jsonb, true);
    end if;

    v_rules := jsonb_set(v_rules, '{orchestration}', v_orch, true);
    update public.instagram_conversations
       set stage_completed_rules = v_rules
     where id = v_conversation_id;

    v_queue := public.enqueue_autopilot_inbound_job(
      v_conversation_id,
      p_message_id,
      clock_timestamp()
    );
    if coalesce((v_queue->>'success')::boolean, false) is not true then
      raise exception 'whatsapp2_audio_brain_enqueue_failed: %',
        coalesce(v_queue->>'reason', 'unknown') using errcode = 'P0001';
    end if;

    v_released := true;
  end if;

  update public.whatsapp2_transcription_jobs
     set status = 'completed',
         lease_token = null,
         lease_expires_at = null,
         brain_released_at = case
           when v_released then clock_timestamp()
           else brain_released_at
         end,
         completed_at = clock_timestamp(),
         failed_at = null,
         last_error = null,
         updated_at = clock_timestamp()
   where message_id = p_message_id;

  return jsonb_build_object(
    'success', true,
    'completed', true,
    'duplicate', false,
    'brain_released', v_released or v_job.brain_released_at is not null,
    'queue_revision', v_queue->'revision'
  );
end;
$$;
revoke all on function public.complete_whatsapp2_transcription_job(
  text, text, text
) from public, anon, authenticated;
grant execute on function public.complete_whatsapp2_transcription_job(
  text, text, text
) to service_role;

create or replace function public.reschedule_whatsapp2_transcription_job(
  p_message_id text,
  p_worker_token text,
  p_due_at timestamptz,
  p_last_error text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_attempt_count integer;
  v_max_attempts integer;
  v_terminal boolean := false;
  v_error text;
begin
  select j.attempt_count, j.max_attempts
    into v_attempt_count, v_max_attempts
    from public.whatsapp2_transcription_jobs j
   where j.message_id = p_message_id
     and j.status = 'processing'
     and j.lease_token = p_worker_token
   for update;
  if not found then
    return jsonb_build_object('success', false, 'reason', 'lease_not_owned');
  end if;

  v_terminal := v_attempt_count >= v_max_attempts;
  v_error := left(
    coalesce(
      nullif(p_last_error, ''),
      case when v_terminal
        then 'transcription_retry_exhausted'
        else 'transcription_retry_scheduled'
      end
    ),
    1000
  );

  update public.whatsapp2_transcription_jobs
     set status = case when v_terminal then 'failed' else 'pending' end,
         due_at = case
           when v_terminal then due_at
           else greatest(coalesce(p_due_at, clock_timestamp()), clock_timestamp())
         end,
         lease_token = null,
         lease_expires_at = null,
         failed_at = case when v_terminal then clock_timestamp() else null end,
         last_error = v_error,
         updated_at = clock_timestamp()
   where message_id = p_message_id;
  update public.instagram_messages
     set audio_transcription_error = v_error
   where id = p_message_id
     and channel = 'whatsapp2'
     and media_type = 'audio'
     and audio_transcript is null;

  return jsonb_build_object(
    'success', true,
    'rescheduled', not v_terminal,
    'failed', v_terminal,
    'attempt_count', v_attempt_count,
    'max_attempts', v_max_attempts,
    'last_error', v_error
  );
end;
$$;

revoke all on function public.reschedule_whatsapp2_transcription_job(
  text, text, timestamptz, text
) from public, anon, authenticated;
grant execute on function public.reschedule_whatsapp2_transcription_job(
  text, text, timestamptz, text
) to service_role;
