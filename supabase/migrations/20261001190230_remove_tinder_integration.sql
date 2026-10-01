-- Remove the retired Tinder integration from the production schema.
-- The product now supports Instagram Direct only.

drop table if exists public.tinder_messages cascade;
drop table if exists public.tinder_conversations cascade;
drop table if exists public.tinder_config cascade;
drop table if exists public.tinder_sessions cascade;
