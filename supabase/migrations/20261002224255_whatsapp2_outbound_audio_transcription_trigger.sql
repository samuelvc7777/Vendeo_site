create or replace function public.enqueue_whatsapp2_outbound_audio_transcription()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.channel <> 'whatsapp2'
     or new.media_type <> 'audio'
     or new.direction <> 'out'
     or coalesce(new.is_mine, false) is not true
     or nullif(btrim(coalesce(new.media_url, '')), '') is null
     or nullif(btrim(coalesce(new.audio_transcript, '')), '') is not null then
    return new;
  end if;

  insert into public.whatsapp2_transcription_jobs (
    message_id, conversation_id, media_url, release_brain,
    status, due_at, attempt_count, max_attempts, created_at, updated_at
  ) values (
    new.id, new.conversation_id, new.media_url, false,
    'pending', clock_timestamp(), 0, 5, clock_timestamp(), clock_timestamp()
  )
  on conflict (message_id) do update
  set conversation_id = excluded.conversation_id,
      media_url = excluded.media_url,
      release_brain = false,
      updated_at = clock_timestamp()
  where public.whatsapp2_transcription_jobs.status not in ('completed', 'failed');

  return new;
end;
$$;

revoke all on function public.enqueue_whatsapp2_outbound_audio_transcription()
  from public, anon, authenticated;
grant execute on function public.enqueue_whatsapp2_outbound_audio_transcription()
  to service_role;

drop trigger if exists trg_whatsapp2_outbound_audio_transcription
  on public.instagram_messages;

create trigger trg_whatsapp2_outbound_audio_transcription
after insert or update of media_url, media_type, direction, is_mine, audio_transcript
on public.instagram_messages
for each row
execute function public.enqueue_whatsapp2_outbound_audio_transcription();

insert into public.whatsapp2_transcription_jobs (
  message_id, conversation_id, media_url, release_brain,
  status, due_at, attempt_count, max_attempts, created_at, updated_at
)
select
  m.id, m.conversation_id, m.media_url, false,
  'pending', clock_timestamp(), 0, 5, clock_timestamp(), clock_timestamp()
from public.instagram_messages m
where m.channel='whatsapp2'
  and m.media_type='audio'
  and m.direction='out'
  and coalesce(m.is_mine,false)=true
  and nullif(btrim(coalesce(m.media_url,'')), '') is not null
  and nullif(btrim(coalesce(m.audio_transcript,'')), '') is null
on conflict (message_id) do nothing;
