-- ==============================================================================
-- Migration: 20260920202000_security_hardening_cycle_rpcs.sql
-- Descrição: Hardening de permissões para RPCs transacionais críticas do modo experimental.
--            Revoga execução pública (anon/authenticated) e restringe exclusivamente
--            para a role service_role utilizada pelas Edge Functions do backend.
-- ==============================================================================

DO $$
BEGIN
  -- 1. claim_experimental_cycle
  REVOKE ALL ON FUNCTION claim_experimental_cycle(text, text, integer) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION claim_experimental_cycle(text, text, integer) TO service_role;

  -- 2. claim_experimental_cycle_messages
  REVOKE ALL ON FUNCTION claim_experimental_cycle_messages(text, text, text[]) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION claim_experimental_cycle_messages(text, text, text[]) TO service_role;

  -- 3. request_experimental_cycle_preemption
  REVOKE ALL ON FUNCTION request_experimental_cycle_preemption(text, text, timestamptz) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION request_experimental_cycle_preemption(text, text, timestamptz) TO service_role;

  -- 4. ack_experimental_cycle_preemption
  REVOKE ALL ON FUNCTION ack_experimental_cycle_preemption(text, text, integer) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION ack_experimental_cycle_preemption(text, text, integer) TO service_role;

  -- 5. prepare_experimental_outbox_entry
  REVOKE ALL ON FUNCTION prepare_experimental_outbox_entry(text, text, jsonb) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION prepare_experimental_outbox_entry(text, text, jsonb) TO service_role;

  -- 6. claim_outbox_entry
  REVOKE ALL ON FUNCTION claim_outbox_entry(text, text, text) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION claim_outbox_entry(text, text, text) TO service_role;

  -- 7. release_experimental_cycle_if_owned
  REVOKE ALL ON FUNCTION release_experimental_cycle_if_owned(text, text, text, timestamptz, text[], text[], text, jsonb, jsonb, boolean) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION release_experimental_cycle_if_owned(text, text, text, timestamptz, text[], text[], text, jsonb, jsonb, boolean) TO service_role;

  -- 8. commit_experimental_cycle_if_owned
  REVOKE ALL ON FUNCTION commit_experimental_cycle_if_owned(text, text, jsonb) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION commit_experimental_cycle_if_owned(text, text, jsonb) TO service_role;
END;
$$;
