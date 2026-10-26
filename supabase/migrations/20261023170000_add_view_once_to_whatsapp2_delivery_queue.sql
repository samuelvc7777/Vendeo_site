-- Adiciona suporte a visualização única (view once) para imagens no WhatsApp2
ALTER TABLE whatsapp2_delivery_queue ADD COLUMN IF NOT EXISTS view_once BOOLEAN DEFAULT FALSE;
COMMENT ON COLUMN whatsapp2_delivery_queue.view_once IS 'Quando true, a imagem é enviada como visualização única no WhatsApp';
