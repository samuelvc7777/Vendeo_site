-- Keep hundreds of chats enabled while protecting the small primary database.
-- Existing cycles in slots 4-6 are allowed to finish, but new claims use only slots 1-3.

create or replace function public.claim_brain_execution_slot(
  p_conversation_id text,
  p_cycle_token text,
  p_lease_seconds integer default 600
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot_no smallint;
  v_lease_token text;
  v_leased_until timestamptz;
  v_active integer;
  v_capacity integer;
begin
  if nullif(btrim(p_conversation_id), '') is null
     or nullif(btrim(p_cycle_token), '') is null then
    return jsonb_build_object('success', false, 'reason', 'invalid_slot_claim');
  end if;

  -- Preserve ownership for a cycle that was already running before the cap changed.
  select slot_no, lease_token, leased_until
    into v_slot_no, v_lease_token, v_leased_until
  from public.brain_execution_slots
  where cycle_token = p_cycle_token
    and leased_until > clock_timestamp()
  limit 1;

  if found then
    return jsonb_build_object(
      'success', true, 'acquired', true, 'slotNo', v_slot_no,
      'leaseToken', v_lease_token, 'leasedUntil', v_leased_until
    );
  end if;

  with candidate as (
    select slot_no
    from public.brain_execution_slots
    where slot_no <= 3
      and (
        lease_token is null
        or leased_until is null
        or leased_until <= clock_timestamp()
      )
    order by slot_no
    for update skip locked
    limit 1
  )
  update public.brain_execution_slots s
  set lease_token = p_cycle_token || ':' || txid_current()::text || ':' || s.slot_no::text,
      conversation_id = p_conversation_id,
      cycle_token = p_cycle_token,
      acquired_at = clock_timestamp(),
      leased_until = clock_timestamp()
        + make_interval(secs => greatest(60, least(coalesce(p_lease_seconds, 600), 900))),
      updated_at = clock_timestamp()
  from candidate c
  where s.slot_no = c.slot_no
  returning s.slot_no, s.lease_token, s.leased_until
  into v_slot_no, v_lease_token, v_leased_until;

  if found then
    return jsonb_build_object(
      'success', true, 'acquired', true, 'slotNo', v_slot_no,
      'leaseToken', v_lease_token, 'leasedUntil', v_leased_until
    );
  end if;

  select count(*)::integer into v_active
  from public.brain_execution_slots
  where slot_no <= 3
    and leased_until > clock_timestamp();

  select count(*)::integer into v_capacity
  from public.brain_execution_slots
  where slot_no <= 3;

  return jsonb_build_object(
    'success', true,
    'acquired', false,
    'reason', 'capacity_busy',
    'active', coalesce(v_active, 0),
    'capacity', coalesce(v_capacity, 3)
  );
end;
$$;

revoke all on function public.claim_brain_execution_slot(text, text, integer)
  from public, anon, authenticated;
grant execute on function public.claim_brain_execution_slot(text, text, integer)
  to service_role;
