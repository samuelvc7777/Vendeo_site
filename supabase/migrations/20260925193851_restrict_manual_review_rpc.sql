REVOKE ALL ON FUNCTION public.mark_manual_review_inbounds_processed_atomic(text, text[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_manual_review_inbounds_processed_atomic(text, text[]) TO service_role;
