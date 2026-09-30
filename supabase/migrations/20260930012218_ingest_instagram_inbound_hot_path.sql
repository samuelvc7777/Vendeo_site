-- Collapse the Instagram inbound hot path into one PostgreSQL transaction:
-- conversation preview + inbound ledger/message + Brain queue + profile queue.

create or replace function public.ingest_instagram_inbound_atomic(
  p_conversation_id text,
  p_raw_contact_id text,
  p_message_id text,
  p_sender_id text,
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
  v_placeholder text;
  v_username text;
  v_avatar text;
  v_result jsonb;
  v_profile_result jsonb;
  v_profile_needed boolean := false;
  v_openai_queued integer := 0;
begin
  if nullif(btrim(p_conversation_id), '') is null
     or nullif(btrim(p_raw_contact_id), '') is null
     or nullif(btrim(p_message_id), '') is null then
    raise exception 'invalid_inbound_identity' using errcode = '22023';
  end if;

  begin
    v_timestamp := nullif(btrim(p_timestamp), '')::timestamptz;
  exception when others then
    v_timestamp := clock_timestamp();
  end;
  v_timestamp := coalesce(v_timestamp, clock_timestamp());
  v_placeholder := 'ig_' || right(p_conversation_id, 6);

  insert into public.instagram_conversations (
    id,
    username,
    full_name,
    avatar,
    contact_id,
    last_message,
    last_message_preview,
    last_message_at,
    last_direction,
    last_status,
    seen_at,
    unread,
    updated_at,
    status
  ) values (
    p_conversation_id,
    v_placeholder,
    v_placeholder,
    '/images/default-avatar.svg',
    p_raw_contact_id,
    p_preview_text,
    p_preview_text,
    v_timestamp,
    'in',
    null,
    null,
    true,
    v_timestamp,
    'active'
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
        ) then 'in'
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
        ) then null
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
        ) then true
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

  v_result := public.record_and_queue_inbound_atomic(
    p_conversation_id,
    p_message_id,
    p_raw_contact_id,
    p_sender_id,
    p_text,
    p_timestamp,
    p_media_url,
    p_media_type,
    p_reply_to_message_id,
    p_audio_transcript,
    p_audio_transcription_error,
    p_actionable
  );

  if coalesce((v_result->>'success')::boolean, false) is not true then
    raise exception 'inbound_record_failed: %', coalesce(v_result->>'reason', 'unknown')
      using errcode = 'P0001';
  end if;

  -- Texto/imagem podem entrar na fila da OpenAI na mesma transação.
  -- Áudio espera o worker persistir/transcrever antes de ser sincronizado.
  if coalesce(p_media_type, '') <> 'audio' then
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
        'inbound',
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
  end if;

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

  return v_result || jsonb_build_object(
    'profile_needed', v_profile_needed,
    'profile_queued', coalesce((v_profile_result->>'success')::boolean, false),
    'openai_sync_queued', v_openai_queued > 0
  );
end;
$$;

revoke all on function public.ingest_instagram_inbound_atomic(
  text, text, text, text, text, text, text,
  text, text, text, text, text, boolean
) from public, anon, authenticated;

grant execute on function public.ingest_instagram_inbound_atomic(
  text, text, text, text, text, text, text,
  text, text, text, text, text, boolean
) to service_role;
