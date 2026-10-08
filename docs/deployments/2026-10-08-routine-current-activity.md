# Rotina como contexto para atividade atual

Publicado em 08/10/2026 no projeto Supabase `wsdualhvopidgqcumonr`: API v526, ACTIVE, prompt canônico 2.46.8. Bundle SHA256: `f25f08c6c45493dc5d8c8ea660f03d09028f0b9cb827d00ad985d86dd175bce6`.

A regra anterior tratava a rotina apenas como compatibilidade e exigia confirmação de presença. Isso fazia uma pergunta sobre a atividade atual às 08:28 virar resolução manual, apesar da rotina matinal cadastrada. Havia instruções conflitantes tanto no prompt canônico quanto no estado operacional do turno de conexão.

A rotina agora sustenta descrições gerais da atividade dentro do horário compatível: organizar a loja e os pedidos pela manhã, estágio das 12h às 17h e aula das 19h às 22h nos dias cadastrados. Informações recentes que contradigam a rotina prevalecem. A rotina não autoriza inventar acontecimentos específicos, vendas, matéria de prova ou uma visita concluída aos Correios. Ausência de mídia compatível não impede uma resposta textual válida; objetivos que exigem mídia continuam pendentes.

O pacote foi montado a partir da versão exata v525, substituindo somente `api/openai_sdk_brain.ts` e `api/larissa_canonical_prompt.generated.ts`, mantendo os outros 43 arquivos. Não houve alteração do frontend, gateway ou configuração Flex de produção.

## Verificação

- Avaliação real e isolada do modelo reproduziu `manual_resolution` às 08:28 antes da alteração.
- Depois: cinco de cinco cenários passaram — manhã, estágio, aula, áudio incompatível pela manhã e acontecimento específico de ontem sem informação. O último continuou exigindo resolução manual.
- A resposta matinal foi: “tô arrumando umas coisas da loja e organizando os pedidos aqui kkk e vc tá fazendo oq?”. Nenhum áudio de estágio foi enviado no cenário matinal.
- Os 87 testes de segurança da automação passaram. Markdown e módulo gerado estão sincronizados na versão 2.46.8.
- A publicação e o estado ACTIVE da API v526 foram confirmados pelo conector Supabase.

Avaliações são sintéticas e não enviam mensagens a clientes. Cinco casos não representam garantia de comportamento em toda conversa. Relatórios locais: `.firebase/automation-audit/routine-eval-before.json` e `routine-eval-after.json`; avaliador opt-in: `scripts/eval-larissa-routine.mjs`.

Referência consultada para clareza e consistência das instruções: [documentação oficial de prompting da OpenAI](https://developers.openai.com/api/docs/guides/prompt-engineering).
