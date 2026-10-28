-- Somente figurinhas descritas e habilitadas pelo operador entram no catálogo da IA.
-- Mantém URLs, títulos, sessão WhatsApp e a coleção manual existentes.
alter table public.whatsapp_stickers
  add column if not exists ai_enabled boolean not null default false,
  add column if not exists ai_description text;

-- Arquivos identificados no painel de figurinhas em 26/10/2026.
-- A correspondência é pelo arquivo, nunca pela ordem mutável da lista.
with reviewed(filename, description) as (values
  ('sticker_wamid_HBgMNTUzMjk5NjI4MDYwFQIAEhgUM0E5MzkyRTZCQkM2NUI2OURERDEA.webp',
   'Criança sorrindo com a cabeça inclinada e olhos quase fechados. Felicidade, carinho, ficar toda boba ao receber elogio ou mensagem carinhosa.'),
  ('sticker_wamid_HBgMNTUzMjk5NjI4MDYwFQIAEhgUM0E0NzcwQzQwNzhEQzFFNjFEMzIA.webp',
   'Criança fazendo coração com as mãos diante do rosto. Afeto, carinho e agradecimento carinhoso; adequado para retribuir afeto já existente.'),
  ('sticker_wamid_HBgMNTUzMjk5NjI4MDYwFQIAEhgUM0E5NzlCNUYyQjY3MTU1MDg2RTgA.webp',
   'Criança de biquinho triste, olhando para baixo. Saudade, decepção leve ou pedido brincalhão de carinho. Evitar em tristeza real, reclamações ou para cobrar resposta, dinheiro ou compra.'),
  ('sticker_wamid_HBgMNTUzMjk5NjI4MDYwFQIAEhgUM0FERTk2NDY4Qjg2NjcxMTA3NjYA.webp',
   'Criança deitada com mão cobrindo parte do rosto. Vergonha ou constrangimento brincalhão, reação de ai meu Deus. Expressão ambígua: usar apenas com contexto leve inequívoco, nunca para ridicularizar.'),
  ('sticker_wamid_HBgMNTUzMjk5NjI4MDYwFQIAEhgUM0FGQjJFOTNFNDJFNjFFMzk1OEMA.webp',
   'Criança com boca aberta e cabeça inclinada para trás, em risada. Gargalhada e diversão em resposta a piada ou situação engraçada, nunca a sofrimento ou problema sério.')
)
update public.whatsapp_stickers as sticker
set ai_enabled = false, ai_description = reviewed.description, updated_at = now()
from reviewed
where regexp_replace(split_part(sticker.sticker_url, '?', 1), '^.*/', '') = reviewed.filename;

create index if not exists brain_sticker_actions_recent_idx
  on public.brain_decision_actions (conversation_id, updated_at desc)
  where action_type = 'sticker';
;
