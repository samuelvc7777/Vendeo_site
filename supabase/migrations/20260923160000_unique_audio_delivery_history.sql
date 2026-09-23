-- Migration local: Unicidade e proteção de concorrência com claim atômico pré-dispatch em audio_delivery_history
-- Garante que o mesmo áudio nunca seja entregue mais de uma vez para a mesma conversa,
-- prevenindo race conditions entre workers simultâneos ANTES do envio real para a Meta.

-- 1. Evolução do esquema da tabela audio_delivery_history
ALTER TABLE public.audio_delivery_history ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'sent';
ALTER TABLE public.audio_delivery_history ADD COLUMN IF NOT EXISTS cycle_id TEXT NULL;
ALTER TABLE public.audio_delivery_history ADD COLUMN IF NOT EXISTS action_index INT NULL DEFAULT 0;
ALTER TABLE public.audio_delivery_history ADD COLUMN IF NOT EXISTS reservation_token TEXT NULL;
ALTER TABLE public.audio_delivery_history ADD COLUMN IF NOT EXISTS reserved_at TIMESTAMPTZ NULL;
ALTER TABLE public.audio_delivery_history ADD COLUMN IF NOT EXISTS last_error TEXT NULL;

-- 2. Índice único em (conversation_id, audio_id)
CREATE UNIQUE INDEX IF NOT EXISTS idx_audio_delivery_history_conversation_audio
  ON public.audio_delivery_history (conversation_id, audio_id);

-- 3. RPC Atômica para RESERVA / CLAIM PRÉ-DISPATCH
CREATE OR REPLACE FUNCTION public.claim_audio_delivery_reservation(
  p_conversation_id text,
  p_audio_id text,
  p_cycle_id text,
  p_reservation_token text,
  p_action_index int DEFAULT 0,
  p_stale_seconds int DEFAULT 60
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_existing RECORD;
  v_new_id text;
  v_now timestamptz := now();
BEGIN
  -- 1. Verifica se já existe registro para esta conversa e áudio
  SELECT id, status, cycle_id, reservation_token, reserved_at, sent_at
  INTO v_existing
  FROM public.audio_delivery_history
  WHERE conversation_id = p_conversation_id AND audio_id = p_audio_id
  FOR UPDATE;

  IF FOUND THEN
    -- Já enviado com sucesso: fail-closed permanente
    IF v_existing.status = 'sent' THEN
      RETURN jsonb_build_object(
        'claimed', false,
        'reason', 'already_delivered',
        'status', 'sent',
        'message', 'Áudio já entregue com sucesso nesta conversa.'
      );
    END IF;

    -- Despacho incerto: fail-closed
    IF v_existing.status = 'dispatch_uncertain' THEN
      RETURN jsonb_build_object(
        'claimed', false,
        'reason', 'dispatch_uncertain',
        'status', 'dispatch_uncertain',
        'message', 'Entrega anterior com status incerto na Meta. Bloqueado por segurança.'
      );
    END IF;

    -- Em processo de despacho para Meta: nunca conceder a outro worker
    IF v_existing.status = 'dispatching' THEN
      RETURN jsonb_build_object(
        'claimed', false,
        'reason', 'already_dispatching',
        'status', 'dispatching',
        'message', 'Áudio já está em processo de envio para a Meta por outro worker.'
      );
    END IF;

    -- Se estiver 'reserved':
    IF v_existing.status = 'reserved' THEN
      -- Se for o MESMO ciclo e token: idempotência segura
      IF v_existing.cycle_id = p_cycle_id AND v_existing.reservation_token = p_reservation_token THEN
        RETURN jsonb_build_object(
          'claimed', true,
          'reason', 'idempotent_reclaim',
          'id', v_existing.id,
          'status', 'reserved'
        );
      END IF;

      -- Se pertencer a outro ciclo, checa se está expirado (stale) e nunca iniciou dispatch
      IF v_existing.reserved_at < (v_now - (p_stale_seconds || ' seconds')::interval) THEN
        UPDATE public.audio_delivery_history
        SET status = 'reserved',
            cycle_id = p_cycle_id,
            reservation_token = p_reservation_token,
            action_index = p_action_index,
            reserved_at = v_now,
            last_error = 'stale_reservation_reclaimed'
        WHERE id = v_existing.id;

        RETURN jsonb_build_object(
          'claimed', true,
          'reason', 'stale_reservation_recovered',
          'id', v_existing.id,
          'status', 'reserved'
        );
      END IF;

      -- Reserva ativa recente de outro worker: colisão
      RETURN jsonb_build_object(
        'claimed', false,
        'reason', 'already_reserved',
        'status', 'reserved',
        'message', 'Áudio reservado por outro worker recente.'
      );
    END IF;

    -- Se estiver 'failed_safe' (comprovadamente cancelado pré-dispatch): permite nova reserva
    IF v_existing.status = 'failed_safe' THEN
      UPDATE public.audio_delivery_history
      SET status = 'reserved',
          cycle_id = p_cycle_id,
          reservation_token = p_reservation_token,
          action_index = p_action_index,
          reserved_at = v_now,
          last_error = NULL
      WHERE id = v_existing.id;

      RETURN jsonb_build_object(
        'claimed', true,
        'reason', 'failed_safe_reclaimed',
        'id', v_existing.id,
        'status', 'reserved'
      );
    END IF;
  END IF;

  -- 2. Não existe registro: tenta criar nova reserva atômica
  v_new_id := 'adh_' || floor(extract(epoch from v_now) * 1000)::text || '_' || substr(md5(random()::text), 1, 6);

  BEGIN
    INSERT INTO public.audio_delivery_history (
      id,
      conversation_id,
      audio_id,
      status,
      cycle_id,
      reservation_token,
      action_index,
      reserved_at
    ) VALUES (
      v_new_id,
      p_conversation_id,
      p_audio_id,
      'reserved',
      p_cycle_id,
      p_reservation_token,
      p_action_index,
      v_now
    );

    RETURN jsonb_build_object(
      'claimed', true,
      'reason', 'reserved',
      'id', v_new_id,
      'status', 'reserved'
    );
  EXCEPTION WHEN unique_violation THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'reason', 'concurrent_audio_delivered',
      'message', 'Entrega concorrente detectada: outro worker acabou de reservar este áudio.'
    );
  END;
END;
$$;

-- 4. RPC para ATUALIZAR STATUS DA RESERVA (ex: reserved -> dispatching -> dispatch_uncertain / failed_safe)
CREATE OR REPLACE FUNCTION public.update_audio_delivery_status(
  p_conversation_id text,
  p_audio_id text,
  p_reservation_token text,
  p_status text,
  p_error text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id text;
BEGIN
  UPDATE public.audio_delivery_history
  SET status = p_status,
      last_error = COALESCE(p_error, last_error)
  WHERE conversation_id = p_conversation_id
    AND audio_id = p_audio_id
    AND reservation_token = p_reservation_token
  RETURNING id INTO v_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'reservation_not_found_or_token_mismatch');
  END IF;

  RETURN jsonb_build_object('success', true, 'status', p_status, 'id', v_id);
END;
$$;

-- 5. RPC para CONFIRMAR ENTREGA (status -> sent)
CREATE OR REPLACE FUNCTION public.commit_audio_delivery_sent(
  p_conversation_id text,
  p_audio_id text,
  p_reservation_token text,
  p_provider_message_id text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id text;
BEGIN
  UPDATE public.audio_delivery_history
  SET status = 'sent',
      sent_at = now(),
      provider_message_id = COALESCE(p_provider_message_id, provider_message_id)
  WHERE conversation_id = p_conversation_id
    AND audio_id = p_audio_id
    AND reservation_token = p_reservation_token
  RETURNING id INTO v_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'reservation_not_found_or_token_mismatch');
  END IF;

  RETURN jsonb_build_object('success', true, 'status', 'sent', 'id', v_id);
END;
$$;

-- 6. RPC para LIBERAR RESERVA PRÉ-DISPATCH EM CASO DE ERRO DETERMINÍSTICO SEGURO
CREATE OR REPLACE FUNCTION public.release_audio_delivery_reservation(
  p_conversation_id text,
  p_audio_id text,
  p_reservation_token text,
  p_reason text DEFAULT 'cancelled_pre_dispatch'
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Só libera se ainda estiver em 'reserved' (comprovadamente NUNCA iniciou dispatch para Meta)
  DELETE FROM public.audio_delivery_history
  WHERE conversation_id = p_conversation_id
    AND audio_id = p_audio_id
    AND reservation_token = p_reservation_token
    AND status = 'reserved';

  IF FOUND THEN
    RETURN jsonb_build_object('success', true, 'released', true, 'reason', p_reason);
  ELSE
    RETURN jsonb_build_object('success', false, 'released', false, 'reason', 'not_found_or_not_reserved');
  END IF;
END;
$$;

-- 7. RPC de compatibilidade retroativa
CREATE OR REPLACE FUNCTION public.claim_or_record_audio_delivery(
  p_conversation_id text,
  p_audio_id text,
  p_provider_message_id text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_res jsonb;
  v_token text := 'adh_legacy_' || floor(extract(epoch from now()) * 1000)::text;
BEGIN
  v_res := public.claim_audio_delivery_reservation(
    p_conversation_id,
    p_audio_id,
    v_token,
    v_token,
    0,
    60
  );

  IF (v_res->>'claimed')::boolean = true THEN
    PERFORM public.commit_audio_delivery_sent(
      p_conversation_id,
      p_audio_id,
      v_token,
      p_provider_message_id
    );
    RETURN jsonb_build_object('success', true, 'reason', 'recorded', 'id', v_res->>'id');
  ELSE
    RETURN jsonb_build_object('success', false, 'reason', v_res->>'reason');
  END IF;
END;
$$;

-- Permissões de Segurança
REVOKE ALL ON FUNCTION public.claim_audio_delivery_reservation(text, text, text, text, int, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_audio_delivery_reservation(text, text, text, text, int, int) TO service_role;

REVOKE ALL ON FUNCTION public.update_audio_delivery_status(text, text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_audio_delivery_status(text, text, text, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.commit_audio_delivery_sent(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.commit_audio_delivery_sent(text, text, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.release_audio_delivery_reservation(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.release_audio_delivery_reservation(text, text, text, text) TO service_role;

REVOKE ALL ON FUNCTION public.claim_or_record_audio_delivery(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_or_record_audio_delivery(text, text, text) TO service_role;
