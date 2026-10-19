-- Envio manual da finalização é permitido no contato aberto, arquivado ou trancado.
-- Contatos bloqueados e não reconhecidos permanecem protegidos.
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
      where c.id = p_conversation_id and c.channel = 'whatsapp2' and c.status in ('active', 'archived', 'locked')
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
     p_recipient_id,p_gateway_account_id,
     case when v_item.kind = 'raffle_numbers' then 'text' else v_item.kind end,
     case when v_item.kind='audio' then null
          when v_item.kind='raffle_numbers' then public.format_available_raffle_numbers_for_finalization()
          else v_item.body end,
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
