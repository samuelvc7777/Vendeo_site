-- Preserva o contrato atual e acrescenta a origem factual da mensagem.
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
      'channel', c.channel,
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
      'channel', m.channel,
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

;
