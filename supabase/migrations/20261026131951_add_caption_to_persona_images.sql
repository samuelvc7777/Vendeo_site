ALTER TABLE public.persona_images
  ADD COLUMN IF NOT EXISTS caption TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN public.persona_images.caption IS
  'Legenda opcional enviada junto da foto no WhatsApp; não é uma mensagem separada.';
;
