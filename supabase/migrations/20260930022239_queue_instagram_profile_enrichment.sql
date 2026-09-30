-- Move Instagram profile enrichment out of the Meta webhook hot path.
-- Jobs are coalesced per conversation and processed with bounded concurrency.

create table if not exists public.instagram_profile_jobs (
  conversation_id text primary key
    references public.instagram_conversations(id) on delete cascade,
  raw_contact_id text not null,
  message_id text,
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

create index if not exists idx_instagram_profile_jobs_due
  on public.instagram_profile_jobs (status, due_at, updated_at);

alter table public.instagram_profile_jobs enable row level security;
revoke all on public.instagram_profile_jobs from public, anon, authenticated;
grant select, insert, update, delete on public.instagram_profile_jobs to service_role;

create or replace function public.enqueue_instagram_profile_job(
  p_conversation_id text,
  p_raw_contact_id text,
  p_message_id text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if nullif(btrim(p_conversation_id), '') is null
     or nullif(btrim(p_raw_contact_id), '') is null then
    return jsonb_build_object('success', false, 'reason', 'invalid_profile_job');
  end if;

  insert into public.instagram_profile_jobs (
    conversation_id, raw_contact_id, message_id, due_at
  ) values (
    p_conversation_id, p_raw_contact_id, p_message_id, clock_timestamp()
  )
  on conflict (conversation_id) do update
  set raw_contact_id = excluded.raw_contact_id,
      message_id = coalesce(excluded.message_id, public.instagram_profile_jobs.message_id),
      status = case
        when public.instagram_profile_jobs.status = 'processing'
         and public.instagram_profile_jobs.lease_expires_at > clock_timestamp()
          then 'processing'
        else 'pending'
      end,
      due_at = clock_timestamp(),
      lease_token = case
        when public.instagram_profile_jobs.status = 'processing'
         and public.instagram_profile_jobs.lease_expires_at > clock_timestamp()
          then public.instagram_profile_jobs.lease_token
        else null
      end,
      lease_expires_at = case
        when public.instagram_profile_jobs.status = 'processing'
         and public.instagram_profile_jobs.lease_expires_at > clock_timestamp()
          then public.instagram_profile_jobs.lease_expires_at
        else null
      end,
      last_error = null,
      updated_at = clock_timestamp();

  return jsonb_build_object('success', true, 'queued', true);
end;
$$;

revoke all on function public.enqueue_instagram_profile_job(text, text, text)
  from public, anon, authenticated;
grant execute on function public.enqueue_instagram_profile_job(text, text, text)
  to service_role;

create or replace function public.claim_instagram_profile_jobs(
  p_worker_token text,
  p_limit integer default 2,
  p_lease_seconds integer default 120
) returns table (
  conversation_id text,
  raw_contact_id text,
  message_id text,
  attempt_count integer
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if nullif(btrim(p_worker_token), '') is null then
    return;
  end if;

  update public.instagram_profile_jobs
     set status = 'pending',
         lease_token = null,
         lease_expires_at = null,
         due_at = least(due_at, clock_timestamp()),
         updated_at = clock_timestamp()
   where status = 'processing'
     and lease_expires_at <= clock_timestamp();

  return query
  with candidate as (
    select j.conversation_id
    from public.instagram_profile_jobs j
    where j.status = 'pending'
      and j.due_at <= clock_timestamp()
    order by j.due_at asc, j.updated_at asc
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 2), 10))
  )
  update public.instagram_profile_jobs j
  set status = 'processing',
      lease_token = p_worker_token,
      lease_expires_at = clock_timestamp()
        + make_interval(secs => greatest(30, least(coalesce(p_lease_seconds, 120), 600))),
      attempt_count = j.attempt_count + 1,
      updated_at = clock_timestamp()
  from candidate c
  where j.conversation_id = c.conversation_id
  returning j.conversation_id, j.raw_contact_id, j.message_id, j.attempt_count;
end;
$$;

revoke all on function public.claim_instagram_profile_jobs(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_instagram_profile_jobs(text, integer, integer)
  to service_role;

create or replace function public.complete_instagram_profile_job(
  p_conversation_id text,
  p_worker_token text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted integer;
begin
  delete from public.instagram_profile_jobs
  where conversation_id = p_conversation_id
    and status = 'processing'
    and lease_token = p_worker_token;

  get diagnostics v_deleted = row_count;

  return jsonb_build_object(
    'success', true,
    'completed', v_deleted > 0
  );
end;
$$;

revoke all on function public.complete_instagram_profile_job(text, text)
  from public, anon, authenticated;
grant execute on function public.complete_instagram_profile_job(text, text)
  to service_role;

create or replace function public.reschedule_instagram_profile_job(
  p_conversation_id text,
  p_worker_token text,
  p_due_at timestamptz,
  p_last_error text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated integer;
begin
  update public.instagram_profile_jobs
  set status = 'pending',
      due_at = greatest(coalesce(p_due_at, clock_timestamp()), clock_timestamp()),
      lease_token = null,
      lease_expires_at = null,
      last_error = left(coalesce(p_last_error, ''), 1000),
      updated_at = clock_timestamp()
  where conversation_id = p_conversation_id
    and status = 'processing'
    and lease_token = p_worker_token;

  get diagnostics v_updated = row_count;

  return jsonb_build_object(
    'success', true,
    'rescheduled', v_updated > 0
  );
end;
$$;

revoke all on function public.reschedule_instagram_profile_job(text, text, timestamptz, text)
  from public, anon, authenticated;
grant execute on function public.reschedule_instagram_profile_job(text, text, timestamptz, text)
  to service_role;
