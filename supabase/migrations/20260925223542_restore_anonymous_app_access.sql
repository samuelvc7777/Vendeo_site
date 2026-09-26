-- Restaura o acesso sem login que o app usava antes da restrição por e-mail.
-- RLS permanece habilitado; o papel anon recebe a política usada pelo cliente web.
DO $$
DECLARE
  v_table record;
BEGIN
  FOR v_table IN
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', v_table.tablename);
    EXECUTE format('DROP POLICY IF EXISTS vendeo_single_operator_access ON public.%I', v_table.tablename);
    EXECUTE format('DROP POLICY IF EXISTS vendeo_anon_app_access ON public.%I', v_table.tablename);
    EXECUTE format(
      'CREATE POLICY vendeo_anon_app_access ON public.%I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)',
      v_table.tablename
    );
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.%I TO anon, authenticated', v_table.tablename);
  END LOOP;
END;
$$;

GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO anon, authenticated;
