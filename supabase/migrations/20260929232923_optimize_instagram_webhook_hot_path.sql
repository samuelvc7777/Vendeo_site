-- Reduce Meta webhook DB round-trips without changing Brain behavior.
-- This migration is intentionally local-only until the staged rollout is approved.

create index if not exists idx_instagram_conversations_contact_hot
  on public.instagram_conversations (contact_id, updated_at desc)
  where contact_id is not null and left(id, 2) <> '__';

create index if not exists idx_instagram_messages_sender_hot
  on public.instagram_messages (sender_id, created_at desc, conversation_id)
  where sender_id is not null;

create index if not exists idx_instagram_messages_contact_hot
  on public.instagram_messages (contact_id, created_at desc, conversation_id)
  where contact_id is not null;

create or replace function public.resolve_instagram_conversation_id_fast(
  p_raw_contact_id text
) returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_conversation_id text;
begin
  if nullif(btrim(p_raw_contact_id), '') is null then
    return null;
  end if;
  select c.id
    into v_conversation_id
  from public.instagram_conversations c
  where c.id = p_raw_contact_id
  limit 1;

  if found then return v_conversation_id; end if;

  select c.id
    into v_conversation_id
  from public.instagram_conversations c
  where c.contact_id = p_raw_contact_id
  order by c.updated_at desc nulls last
  limit 1;

  if found then return v_conversation_id; end if;

  select m.conversation_id
    into v_conversation_id
  from public.instagram_messages m
  where m.sender_id = p_raw_contact_id
    and m.conversation_id is distinct from p_raw_contact_id
  order by m.created_at desc nulls last
  limit 1;

  if found then return v_conversation_id; end if;
  select m.conversation_id
    into v_conversation_id
  from public.instagram_messages m
  where m.contact_id = p_raw_contact_id
    and m.conversation_id is distinct from p_raw_contact_id
  order by m.created_at desc nulls last
  limit 1;

  return coalesce(v_conversation_id, p_raw_contact_id);
end;
$$;

revoke all on function public.resolve_instagram_conversation_id_fast(text)
  from public, anon, authenticated;

grant execute on function public.resolve_instagram_conversation_id_fast(text)
  to service_role;
