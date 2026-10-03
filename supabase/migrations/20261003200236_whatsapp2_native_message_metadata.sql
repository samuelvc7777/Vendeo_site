-- WhatsApp 2 native message metadata (contacts, locations, polls, forwarding, links).
-- Attachment metadata remains reserved for downloadable media/files.

alter table public.whatsapp2_inbound_jobs
  add column if not exists message_metadata jsonb not null default '{}'::jsonb;

alter table public.instagram_messages
  add column if not exists message_metadata jsonb not null default '{}'::jsonb;

drop function if exists public.enqueue_whatsapp2_inbound_attachment_job(
  text, text, text, text, text, text, text, text, text, text, boolean,
  timestamptz, text, jsonb
);

create function public.enqueue_whatsapp2_inbound_attachment_job(
  p_message_id text,
  p_conversation_id text,
  p_raw_contact_id text,
  p_sender_id text default null,
  p_contact_name text default null,
  p_message_text text default '',
  p_preview_text text default 'Mensagem',
  p_timestamp text default null,
  p_media_type text default null,
  p_reply_to_message_id text default null,
  p_actionable boolean default true,
  p_due_at timestamptz default now(),
  p_provider_type text default null,
  p_attachment_metadata jsonb default '{}'::jsonb,
  p_message_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  v_result := public.enqueue_whatsapp2_inbound_job(
    p_message_id,
    p_conversation_id,
    p_raw_contact_id,
    p_sender_id,
    p_contact_name,
    p_message_text,
    p_preview_text,
    p_timestamp,
    p_media_type,
    p_reply_to_message_id,
    p_actionable,
    p_due_at
  );

  if coalesce((v_result->>'success')::boolean, false) then
    update public.whatsapp2_inbound_jobs
       set provider_type = coalesce(nullif(btrim(p_provider_type), ''), provider_type),
           attachment_metadata = case
             when coalesce(p_attachment_metadata, '{}'::jsonb) <> '{}'::jsonb
               then coalesce(attachment_metadata, '{}'::jsonb) || coalesce(p_attachment_metadata, '{}'::jsonb)
             else coalesce(attachment_metadata, '{}'::jsonb)
           end,
           message_metadata = case
             when coalesce(p_message_metadata, '{}'::jsonb) <> '{}'::jsonb
               then coalesce(message_metadata, '{}'::jsonb) || coalesce(p_message_metadata, '{}'::jsonb)
             else coalesce(message_metadata, '{}'::jsonb)
           end,
           updated_at = clock_timestamp()
     where message_id = p_message_id;
  end if;

  return v_result;
end;
$$;

revoke all on function public.enqueue_whatsapp2_inbound_attachment_job(
  text, text, text, text, text, text, text, text, text, text, boolean,
  timestamptz, text, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.enqueue_whatsapp2_inbound_attachment_job(
  text, text, text, text, text, text, text, text, text, text, boolean,
  timestamptz, text, jsonb, jsonb
) to service_role;

drop function if exists public.claim_whatsapp2_inbound_attachment_jobs(
  text, integer, integer, integer
);

create function public.claim_whatsapp2_inbound_attachment_jobs(
  p_worker_token text,
  p_limit integer default 3,
  p_lease_seconds integer default 300,
  p_global_limit integer default 3
) returns table (
  message_id text,
  conversation_id text,
  raw_contact_id text,
  sender_id text,
  contact_name text,
  message_text text,
  preview_text text,
  message_timestamp timestamptz,
  media_type text,
  provider_type text,
  attachment_metadata jsonb,
  message_metadata jsonb,
  reply_to_message_id text,
  actionable boolean,
  attempt_count integer,
  max_attempts integer
)
language sql
security definer
set search_path = public
as $$
  select
    claimed.message_id,
    claimed.conversation_id,
    claimed.raw_contact_id,
    claimed.sender_id,
    claimed.contact_name,
    claimed.message_text,
    claimed.preview_text,
    claimed.message_timestamp,
    claimed.media_type,
    job.provider_type,
    coalesce(job.attachment_metadata, '{}'::jsonb),
    coalesce(job.message_metadata, '{}'::jsonb),
    claimed.reply_to_message_id,
    claimed.actionable,
    claimed.attempt_count,
    claimed.max_attempts
  from public.claim_whatsapp2_inbound_jobs(
    p_worker_token,
    p_limit,
    p_lease_seconds,
    p_global_limit
  ) claimed
  join public.whatsapp2_inbound_jobs job
    on job.message_id = claimed.message_id;
$$;

revoke all on function public.claim_whatsapp2_inbound_attachment_jobs(
  text, integer, integer, integer
) from public, anon, authenticated;
grant execute on function public.claim_whatsapp2_inbound_attachment_jobs(
  text, integer, integer, integer
) to service_role;

drop function if exists public.ingest_whatsapp2_inbound_attachment_atomic(
  text, text, text, text, text, text, text, text, text, text, text, text,
  text, text, boolean, text, jsonb
);

create function public.ingest_whatsapp2_inbound_attachment_atomic(
  p_conversation_id text,
  p_raw_contact_id text,
  p_message_id text,
  p_sender_id text,
  p_contact_name text,
  p_text text,
  p_timestamp text,
  p_preview_text text,
  p_avatar_url text default null,
  p_media_url text default null,
  p_media_type text default null,
  p_reply_to_message_id text default null,
  p_audio_transcript text default null,
  p_audio_transcription_error text default null,
  p_actionable boolean default true,
  p_provider_type text default null,
  p_attachment_metadata jsonb default '{}'::jsonb,
  p_message_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  v_result := public.ingest_whatsapp2_inbound_atomic(
    p_conversation_id,
    p_raw_contact_id,
    p_message_id,
    p_sender_id,
    p_contact_name,
    p_text,
    p_timestamp,
    p_preview_text,
    p_avatar_url,
    p_media_url,
    p_media_type,
    p_reply_to_message_id,
    p_audio_transcript,
    p_audio_transcription_error,
    p_actionable
  );

  if coalesce((v_result->>'success')::boolean, false) then
    update public.instagram_messages
       set provider_type = coalesce(nullif(btrim(p_provider_type), ''), provider_type),
           attachment_metadata = case
             when coalesce(p_attachment_metadata, '{}'::jsonb) <> '{}'::jsonb
               then coalesce(attachment_metadata, '{}'::jsonb) || coalesce(p_attachment_metadata, '{}'::jsonb)
             else coalesce(attachment_metadata, '{}'::jsonb)
           end,
           message_metadata = case
             when coalesce(p_message_metadata, '{}'::jsonb) <> '{}'::jsonb
               then coalesce(message_metadata, '{}'::jsonb) || coalesce(p_message_metadata, '{}'::jsonb)
             else coalesce(message_metadata, '{}'::jsonb)
           end
     where id = p_message_id
       and channel = 'whatsapp2';
  end if;

  return v_result;
end;
$$;

revoke all on function public.ingest_whatsapp2_inbound_attachment_atomic(
  text, text, text, text, text, text, text, text, text, text, text, text,
  text, text, boolean, text, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.ingest_whatsapp2_inbound_attachment_atomic(
  text, text, text, text, text, text, text, text, text, text, text, text,
  text, text, boolean, text, jsonb, jsonb
) to service_role;

drop function if exists public.stage_whatsapp2_audio_inbound_attachment_atomic(
  text, text, text, text, text, text, text, text, text, text, text, boolean,
  text, jsonb
);

create function public.stage_whatsapp2_audio_inbound_attachment_atomic(
  p_conversation_id text,
  p_raw_contact_id text,
  p_message_id text,
  p_sender_id text,
  p_contact_name text,
  p_text text,
  p_timestamp text,
  p_preview_text text,
  p_avatar_url text,
  p_media_url text,
  p_reply_to_message_id text default null,
  p_actionable boolean default true,
  p_provider_type text default null,
  p_attachment_metadata jsonb default '{}'::jsonb,
  p_message_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  v_result := public.stage_whatsapp2_audio_inbound_atomic(
    p_conversation_id,
    p_raw_contact_id,
    p_message_id,
    p_sender_id,
    p_contact_name,
    p_text,
    p_timestamp,
    p_preview_text,
    p_avatar_url,
    p_media_url,
    p_reply_to_message_id,
    p_actionable
  );

  if coalesce((v_result->>'success')::boolean, false) then
    update public.instagram_messages
       set provider_type = coalesce(nullif(btrim(p_provider_type), ''), provider_type),
           attachment_metadata = case
             when coalesce(p_attachment_metadata, '{}'::jsonb) <> '{}'::jsonb
               then coalesce(attachment_metadata, '{}'::jsonb) || coalesce(p_attachment_metadata, '{}'::jsonb)
             else coalesce(attachment_metadata, '{}'::jsonb)
           end,
           message_metadata = case
             when coalesce(p_message_metadata, '{}'::jsonb) <> '{}'::jsonb
               then coalesce(message_metadata, '{}'::jsonb) || coalesce(p_message_metadata, '{}'::jsonb)
             else coalesce(message_metadata, '{}'::jsonb)
           end
     where id = p_message_id
       and channel = 'whatsapp2';
  end if;

  return v_result;
end;
$$;

revoke all on function public.stage_whatsapp2_audio_inbound_attachment_atomic(
  text, text, text, text, text, text, text, text, text, text, text, boolean,
  text, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.stage_whatsapp2_audio_inbound_attachment_atomic(
  text, text, text, text, text, text, text, text, text, text, text, boolean,
  text, jsonb, jsonb
) to service_role;

drop function if exists public.record_whatsapp2_outbound_attachment_atomic(
  text, text, text, text, text, text, text, text, text, text, text, text,
  text, jsonb
);

create function public.record_whatsapp2_outbound_attachment_atomic(
  p_conversation_id text,
  p_raw_contact_id text,
  p_message_id text,
  p_contact_name text,
  p_text text,
  p_timestamp text,
  p_preview_text text,
  p_avatar_url text default null,
  p_media_url text default null,
  p_media_type text default null,
  p_reply_to_message_id text default null,
  p_status text default 'sent',
  p_provider_type text default null,
  p_attachment_metadata jsonb default '{}'::jsonb,
  p_message_metadata jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  v_result := public.record_whatsapp2_outbound_atomic(
    p_conversation_id,
    p_raw_contact_id,
    p_message_id,
    p_contact_name,
    p_text,
    p_timestamp,
    p_preview_text,
    p_avatar_url,
    p_media_url,
    p_media_type,
    p_reply_to_message_id,
    p_status
  );

  if coalesce((v_result->>'success')::boolean, false) then
    update public.instagram_messages
       set provider_type = coalesce(nullif(btrim(p_provider_type), ''), provider_type),
           attachment_metadata = case
             when coalesce(p_attachment_metadata, '{}'::jsonb) <> '{}'::jsonb
               then coalesce(attachment_metadata, '{}'::jsonb) || coalesce(p_attachment_metadata, '{}'::jsonb)
             else coalesce(attachment_metadata, '{}'::jsonb)
           end,
           message_metadata = case
             when coalesce(p_message_metadata, '{}'::jsonb) <> '{}'::jsonb
               then coalesce(message_metadata, '{}'::jsonb) || coalesce(p_message_metadata, '{}'::jsonb)
             else coalesce(message_metadata, '{}'::jsonb)
           end
     where id = p_message_id
       and channel = 'whatsapp2';
  end if;

  return v_result;
end;
$$;

revoke all on function public.record_whatsapp2_outbound_attachment_atomic(
  text, text, text, text, text, text, text, text, text, text, text, text,
  text, jsonb, jsonb
) from public, anon, authenticated;
grant execute on function public.record_whatsapp2_outbound_attachment_atomic(
  text, text, text, text, text, text, text, text, text, text, text, text,
  text, jsonb, jsonb
) to service_role;

create or replace function public.apply_whatsapp2_poll_vote_atomic(
  p_message_id text,
  p_voter text,
  p_selected_options jsonb default '[]'::jsonb,
  p_interacted_at timestamptz default clock_timestamp()
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_poll jsonb;
begin
  if nullif(btrim(coalesce(p_message_id, '')), '') is null
     or nullif(btrim(coalesce(p_voter, '')), '') is null then
    return jsonb_build_object('success', false, 'reason', 'invalid_arguments');
  end if;

  update public.instagram_messages
     set message_metadata =
       coalesce(message_metadata, '{}'::jsonb)
       || jsonb_build_object(
            'poll',
            coalesce(message_metadata->'poll', '{}'::jsonb)
            || jsonb_build_object(
                 'votesByVoter',
                 coalesce(message_metadata->'poll'->'votesByVoter', '{}'::jsonb)
                 || jsonb_build_object(
                      p_voter,
                      jsonb_build_object(
                        'selectedOptions', coalesce(p_selected_options, '[]'::jsonb),
                        'interactedAt', p_interacted_at
                      )
                    )
               )
          )
   where id = p_message_id
     and channel = 'whatsapp2'
   returning message_metadata->'poll' into v_poll;

  if not found then
    return jsonb_build_object('success', false, 'reason', 'message_not_found');
  end if;

  return jsonb_build_object('success', true, 'poll', v_poll);
end;
$$;

revoke all on function public.apply_whatsapp2_poll_vote_atomic(
  text, text, jsonb, timestamptz
) from public, anon, authenticated;
grant execute on function public.apply_whatsapp2_poll_vote_atomic(
  text, text, jsonb, timestamptz
) to service_role;
