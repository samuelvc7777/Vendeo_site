-- Durable inbound queue for WhatsApp 2 heavy processing.
-- Task 1 only creates the queue primitives; the current gateway hot path is not moved yet.

create table if not exists public.whatsapp2_inbound_jobs (
  message_id text primary key,
  conversation_id text not null,
  raw_contact_id text not null,
  sender_id text,
  contact_name text,
  message_text text not null default '',
  preview_text text not null default 'Mensagem',
  message_timestamp timestamptz not null default clock_timestamp(),
  media_type text
    check (media_type is null or media_type in ('audio', 'image', 'video', 'sticker')),
  reply_to_message_id text,
  actionable boolean not null default true,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed')),
  due_at timestamptz not null default clock_timestamp(),
  lease_token text,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  last_error text,
  completed_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
create index if not exists idx_whatsapp2_inbound_jobs_due
  on public.whatsapp2_inbound_jobs (status, due_at, updated_at)
  where status = 'pending';

create index if not exists idx_whatsapp2_inbound_jobs_lease
  on public.whatsapp2_inbound_jobs (lease_expires_at)
  where status = 'processing';

create index if not exists idx_whatsapp2_inbound_jobs_conversation
  on public.whatsapp2_inbound_jobs (conversation_id, message_timestamp desc);

alter table public.whatsapp2_inbound_jobs enable row level security;
revoke all on public.whatsapp2_inbound_jobs from public, anon, authenticated;
grant select, insert, update, delete on public.whatsapp2_inbound_jobs to service_role;

create or replace function public.enqueue_whatsapp2_inbound_job(
  p_message_id text,
  p_conversation_id text,
  p_raw_contact_id text,
  p_sender_id text default null,
  p_contact_name text default null,
  p_message_text text default '',
  p_preview_text text default 'Mensagem',
  p_timestamp text default null,
  p_media_type text default null,
  p_reply_to_message_id text default null,
  p_actionable boolean default true,
  p_due_at timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_timestamp timestamptz;
  v_inserted public.whatsapp2_inbound_jobs%rowtype;
  v_current public.whatsapp2_inbound_jobs%rowtype;
begin
  if nullif(btrim(p_message_id), '') is null
     or nullif(btrim(p_conversation_id), '') is null
     or nullif(btrim(p_raw_contact_id), '') is null then
    return jsonb_build_object('success', false, 'reason', 'invalid_inbound_job_identity');
  end if;

  begin
    v_timestamp := nullif(btrim(p_timestamp), '')::timestamptz;
  exception when others then
    v_timestamp := clock_timestamp();
  end;
  v_timestamp := coalesce(v_timestamp, clock_timestamp());

  insert into public.whatsapp2_inbound_jobs (
    message_id, conversation_id, raw_contact_id, sender_id, contact_name,
    message_text, preview_text, message_timestamp, media_type,
    reply_to_message_id, actionable, due_at
  ) values (
    p_message_id, p_conversation_id, p_raw_contact_id, p_sender_id, p_contact_name,
    coalesce(p_message_text, ''), coalesce(nullif(p_preview_text, ''), 'Mensagem'),
    v_timestamp, nullif(p_media_type, ''), p_reply_to_message_id,
    coalesce(p_actionable, true), coalesce(p_due_at, clock_timestamp())
  )
  on conflict (message_id) do nothing
  returning * into v_inserted;
  if v_inserted.message_id is not null then
    return jsonb_build_object(
      'success', true,
      'queued', true,
      'duplicate', false,
      'message_id', v_inserted.message_id,
      'status', v_inserted.status,
      'attempt_count', v_inserted.attempt_count
    );
  end if;

  select *
    into v_current
    from public.whatsapp2_inbound_jobs
   where message_id = p_message_id
   for update;

  if v_current.message_id is null then
    return jsonb_build_object('success', false, 'reason', 'inbound_job_conflict_missing');
  end if;

  update public.whatsapp2_inbound_jobs
     set conversation_id = p_conversation_id,
         raw_contact_id = p_raw_contact_id,
         sender_id = coalesce(p_sender_id, sender_id),
         contact_name = coalesce(nullif(p_contact_name, ''), contact_name),
         message_text = case when coalesce(p_message_text, '') <> '' then p_message_text else message_text end,
         preview_text = coalesce(nullif(p_preview_text, ''), preview_text),
         message_timestamp = least(message_timestamp, v_timestamp),
         media_type = coalesce(nullif(p_media_type, ''), media_type),
         reply_to_message_id = coalesce(p_reply_to_message_id, reply_to_message_id),
         actionable = actionable or coalesce(p_actionable, true),
         due_at = case
           when status = 'pending' then least(due_at, coalesce(p_due_at, clock_timestamp()))
           else due_at
         end,
         updated_at = clock_timestamp()
   where message_id = p_message_id
   returning * into v_current;

  return jsonb_build_object(
    'success', true,
    'queued', v_current.status = 'pending',
    'duplicate', true,
    'message_id', v_current.message_id,
    'status', v_current.status,
    'attempt_count', v_current.attempt_count,
    'terminal', v_current.status in ('completed', 'failed')
  );
end;
$$;

revoke all on function public.enqueue_whatsapp2_inbound_job(
  text, text, text, text, text, text, text, text, text, text, boolean, timestamptz
) from public, anon, authenticated;
grant execute on function public.enqueue_whatsapp2_inbound_job(
  text, text, text, text, text, text, text, text, text, text, boolean, timestamptz
) to service_role;
create or replace function public.claim_whatsapp2_inbound_jobs(
  p_worker_token text,
  p_limit integer default 1,
  p_lease_seconds integer default 180,
  p_global_limit integer default 1
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
declare
  v_inflight integer := 0;
  v_available integer := 0;
  v_global_limit integer := 1;
begin
  if nullif(btrim(p_worker_token), '') is null then
    return;
  end if;

  -- Serialize the global capacity check so overlapping workers cannot over-claim.
  perform pg_advisory_xact_lock(
    hashtext('whatsapp2_inbound_global_claim')::bigint
  );

  -- Recover expired leases. A crash consumes one attempt, preventing infinite loops.
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
  -- Never claim a job that already exhausted its retry budget.
  update public.whatsapp2_inbound_jobs
     set status = 'failed',
         failed_at = coalesce(failed_at, clock_timestamp()),
         last_error = left(coalesce(nullif(last_error, ''), 'max_attempts_exhausted'), 1000),
         updated_at = clock_timestamp()
   where status = 'pending'
     and attempt_count >= max_attempts;

  v_global_limit := greatest(1, least(coalesce(p_global_limit, 1), 16));

  select count(*)
    into v_inflight
    from public.whatsapp2_inbound_jobs j
   where j.status = 'processing'
     and j.lease_expires_at > clock_timestamp();

  v_available := greatest(0, v_global_limit - v_inflight);
  if v_available = 0 then
    return;
  end if;

  return query
  with candidates as (
    select j.message_id
      from public.whatsapp2_inbound_jobs j
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
  update public.whatsapp2_inbound_jobs j
     set status = 'processing',
         lease_token = p_worker_token,
         lease_expires_at = clock_timestamp()
           + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 180), 900))),
         attempt_count = j.attempt_count + 1,
         updated_at = clock_timestamp()
    from candidates c
   where j.message_id = c.message_id
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

revoke all on function public.claim_whatsapp2_inbound_jobs(text, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_whatsapp2_inbound_jobs(text, integer, integer, integer)
  to service_role;

create or replace function public.complete_whatsapp2_inbound_job(
  p_message_id text,
  p_worker_token text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer := 0;
begin
  update public.whatsapp2_inbound_jobs
     set status = 'completed',
         lease_token = null,
         lease_expires_at = null,
         completed_at = clock_timestamp(),
         failed_at = null,
         last_error = null,
         updated_at = clock_timestamp()
   where message_id = p_message_id
     and status = 'processing'
     and lease_token = p_worker_token;
  get diagnostics v_updated = row_count;

  return jsonb_build_object(
    'success', v_updated > 0,
    'completed', v_updated > 0,
    'reason', case when v_updated > 0 then null else 'lease_not_owned' end
  );
end;
$$;

revoke all on function public.complete_whatsapp2_inbound_job(text, text)
  from public, anon, authenticated;
grant execute on function public.complete_whatsapp2_inbound_job(text, text)
  to service_role;

create or replace function public.reschedule_whatsapp2_inbound_job(
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
begin
  select j.attempt_count, j.max_attempts
    into v_attempt_count, v_max_attempts
    from public.whatsapp2_inbound_jobs j
   where j.message_id = p_message_id
     and j.status = 'processing'
     and j.lease_token = p_worker_token
   for update;

  if not found then
    return jsonb_build_object('success', false, 'reason', 'lease_not_owned');
  end if;

  v_terminal := v_attempt_count >= v_max_attempts;

  update public.whatsapp2_inbound_jobs
     set status = case when v_terminal then 'failed' else 'pending' end,
         due_at = case
           when v_terminal then due_at
           else greatest(coalesce(p_due_at, clock_timestamp()), clock_timestamp())
         end,
         lease_token = null,
         lease_expires_at = null,
         failed_at = case when v_terminal then clock_timestamp() else null end,
         last_error = left(
           coalesce(
             nullif(p_last_error, ''),
             case when v_terminal then 'max_attempts_exhausted' else 'retry_scheduled' end
           ),
           1000
         ),
         updated_at = clock_timestamp()
   where message_id = p_message_id;

  return jsonb_build_object(
    'success', true,
    'rescheduled', not v_terminal,
    'failed', v_terminal,
    'attempt_count', v_attempt_count,
    'max_attempts', v_max_attempts
  );
end;
$$;

revoke all on function public.reschedule_whatsapp2_inbound_job(
  text, text, timestamptz, text
) from public, anon, authenticated;
grant execute on function public.reschedule_whatsapp2_inbound_job(
  text, text, timestamptz, text
) to service_role;
