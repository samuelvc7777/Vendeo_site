-- Expande a capacidade do Brain de 3 para 6 slots simultâneos.
-- A tabela brain_execution_slots já tinha 6 linhas, mas a função
-- claim_brain_execution_slot limitava a slot_no <= 3, deixando 3 slots
-- permanentemente inutilizados. Quando várias conversas chegavam ao mesmo
-- tempo, as excedentes ficavam presas em "Aguardando vaga no Brain..."
-- retryando a cada 5s sem nunca conseguir slot se os ciclos ativos demorassem.
--
-- Com 6 slots, a concorrência dobra e o gargalo de capacidade desaparece
-- na prática para o volume atual de conversas ativas.

CREATE OR REPLACE FUNCTION public.claim_brain_execution_slot(
  p_conversation_id text,
  p_cycle_token text,
  p_lease_seconds integer DEFAULT 600
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
     where slot_no <= 6
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
   where slot_no <= 6
     and leased_until > clock_timestamp();

  select count(*)::integer into v_capacity
    from public.brain_execution_slots
   where slot_no <= 6;

  return jsonb_build_object(
    'success', true,
    'acquired', false,
    'reason', 'capacity_busy',
    'active', coalesce(v_active, 0),
    'capacity', coalesce(v_capacity, 6)
  );
end;
$function$;