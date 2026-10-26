-- Adiciona timestamp do último pitch de rifa e agendamento de check de ghost
ALTER TABLE public.instagram_conversations
ADD COLUMN IF NOT EXISTS last_raffle_pitch_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_conversations_ghost_scan
ON public.instagram_conversations (last_raffle_pitch_at)
WHERE last_raffle_pitch_at IS NOT NULL AND ai_auto_respond IS TRUE;

ALTER TABLE public.instagram_conversations
ADD COLUMN IF NOT EXISTS next_ghost_check_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_conversations_next_ghost_check
ON public.instagram_conversations (next_ghost_check_at)
WHERE next_ghost_check_at IS NOT NULL;

