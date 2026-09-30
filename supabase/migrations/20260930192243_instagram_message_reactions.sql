-- Capture Instagram message reactions without treating them as normal chat messages.
-- Stores the latest reaction from the other participant on the target message and
-- exposes an atomic, service-role-only mutation used by the Meta webhook.

alter table public.instagram_messages
  add column if not exists reaction_emoji text,
  add column if not exists reaction_sender_id text,
  add column if not exists reaction_at timestamptz;

comment on column public.instagram_messages.reaction_emoji is
  'Latest Instagram reaction emoji currently applied to this message by the conversation participant.';
comment on column public.instagram_messages.reaction_sender_id is
  'Instagram-scoped sender id that applied the latest reaction.';
comment on column public.instagram_messages.reaction_at is
  'Timestamp of the latest react/unreact event applied to this message.';

create index if not exists instagram_messages_conversation_reaction_at_idx
  on public.instagram_messages (conversation_id, reaction_at desc)
  where reaction_emoji is not null;

create or replace function public.apply_instagram_message_reaction_atomic(
  p_message_id text,
  p_sender_id text,
  p_emoji text,
  p_action text,
  p_reacted_at timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action text := lower(coalesce(btrim(p_action), ''));
  v_message public.instagram_messages%rowtype;
  v_reacted_at timestamptz := coalesce(p_reacted_at, clock_timestamp());
  v_emoji text := nullif(btrim(p_emoji), '');
begin
  if nullif(btrim(p_message_id), '') is null then
    return jsonb_build_object('success', false, 'reason', 'missing_message_id');
  end if;

  if v_action not in ('react', 'unreact') then
    return jsonb_build_object('success', false, 'reason', 'invalid_action');
  end if;

  if v_action = 'react' and v_emoji is null then
    return jsonb_build_object('success', false, 'reason', 'missing_emoji');
  end if;

  select *
    into v_message
    from public.instagram_messages
   where id = p_message_id
   for update;

  if not found then
    return jsonb_build_object('success', false, 'reason', 'message_not_found');
  end if;

  -- This feature tracks the customer's reaction to Larissa's outbound message.
  -- Reactions made by Larissa on inbound messages stay outside this projection.
  if coalesce(v_message.is_mine, false) is not true then
    return jsonb_build_object(
      'success', true,
      'ignored', true,
      'reason', 'target_not_outbound',
      'conversation_id', v_message.conversation_id,
      'message_id', p_message_id
    );
  end if;

  if v_action = 'react' then
    update public.instagram_messages
       set reaction_emoji = v_emoji,
           reaction_sender_id = nullif(btrim(p_sender_id), ''),
           reaction_at = v_reacted_at
     where id = p_message_id;
  else
    update public.instagram_messages
       set reaction_emoji = null,
           reaction_sender_id = null,
           reaction_at = v_reacted_at
     where id = p_message_id;
  end if;

  return jsonb_build_object(
    'success', true,
    'conversation_id', v_message.conversation_id,
    'message_id', p_message_id,
    'is_mine', coalesce(v_message.is_mine, false),
    'action', v_action,
    'emoji', case when v_action = 'react' then v_emoji else null end,
    'sender_id', nullif(btrim(p_sender_id), ''),
    'reacted_at', v_reacted_at
  );
end;
$$;

revoke all on function public.apply_instagram_message_reaction_atomic(text, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.apply_instagram_message_reaction_atomic(text, text, text, text, timestamptz)
  to service_role;
