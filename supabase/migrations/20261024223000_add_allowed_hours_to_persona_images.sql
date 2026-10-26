-- Migration: Suporte a janela de horários permitidos para envio de fotos no Cofre da Larissa
ALTER TABLE public.persona_images
  ADD COLUMN IF NOT EXISTS allowed_time_start TEXT,
  ADD COLUMN IF NOT EXISTS allowed_time_end TEXT;

COMMENT ON COLUMN public.persona_images.allowed_time_start IS 'Horário de início permitido para envio da foto (ex: 12:00) em America/Sao_Paulo';
COMMENT ON COLUMN public.persona_images.allowed_time_end IS 'Horário de término permitido para envio da foto (ex: 17:00) em America/Sao_Paulo';
