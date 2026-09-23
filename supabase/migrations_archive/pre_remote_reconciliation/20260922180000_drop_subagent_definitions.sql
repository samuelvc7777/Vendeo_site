-- Migration: Expurgo Definitivo da Camada de Subagentes
-- Consolidação na Arquitetura Brain Único (OpenAI Agent Luna gpt-5.6-luna).
-- Remove a tabela legada subagent_definitions, triggers e funções associadas.

-- 1. Dropar triggers associadas
DROP TRIGGER IF EXISTS trg_prevent_system_subagent_delete ON public.subagent_definitions;
DROP TRIGGER IF EXISTS trg_subagent_definitions_updated_at ON public.subagent_definitions;

-- 2. Dropar funções associadas
DROP FUNCTION IF EXISTS public.prevent_system_subagent_delete();
DROP FUNCTION IF EXISTS public.update_subagent_definitions_updated_at();

-- 3. Dropar a tabela legada de subagentes
DROP TABLE IF EXISTS public.subagent_definitions CASCADE;
