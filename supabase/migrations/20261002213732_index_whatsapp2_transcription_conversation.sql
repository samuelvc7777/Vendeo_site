-- Cover the WhatsApp 2 transcription queue's conversation foreign key and hot per-conversation claim path.
create index if not exists idx_whatsapp2_transcription_jobs_conversation
  on public.whatsapp2_transcription_jobs (conversation_id, due_at, created_at);
