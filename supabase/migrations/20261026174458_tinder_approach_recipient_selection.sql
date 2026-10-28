alter table public.tinder_ai_settings
  add column selection_revision bigint not null default 0 check (selection_revision >= 0);

create table public.tinder_approach_recipients (
  account_id text not null references public.tinder_ai_settings(account_id) on delete cascade,
  match_id text not null check (length(btrim(match_id)) between 1 and 200),
  is_authorized boolean not null default false,
  status text not null default 'pending' check (status in ('pending','running','completed','failed')),
  delivered_message_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(delivered_message_ids) = 'array'),
  authorized_at timestamptz,
  revoked_at timestamptz,
  completed_at timestamptz,
  primary key (account_id, match_id)
);
alter table public.tinder_approach_recipients enable row level security;
revoke all on public.tinder_approach_recipients from public, anon, authenticated;
grant select, insert, update, delete on public.tinder_approach_recipients to service_role;

create function public.get_tinder_approach_recipients(p_account_id text)
returns jsonb language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'success', true,
    'selectionRevision', coalesce((select selection_revision from public.tinder_ai_settings where account_id = p_account_id), 0),
    'selectedMatchIds', coalesce((select jsonb_agg(match_id order by match_id) from public.tinder_approach_recipients where account_id = p_account_id and is_authorized), '[]'::jsonb),
    'completedMatchIds', coalesce((select jsonb_agg(match_id order by match_id) from public.tinder_approach_recipients where account_id = p_account_id and status = 'completed'), '[]'::jsonb)
  );
$$;

create function public.set_tinder_approach_recipients(p_account_id text, p_match_ids text[], p_expected_revision bigint)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  v_revision bigint;
  v_ids text[];
  v_previous text[];
begin
  if p_account_id is null or btrim(p_account_id) = '' or p_match_ids is null or cardinality(p_match_ids) > 1000 or p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'Seleção inválida' using errcode = '22023';
  end if;
  if exists (select 1 from unnest(p_match_ids) id where id is null or id <> btrim(id) or length(id) not between 1 and 200) then
    raise exception 'Match inválido' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct id order by id), '{}'::text[]) into v_ids from unnest(p_match_ids) id;
  if cardinality(v_ids) <> cardinality(p_match_ids) then
    raise exception 'Matches repetidos' using errcode = '22023';
  end if;
  insert into public.tinder_ai_settings(account_id) values(p_account_id) on conflict do nothing;
  select selection_revision into v_revision from public.tinder_ai_settings where account_id = p_account_id for update;
  if v_revision <> p_expected_revision then
    return jsonb_build_object('success', false, 'code', 'TINDER_SELECTION_STALE');
  end if;
  select coalesce(array_agg(match_id order by match_id), '{}'::text[]) into v_previous
    from public.tinder_approach_recipients where account_id = p_account_id and is_authorized;
  if v_previous is distinct from v_ids then
    update public.tinder_approach_recipients set is_authorized = false, revoked_at = now()
      where account_id = p_account_id and is_authorized and not (match_id = any(v_ids));
    insert into public.tinder_approach_recipients(account_id, match_id, is_authorized, authorized_at)
      select p_account_id, id, true, now() from unnest(v_ids) id
      on conflict (account_id, match_id) do update set is_authorized = true, authorized_at = now(), revoked_at = null
      where not public.tinder_approach_recipients.is_authorized;
    -- Não modifica status, conclusão nem mensagens já entregues ao autorizar novamente.
    v_revision := v_revision + 1;
    update public.tinder_ai_settings set selection_revision = v_revision, updated_at = now() where account_id = p_account_id;
  end if;
  return jsonb_build_object('success', true, 'selectionRevision', v_revision, 'selectedMatchIds', to_jsonb(v_ids),
    'completedMatchIds', coalesce((select jsonb_agg(match_id order by match_id) from public.tinder_approach_recipients where account_id = p_account_id and status = 'completed'), '[]'::jsonb));
end;
$$;

revoke all on function public.get_tinder_approach_recipients(text) from public, anon, authenticated;
revoke all on function public.set_tinder_approach_recipients(text,text[],bigint) from public, anon, authenticated;
grant execute on function public.get_tinder_approach_recipients(text) to service_role;
grant execute on function public.set_tinder_approach_recipients(text,text[],bigint) to service_role;

create view public.tinder_approach_eligible_recipients with (security_invoker = true) as
select r.account_id, r.match_id, s.schedule_id, r.status, r.delivered_message_ids
from public.tinder_approach_recipients r
join public.tinder_ai_settings s on s.account_id = r.account_id
join public.tinder_conversation_schedules c on c.id = s.schedule_id and c.account_id = r.account_id
where r.is_authorized and s.is_enabled and r.status in ('pending','running') and c.config->>'isActive' = 'true';
revoke all on public.tinder_approach_eligible_recipients from public, anon, authenticated;
grant select on public.tinder_approach_eligible_recipients to service_role;

;
