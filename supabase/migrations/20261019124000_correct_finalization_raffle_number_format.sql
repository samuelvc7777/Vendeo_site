-- Nas rifas de 100 números, formatar 01 a 99 com dois dígitos; 100 permanece 100.
create or replace function public.format_available_raffle_numbers_for_finalization()
returns text language plpgsql security definer set search_path=''
as $raffle$
declare
  v_raffle jsonb;
  v_tickets jsonb;
  v_total integer;
  v_count integer;
  v_text text;
begin
  select r.item,coalesce(c.stage_completed_rules->'tickets'->(r.item->>'id'),'[]'::jsonb)
    into v_raffle,v_tickets
  from public.instagram_conversations c,
       lateral jsonb_array_elements(coalesce(c.stage_completed_rules->'raffles','[]'::jsonb)) r(item)
  where c.id='__raffle_data__'
    and r.item->>'status'='active'
    and (r.item->>'endDate')::timestamptz > clock_timestamp()
  order by (r.item->>'createdAt')::timestamptz desc
  limit 1;

  if v_raffle is null then
    raise exception 'Não há uma rifa ativa com data válida para oferecer números.';
  end if;
  v_total := (v_raffle->>'totalNumbers')::integer;
  if v_total < 10 or v_total > 10000 then
    raise exception 'A rifa ativa não tem uma quantidade válida de números.';
  end if;

  with available as (
    select n from generate_series(1,v_total) as n
    where not exists (
      select 1 from jsonb_array_elements(v_tickets) ticket
      where ticket->>'status' in ('reserved','paid')
        and ticket->>'number' ~ '^[0-9]+$'
        and (ticket->>'number')::int = n
    )
  ), picked as (
    select n from available order by random() limit 10
  )
  select count(*)::integer,
         string_agg(lpad(n::text,greatest(2,length((v_total-1)::text)),'0'),', ' order by n)
    into v_count,v_text from picked;

  if v_count <> 10 then
    raise exception 'A rifa ativa tem menos de 10 números livres; finalização não programada.';
  end if;
  return v_text;
end;
$raffle$;
revoke all on function public.format_available_raffle_numbers_for_finalization() from public,anon,authenticated;
grant execute on function public.format_available_raffle_numbers_for_finalization() to service_role;
