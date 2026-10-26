-- Migration: permite re-enfileirar jobs de transcrição failed de volta para pending
-- quando a IA é ativada/reiniciada. Corrige o caso onde áudio falha na transcrição
-- (ex: Groq retorna vazio) e o job morre sem liberar o Brain, mesmo que a mensagem
-- tenha transcrição válida de outra fonte.

create or replace function public.enqueue_whatsapp2_transcription_job(
  p_message_id text,
  p_conversation_id text,
  p_media_url text,
  p_release_brain boolean default false,
  p_due_at timestamptz default now()
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.whatsapp2_transcription_jobs%rowtype;
begin
  if nullif(btrim(p_message_id), '') is null
     or nullif(btrim(p_conversation_id), '') is null
     or nullif(btrim(p_media_url), '') is null then
    return jsonb_build_object('success', false, 'reason', 'invalid_transcription_job');
  end if;

  if not exists (
    select 1
    from public.instagram_messages m
    where m.id = p_message_id
      and m.conversation_id = p_conversation_id
      and m.channel = 'whatsapp2'
      and m.media_type = 'audio'
  ) then
    return jsonb_build_object('success', false, 'reason', 'whatsapp2_audio_message_not_found');
  end if;

  insert into public.whatsapp2_transcription_jobs (
    message_id, conversation_id, media_url, release_brain, due_at
  ) values (
    p_message_id, p_conversation_id, p_media_url,
    coalesce(p_release_brain, false), coalesce(p_due_at, clock_timestamp())
  )
  on conflict (message_id) do update
  set conversation_id = excluded.conversation_id,
      media_url = excluded.media_url,
      release_brain = public.whatsapp2_transcription_jobs.release_brain
        or excluded.release_brain,
      status = case
        -- CORREÇÃO: jobs completed permanecem completed (não reprocessar).
        -- Jobs failed voltam para pending para retry automático ao ativar IA.
        when public.whatsapp2_transcription_jobs.status = 'completed'
          then 'completed'
        when public.whatsapp2_transcription_jobs.status = 'failed'
          then 'pending'
        when public.whatsapp2_transcription_jobs.status = 'processing'
         and public.whatsapp2_transcription_jobs.lease_expires_at > clock_timestamp()
          then 'processing'
        else 'pending'
      end,
      due_at = case
        when public.whatsapp2_transcription_jobs.status = 'completed'
          then public.whatsapp2_transcription_jobs.due_at
        when public.whatsapp2_transcription_jobs.status = 'failed'
          then excluded.due_at
        when public.whatsapp2_transcription_jobs.status = 'processing'
         and public.whatsapp2_transcription_jobs.lease_expires_at > clock_timestamp()
          then public.whatsapp2_transcription_jobs.due_at
        else least(public.whatsapp2_transcription_jobs.due_at, excluded.due_at)
      end,
      attempt_count = case
        when public.whatsapp2_transcription_jobs.status = 'failed'
          then 0
        else public.whatsapp2_transcription_jobs.attempt_count
      end,
      last_error = case
        when public.whatsapp2_transcription_jobs.status = 'failed'
          then null
        else public.whatsapp2_transcription_jobs.last_error
      end,
      failed_at = case
        when public.whatsapp2_transcription_jobs.status = 'failed'
          then null
        else public.whatsapp2_transcription_jobs.failed_at
      end,
      lease_token = case
        when public.whatsapp2_transcription_jobs.status = 'processing'
         and public.whatsapp2_transcription_jobs.lease_expires_at > clock_timestamp()
          then public.whatsapp2_transcription_jobs.lease_token
        else null
      end,
      lease_expires_at = case
        when public.whatsapp2_transcription_jobs.status = 'processing'
         and public.whatsapp2_transcription_jobs.lease_expires_at > clock_timestamp()
          then public.whatsapp2_transcription_jobs.lease_expires_at
        else null
      end,
      updated_at = clock_timestamp()
  returning * into v_row;

  return jsonb_build_object(
    'success', true,
    'message_id', v_row.message_id,
    'status', v_row.status,
    'release_brain', v_row.release_brain,
    'attempt_count', v_row.attempt_count,
    'terminal', v_row.status in ('completed', 'failed'),
    'retried', v_row.status = 'pending' and v_row.attempt_count = 0
  );
end;
$$;

revoke all on function public.enqueue_whatsapp2_transcription_job(
  text, text, text, boolean, timestamptz
) from public, anon, authenticated;
grant execute on function public.enqueue_whatsapp2_transcription_job(
  text, text, text, boolean, timestamptz
) to service_role;