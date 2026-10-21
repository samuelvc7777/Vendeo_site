-- Habilita uploads públicos de wallpaper no bucket instagram_media
-- Execute este script no SQL Editor do Supabase Dashboard

-- Política para permitir SELECT público (leitura)
CREATE POLICY "Permitir leitura pública de wallpapers"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'instagram_media' AND name LIKE 'wallpapers/%');

-- Política para permitir INSERT público (upload)
CREATE POLICY "Permitir upload público de wallpapers"
ON storage.objects FOR INSERT
TO public
WITH CHECK (bucket_id = 'instagram_media' AND name LIKE 'wallpapers/%');

-- Política para permitir UPDATE público (substituição)
CREATE POLICY "Permitir atualização pública de wallpapers"
ON storage.objects FOR UPDATE
TO public
USING (bucket_id = 'instagram_media' AND name LIKE 'wallpapers/%')
WITH CHECK (bucket_id = 'instagram_media' AND name LIKE 'wallpapers/%');

-- Política para permitir DELETE público (remoção)
CREATE POLICY "Permitir remoção pública de wallpapers"
ON storage.objects FOR DELETE
TO public
USING (bucket_id = 'instagram_media' AND name LIKE 'wallpapers/%');