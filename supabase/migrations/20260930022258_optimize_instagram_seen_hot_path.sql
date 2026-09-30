-- Collapse Instagram read receipt handling into one transaction and
-- avoid rewriting rows that are already at the same/newer seen watermark.

create or replace function public.mark_instagram_seen_atomic(
  p_raw_contact_id text,
  p_seen_at timestamptz
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conversation_id text;
  v_seen_at timestamptz := coalesce(p_seen_at, clock_timestamp());
  v_conversation_updated integer := 0;
  v_messages_updated integer := 0;
begin
  if nullif(btrim(p_raw_contact_id), '') is null then
    return jsonb_build_object('success', false, 'reason', 'missing_contact_id');
  end if;

  v_conversation_id := public.resolve_instagram_conversation_id_fast(p_raw_contact_id);

  if nullif(btrim(v_conversation_id), '') is null then
    return jsonb_build_object('success', false, 'reason', 'conversation_not_resolved');
  end if;

  update public.instagram_conversations c
     set last_status = 'seen',
         seen_at = greatest(coalesce(c.seen_at, '-infinity'::timestamptz), v_seen_at),
         updated_at = clock_timestamp()
   where c.id = v_conversation_id
     and (
       c.last_status is distinct from 'seen'
       or c.seen_at is null
       or c.seen_at < v_seen_at
     );

  get diagnostics v_conversation_updated = row_count;

  update public.instagram_messages m
     set status = 'seen',
         seen_at = greatest(coalesce(m.seen_at, '-infinity'::timestamptz), v_seen_at)
   where m.conversation_id = v_conversation_id
     and m.is_mine = true
     and m.timestamp <= v_seen_at
     and (
       m.status is distinct from 'seen'
       or m.seen_at is null
       or m.seen_at < v_seen_at
     );

  get diagnostics v_messages_updated = row_count;

  return jsonb_build_object(
    'success', true,
    'conversation_id', v_conversation_id,
    'seen_at', v_seen_at,
    'conversation_updated', v_conversation_updated > 0,
    'messages_updated', v_messages_updated
  );
end;
$$;

revoke all on function public.mark_instagram_seen_atomic(text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.mark_instagram_seen_atomic(text, timestamptz)
  to service_role;
