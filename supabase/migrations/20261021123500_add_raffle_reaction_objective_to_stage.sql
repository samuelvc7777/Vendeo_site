-- Adiciona objetivo de reação pós-pitch da rifa na etapa de finalização da rifa.
-- Este objetivo é do tipo conversation_state e só completa quando a IA processa
-- a resposta do pretendente (interesse, recusa, confirmação ou ghost) usando
-- o cofre de finalização com reaction_context apropriado.
-- A política de conclusão é operator_handoff: a etapa só avança quando a IA
-- faz handoff (recusa/insistência falhada) ou quando o operador assume (interesse).

-- Garante que os objetivos da etapa Rifa fiquem planos (sem aninhamento [ [ ... ] ])
update public.chat_stages s
set goals = case
  when jsonb_typeof(s.goals->0) = 'array' then s.goals->0
  else s.goals
end
where s.id = 'stage_1790861775316_am5wy';