-- Restringe a API REST a uma única conta confirmada sem alterar linhas ou schema
-- de negócio. service_role continua sendo a identidade das Edge Functions.
DO $$
DECLARE
  v_table record;
  v_policy record;
BEGIN
  FOR v_policy IN
    SELECT tablename, policyname
    FROM pg_policies
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY %I ON public.%I', v_policy.policyname, v_policy.tablename);
  END LOOP;

  FOR v_table IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table.tablename);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, PUBLIC', v_table.tablename);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO authenticated', v_table.tablename);
    EXECUTE format(
      'CREATE POLICY vendeo_single_operator_access ON public.%I FOR ALL TO authenticated USING (lower(coalesce(auth.jwt() ->> ''email'', '''')) = ''lariresende0679@gmail.com'') WITH CHECK (lower(coalesce(auth.jwt() ->> ''email'', '''')) = ''lariresende0679@gmail.com'')',
      v_table.tablename
    );
  END LOOP;
END;
$$;

REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, PUBLIC;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON SEQUENCES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO authenticated;

-- SECURITY DEFINER não fica disponível a qualquer visitante autenticado.
-- O backend continua podendo executar RPCs usando service_role.
DO $$
DECLARE
  v_function record;
BEGIN
  FOR v_function IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND p.prokind = 'f'
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', v_function.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', v_function.signature);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION public.patch_chat_progress_atomic_authorized(
  p_conversation_id text,
  p_progress_patch jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF lower(coalesce(auth.jwt() ->> 'email', '')) <> 'lariresende0679@gmail.com' THEN
    RAISE EXCEPTION 'Acesso não autorizado' USING ERRCODE = '42501';
  END IF;
  RETURN public.patch_chat_progress_atomic(p_conversation_id, p_progress_patch);
END;
$$;

CREATE OR REPLACE FUNCTION public.patch_autopilot_pause_atomic_authorized(
  p_conversation_id text,
  p_paused boolean
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF lower(coalesce(auth.jwt() ->> 'email', '')) <> 'lariresende0679@gmail.com' THEN
    RAISE EXCEPTION 'Acesso não autorizado' USING ERRCODE = '42501';
  END IF;
  RETURN public.patch_autopilot_pause_atomic(p_conversation_id, p_paused);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.patch_chat_progress_atomic(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.patch_autopilot_pause_atomic(text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.patch_chat_progress_atomic(text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.patch_autopilot_pause_atomic(text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.patch_chat_progress_atomic_authorized(text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.patch_autopilot_pause_atomic_authorized(text, boolean) TO authenticated;
