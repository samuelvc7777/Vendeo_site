-- Isolate inbound queue leases so each WhatsApp session processes only its own messages.
alter table public.whatsapp2_inbound_jobs
  add column if not exists gateway_account_id text not null default 'primary';

alter table public.whatsapp2_inbound_jobs
  drop constraint if exists whatsapp2_inbound_jobs_pkey;

alter table public.whatsapp2_inbound_jobs
  add constraint whatsapp2_inbound_jobs_pkey
  primary key (gateway_account_id, message_id);

create index if not exists idx_whatsapp2_inbound_jobs_account_due
  on public.whatsapp2_inbound_jobs (gateway_account_id, status, due_at, created_at)
  where status = 'pending';

create or replace function public.enqueue_whatsapp2_inbound_attachment_job_for_account(
  p_gateway_account_id text,
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
  p_due_at timestamptz default now(),
  p_provider_type text default null,
  p_attachment_metadata jsonb default '{}'::jsonb,
  p_message_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_timestamp timestamptz;
  v_job public.whatsapp2_inbound_jobs%rowtype;
begin
  if nullif(btrim(coalesce(p_gateway_account_id, '')), '') is null
     or nullif(btrim(coalesce(p_message_id, '')), '') is null
     or nullif(btrim(coalesce(p_conversation_id, '')), '') is null
     or nullif(btrim(coalesce(p_raw_contact_id, '')), '') is null then
    return jsonb_build_object('success', false, 'reason', 'invalid_inbound_job_identity');
  end if;

  begin
    v_timestamp := nullif(btrim(p_timestamp), '')::timestamptz;
  exception when others then
    v_timestamp := clock_timestamp();
  end;
  v_timestamp := coalesce(v_timestamp, clock_timestamp());

  insert into public.whatsapp2_inbound_jobs (
    gateway_account_id, message_id, conversation_id, raw_contact_id,
    sender_id, contact_name, message_text, preview_text, message_timestamp,
    media_type, provider_type, attachment_metadata, message_metadata,
    reply_to_message_id, actionable, due_at
  ) values (
    p_gateway_account_id, p_message_id, p_conversation_id, p_raw_contact_id,
    p_sender_id, p_contact_name, coalesce(p_message_text, ''),
    coalesce(nullif(p_preview_text, ''), 'Mensagem'), v_timestamp,
    nullif(p_media_type, ''), nullif(p_provider_type, ''),
    coalesce(p_attachment_metadata, '{}'::jsonb),
    coalesce(p_message_metadata, '{}'::jsonb), p_reply_to_message_id,
    coalesce(p_actionable, true), coalesce(p_due_at, clock_timestamp())
  )
  on conflict (gateway_account_id, message_id) do update
    set conversation_id = excluded.conversation_id,
        raw_contact_id = excluded.raw_contact_id,
        sender_id = coalesce(excluded.sender_id, public.whatsapp2_inbound_jobs.sender_id),
        contact_name = coalesce(nullif(excluded.contact_name, ''), public.whatsapp2_inbound_jobs.contact_name),
        message_text = case when excluded.message_text <> '' then excluded.message_text else public.whatsapp2_inbound_jobs.message_text end,
        preview_text = coalesce(nullif(excluded.preview_text, ''), public.whatsapp2_inbound_jobs.preview_text),
        message_timestamp = least(public.whatsapp2_inbound_jobs.message_timestamp, excluded.message_timestamp),
        media_type = coalesce(excluded.media_type, public.whatsapp2_inbound_jobs.media_type),
        provider_type = coalesce(excluded.provider_type, public.whatsapp2_inbound_jobs.provider_type),
        attachment_metadata = coalesce(public.whatsapp2_inbound_jobs.attachment_metadata, '{}'::jsonb) || excluded.attachment_metadata,
        message_metadata = coalesce(public.whatsapp2_inbound_jobs.message_metadata, '{}'::jsonb) || excluded.message_metadata,
        reply_to_message_id = coalesce(excluded.reply_to_message_id, public.whatsapp2_inbound_jobs.reply_to_message_id),
        actionable = public.whatsapp2_inbound_jobs.actionable or excluded.actionable,
        due_at = case
          when public.whatsapp2_inbound_jobs.status = 'pending'
            then least(public.whatsapp2_inbound_jobs.due_at, excluded.due_at)
          else public.whatsapp2_inbound_jobs.due_at
        end,
        updated_at = clock_timestamp()
  returning * into v_job;

  return jsonb_build_object(
    'success', true,
    'queued', v_job.status = 'pending',
    'duplicate', v_job.attempt_count > 0,
    'message_id', v_job.message_id,
    'status', v_job.status,
    'attempt_count', v_job.attempt_count,
    'terminal', v_job.status in ('completed', 'failed')
  );
end;
$$;

revoke all on function public.enqueue_whatsapp2_inbound_attachment_job_for_account(
  text, text, text, text, text, text, text, text, text, text, text, boolean,
  timestamptz, text, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.enqueue_whatsapp2_inbound_attachment_job_for_account(
  text, text, text, text, text, text, text, text, text, text, text, boolean,
  timestamptz, text, jsonb, jsonb
) to service_role;

create or replace function public.claim_whatsapp2_inbound_jobs_for_account(
  p_gateway_account_id text,
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
set search_path = ''
as $$
declare
  v_inflight integer := 0;
  v_available integer := 0;
  v_global_limit integer := 3;
  v_media_inflight integer := 0;
  v_media_available integer := 0;
begin
  if nullif(btrim(coalesce(p_gateway_account_id, '')), '') is null
     or nullif(btrim(coalesce(p_worker_token, '')), '') is null then
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext('whatsapp2_inbound_global_claim')::bigint);

  update public.whatsapp2_inbound_jobs j
     set status = case when j.attempt_count >= j.max_attempts then 'failed' else 'pending' end,
         due_at = case when j.attempt_count >= j.max_attempts then j.due_at else least(j.due_at, clock_timestamp()) end,
         lease_token = null,
         lease_expires_at = null,
         failed_at = case when j.attempt_count >= j.max_attempts then coalesce(j.failed_at, clock_timestamp()) else null end,
         last_error = left(coalesce(nullif(j.last_error, ''), 'stale_worker_lease_recovered'), 1000),
         updated_at = clock_timestamp()
   where j.gateway_account_id = p_gateway_account_id
     and j.status = 'processing'
     and (j.lease_expires_at is null or j.lease_expires_at <= clock_timestamp());

  update public.whatsapp2_inbound_jobs j
     set status = 'failed',
         failed_at = coalesce(j.failed_at, clock_timestamp()),
         last_error = left(coalesce(nullif(j.last_error, ''), 'max_attempts_exhausted'), 1000),
         updated_at = clock_timestamp()
   where j.gateway_account_id = p_gateway_account_id
     and j.status = 'pending'
     and j.attempt_count >= j.max_attempts;

  v_global_limit := greatest(1, least(coalesce(p_global_limit, 3), 8));

  select count(*) into v_inflight
    from public.whatsapp2_inbound_jobs j
   where j.status = 'processing'
     and j.lease_expires_at > clock_timestamp();

  v_available := greatest(0, v_global_limit - v_inflight);
  if v_available = 0 then return; end if;

  select count(*) into v_media_inflight
    from public.whatsapp2_inbound_jobs j
   where j.status = 'processing'
     and j.lease_expires_at > clock_timestamp()
     and j.media_type is not null;
  v_media_available := greatest(0, 1 - v_media_inflight);

  return query
  with per_conversation as (
    select distinct on (j.conversation_id)
      j.gateway_account_id, j.message_id, j.conversation_id,
      j.media_type, j.due_at, j.created_at
      from public.whatsapp2_inbound_jobs j
     where j.gateway_account_id = p_gateway_account_id
       and j.status = 'pending'
       and j.due_at <= clock_timestamp()
       and j.attempt_count < j.max_attempts
       and not exists (
         select 1
           from public.whatsapp2_inbound_jobs active
          where active.gateway_account_id = j.gateway_account_id
            and active.conversation_id = j.conversation_id
            and active.status = 'processing'
            and active.lease_expires_at > clock_timestamp()
       )
     order by j.conversation_id, j.due_at asc, j.created_at asc
  ),
  light_candidates as (
    select p.gateway_account_id, p.message_id, p.due_at, p.created_at
      from per_conversation p
     where p.media_type is null
     order by p.due_at asc, p.created_at asc
     limit v_available
  ),
  media_candidates as (
    select p.gateway_account_id, p.message_id, p.due_at, p.created_at
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
    select j.gateway_account_id, j.message_id
      from public.whatsapp2_inbound_jobs j
      join candidates c
        on c.gateway_account_id = j.gateway_account_id
       and c.message_id = j.message_id
     where j.status = 'pending'
     order by j.due_at asc, j.created_at asc
     for update of j skip locked
  )
  update public.whatsapp2_inbound_jobs j
     set status = 'processing',
         lease_token = p_worker_token,
         lease_expires_at = clock_timestamp() + make_interval(secs => greatest(60, least(coalesce(p_lease_seconds, 300), 900))),
         attempt_count = j.attempt_count + 1,
         updated_at = clock_timestamp()
    from locked l
   where j.gateway_account_id = l.gateway_account_id
     and j.message_id = l.message_id
  returning j.message_id, j.conversation_id, j.raw_contact_id, j.sender_id,
            j.contact_name, j.message_text, j.preview_text, j.message_timestamp,
            j.media_type, j.reply_to_message_id, j.actionable,
            j.attempt_count, j.max_attempts;
end;
$$;

revoke all on function public.claim_whatsapp2_inbound_jobs_for_account(text, text, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_whatsapp2_inbound_jobs_for_account(text, text, integer, integer, integer)
  to service_role;

create or replace function public.claim_whatsapp2_inbound_attachment_jobs_for_account(
  p_gateway_account_id text,
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
  provider_type text,
  attachment_metadata jsonb,
  message_metadata jsonb,
  reply_to_message_id text,
  actionable boolean,
  attempt_count integer,
  max_attempts integer
)
language sql
security definer
set search_path = ''
as $$
  select claimed.message_id, claimed.conversation_id, claimed.raw_contact_id,
         claimed.sender_id, claimed.contact_name, claimed.message_text,
         claimed.preview_text, claimed.message_timestamp, claimed.media_type,
         job.provider_type, coalesce(job.attachment_metadata, '{}'::jsonb),
         coalesce(job.message_metadata, '{}'::jsonb), claimed.reply_to_message_id,
         claimed.actionable, claimed.attempt_count, claimed.max_attempts
    from public.claim_whatsapp2_inbound_jobs_for_account(
      p_gateway_account_id, p_worker_token, p_limit, p_lease_seconds, p_global_limit
    ) claimed
    join public.whatsapp2_inbound_jobs job
      on job.gateway_account_id = p_gateway_account_id
     and job.message_id = claimed.message_id;
$$;

revoke all on function public.claim_whatsapp2_inbound_attachment_jobs_for_account(text, text, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_whatsapp2_inbound_attachment_jobs_for_account(text, text, integer, integer, integer)
  to service_role;

create or replace function public.complete_whatsapp2_inbound_job_for_account(
  p_gateway_account_id text,
  p_message_id text,
  p_worker_token text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated integer := 0;
begin
  update public.whatsapp2_inbound_jobs
     set status = 'completed', lease_token = null, lease_expires_at = null,
         completed_at = clock_timestamp(), failed_at = null, last_error = null,
         updated_at = clock_timestamp()
   where gateway_account_id = p_gateway_account_id
     and message_id = p_message_id
     and status = 'processing'
     and lease_token = p_worker_token;
  get diagnostics v_updated = row_count;
  return jsonb_build_object('success', v_updated > 0, 'completed', v_updated > 0,
    'reason', case when v_updated > 0 then null else 'lease_not_owned' end);
end;
$$;

revoke all on function public.complete_whatsapp2_inbound_job_for_account(text, text, text)
  from public, anon, authenticated;
grant execute on function public.complete_whatsapp2_inbound_job_for_account(text, text, text)
  to service_role;

create or replace function public.reschedule_whatsapp2_inbound_job_for_account(
  p_gateway_account_id text,
  p_message_id text,
  p_worker_token text,
  p_due_at timestamptz,
  p_last_error text default null
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt_count integer;
  v_max_attempts integer;
  v_terminal boolean := false;
begin
  select j.attempt_count, j.max_attempts
    into v_attempt_count, v_max_attempts
    from public.whatsapp2_inbound_jobs j
   where j.gateway_account_id = p_gateway_account_id
     and j.message_id = p_message_id
     and j.status = 'processing'
     and j.lease_token = p_worker_token
   for update;
  if not found then return jsonb_build_object('success', false, 'reason', 'lease_not_owned'); end if;

  v_terminal := v_attempt_count >= v_max_attempts;
  update public.whatsapp2_inbound_jobs
     set status = case when v_terminal then 'failed' else 'pending' end,
         due_at = case when v_terminal then due_at else greatest(coalesce(p_due_at, clock_timestamp()), clock_timestamp()) end,
         lease_token = null, lease_expires_at = null,
         failed_at = case when v_terminal then clock_timestamp() else null end,
         last_error = left(coalesce(nullif(p_last_error, ''), case when v_terminal then 'max_attempts_exhausted' else 'retry_scheduled' end), 1000),
         updated_at = clock_timestamp()
   where gateway_account_id = p_gateway_account_id
     and message_id = p_message_id;

  return jsonb_build_object('success', true, 'rescheduled', not v_terminal,
    'failed', v_terminal, 'attempt_count', v_attempt_count, 'max_attempts', v_max_attempts);
end;
$$;

revoke all on function public.reschedule_whatsapp2_inbound_job_for_account(text, text, text, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.reschedule_whatsapp2_inbound_job_for_account(text, text, text, timestamptz, text)
  to service_role;

-- Keep the original single-account RPCs safe during rolling gateway restarts.
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
language sql
security definer
set search_path = ''
as $$
  select public.enqueue_whatsapp2_inbound_attachment_job_for_account(
    'primary', p_message_id, p_conversation_id, p_raw_contact_id,
    p_sender_id, p_contact_name, p_message_text, p_preview_text,
    p_timestamp, p_media_type, p_reply_to_message_id, p_actionable,
    p_due_at, null, '{}'::jsonb, '{}'::jsonb
  );
$$;

create or replace function public.enqueue_whatsapp2_inbound_attachment_job(
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
  p_due_at timestamptz default now(),
  p_provider_type text default null,
  p_attachment_metadata jsonb default '{}'::jsonb,
  p_message_metadata jsonb default '{}'::jsonb
) returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.enqueue_whatsapp2_inbound_attachment_job_for_account(
    'primary', p_message_id, p_conversation_id, p_raw_contact_id,
    p_sender_id, p_contact_name, p_message_text, p_preview_text,
    p_timestamp, p_media_type, p_reply_to_message_id, p_actionable,
    p_due_at, p_provider_type, p_attachment_metadata, p_message_metadata
  );
$$;

create or replace function public.claim_whatsapp2_inbound_jobs(
  p_worker_token text,
  p_limit integer default 3,
  p_lease_seconds integer default 300,
  p_global_limit integer default 3
) returns table (
  message_id text, conversation_id text, raw_contact_id text, sender_id text,
  contact_name text, message_text text, preview_text text,
  message_timestamp timestamptz, media_type text, reply_to_message_id text,
  actionable boolean, attempt_count integer, max_attempts integer
)
language sql
security definer
set search_path = ''
as $$
  select * from public.claim_whatsapp2_inbound_jobs_for_account(
    'primary', p_worker_token, p_limit, p_lease_seconds, p_global_limit
  );
$$;

create or replace function public.claim_whatsapp2_inbound_attachment_jobs(
  p_worker_token text,
  p_limit integer default 3,
  p_lease_seconds integer default 300,
  p_global_limit integer default 3
) returns table (
  message_id text, conversation_id text, raw_contact_id text, sender_id text,
  contact_name text, message_text text, preview_text text,
  message_timestamp timestamptz, media_type text, provider_type text,
  attachment_metadata jsonb, message_metadata jsonb,
  reply_to_message_id text, actionable boolean, attempt_count integer,
  max_attempts integer
)
language sql
security definer
set search_path = ''
as $$
  select * from public.claim_whatsapp2_inbound_attachment_jobs_for_account(
    'primary', p_worker_token, p_limit, p_lease_seconds, p_global_limit
  );
$$;

create or replace function public.complete_whatsapp2_inbound_job(
  p_message_id text,
  p_worker_token text
) returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.complete_whatsapp2_inbound_job_for_account(
    'primary', p_message_id, p_worker_token
  );
$$;

create or replace function public.reschedule_whatsapp2_inbound_job(
  p_message_id text,
  p_worker_token text,
  p_due_at timestamptz,
  p_last_error text default null
) returns jsonb
language sql
security definer
set search_path = ''
as $$
  select public.reschedule_whatsapp2_inbound_job_for_account(
    'primary', p_message_id, p_worker_token, p_due_at, p_last_error
  );
$$;
