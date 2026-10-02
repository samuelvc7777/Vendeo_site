-- Durable delivery bridge for the local WhatsApp 2 linked-device gateway.

create table if not exists public.whatsapp2_delivery_queue (
  id text primary key,
  conversation_id text not null,
  recipient_id text not null,
  kind text not null default 'text'
    check (kind in ('text', 'audio', 'image', 'sticker')),
  text_content text,
  media_url text,
  voice_note boolean not null default false,
  reply_to_message_id text,
  status text not null default 'pending'
    check (status in ('pending', 'sending', 'sent', 'failed', 'uncertain', 'cancelled')),
  provider_message_id text,
  attempts integer not null default 0,
  claimed_by text,
  claimed_at timestamptz,
  completed_at timestamptz,
  last_error text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create index if not exists idx_whatsapp2_delivery_queue_due
  on public.whatsapp2_delivery_queue (status, created_at)
  where status in ('pending', 'sending');

create index if not exists idx_whatsapp2_delivery_queue_conversation
  on public.whatsapp2_delivery_queue (conversation_id, created_at desc);

revoke all on table public.whatsapp2_delivery_queue from public, anon, authenticated;
grant select, insert, update, delete on table public.whatsapp2_delivery_queue to service_role;

create or replace function public.claim_whatsapp2_delivery_batch(
  p_worker_id text,
  p_limit integer default 5,
  p_stale_after_seconds integer default 90
) returns setof public.whatsapp2_delivery_queue
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidates as (
    select q.id
    from public.whatsapp2_delivery_queue q
    where
      q.status = 'pending'
      or (
        q.status = 'sending'
        and q.claimed_at < clock_timestamp() - make_interval(secs => greatest(10, p_stale_after_seconds))
      )
    order by q.created_at asc
    for update skip locked
    limit greatest(1, least(coalesce(p_limit, 5), 25))
  ),
  updated as (
    update public.whatsapp2_delivery_queue q
    set status = 'sending',
        claimed_by = nullif(btrim(p_worker_id), ''),
        claimed_at = clock_timestamp(),
        attempts = q.attempts + 1,
        last_error = null,
        updated_at = clock_timestamp()
    from candidates c
    where q.id = c.id
    returning q.*
  )
  select * from updated;
end;
$$;

revoke all on function public.claim_whatsapp2_delivery_batch(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.claim_whatsapp2_delivery_batch(text, integer, integer)
  to service_role;

create or replace function public.complete_whatsapp2_delivery(
  p_id text,
  p_worker_id text,
  p_success boolean,
  p_provider_message_id text default null,
  p_error text default null,
  p_uncertain boolean default false
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_row public.whatsapp2_delivery_queue%rowtype;
begin
  v_status := case
    when p_success then 'sent'
    when p_uncertain then 'uncertain'
    else 'failed'
  end;

  update public.whatsapp2_delivery_queue
  set status = v_status,
      provider_message_id = coalesce(nullif(btrim(p_provider_message_id), ''), provider_message_id),
      last_error = case when p_success then null else nullif(p_error, '') end,
      completed_at = case when p_success or not p_uncertain then clock_timestamp() else completed_at end,
      updated_at = clock_timestamp()
  where id = p_id
    and (claimed_by = p_worker_id or claimed_by is null)
  returning * into v_row;

  if v_row.id is null then
    return jsonb_build_object('success', false, 'reason', 'not_claimed');
  end if;

  return jsonb_build_object(
    'success', true,
    'status', v_row.status,
    'provider_message_id', v_row.provider_message_id
  );
end;
$$;

revoke all on function public.complete_whatsapp2_delivery(text, text, boolean, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.complete_whatsapp2_delivery(text, text, boolean, text, text, boolean)
  to service_role;
