-- RLS policies block public row access, but direct table grants should also be
-- removed so only the service role can access canonical channel identities.
REVOKE ALL ON TABLE public.conversation_channel_identities, public.conversation_channel_transfers
  FROM PUBLIC, anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.conversation_channel_identities, public.conversation_channel_transfers
  TO service_role;
