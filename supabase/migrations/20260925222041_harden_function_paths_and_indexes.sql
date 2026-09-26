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
      'ALTER POLICY vendeo_single_operator_access ON public.%I USING (lower(coalesce((select auth.jwt()) ->> ''email'', '''')) = ''lariresende0679@gmail.com'') WITH CHECK (lower(coalesce((select auth.jwt()) ->> ''email'', '''')) = ''lariresende0679@gmail.com'')',
      v_table.tablename
    );
  END LOOP;
END;
$$;

ALTER FUNCTION public.sync_instagram_conv_compat() SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.sync_instagram_msg_compat() SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.update_persona_memory_updated_at() SET search_path = pg_catalog, public, pg_temp;
ALTER FUNCTION public.guard_stage_completed_rules_integrity() SET search_path = pg_catalog, public, pg_temp;

CREATE INDEX IF NOT EXISTS idx_contact_memory_facts_superseded_by_id
  ON public.contact_memory_facts (superseded_by_id);
CREATE INDEX IF NOT EXISTS idx_vault_items_folder_id
  ON public.vault_items (folder_id);
