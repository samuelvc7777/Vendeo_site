-- =========================================================
-- ESQUEMA DO BANCO DE DADOS SUPABASE (VENDEO)
-- Execute este script no SQL Editor do seu Dashboard Supabase
-- =========================================================

-- 1. Habilita extensão para UUIDs se necessário
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Tabela de Categorias
CREATE TABLE IF NOT EXISTS public.categories (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    icon TEXT
);

-- 3. Tabela de Produtos
CREATE TABLE IF NOT EXISTS public.products (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    price NUMERIC NOT NULL,
    original_price NUMERIC,
    images JSONB DEFAULT '[]'::jsonb,
    category_id TEXT REFERENCES public.categories(id) ON DELETE SET NULL,
    seller JSONB NOT NULL,
    condition TEXT DEFAULT 'used',
    featured BOOLEAN DEFAULT false,
    discount INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. Tabela de Conversas (Instagram Direct e Tinder)
CREATE TABLE IF NOT EXISTS public.conversations (
    id TEXT PRIMARY KEY,
    platform TEXT NOT NULL CHECK (platform IN ('instagram', 'tinder')),
    username TEXT,
    full_name TEXT NOT NULL,
    avatar TEXT,
    last_message TEXT,
    last_sender TEXT CHECK (last_sender IN ('me', 'them')),
    unread BOOLEAN DEFAULT false,
    is_new_match BOOLEAN DEFAULT false,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. Tabela de Mensagens
CREATE TABLE IF NOT EXISTS public.messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
    sender_id TEXT NOT NULL,
    text TEXT NOT NULL,
    is_mine BOOLEAN NOT NULL,
    liked BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. Tabela de Sessões do Tinder
CREATE TABLE IF NOT EXISTS public.tinder_sessions (
    id TEXT PRIMARY KEY DEFAULT 'current',
    token TEXT NOT NULL,
    is_connected BOOLEAN DEFAULT true,
    profile_data JSONB,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =========================================================
-- ÍNDICES PARA ALTA PERFORMANCE
-- =========================================================
CREATE INDEX IF NOT EXISTS idx_products_category ON public.products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_created_at ON public.products(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_platform ON public.conversations(platform);
CREATE INDEX IF NOT EXISTS idx_conversations_updated ON public.conversations(updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON public.messages(conversation_id, created_at ASC);

-- =========================================================
-- ROW LEVEL SECURITY (RLS)
-- Políticas para leitura e escrita pública com a chave anon
-- =========================================================
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tinder_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Permitir leitura pública de categorias" ON public.categories FOR SELECT USING (true);
CREATE POLICY "Permitir leitura pública de produtos" ON public.products FOR SELECT USING (true);
CREATE POLICY "Permitir inserção de produtos" ON public.products FOR INSERT WITH CHECK (true);

CREATE POLICY "Permitir acesso a conversas" ON public.conversations FOR ALL USING (true);
CREATE POLICY "Permitir acesso a mensagens" ON public.messages FOR ALL USING (true);
CREATE POLICY "Permitir acesso a sessões tinder" ON public.tinder_sessions FOR ALL USING (true);

-- =========================================================
-- CARGA INICIAL (SEEDS)
-- =========================================================
INSERT INTO public.categories (id, name, slug, icon) VALUES
    ('cat-1', 'Todos', 'todos', 'Grid'),
    ('cat-2', 'Tênis & Sneaker', 'tenis', 'Footprints'),
    ('cat-3', 'Smartphones', 'smartphones', 'Smartphone'),
    ('cat-4', 'Games & Consoles', 'games', 'Gamepad2'),
    ('cat-5', 'Relógios', 'relogios', 'Watch')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.products (id, title, description, price, original_price, images, category_id, seller, condition, featured, discount) VALUES
    ('prod-1', 'iPhone 15 Pro Max 256GB Titânio', 'Aparelho impecável com nota fiscal e garantia Apple.', 6890, 7890, '["https://images.unsplash.com/photo-1695048133142-1a20484d2569?w=600&auto=format&fit=crop&q=80"]'::jsonb, 'cat-3', '{"name": "TechStore Oficial", "verified": true, "rating": 4.9}'::jsonb, 'new', true, 12),
    ('prod-2', 'Nike Air Jordan 1 High Retro Chicago', 'Tamanho 41 BR. Edição especial colecionador.', 1290, 1690, '["https://images.unsplash.com/photo-1552346154-21d32810aba3?w=600&auto=format&fit=crop&q=80"]'::jsonb, 'cat-2', '{"name": "Sneakers Hub", "verified": true, "rating": 5.0}'::jsonb, 'new', true, 23),
    ('prod-3', 'PlayStation 5 Slim 1TB Edição Digital', 'Com 2 controles DualSense e 3 jogos inclusos.', 3399, 3999, '["https://images.unsplash.com/photo-1606813907291-d86efa9b94db?w=600&auto=format&fit=crop&q=80"]'::jsonb, 'cat-4', '{"name": "Lucas Ferreira", "verified": true, "rating": 4.8}'::jsonb, 'used', false, 15)
ON CONFLICT (id) DO NOTHING;
