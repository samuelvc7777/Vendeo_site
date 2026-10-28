ALTER TABLE public.instagram_conversations
ADD COLUMN IF NOT EXISTS auto_close_test_enabled BOOLEAN DEFAULT FALSE;

COMMENT ON COLUMN public.instagram_conversations.auto_close_test_enabled IS
'Flag de teste temporária: quando TRUE, permite que a IA finalize a venda sozinha usando o cofre de reações.';;
