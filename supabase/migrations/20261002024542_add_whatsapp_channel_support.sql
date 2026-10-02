-- WhatsApp Cloud API channel support without duplicating the Brain.
-- Existing rows remain Instagram by default.

alter table public.instagram_conversations
  add column if not exists channel text not null default 'instagram';

alter table public.instagram_messages
  add column if not exists channel text not null default 'instagram';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'instagram_conversations_channel_check'
  ) then
    alter table public.instagram_conversations
      add constraint instagram_conversations_channel_check
      check (channel in ('instagram', 'whatsapp'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'instagram_messages_channel_check'
  ) then
    alter table public.instagram_messages
      add constraint instagram_messages_channel_check
      check (channel in ('instagram', 'whatsapp'));
  end if;
end $$;

create index if not exists idx_instagram_conversations_channel_last_message
  on public.instagram_conversations (channel, last_message_at desc);

create index if not exists idx_instagram_messages_channel_conversation_timestamp
  on public.instagram_messages (channel, conversation_id, timestamp desc);

create or replace function public.ingest_whatsapp_inbound_atomic(
  p_conversation_id text,
  p_raw_contact_id text,
  p_message_id text,
  p_sender_id text,
  p_contact_name text,
  p_text text,
  p_timestamp text,
  p_preview_text text,
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
  v_timestamp timestamptz;
  v_name text;
  v_result jsonb;
  v_openai_queued integer := 0;
begin

  if nullif(btrim(p_conversation_id), '') is null
     or nullif(btrim(p_raw_contact_id), '') is null
     or nullif(btrim(p_message_id), '') is null then
    raise exception 'invalid_whatsapp_inbound_identity' using errcode = '22023';
  end if;

  begin
    v_timestamp := nullif(btrim(p_timestamp), '')::timestamptz;
  exception when others then
    v_timestamp := clock_timestamp();
  end;
  v_timestamp := coalesce(v_timestamp, clock_timestamp());
  v_name := coalesce(nullif(btrim(p_contact_name), ''), p_raw_contact_id);

  insert into public.instagram_conversations (
    id, username, full_name, avatar, contact_id, channel,
    last_message, last_message_preview, last_message_at,
    last_direction, last_status, seen_at, unread, updated_at, status
  ) values (
    p_conversation_id, p_raw_contact_id, v_name, '/images/default-avatar.svg',
    p_raw_contact_id, 'whatsapp', p_preview_text, p_preview_text, v_timestamp,
    'in', null, null, true, v_timestamp, 'active'
  )

  on conflict (id) do update
  set channel = 'whatsapp',
      contact_id = excluded.contact_id,
      username = coalesce(nullif(public.instagram_conversations.username, ''), excluded.username),
      full_name = case
        when nullif(btrim(p_contact_name), '') is not null then excluded.full_name
        else public.instagram_conversations.full_name
      end,
      last_message = case
        when excluded.last_message_at >= coalesce(public.instagram_conversations.last_message_at, '-infinity'::timestamptz)
          then excluded.last_message
        else public.instagram_conversations.last_message
      end,
      last_message_preview = case
        when excluded.last_message_at >= coalesce(public.instagram_conversations.last_message_at, '-infinity'::timestamptz)
          then excluded.last_message_preview
        else public.instagram_conversations.last_message_preview
      end,
      last_message_at = greatest(
        coalesce(public.instagram_conversations.last_message_at, '-infinity'::timestamptz),
        excluded.last_message_at
      ),

      last_direction = case
        when excluded.last_message_at >= coalesce(public.instagram_conversations.last_message_at, '-infinity'::timestamptz)
          then 'in'
        else public.instagram_conversations.last_direction
      end,
      last_status = case
        when excluded.last_message_at >= coalesce(public.instagram_conversations.last_message_at, '-infinity'::timestamptz)
          then null
        else public.instagram_conversations.last_status
      end,
      seen_at = case
        when excluded.last_message_at >= coalesce(public.instagram_conversations.last_message_at, '-infinity'::timestamptz)
          then null
        else public.instagram_conversations.seen_at
      end,
      unread = case
        when excluded.last_message_at >= coalesce(public.instagram_conversations.last_message_at, '-infinity'::timestamptz)
          then true
        else public.instagram_conversations.unread
      end,
      updated_at = greatest(public.instagram_conversations.updated_at, excluded.updated_at);

  v_result := public.record_and_queue_inbound_atomic(
    p_conversation_id, p_message_id, p_raw_contact_id, p_sender_id,
    p_text, p_timestamp, p_media_url, p_media_type,
    p_reply_to_message_id, p_audio_transcript,
    p_audio_transcription_error, p_actionable
  );

  if coalesce((v_result->>'success')::boolean, false) is not true then
    raise exception 'whatsapp_inbound_record_failed: %',
      coalesce(v_result->>'reason', 'unknown') using errcode = 'P0001';
  end if;

  update public.instagram_messages
     set channel = 'whatsapp'
   where id = p_message_id;

  if coalesce(p_media_type, '') not in ('audio', 'image', 'video') then
    begin
      insert into public.openai_message_receipts (
        provider_message_id, conversation_id, direction, received_at,
        sync_status, next_retry_at, last_error, updated_at
      )
      select p_message_id, p_conversation_id, 'inbound', v_timestamp,
             'pending', null, null, clock_timestamp()
      from public.openai_conversation_links l
      where l.conversation_id = p_conversation_id
        and l.status = 'active'
        and l.bootstrap_status = 'complete'
      on conflict (provider_message_id) do nothing;

      get diagnostics v_openai_queued = row_count;
    exception when others then
      v_openai_queued := 0;
    end;
  end if;

  return v_result || jsonb_build_object(
    'channel', 'whatsapp',
    'openai_sync_queued', v_openai_queued > 0
  );
end;
$$;

revoke all on function public.ingest_whatsapp_inbound_atomic(
  text, text, text, text, text, text, text, text,
  text, text, text, text, text, boolean
) from public, anon, authenticated;

grant execute on function public.ingest_whatsapp_inbound_atomic(
  text, text, text, text, text, text, text, text,
  text, text, text, text, text, boolean
) to service_role;
