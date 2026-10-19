-- Cofre separado e fila persistente de finalização do WhatsApp.
create table if not exists public.whatsapp_finalization_vault_items (
  id uuid primary key default gen_random_uuid(),
  position integer not null default 0 check (position >= 0 and position <= 1000),
  kind text not null check (kind in ('text', 'audio', 'image')),
  body text,
  media_url text,
  file_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint whatsapp_finalization_valid_item check (
    (kind = 'text' and length(btrim(coalesce(body,''))) between 1 and 4000 and media_url is null)
    or (kind in ('audio','image') and media_url ~ '^https://[^[:space:]]+$' and length(media_url) <= 2000)
  )
);
create index if not exists whatsapp_finalization_vault_order_idx
  on public.whatsapp_finalization_vault_items(position, created_at, id);
alter table public.whatsapp_finalization_vault_items enable row level security;
-- Vendeo uses the same anonymous browser operator as its existing vault.
drop policy if exists vendeo_finalization_vault_app on public.whatsapp_finalization_vault_items;
create policy vendeo_finalization_vault_app on public.whatsapp_finalization_vault_items
  for all to anon, authenticated using (true) with check (true);
grant select, insert, update, delete on public.whatsapp_finalization_vault_items to anon, authenticated;

alter table public.whatsapp2_delivery_queue
  add column if not exists scheduled_at timestamptz not null default clock_timestamp();
create index if not exists whatsapp2_delivery_schedule_idx
  on public.whatsapp2_delivery_queue(gateway_account_id, scheduled_at, id)
  where status = 'pending';

create or replace function public.claim_whatsapp2_delivery_batch(
 p_worker_id text, p_limit integer default 5,
 p_stale_after_seconds integer default 90, p_gateway_account_id text default 'primary'
)
returns setof public.whatsapp2_delivery_queue
language plpgsql set search_path = ''
as $$
begin
  with stale as (
    select q.id from public.whatsapp2_delivery_queue q
    where q.gateway_account_id = coalesce(nullif(btrim(p_gateway_account_id), ''), 'primary')
      and q.status = 'sending'
      and (q.claimed_at is null or q.claimed_at < clock_timestamp() - make_interval(secs => greatest(10, p_stale_after_seconds)))
    order by q.created_at for update skip locked limit 25
  )
  update public.whatsapp2_delivery_queue q
    set status = case when nullif(btrim(q.provider_message_id), '') is not null then 'sent' else 'uncertain' end,
        last_error = case when nullif(btrim(q.provider_message_id), '') is not null then null else 'whatsapp2_sending_stale_unknown_delivery' end,
        updated_at = clock_timestamp()
  from stale s where q.id = s.id;

  return query
  with candidates as (
    select q.id from public.whatsapp2_delivery_queue q
    where q.gateway_account_id = coalesce(nullif(btrim(p_gateway_account_id), ''), 'primary')
      and q.status = 'pending'
      and q.scheduled_at <= clock_timestamp()
      and nullif(btrim(q.provider_message_id), '') is null
      and (
        q.id not like 'fin-%'
        or not exists (
          select 1 from public.whatsapp2_delivery_queue earlier
          where earlier.conversation_id = q.conversation_id
            and earlier.gateway_account_id = q.gateway_account_id
            and earlier.id like 'fin-%'
            and left(earlier.id, 41) = left(q.id, 41)
            and earlier.id < q.id and earlier.status <> 'sent'
        )
      )
    order by q.scheduled_at, q.created_at
    for update skip locked
    limit greatest(1,least(coalesce(p_limit,5),25))
  )
  update public.whatsapp2_delivery_queue q
    set status='sending', claimed_by=nullif(btrim(p_worker_id),''),
        claimed_at=clock_timestamp(),attempts=q.attempts+1,
        last_error=null,updated_at=clock_timestamp()
  from candidates c where q.id=c.id returning q.*;
end;
$$;

create or replace function public.enqueue_whatsapp_finalization_batch(
 p_conversation_id text,
 p_recipient_id text,
 p_gateway_account_id text,
 p_request_id uuid
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
 v_item record;
 v_count integer;
 v_next timestamptz;
 v_batch_prefix text := 'fin-' || p_request_id::text || '-';
 v_existing integer;
 v_expected_prefix text := 'wa2:' || p_gateway_account_id || ':';
 v_i integer := 0;
 v_now timestamptz := clock_timestamp();
begin
 if p_request_id is null or length(coalesce(p_conversation_id,'')) > 150
    or p_gateway_account_id !~ '^account-[0-9]{8,20}$'
    or p_recipient_id !~ '^[0-9]{8,20}@(c[.]us|lid)$'
    or left(coalesce(p_conversation_id,''),length(v_expected_prefix)) <> v_expected_prefix
    or not exists (
      select 1 from public.instagram_conversations c
      where c.id = p_conversation_id and c.channel = 'whatsapp2' and c.status = 'active'
    )
 then raise exception 'Conversa WhatsApp não autorizada para finalização.';
 end if;

 perform pg_advisory_xact_lock(hashtextextended(p_conversation_id, 331));
 select count(*) into v_existing
 from public.whatsapp2_delivery_queue q
 where q.id like v_batch_prefix || '%';
 if v_existing > 0 then
   return jsonb_build_object('queued',true,'alreadyQueued',true,'count',v_existing,'batchId',p_request_id);
 end if;
 if exists (
   select 1 from public.whatsapp2_delivery_queue q
   where q.conversation_id = p_conversation_id
     and q.gateway_account_id = p_gateway_account_id
     and q.id like 'fin-%' and q.status in ('pending','sending','uncertain')
 ) then
   raise exception 'Já existe uma finalização em andamento ou aguardando conferência neste chat.';
 end if;
 select count(*) into v_count from public.whatsapp_finalization_vault_items;
 if v_count < 1 or v_count > 30 then
   raise exception 'O cofre de finalização precisa de 1 a 30 itens.';
 end if;
 select greatest(v_now,coalesce(max(q.scheduled_at),v_now)) into v_next
 from public.whatsapp2_delivery_queue q
 where q.conversation_id=p_conversation_id
   and q.gateway_account_id=p_gateway_account_id
   and q.status in ('pending','sending');
 for v_item in
   select * from public.whatsapp_finalization_vault_items
   order by position,created_at,id
 loop
   v_i := v_i + 1;
   v_next := v_next + case when v_item.kind = 'image'
      then interval '3 seconds' else interval '10 seconds' end;
   insert into public.whatsapp2_delivery_queue (
     id,conversation_id,recipient_id,gateway_account_id,
     kind,text_content,media_url,voice_note,status,scheduled_at
   ) values (
     v_batch_prefix || lpad(v_i::text,2,'0'), p_conversation_id,
     p_recipient_id,p_gateway_account_id,v_item.kind,
     case when v_item.kind='audio' then null else v_item.body end,
     v_item.media_url,v_item.kind='audio','pending',v_next
   );
 end loop;
 return jsonb_build_object(
   'queued',true,'alreadyQueued',false,'count',v_i,
   'batchId',p_request_id,'lastScheduledAt',v_next
 );
end;
$$;
revoke all on function public.enqueue_whatsapp_finalization_batch(text,text,text,uuid) from public,anon,authenticated;
grant execute on function public.enqueue_whatsapp_finalization_batch(text,text,text,uuid) to service_role;
