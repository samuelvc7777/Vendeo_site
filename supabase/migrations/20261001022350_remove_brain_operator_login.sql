-- Remove the obsolete operator login/session boundary.
-- The Vendeo UI is intentionally public. Browser-origin requests from the
-- published Vendeo site are authorized by origin checks in the Edge API.

drop function if exists public.consume_brain_operator_login_attempt(text, timestamptz, integer, integer);
drop function if exists public.clear_brain_operator_login_attempts(text);
drop table if exists public.brain_operator_login_limits;
