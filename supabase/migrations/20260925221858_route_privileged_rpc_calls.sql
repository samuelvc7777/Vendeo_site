-- Avalia a identidade uma vez por consulta e remove atalhos RPC do navegador.
DO $$
DECLARE
  v_table record;
BEGIN
  FOR v_table IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format(
      'ALTER POLICY vendeo_single_operator_access ON public.%I USING (lower(coalesce((select auth.jwt() ->> ''email''), '''')) = ''lariresende0679@gmail.com'') WITH CHECK (lower(coalesce((select auth.jwt() ->> ''email''), '''')) = ''lariresende0679@gmail.com'')',
      v_table.tablename
    );
  END LOOP;
END;
$$;

DROP FUNCTION IF EXISTS public.patch_chat_progress_atomic_authorized(text, jsonb);
DROP FUNCTION IF EXISTS public.patch_autopilot_pause_atomic_authorized(text, boolean);

REVOKE EXECUTE ON FUNCTION public.patch_chat_progress_atomic(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.patch_autopilot_pause_atomic(text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.patch_chat_progress_atomic(text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.patch_autopilot_pause_atomic(text, boolean) TO service_role;
