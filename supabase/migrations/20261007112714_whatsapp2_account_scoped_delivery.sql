-- Separa a fila de envio para que cada instância entregue apenas mensagens
-- da sessão WhatsApp à qual a conversa pertence.
ALTER TABLE public.whatsapp2_delivery_queue
  ADD COLUMN IF NOT EXISTS gateway_account_id text NOT NULL DEFAULT 'primary';

CREATE INDEX IF NOT EXISTS idx_whatsapp2_delivery_queue_account_due
  ON public.whatsapp2_delivery_queue (gateway_account_id, status, created_at)
  WHERE status IN ('pending', 'sending');

DROP FUNCTION IF EXISTS public.claim_whatsapp2_delivery_batch(text, integer, integer);

CREATE FUNCTION public.claim_whatsapp2_delivery_batch(
  p_worker_id text,
  p_limit integer DEFAULT 5,
  p_stale_after_seconds integer DEFAULT 90,
  p_gateway_account_id text DEFAULT 'primary'
) RETURNS SETOF public.whatsapp2_delivery_queue
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  WITH candidates AS (
    SELECT q.id
    FROM public.whatsapp2_delivery_queue q
    WHERE q.gateway_account_id = COALESCE(NULLIF(btrim(p_gateway_account_id), ''), 'primary')
      AND (
        q.status = 'pending'
        OR (
          q.status = 'sending'
          AND q.claimed_at < clock_timestamp() - make_interval(secs => greatest(10, p_stale_after_seconds))
        )
      )
    ORDER BY q.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT greatest(1, least(coalesce(p_limit, 5), 25))
  ),
  updated AS (
    UPDATE public.whatsapp2_delivery_queue q
    SET status = 'sending',
        claimed_by = nullif(btrim(p_worker_id), ''),
        claimed_at = clock_timestamp(),
        attempts = q.attempts + 1,
        last_error = NULL,
        updated_at = clock_timestamp()
    FROM candidates c
    WHERE q.id = c.id
    RETURNING q.*
  )
  SELECT * FROM updated;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_whatsapp2_delivery_batch(text, integer, integer, text)
  FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_whatsapp2_delivery_batch(text, integer, integer, text)
  TO service_role;
