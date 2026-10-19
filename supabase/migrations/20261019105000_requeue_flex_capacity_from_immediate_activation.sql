-- Flex 429 recovery: ensure an immediate activation cycle has a durable retry.
-- No changes to messages, outbox, workflow, stage, or other conversations.
create or replace function public.release_flex_capacity_cycle_if_owned(
  p_conversation_id text,
  p_cycle_token text,
  p_debounce_until timestamptz,
  p_revert_message_ids text[] default null,
  p_mark_processed_ids text[] default null,
  p_last_error text default null,
  p_cycle_record jsonb default null,
  p_outbox_map jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_rules jsonb;
  v_old_technical int := 0;
  v_old_exhausted jsonb;
  v_flex_attempt int;
  v_delay_seconds int;
  v_retry_at timestamptz;
  v_release jsonb;
  v_orch jsonb;
  v_retry_message_id text;
  v_message_revision int;
  v_watermark_revision int;
  v_queued boolean := false;
  v_inserted_count bigint := 0;
begin
  select c.stage_completed_rules into v_rules
  from public.instagram_conversations c
  where c.id = p_conversation_id and c.ai_auto_respond is true
  for update;

  if not found then
    return jsonb_build_object('released', false, 'reason', 'conversation_not_enabled');
  end if;
  if v_rules->>'active_cycle_token' is distinct from p_cycle_token then
    return jsonb_build_object('released', false, 'reason', 'token_mismatch');
  end if;
  if p_debounce_until is null
     or coalesce(p_last_error, '') !~* '429[^\n]*Flex processing is temporarily unavailable' then
    return jsonb_build_object('released', false, 'reason', 'not_flex_capacity_failure');
  end if;

  v_orch := coalesce(v_rules->'orchestration', '{}'::jsonb);
  v_old_technical := coalesce((v_orch->>'technicalRetryCount')::int, 0);
  v_old_exhausted := coalesce(v_orch->'technicalRetryExhaustedAt', 'null'::jsonb);
  v_flex_attempt := greatest(0, coalesce((v_orch->>'flexCapacityRetryCount')::int, 0)) + 1;

  -- Preserve the existing claim/outbox/duplicate-send guards.
  v_release := public.release_experimental_cycle_if_owned(
    p_conversation_id, p_cycle_token, 'failed', p_debounce_until,
    p_revert_message_ids, p_mark_processed_ids, p_last_error,
    p_cycle_record, p_outbox_map, false
  );
  if v_release->>'released' is distinct from 'true' then return v_release; end if;
  if coalesce((v_release->>'possibleSend')::boolean, false) then return v_release; end if;

  select c.stage_completed_rules into v_rules
  from public.instagram_conversations c
  where c.id = p_conversation_id
  for update;
  v_orch := coalesce(v_rules->'orchestration', '{}'::jsonb);
  v_orch := jsonb_set(v_orch, '{flexCapacityRetryCount}', to_jsonb(v_flex_attempt), true);

  if v_flex_attempt >= 9 then
    -- Preserve the bounded Flex retry budget (no silent Standard fallback).
    v_orch := jsonb_set(v_orch, '{technicalRetryCount}', '3'::jsonb, true);
    v_orch := jsonb_set(v_orch, '{technicalRetryExhaustedAt}', to_jsonb(now()::text), true);
    v_orch := jsonb_set(v_orch, '{flexCapacityRetryUntil}', 'null'::jsonb, true);
    v_rules := jsonb_set(v_rules, '{orchestration}', v_orch, true);
    update public.instagram_conversations
      set stage_completed_rules = v_rules, ai_debounce_until = null
      where id = p_conversation_id;
    return v_release || jsonb_build_object(
      'retryCount', 3, 'retryExhausted', true,
      'flexRetryScheduled', false, 'flexAttempt', v_flex_attempt
    );
  end if;

  v_delay_seconds := least(900, (60 * power(2, least(v_flex_attempt - 1, 4)))::int)
    + floor(random() * 21)::int;
  v_retry_at := greatest(now() + make_interval(secs => v_delay_seconds), p_debounce_until);
  v_orch := jsonb_set(v_orch, '{technicalRetryCount}', to_jsonb(v_old_technical), true);
  v_orch := jsonb_set(v_orch, '{technicalRetryExhaustedAt}', v_old_exhausted, true);
  v_orch := jsonb_set(v_orch, '{flexCapacityRetryUntil}', to_jsonb(v_retry_at::text), true);

  -- Only recover the newest unanswered inbound that this failed cycle owned.
  -- A manual reply, a newer inbound, or an uncertain send makes it ineligible.
  select m.id into v_retry_message_id
  from public.instagram_messages m
  join public.instagram_conversations c on c.id = m.conversation_id
  where m.conversation_id = p_conversation_id
    and m.id = any(coalesce(p_revert_message_ids, array[]::text[]))
    and m.is_mine is false
    and c.ai_auto_respond is true
    and c.status = 'active'
    and c.is_restricted is distinct from true
    and v_orch->'messageLedger'->>m.id = 'pending'
    and not exists (
      select 1 from public.instagram_messages newer
      where newer.conversation_id = p_conversation_id
        and newer.id <> m.id
        and coalesce(newer.timestamp, newer.created_at) > coalesce(m.timestamp, m.created_at)
    )
    and not exists (
      select 1 from public.whatsapp2_delivery_queue q
      where q.conversation_id = p_conversation_id
        and q.status in ('pending', 'claimed', 'sending', 'uncertain', 'dispatch_uncertain')
    )
  order by coalesce(m.timestamp, m.created_at) desc
  limit 1;

  if v_retry_message_id is not null then
    begin
      v_message_revision := (v_orch->'messageInboundRevisions'->>v_retry_message_id)::int;
      v_watermark_revision := (v_orch->'activation_watermark'->>'inboundRevision')::int;
    exception when others then
      v_message_revision := null;
      v_watermark_revision := null;
    end;

    -- The immediate activation may have the same revision as its own watermark.
    -- Move the watermark only far enough for the failed message to be eligible.
    if v_message_revision is not null
       and v_watermark_revision is not null
       and v_watermark_revision >= v_message_revision then
      v_orch := jsonb_set(
        v_orch, '{activation_watermark,inboundRevision}',
        to_jsonb(greatest(v_message_revision - 1, 0)), true
      );
    end if;
  end if;

  v_rules := jsonb_set(v_rules, '{orchestration}', v_orch, true);
  update public.instagram_conversations
    set stage_completed_rules = v_rules,
        ai_debounce_until = v_retry_at
    where id = p_conversation_id;

  -- For a normal inbound worker a claimed job already exists; its worker
  -- reschedules it using its original revision. Do not modify that lease.
  -- For an immediate button activation there may be NO job at all:
  -- create one atomically, due after Flex cooldown, without a duplicate.
  if v_retry_message_id is not null then
    insert into public.autopilot_inbound_jobs
      (conversation_id, latest_message_id, due_at)
    values (p_conversation_id, v_retry_message_id, v_retry_at)
    on conflict (conversation_id) do nothing;
    get diagnostics v_inserted_count = row_count;
    v_queued := v_inserted_count > 0;
  end if;

  return v_release || jsonb_build_object(
    'retryCount', v_old_technical, 'retryExhausted', false,
    'flexRetryScheduled', true, 'flexAttempt', v_flex_attempt,
    'flexRetryAt', v_retry_at, 'durableRetryQueued', v_queued
  );
end;
$function$;
