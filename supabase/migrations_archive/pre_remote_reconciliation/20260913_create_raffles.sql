-- =========================================================
-- MIGRAÇÃO: TABELAS DO MÓDULO DE RIFAS (VENDEO)
-- =========================================================

-- 1. Tabela de Rifas
CREATE TABLE IF NOT EXISTS public.raffles (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    total_numbers INTEGER NOT NULL DEFAULT 100,
    price_per_number NUMERIC NOT NULL DEFAULT 10.00,
    start_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    end_date TIMESTAMPTZ,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'drawn', 'cancelled')),
    winning_number INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Tabela de Bilhetes / Cotas da Rifa
CREATE TABLE IF NOT EXISTS public.raffle_tickets (
    id TEXT PRIMARY KEY,
    raffle_id TEXT NOT NULL REFERENCES public.raffles(id) ON DELETE CASCADE,
    number INTEGER NOT NULL,
    formatted_number TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'reserved', 'paid')),
    buyer_name TEXT,
    buyer_username TEXT,
    buyer_avatar TEXT,
    buyer_phone TEXT,
    conversation_id TEXT,
    paid_at TIMESTAMPTZ,
    reserved_at TIMESTAMPTZ,
    notes TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT unique_raffle_ticket_number UNIQUE (raffle_id, number)
);

-- 3. Índices de Alta Performance
CREATE INDEX IF NOT EXISTS idx_raffles_status ON public.raffles(status);
CREATE INDEX IF NOT EXISTS idx_raffles_created_at ON public.raffles(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_raffle_tickets_raffle_id ON public.raffle_tickets(raffle_id);
CREATE INDEX IF NOT EXISTS idx_raffle_tickets_status ON public.raffle_tickets(status);
CREATE INDEX IF NOT EXISTS idx_raffle_tickets_conversation ON public.raffle_tickets(conversation_id);

-- 4. Políticas de RLS (Row Level Security)
ALTER TABLE public.raffles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.raffle_tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Permitir acesso completo a rifas" ON public.raffles FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Permitir acesso completo a bilhetes" ON public.raffle_tickets FOR ALL USING (true) WITH CHECK (true);
