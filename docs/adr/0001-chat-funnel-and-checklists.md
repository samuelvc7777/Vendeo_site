# 0001: Gestão de Etapas de Conversa com Checklists Vinculados ao Cofre de Ativos

## Contexto
O Vendeo conduz dezenas de conversas simultâneas de pretendentes no Instagram Direct e no Tinder com objetivo final de conversão. Sem um rastreamento padronizado de jornada, o operador perde a visibilidade de em qual ponto do funil cada conversa se encontra e se os materiais estratégicos (fotos, áudios e tópicos essenciais) já foram enviados.

## Decisão
Implementar um sistema de Funil com Etapas Sequenciais e Checklists por Conversa:
1. **Configuração Global de Etapas:** Na aba Configurações, o operador cria e reordena as Etapas da jornada, vinculando cada Etapa diretamente a uma Pasta do Cofre (`VaultFolder`).
2. **Checklist Automático da Pasta:** Todos os ativos contidos na pasta vinculada (fotos, áudios e frases de texto) compõem o checklist daquela etapa para cada conversa.
3. **Disparo Rápido com 1 Toque (Quick Send):** Na Barra de Etapa da conversa, cada item não enviado possui um botão de disparo imediato que envia o ativo do cofre para o chat com delay humano.
4. **Marcação Híbrida:** O item do checklist é marcado automaticamente no envio via cofre/barra rápida (ou envio de frase idêntica), e o operador pode alternar manualmente o checkbox a qualquer momento.
5. **Avanço Manual Consciente:** Ao atingir 100% dos itens da etapa, o sistema alerta visualmente e disponibiliza o botão de avanço manual para a próxima etapa.
6. **Persistência na Nuvem (Supabase + Cache Local):** As definições de etapas e o progresso individual de cada conversa são salvos na tabela `vendeo_chat_stages` / `vendeo_chat_progress` no Supabase com sincronização em tempo real e cache offline.
7. **Barra de Etapa Superior Recolhível:** Fixada abaixo do cabeçalho do chat, permite expandir/recolher com 1 toque para visualizar o checklist e disparar ativos.
8. **Filtros e Badges na Listagem:** As listas de conversas do Instagram Direct e do Tinder ganham badges coloridas com o nome da etapa e uma barra de filtros rápidos por etapa.
9. **Reatividade Dinâmica da Pasta:** Alterações na pasta do cofre (inclusão ou exclusão de mídias/textos) refletem instantaneamente no checklist das conversas ativas naquela etapa sem perda do progresso já registrado.
10. **Conclusão do Objetivo Final:** Ao concluir a última etapa, a conversa é promovida ao status "🏆 Convertido / Finalizado" e ganha filtro exclusivo para métricas de conversão.
11. **Reordenação Tátil:** Ajuste da ordem das etapas por botões de setas (⬆️ / ⬇️) eliminando problemas de arraste no mobile.

## Consequências
- Zero falsos positivos na detecção de progresso (eliminação de heurísticas frágeis de regex).
- Clareza operacional total: o operador sabe exatamente qual áudio, foto ou texto enviar a seguir.
- Controle humano preservado no momento da transição entre fases emocionais da conversa.
