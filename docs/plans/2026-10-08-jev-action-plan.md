# Plano de ação: Jev seleciona memórias para o Brain

Data: 08/10/2026. Base: `main` consolidada. Status atualizado: módulos, integração, fallback e testes locais implementados. Avaliação real, calibração e publicação pendentes de configuração da chave. Consulte [o registro da implementação e configuração](../deployments/2026-10-08-jev-configuration.md).

## Contrato aprovado

**Backend prepara o contexto e garante integridade; Jev decide relevância; Brain responde.**

O backend entrega mensagens recentes, etapa, objetivo, checkpoints, horário e fatos obrigatórios. Carrega todas as memórias elegíveis, com paginação completa. Elegibilidade significa conta/persona/conversa/sessão autorizadas, registro disponível e validade explícita; não significa interesse presumido na conversa.

Não selecionar candidatos por tags, palavras, categoria temática ou ordem dos últimos registros. Não usar o limite atual de 120 candidatos ou dois resultados no caminho novo. Jev avalia cada memória elegível. Backend apenas valida o retorno e entrega os textos originais correspondentes. Relevância semântica não será decidida por regras locais.

Rotina, identidade essencial e regras continuam sempre presentes. A resposta manual que acabou de solucionar uma dúvida permanece obrigatória naquele turno. Jev não altera etapas, checkpoints, autorização de mídia ou mecanismos de envio.

## Etapas e entregáveis

| Ordem | Trabalho | Arquivos/responsabilidade | Critério para concluir |
| --- | --- | --- | --- |
| 1 | Inventariar fatos fixos e registros de memória; separar conhecimento essencial e opcional, preservando origem e negações. | Prompt canônico, geração de instruções e catálogo existente. | Mapa de cada fato movido; nenhuma regra essencial removida; diferenças revisadas. |
| 2 | Criar repositório que carrega todo o catálogo elegível, com paginação, escopo e validade. | Novo `supabase/functions/api/persona_memory_repository.ts`; adaptar acesso atual do orquestrador. | Testes comprovam cobertura além de 120 registros, isolamento de clientes e inclusão independente de tags. |
| 3 | Implementar transporte e seleção Jev com contrato validado, prazo total e cancelamento. | Novo `supabase/functions/api/jev_memory_selector.ts`, desenvolvido sobre a main, sem copiar cegamente o protótipo antigo. | IDs completos e válidos; textos não reescritos; lote incompleto dispara fallback; catálogo inteiro avaliado ou seleção declarada indisponível. |
| 4 | Integrar seleção antes do Brain e criar consulta complementar real. | `brain_orchestrator.ts` e `openai_sdk_brain.ts`. | Brain recebe contexto operacional, essenciais, fatos obrigatórios e memórias selecionadas; ferramenta consulta o mesmo catálogo via Jev. |
| 5 | Separar prompt essencial e completo; ativação e fallback coerentes. | `larissa_canonical_prompt.md`, `openai_agent_instructions.ts` e consumidores/geradores identificados durante implementação. | Modos `off`/`shadow` preservam caminho atual; falha em `active` mantém conhecimento aprovado pelo fallback. Nenhum consumidor fica com prompt reduzido sem memórias. |
| 6 | Medir qualidade, custo e latência em português, usando API real. | Novo conjunto de avaliação e runner em `tests/`/`scripts/`; telemetria do seletor. | Relatório reproduzível, com falhas e métricas; orçamento e limiar calibrados pelos casos. |
| 7 | Validar automação e publicar gradualmente. | Suíte baseline, segurança da automação e procedimento de deploy existente. | Verificações passam; versão publicada conferida; começa desligado, segue para sombra e só então seleção ativa. |

Os novos nomes de módulos são propostas deste plano, não arquivos já existentes. Confirmar campos existentes antes de criar migração. Não excluir nem converter dados automaticamente sem evidência da origem.

## Entrada e saída do seletor

Entrada: revisão do turno, mensagens/contexto, objetivo/etapa/checkpoints relevantes, horário local e lista de memórias com ID, texto original, origem, revisão, escopo e validade.

Saída interna validada: estado `complete` ou `unavailable`, IDs selecionados, escores associados aos IDs conhecidos, revisão do catálogo, modelo/política utilizados, duração e uso de tokens. Um resultado completo sem IDs é distinto de erro ou resposta parcial. A relevância vem do Jev; o limiar de Noul precisa ser calibrado e documentado.

O backend não transforma texto gerado pelo Jev em memória. Resolve IDs para os registros originais da mesma revisão avaliada. Revisão alterada durante a chamada ou turno cancelado exige descarte/revalidação pelo fluxo existente.

Todos os candidatos devem participar da avaliação. Se precisarem de lotes, cobrir deterministicamente o catálogo inteiro com concorrência limitada. Sem truncamento silencioso. Não iniciar com cache de resultados; adicionar somente se houver necessidade medida e invalidação correta.

## Tratamento de falhas

- Chave somente no servidor; ausência de chave mantém seleção desligada.
- Prazo total inclui chamadas e retries; cancelamento do turno cancela a seleção.
- Erro de autenticação, timeout, sobrecarga ou retorno inválido ativa fallback e registra motivo técnico. Não vira automaticamente dúvida pessoal, desligamento da IA ou bloqueio de envio.
- Fallback restaura prompt completo e comportamento atual de recuperação manual, explicitamente registrado como modo degradado. A comparação lexical antiga não participa da seleção Jev normal.
- Não reiniciar WhatsApp, limpar históricos, mexer em outbox ou remover agendamentos para integrar Jev.

## Verificação necessária

Testar interpretação indireta, sinônimos, várias perguntas, negações, fatos desconhecidos, rotina às 08:28, validade vencida, correções humanas, isolamento entre números e resposta manual recém-salva. Testar retorno parcial, IDs inválidos, falhas HTTP, cancelamento/reinício e execução concorrente sem duplicação de mensagens.

Rodar `node scripts/test-production-baseline.mjs`, `node scripts/test-automation-safety.mjs` e testes novos pertinentes. Nenhum teste envia mensagens a clientes reais.

Avaliação real deve comparar baseline e seleção nos mesmos casos, incluindo sessões longas e cache frio/quente. Medir custo agregado Jev + Brain, não apenas tamanho do prompt. A meta inicial proposta de recall é pelo menos 98% no conjunto rotulado, com todos os casos críticos corretos; reportar tamanho do conjunto e limitações. Definir orçamento de latência após medir.

## Ativação e reversão

1. Desenvolver a partir da main e manter seleção desligada por padrão.
2. Configurar credencial TypeSafe como secret do backend pelo meio adequado, sem expor em chat, frontend ou logs.
3. Executar avaliação com API real. Não anunciar economia ou integração funcional com testes simulados apenas.
4. Publicar desligado; habilitar sombra para comparar seleção sem alterar as respostas.
5. Ativar gradualmente após critérios de qualidade, custo e latência, preservando os mecanismos atuais de envio.
6. Reverter para `off` se houver regressão; recuperar prompt completo sem descartar chats ou dados.

Pendência atual: credencial TypeSafe não encontrada no ambiente local. Implementação e testes simulados podem avançar; avaliação real e ativação dependem da credencial.

Detalhamento técnico e fontes: [análise de integração](../research/2026-10-08-jev-implementation.md) e [contrato oficial pesquisado](../research/2026-10-08-jev-api.md).
