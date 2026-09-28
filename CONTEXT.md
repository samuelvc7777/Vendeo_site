# Vendeo — Modelo de Domínio Canônico

Vocabulário oficial do atendimento autônomo do Vendeo.

## Princípio de autoridade

**Brain (OpenAI Agent persistente)**
Única autoridade semântica da conversa. Interpreta o que o pretendente disse, decide se responde, espera, pede informação ao operador, persegue ou adia objetivos, escolhe áudio entre candidatos autorizados e propõe transição de etapa.

**Backend determinístico**
Não escreve fala, não escolhe objetivo, não escolhe áudio e não decide o rumo da conversa. Faz somente plumbing e invariantes: locks, freshness, autenticação, validação estrutural, persistência, idempotência, outbox, entrega, retries, recovery e observabilidade.

**Session do Brain**
Uma sessão persistente por conversa enquanto compatível com a versão atual. Uma session nova recebe bootstrap compacto de histórico recente e fatos manuais explicitamente salvos para sessões futuras.

**Turno do Brain**
Unidade canônica de decisão. Timeout local de espera não encerra o turno do provedor. Turnos tardios são recuperados pelo mesmo provider turn e nunca recriados semanticamente pelo backend.

## Progresso da conversa

**Etapas e objetivos**
São configuração manual do produto. Objetivos funcionam como checkpoints: concluídos não devem ser repetidos. O Brain decide o que perseguir e quando pedir mudança de etapa; o backend apenas valida IDs e evidências configuradas.

**Evidência de objetivo**
Conclusão de fato exige evidência real associada à conversa/mensagem. Evidência inválida não pode avançar progresso.

**Cofre de áudio**
O backend oferece candidatos elegíveis limitados ao objetivo consultado. O Brain decide semanticamente usar ou rejeitar um candidato. IDs não autorizados, áudios repetidos ou concorrência de reserva são bloqueados deterministicamente.

## Execução e entrega

**Decisão durável**
Antes de qualquer dispatch, decisão, ações e outbox são persistidas atomicamente. O estado semântico não depende do sucesso imediato da Meta.

**Outbox**
Fonte durável da entrega. Mantém ordem por lote, `not_before`, idempotência, tentativas e confirmação do provider. `dispatch_uncertain` é fail-closed e nunca autoriza reenvio cego.

**Cadência humana**
O Brain define explicitamente a pausa depois de ações de texto. Quando a ação anterior é áudio, o backend usa a duração real do arquivo antes da próxima ação.

**Debounce limitado**
O quiet period é configurável e reinicia com novas mensagens, mas possui um teto absoluto contado da primeira mensagem do lote. Mensagens sucessivas não podem adiar a resposta indefinidamente.

**Resolução manual**
Quando falta um fato pessoal confiável, o Brain pausa o mesmo turno e pergunta ao operador. A resposta retoma o mesmo contexto. Fatos marcados para futuras sessions são promovidos para a memória da persona e só entram no bootstrap de novas sessions.

## Observabilidade e interface

**Eventos do Brain**
`brain_turn_events`, `brain_turns`, `brain_decisions` e `brain_decision_actions` formam a fonte canônica operacional. UI não deve inferir “enviado” apenas porque o Brain concluiu.

**Inbox / Card / Console**
São projeções do mesmo estado canônico. Devem distinguir Brain processando, aguardando operador, ação pendente, envio parcial, falha confirmada, envio incerto e entrega totalmente confirmada.

## Regras de segurança arquitetural

- Não criar segundo cérebro, router semântico ou subagentes.
- Não colocar regras de conteúdo conversacional no backend.
- Não usar fallback que invente resposta quando a decisão canônica falhar.
- Não transformar `cycle_completed` em prova de entrega.
- Não atualizar memória/progresso a partir de ação não confirmada quando o contrato exigir entrega.
- Realtime e cron são gatilhos/contingência; não podem criar loops de polling.
- Ativação do AutoPilot é individual por conversa e independente de pausas operacionais temporárias.
