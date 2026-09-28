-- Conversation-first runtime: OpenAI stores conversational history; Supabase keeps operational references only.
CREATE TABLE IF NOT EXISTS public.openai_conversation_links (
  conversation_id text PRIMARY KEY REFERENCES public.instagram_conversations(id) ON DELETE CASCADE,
  openai_conversation_id text NOT NULL UNIQUE,
  runtime_version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed', 'failed')),
  bootstrap_status text NOT NULL DEFAULT 'pending'
    CHECK (bootstrap_status IN ('pending', 'running', 'complete', 'failed')),
  bootstrapped_at timestamptz,
  bootstrap_message_count integer NOT NULL DEFAULT 0,
  bootstrap_last_error text,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_openai_conversation_links_status_updated
  ON public.openai_conversation_links (status, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.openai_message_receipts (
  provider_message_id text PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES public.instagram_conversations(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  openai_item_id text,
  received_at timestamptz NOT NULL DEFAULT now(),
  synced_at timestamptz,
  processed_at timestamptz,
  sync_status text NOT NULL DEFAULT 'pending'
    CHECK (sync_status IN ('pending', 'syncing', 'synced', 'failed')),
  sync_attempts integer NOT NULL DEFAULT 0,
  sync_started_at timestamptz,
  next_retry_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_openai_message_receipts_conversation
  ON public.openai_message_receipts (conversation_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_openai_message_receipts_sync_queue
  ON public.openai_message_receipts (sync_status, next_retry_at, received_at);

-- The existing brain_turns ledger remains the single operational execution ledger.
-- SDK-specific recovery data lives here instead of creating a parallel lock/lease system.
ALTER TABLE public.brain_turns
  ADD COLUMN IF NOT EXISTS runtime_metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_brain_turns_sdk_execution_key
  ON public.brain_turns ((runtime_metadata->>'executionKey'))
  WHERE runtime_metadata->>'runtime' = 'agents_sdk_conversation';
