-- Adiciona suporte a visualização única (view once) para imagens no cofre
ALTER TABLE persona_images ADD COLUMN IF NOT EXISTS is_view_once BOOLEAN DEFAULT FALSE;
COMMENT ON COLUMN persona_images.is_view_once IS 'Quando true, a imagem é enviada como visualização única';
