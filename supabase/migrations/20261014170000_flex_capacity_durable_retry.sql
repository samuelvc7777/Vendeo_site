-- Flex 429 is capacity pressure, not a semantic Brain failure.
-- Reuse the canonical release RPC under the same row lock and transaction:
-- idempotency/possible-send safeguards remain authoritative.
create or replace function public.release_flex_capacity_cycle_if_owned(
  p_conversation_id text,
  p_cycle_token text,
  p_debounce_until timestamptz,
  p_revert_message_ids text[] default null,
  p_mark_processed_ids text[] default null,
  p_last_error text default null,
  p_cycle_record jsonb default null,
  p_outbox_map jsonb default null
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_rules jsonb;
  v_old_technical int := 0;
  v_old_exhausted jsonb;
  v_flex_attempt int;
  v_delay_seconds int;
  v_retry_at timestamptz;
  v_release jsonb;
  v_orch jsonb;
begin
  select c.stage_completed_rules into v_rules
  from public.instagram_conversations c
  where c.id=p_conversation_id and c.ai_auto_respond is true
  for update;

  if not found then return jsonb_build_object('released',false,'reason','conversation_not_enabled'); end if;
  if v_rules->>'active_cycle_token' is distinct from p_cycle_token then
    return jsonb_build_object('released',false,'reason','token_mismatch');
  end if;
  if p_debounce_until is null or coalesce(p_last_error,'') !~* '429[^\n]*Flex processing is temporarily unavailable' then
    return jsonb_build_object('released',false,'reason','not_flex_capacity_failure');
  end if;

  v_orch := coalesce(v_rules->'orchestration','{}'::jsonb);
  v_old_technical := coalesce((v_orch->>'technicalRetryCount')::int,0);
  v_old_exhausted := coalesce(v_orch->'technicalRetryExhaustedAt','null'::jsonb);
  v_flex_attempt := greatest(0,coalesce((v_orch->>'flexCapacityRetryCount')::int,0)) + 1;

  -- Atomic delegate: preserves the existing outbox and claimed-message protections.
  v_release := public.release_experimental_cycle_if_owned(
    p_conversation_id, p_cycle_token, 'failed', p_debounce_until,
    p_revert_message_ids, p_mark_processed_ids, p_last_error,
    p_cycle_record, p_outbox_map, false
  );
  if v_release->>'released' is distinct from 'true' then return v_release; end if;
  if coalesce((v_release->>'possibleSend')::boolean,false) then return v_release; end if;

  select c.stage_completed_rules into v_rules
  from public.instagram_conversations c where c.id=p_conversation_id for update;
  v_orch := coalesce(v_rules->'orchestration','{}'::jsonb);
  v_orch := jsonb_set(v_orch,'{flexCapacityRetryCount}',to_jsonb(v_flex_attempt),true);
  if v_flex_attempt >= 9 then
    -- Bounded recovery: after roughly 75 min, require a fresh inbound/manual retry.
    v_orch := jsonb_set(v_orch,'{technicalRetryCount}','3'::jsonb,true);
    v_orch := jsonb_set(v_orch,'{technicalRetryExhaustedAt}',to_jsonb(now()::text),true);
    v_orch := jsonb_set(v_orch,'{flexCapacityRetryUntil}','null'::jsonb,true);
    v_rules := jsonb_set(v_rules,'{orchestration}',v_orch,true);
    update public.instagram_conversations
      set stage_completed_rules=v_rules,ai_debounce_until=null
      where id=p_conversation_id;
    return v_release || jsonb_build_object(
      'retryCount',3,'retryExhausted',true,
      'flexRetryScheduled',false,'flexAttempt',v_flex_attempt
    );
  end if;

  v_delay_seconds := least(900,(60*power(2,least(v_flex_attempt-1,4)))::int)
    + floor(random()*21)::int;
  v_retry_at := greatest(now()+make_interval(secs=>v_delay_seconds),p_debounce_until);
  v_orch := jsonb_set(v_orch,'{technicalRetryCount}',to_jsonb(v_old_technical),true);
  v_orch := jsonb_set(v_orch,'{technicalRetryExhaustedAt}',v_old_exhausted,true);
  v_orch := jsonb_set(v_orch,'{flexCapacityRetryUntil}',to_jsonb(v_retry_at::text),true);
  v_rules := jsonb_set(v_rules,'{orchestration}',v_orch,true);

  update public.instagram_conversations
    set stage_completed_rules=v_rules,
        ai_debounce_until=v_retry_at
    where id=p_conversation_id;
  return v_release || jsonb_build_object(
    'retryCount',v_old_technical,'retryExhausted',false,
    'flexRetryScheduled',true,'flexAttempt',v_flex_attempt,
    'flexRetryAt',v_retry_at
  );
end;
$$;

revoke all on function public.release_flex_capacity_cycle_if_owned(
  text,text,timestamptz,text[],text[],text,jsonb,jsonb
) from public,anon,authenticated;
grant execute on function public.release_flex_capacity_cycle_if_owned(
  text,text,timestamptz,text[],text[],text,jsonb,jsonb
) to service_role;

-- Completing a decision starts a new future capacity-retry window.
-- Patch only the exact canonical commit function contract, fail closed on drift.
do $patch$
declare
 v_ddl text;
 v_old text := '  v_final_rules := jsonb_set(v_final_rules, ''{preempt_requested}'', ''false''::jsonb);';
 v_new text := v_old || E'\n' ||
   '  v_final_rules := jsonb_set(v_final_rules, ''{orchestration}'', ' ||
   'coalesce(v_final_rules->''orchestration'', ''{}''::jsonb) ' ||
   '- ''flexCapacityRetryCount'' - ''flexCapacityRetryUntil'', true);';
begin
 v_ddl := pg_get_functiondef('public.commit_experimental_cycle_if_owned(text,text,jsonb)'::regprocedure);
 if position(v_old in v_ddl)=0 or position('flexCapacityRetryCount' in v_ddl)>0 then
  raise exception 'commit_cycle_flex_patch_contract_mismatch';
 end if;
 execute replace(v_ddl,v_old,v_new);
end;
$patch$;
