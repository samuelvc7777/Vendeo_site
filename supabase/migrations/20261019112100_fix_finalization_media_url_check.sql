alter table public.whatsapp_finalization_vault_items
  drop constraint if exists whatsapp_finalization_valid_item;
alter table public.whatsapp_finalization_vault_items
  add constraint whatsapp_finalization_valid_item check (
    (kind = 'text' and length(btrim(coalesce(body,''))) between 1 and 4000 and media_url is null)
    or (kind in ('audio','image') and media_url ~ '^https://[^[:space:]]+$' and length(media_url) <= 2000)
  );