-- Collapse Instagram echo persistence into one transaction:
-- conversation preview + message upsert + profile queue + OpenAI sync receipt.

create or replace function public.ingest_instagram_echo_atomic(
  p_conversation_id text,
  p_raw_contact_id text,
  p_message_id text,
  p_text text,
  p_timestamp text,
  p_preview_text text,
  p_media_url text default null,
  p_media_type text default null,
  p_reply_to_message_id text default null,
  p_audio_transcript text default null,
  p_audio_transcription_error text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_timestamp timestamptz;
  v_placeholder text;
  v_username text;
  v_avatar text;
  v_profile_needed boolean := false;
  v_profile_result jsonb;
  v_openai_queued integer := 0;
begin
  if nullif(btrim(p_conversation_id), '') is null
     or nullif(btrim(p_raw_contact_id), '') is null
     or nullif(btrim(p_message_id), '') is null then
    raise exception 'invalid_echo_identity' using errcode = '22023';
  end if;

  begin
    v_timestamp := nullif(btrim(p_timestamp), '')::timestamptz;
  exception when others then
    v_timestamp := clock_timestamp();
  end;
  v_timestamp := coalesce(v_timestamp, clock_timestamp());
  v_placeholder := 'ig_' || right(p_conversation_id, 6);

  insert into public.instagram_conversations (
    id, username, full_name, avatar, contact_id,
    last_message, last_message_preview, last_message_at,
    last_direction, last_status, seen_at, unread, updated_at, status
  ) values (
    p_conversation_id, v_placeholder, v_placeholder, '/images/default-avatar.svg',
    p_raw_contact_id, p_preview_text, p_preview_text, v_timestamp,
    'out', 'sent', null, false, v_timestamp, 'active'
  )
  on conflict (id) do update
  set contact_id = coalesce(
        nullif(public.instagram_conversations.contact_id, ''),
        excluded.contact_id
      ),
      last_message = case
        when (
          excluded.last_message_at > coalesce(
            public.instagram_conversations.last_message_at,
            '-infinity'::timestamptz
          )
          or (
            excluded.last_message_at = public.instagram_conversations.last_message_at
            and public.instagram_conversations.last_message_preview
              is distinct from excluded.last_message_preview
          )
        ) then excluded.last_message
        else public.instagram_conversations.last_message
      end,
      last_message_preview = case
        when (
          excluded.last_message_at > coalesce(
            public.instagram_conversations.last_message_at,
            '-infinity'::timestamptz
          )
          or (
            excluded.last_message_at = public.instagram_conversations.last_message_at
            and public.instagram_conversations.last_message_preview
              is distinct from excluded.last_message_preview
          )
        ) then excluded.last_message_preview
        else public.instagram_conversations.last_message_preview
      end,
      last_message_at = greatest(
        coalesce(public.instagram_conversations.last_message_at, '-infinity'::timestamptz),
        excluded.last_message_at
      ),
      last_direction = case
        when (
          excluded.last_message_at > coalesce(
            public.instagram_conversations.last_message_at,
            '-infinity'::timestamptz
          )
          or (
            excluded.last_message_at = public.instagram_conversations.last_message_at
            and public.instagram_conversations.last_message_preview
              is distinct from excluded.last_message_preview
          )
        ) then 'out'
        else public.instagram_conversations.last_direction
      end,
      last_status = case
        when (
          excluded.last_message_at > coalesce(
            public.instagram_conversations.last_message_at,
            '-infinity'::timestamptz
          )
          or (
            excluded.last_message_at = public.instagram_conversations.last_message_at
            and public.instagram_conversations.last_message_preview
              is distinct from excluded.last_message_preview
          )
        ) then 'sent'
        else public.instagram_conversations.last_status
      end,
      seen_at = case
        when (
          excluded.last_message_at > coalesce(
            public.instagram_conversations.last_message_at,
            '-infinity'::timestamptz
          )
          or (
            excluded.last_message_at = public.instagram_conversations.last_message_at
            and public.instagram_conversations.last_message_preview
              is distinct from excluded.last_message_preview
          )
        ) then null
        else public.instagram_conversations.seen_at
      end,
      unread = case
        when (
          excluded.last_message_at > coalesce(
            public.instagram_conversations.last_message_at,
            '-infinity'::timestamptz
          )
          or (
            excluded.last_message_at = public.instagram_conversations.last_message_at
            and public.instagram_conversations.last_message_preview
              is distinct from excluded.last_message_preview
          )
        ) then false
        else public.instagram_conversations.unread
      end,
      updated_at = greatest(
        coalesce(public.instagram_conversations.updated_at, '-infinity'::timestamptz),
        excluded.updated_at
      )
  returning username, avatar
       into v_username, v_avatar;

  v_profile_needed :=
    v_username is null
    or v_username like 'ig\_%' escape '\'
    or v_avatar is null
    or v_avatar = '/images/default-avatar.svg';

  insert into public.instagram_messages (
    id,
    conversation_id,
    contact_id,
    sender_id,
    text,
    timestamp,
    is_mine,
    status,
    media_url,
    media_type,
    reply_to_message_id,
    direction,
    audio_transcript,
    audio_transcribed_at,
    audio_transcription_error
  ) values (
    p_message_id,
    p_conversation_id,
    p_raw_contact_id,
    'me',
    p_text,
    v_timestamp,
    true,
    'delivered',
    p_media_url,
    p_media_type,
    p_reply_to_message_id,
    'outbound',
    p_audio_transcript,
    case when p_audio_transcript is not null then clock_timestamp() else null end,
    p_audio_transcription_error
  )
  on conflict (id) do update
  set conversation_id = excluded.conversation_id,
      contact_id = coalesce(excluded.contact_id, public.instagram_messages.contact_id),
      sender_id = 'me',
      text = excluded.text,
      timestamp = excluded.timestamp,
      is_mine = true,
      status = case
        when public.instagram_messages.status = 'seen' then 'seen'
        else 'delivered'
      end,
      media_url = coalesce(excluded.media_url, public.instagram_messages.media_url),
      media_type = coalesce(excluded.media_type, public.instagram_messages.media_type),
      reply_to_message_id = coalesce(
        excluded.reply_to_message_id,
        public.instagram_messages.reply_to_message_id
      ),
      direction = 'outbound',
      audio_transcript = coalesce(
        excluded.audio_transcript,
        public.instagram_messages.audio_transcript
      ),
      audio_transcribed_at = case
        when excluded.audio_transcript is not null then clock_timestamp()
        else public.instagram_messages.audio_transcribed_at
      end,
      audio_transcription_error = case
        when coalesce(
          excluded.audio_transcript,
          public.instagram_messages.audio_transcript
        ) is not null then null
        else excluded.audio_transcription_error
      end;

  begin
    insert into public.openai_message_receipts (
      provider_message_id,
      conversation_id,
      direction,
      received_at,
      sync_status,
      next_retry_at,
      last_error,
      updated_at
    )
    select
      p_message_id,
      p_conversation_id,
      'outbound',
      v_timestamp,
      'pending',
      null,
      null,
      clock_timestamp()
    from public.openai_conversation_links l
    where l.conversation_id = p_conversation_id
      and l.status = 'active'
      and l.bootstrap_status = 'complete'
    on conflict (provider_message_id) do nothing;

    get diagnostics v_openai_queued = row_count;
  exception when others then
    v_openai_queued := 0;
  end;

  if v_profile_needed then
    begin
      v_profile_result := public.enqueue_instagram_profile_job(
        p_conversation_id,
        p_raw_contact_id,
        p_message_id
      );
    exception when others then
      v_profile_result := jsonb_build_object(
        'success', false,
        'reason', sqlerrm
      );
    end;
  end if;

  return jsonb_build_object(
    'success', true,
    'profile_needed', v_profile_needed,
    'profile_queued', coalesce((v_profile_result->>'success')::boolean, false),
    'openai_sync_queued', v_openai_queued > 0
  );
end;
$$;

revoke all on function public.ingest_instagram_echo_atomic(
  text, text, text, text, text, text,
  text, text, text, text, text
) from public, anon, authenticated;

grant execute on function public.ingest_instagram_echo_atomic(
  text, text, text, text, text, text,
  text, text, text, text, text
) to service_role;
