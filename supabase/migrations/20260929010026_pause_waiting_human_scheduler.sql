-- Prevent automatic scheduler cycles while the Brain is waiting for a human answer.
create or replace function public.list_autopilot_due_work(
  p_now timestamptz default now(),
  p_limit integer default 20
) returns table(id text, stage_completed_rules jsonb)
language sql
security definer
set search_path = public
as $$
  select c.id, c.stage_completed_rules
  from public.instagram_conversations c
  where c.ai_auto_respond is true
    and left(c.id, 2) <> '__'
    and coalesce(c.stage_completed_rules->>'status', 'idle') not in (
      'waiting_human',
      'paused_manual',
      'paused_handoff',
      'paused_guardrail',
      'disabled'
    )
    and (c.ai_debounce_until is null or c.ai_debounce_until <= p_now)
    and exists (
      select 1
      from public.instagram_messages m
      where m.conversation_id = c.id
        and m.is_mine is false
        and m.created_at >= p_now - interval '48 hours'
        and coalesce(c.stage_completed_rules->'orchestration'->'messageLedger'->>m.id, 'pending') <> 'processed'
    )
    and (
      coalesce((c.stage_completed_rules->'orchestration'->>'technicalRetryCount')::int, 0) < 3
      or exists (
        select 1
        from public.instagram_messages newer
        where newer.conversation_id = c.id
          and newer.is_mine is false
          and newer.created_at >
            (c.stage_completed_rules->'orchestration'->>'technicalRetryExhaustedAt')::timestamptz
          and coalesce(c.stage_completed_rules->'orchestration'->'messageLedger'->>newer.id, 'pending') <> 'processed'
      )
    )
  order by c.ai_debounce_until asc nulls first, c.last_message_at asc nulls first
  limit greatest(1, least(coalesce(p_limit, 20), 100));
$$;

revoke all on function public.list_autopilot_due_work(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.list_autopilot_due_work(timestamptz, integer)
  to service_role;
