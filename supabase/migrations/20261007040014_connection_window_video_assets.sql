-- Permite cadastrar vídeos como mídia temporal do arsenal e enviá-los pelo bridge WhatsApp2.

alter table public.conversation_arsenal_items
  drop constraint if exists conversation_arsenal_items_type_check;

alter table public.conversation_arsenal_items
  add constraint conversation_arsenal_items_type_check
  check (item_type in ('topic','question','story','audio','photo','video'));

alter table public.whatsapp2_delivery_queue
  drop constraint if exists whatsapp2_delivery_queue_kind_check;

alter table public.whatsapp2_delivery_queue
  add constraint whatsapp2_delivery_queue_kind_check
  check (kind in ('text','audio','image','video','sticker'));
