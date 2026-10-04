-- Fix PL/pgSQL output-column ambiguity in WhatsApp 2 claim functions.
-- Logic/backpressure is unchanged from whatsapp2_backpressure_limits.

create or replace function public.claim_whatsapp2_inbound_jobs(
  p_worker_token text,
  p_limit integer default 3,
  p_lease_seconds integer default 300,
  p_global_limit integer default 3
) returns table (
  message_id text,
  conversation_id text,
  raw_contact_id text,
  sender_id text,
  contact_name text,
  message_text text,
  preview_text text,
  message_timestamp timestamptz,
  media_type text,
  reply_to_message_id text,
  actionable boolean,
  attempt_count integer,
  max_attempts integer
)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_inflight integer := 0;
  v_available integer := 0;
  v_global_limit integer := 3;
  v_media_inflight integer := 0;
  v_media_available integer := 0;
begin
  if nullif(btrim(p_worker_token), '') is null then
    return;
  end if;

  perform pg_advisory_xact_lock(
    hashtext('whatsapp2_inbound_global_claim')::bigint
  );

  update public.whatsapp2_inbound_jobs
     set status = case when attempt_count >= max_attempts then 'failed' else 'pending' end,
         due_at = case
           when attempt_count >= max_attempts then due_at
           else least(due_at, clock_timestamp())
         end,
         lease_token = null,
         lease_expires_at = null,
         failed_at = case
           when attempt_count >= max_attempts then coalesce(failed_at, clock_timestamp())
           else null
         end,
         last_error = left(
           coalesce(nullif(last_error, ''), 'stale_worker_lease_recovered'),
           1000
         ),
         updated_at = clock_timestamp()
   where status = 'processing'
     and (lease_expires_at is null or lease_expires_at <= clock_timestamp());

  update public.whatsapp2_inbound_jobs
     set status = 'failed',
         failed_at = coalesce(failed_at, clock_timestamp()),
         last_error = left(coalesce(nullif(last_error, ''), 'max_attempts_exhausted'), 1000),
         updated_at = clock_timestamp()
   where status = 'pending'
     and attempt_count >= max_attempts;
  v_global_limit := greatest(1, least(coalesce(p_global_limit, 3), 8));

  select count(*)
    into v_inflight
    from public.whatsapp2_inbound_jobs j
   where j.status = 'processing'
     and j.lease_expires_at > clock_timestamp();

  v_available := greatest(0, v_global_limit - v_inflight);
  if v_available = 0 then
    return;
  end if;

  select count(*)
    into v_media_inflight
    from public.whatsapp2_inbound_jobs j
   where j.status = 'processing'
     and j.lease_expires_at > clock_timestamp()
     and j.media_type is not null;

  v_media_available := greatest(0, 1 - v_media_inflight);
  return query
  with per_conversation as (
    select distinct on (j.conversation_id)
      j.message_id,
      j.conversation_id,
      j.media_type,
      j.due_at,
      j.created_at
    from public.whatsapp2_inbound_jobs j
    where j.status = 'pending'
      and j.due_at <= clock_timestamp()
      and j.attempt_count < j.max_attempts
      and not exists (
        select 1
        from public.whatsapp2_inbound_jobs active
        where active.conversation_id = j.conversation_id
          and active.status = 'processing'
          and active.lease_expires_at > clock_timestamp()
      )
    order by j.conversation_id, j.due_at asc, j.created_at asc
  ),
  light_candidates as (
    select p.message_id, p.due_at, p.created_at
    from per_conversation p
    where p.media_type is null
    order by p.due_at asc, p.created_at asc
    limit v_available
  ),
  media_candidates as (
    select p.message_id, p.due_at, p.created_at
    from per_conversation p
    where p.media_type is not null
    order by p.due_at asc, p.created_at asc
    limit least(v_available, v_media_available)
  ),
  candidates as (
    select * from light_candidates
    union all
    select * from media_candidates
    order by due_at asc, created_at asc
    limit least(greatest(1, least(coalesce(p_limit, 3), 8)), v_available)
  ),
  locked as (
    select j.message_id
    from public.whatsapp2_inbound_jobs j
    join candidates c on c.message_id = j.message_id
    where j.status = 'pending'
    order by j.due_at asc, j.created_at asc
    for update of j skip locked
  )
  update public.whatsapp2_inbound_jobs j
     set status = 'processing',
         lease_token = p_worker_token,
         lease_expires_at = clock_timestamp()
           + make_interval(secs => greatest(60, least(coalesce(p_lease_seconds, 300), 900))),
         attempt_count = j.attempt_count + 1,
         updated_at = clock_timestamp()
    from locked l
   where j.message_id = l.message_id
  returning
    j.message_id,
    j.conversation_id,
    j.raw_contact_id,
    j.sender_id,
    j.contact_name,
    j.message_text,
    j.preview_text,
    j.message_timestamp,
    j.media_type,
    j.reply_to_message_id,
    j.actionable,
    j.attempt_count,
    j.max_attempts;
end;
$$;

revoke all on function public.claim_whatsapp2_inbound_jobs(
  text, integer, integer, integer
) from public, anon, authenticated;
grant execute on function public.claim_whatsapp2_inbound_jobs(
  text, integer, integer, integer
) to service_role;

create or replace function public.claim_whatsapp2_transcription_jobs(
  p_worker_token text,
  p_limit integer default 2,
  p_lease_seconds integer default 120,
  p_global_limit integer default 2
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
#variable_conflict use_column
declare
  v_inflight integer := 0;
  v_available integer := 0;
  v_global_limit integer := 2;
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
     and m.audio_transcript is null;
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

  v_global_limit := greatest(1, least(coalesce(p_global_limit, 2), 4));

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
  with per_conversation as (
    select distinct on (j.conversation_id)
      j.message_id,
      j.conversation_id,
      j.due_at,
      j.created_at
    from public.whatsapp2_transcription_jobs j
    where j.status = 'pending'
      and j.due_at <= clock_timestamp()
      and j.attempt_count < j.max_attempts
      and not exists (
        select 1
        from public.whatsapp2_transcription_jobs active
        where active.conversation_id = j.conversation_id
          and active.status = 'processing'
          and active.lease_expires_at > clock_timestamp()
      )
    order by j.conversation_id, j.due_at asc, j.created_at asc
  ),
  candidates as (
    select p.message_id
    from per_conversation p
    order by p.due_at asc, p.created_at asc
    limit least(greatest(1, least(coalesce(p_limit, 2), 4)), v_available)
  ),
  locked as (
    select j.message_id
    from public.whatsapp2_transcription_jobs j
    join candidates c on c.message_id = j.message_id
    where j.status = 'pending'
    order by j.due_at asc, j.created_at asc
    for update of j skip locked
  )
  update public.whatsapp2_transcription_jobs j
     set status = 'processing',
         lease_token = p_worker_token,
         lease_expires_at = clock_timestamp()
           + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 120), 600))),
         attempt_count = j.attempt_count + 1,
         updated_at = clock_timestamp()
    from locked l
   where j.message_id = l.message_id
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

