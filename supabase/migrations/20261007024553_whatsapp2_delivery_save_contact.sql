-- Persist address-book work separately from delivery outcome.
-- A confirmed message must stay confirmed if saving the contact fails.

ALTER TABLE public.whatsapp2_delivery_queue
  ADD COLUMN IF NOT EXISTS save_recipient_contact boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS recipient_contact_name text,
  ADD COLUMN IF NOT EXISTS recipient_contact_save_status text NOT NULL DEFAULT 'not_requested',
  ADD COLUMN IF NOT EXISTS recipient_contact_save_error text,
  ADD COLUMN IF NOT EXISTS recipient_contact_saved_at timestamptz;

ALTER TABLE public.whatsapp2_delivery_queue
  DROP CONSTRAINT IF EXISTS whatsapp2_delivery_queue_contact_save_status_check;

ALTER TABLE public.whatsapp2_delivery_queue
  ADD CONSTRAINT whatsapp2_delivery_queue_contact_save_status_check
  CHECK (recipient_contact_save_status IN ('not_requested', 'not_sent', 'pending', 'saved', 'failed'));
