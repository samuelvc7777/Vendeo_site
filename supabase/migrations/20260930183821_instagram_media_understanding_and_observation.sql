-- Collapse the Instagram inbound hot path into one PostgreSQL transaction:
alter table public.instagram_messages
  add column if not exists image_description text,
  add column if not exists image_described_at timestamptz,
  add column if not exists image_description_error text,
  add column if not exists media_operator_observation text,
  add column if not exists media_observed_at timestamptz;

-- Re-declare inbound ingestion so media waits for its textual representation.
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

  -- Apenas texto puro entra na fila da OpenAI no hot path.
  -- Áudio espera transcrição; imagem espera Luna; vídeo espera observação humana.
  if coalesce(p_media_type, '') not in ('audio', 'image', 'video') then
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


create or replace function public.get_autopilot_inbound_job_context(
  p_conversation_id text,
  p_message_id text
) returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'config', coalesce(
      (select a.config from public.autopilot_settings a where a.id = 'global'),
      '{}'::jsonb
    ),
    'conversation', jsonb_build_object(
      'status', c.status,
      'is_restricted', c.is_restricted,
      'ai_auto_respond', c.ai_auto_respond,
      'ai_debounce_until', c.ai_debounce_until,
      'ai_debounce_started_at', c.ai_debounce_started_at,
      'stage_completed_rules', c.stage_completed_rules
    ),
    'state', jsonb_build_object(
      'is_enabled', s.is_enabled,
      'status', s.status
    ),
    'message', jsonb_build_object(
      'id', m.id,
      'text', m.text,
      'timestamp', m.timestamp,
      'created_at', m.created_at,
      'sender_id', m.sender_id,
      'is_mine', m.is_mine,
      'media_type', m.media_type,
      'media_url', m.media_url,
      'audio_transcript', m.audio_transcript,
      'image_description', m.image_description,
      'image_description_error', m.image_description_error,
      'media_operator_observation', m.media_operator_observation
    )
  )
  from public.instagram_conversations c
  join public.instagram_messages m
    on m.id = p_message_id
   and m.conversation_id = c.id
  left join public.autopilot_chat_states s
    on s.conversation_id = c.id
  where c.id = p_conversation_id
  limit 1;
$$;

revoke all on function public.get_autopilot_inbound_job_context(text, text)
  from public, anon, authenticated;
grant execute on function public.get_autopilot_inbound_job_context(text, text)
  to service_role;

create or replace function public.prepare_instagram_media_observation(
  p_conversation_id text,
  p_message_id text,
  p_observation text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_media_type text;
  v_text text;
  v_kind text;
  v_enabled boolean;
  v_restricted boolean;
  v_state jsonb;
  v_queue jsonb;
  v_resume_message_id text;
begin
  if nullif(btrim(coalesce(p_observation, '')), '') is null then
    return jsonb_build_object('success', false, 'reason', 'observation_required');
  end if;

  select lower(coalesce(m.media_type, '')), coalesce(m.text, '')
    into v_media_type, v_text
    from public.instagram_messages m
   where m.id = p_message_id
     and m.conversation_id = p_conversation_id
     and coalesce(m.is_mine, false) = false
   for update;
  if not found then
    return jsonb_build_object('success', false, 'reason', 'message_not_found');
  end if;

  v_kind := case
    when v_media_type = 'video' or v_text like '[video:%' then 'video'
    when v_media_type = 'image' or v_text like '[image:%' then 'image'
    else null
  end;
  if v_kind is null then
    return jsonb_build_object('success', false, 'reason', 'message_is_not_observable_media');
  end if;

  update public.instagram_messages
     set media_operator_observation = left(btrim(p_observation), 3000),
         media_observed_at = clock_timestamp(),
         image_description_error = case when v_kind = 'image' then null else image_description_error end
   where id = p_message_id
     and conversation_id = p_conversation_id;

  select coalesce(c.ai_auto_respond, false), coalesce(c.is_restricted, false)
    into v_enabled, v_restricted
    from public.instagram_conversations c
   where c.id = p_conversation_id
   for update;

  if v_enabled and not v_restricted then
    v_state := public.set_autopilot_runtime_state_atomic(
      p_conversation_id,
      'idle',
      null,
      false,
      true
    );
    if coalesce((v_state->>'success')::boolean, false) is not true then
      return jsonb_build_object('success', false, 'reason', coalesce(v_state->>'reason', 'state_resume_failed'));
    end if;

    select m.id
      into v_resume_message_id
      from public.instagram_messages m
     where m.conversation_id = p_conversation_id
       and coalesce(m.is_mine, false) = false
     order by coalesce(m."timestamp", m.created_at) desc, m.created_at desc
     limit 1;

    v_resume_message_id := coalesce(v_resume_message_id, p_message_id);

    v_queue := public.enqueue_autopilot_inbound_job(
      p_conversation_id,
      v_resume_message_id,
      clock_timestamp()
    );
    if coalesce((v_queue->>'success')::boolean, false) is not true then
      return jsonb_build_object('success', false, 'reason', coalesce(v_queue->>'reason', 'requeue_failed'));
    end if;
  end if;

  return jsonb_build_object(
    'success', true,
    'mediaKind', v_kind,
    'queued', v_enabled and not v_restricted,
    'resumeMessageId', v_resume_message_id,
    'isEnabled', v_enabled
  );
end;
$$;

revoke all on function public.prepare_instagram_media_observation(text, text, text)
  from public, anon, authenticated;
grant execute on function public.prepare_instagram_media_observation(text, text, text)
  to service_role;
