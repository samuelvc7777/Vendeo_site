# Especificação Canônica: Serialização de Contexto para a IA em Texto Compacto

> **O backend deve trabalhar internamente com dados estruturados e tipados; somente o contexto entregue aos modelos de IA deve ser projetado para uma representação textual compacta, semelhante a TXT.**

Este documento estabelece as diretrizes canônicas para a fronteira entre os dados internos do backend (PostgreSQL / Supabase / TypeScript) e a entrada textual consumida pelos modelos de linguagem (`ConversationAgent` e Subagentes Especializados).

---

## 5.1. Serializar o Contexto para a IA em Texto Compacto

O contexto entregue ao `ConversationAgent` e aos subagentes deve ser otimizado para leitura por modelo de linguagem e baixo consumo de tokens.

**NÃO** envie estruturas JSON grandes e verbosas para a IA quando os mesmos dados puderem ser representados de forma segura e inequívoca como texto compacto.

Internamente, o backend pode e deve continuar trabalhando com objetos TypeScript, IDs, timestamps, estruturas do banco e schemas tipados.

A conversão para texto ocorre apenas na fronteira de entrada do modelo.

### Fronteira de Separação:
* **BANCO / BACKEND:**
  - Dados estruturados;
  - Objetos tipados;
  - IDs reais (`id`, `conversation_id`, `reply_to_message_id`);
  - Validações de integridade e schema;
  - Relações de reply;
  - Timestamps;
  - Estado da conversa e locks atômicos.
* **ENTRADA DA IA:**
  - Representação textual compacta e previsível semelhante a um arquivo de diálogo em TXT.

### Formato Conceitual Canônico:

```text
[ESTADO]
fase: descoberta
checkpoint: profissao_pendente

[MENSAGENS_NOVAS]

PRETENDENTE | msg_891
Oi, boa noite

PRETENDENTE | msg_892
Hoje foi corrido demais no trabalho

PRETENDENTE | msg_893 | RESPONDENDO_A: msg_450
Eu também gosto muito disso

[REFERÊNCIAS]

msg_450
LARISSA:
Eu amo praia, principalmente lugar mais tranquilo

[FIM]
```

### Princípios Obrigatórios:
1. **Ser curto:** Sem tags XML redundantes ou nesting desnecessário.
2. **Ser determinístico:** A mesma entrada de dados produz exatamente a mesma string.
3. **Deixar explícito quem enviou cada mensagem:** Rótulos claros (`LARISSA` vs `PRETENDENTE`).
4. **Preservar a ordem cronológica das mensagens:** Sem saltos temporais.
5. **Manter o ID da mensagem para rastreabilidade:** Sempre no formato `AUTOR | ID`.
6. **Mostrar claramente quando existe reply:** Anotado na linha do cabeçalho como `| RESPONDENDO_A: <id>`.
7. **Incluir o conteúdo da mensagem referenciada:** Bloco `[REFERÊNCIAS]` isolado.
8. **Diferenciar mensagem NOVA de contexto antigo:** Mensagens novas no bloco `[MENSAGENS_NOVAS]`.
9. **Não repetir informações desnecessariamente:** Deduplicação estrita no bloco de referências.
10. **Não serializar campos internos:** Sem expor `is_echo`, `created_at`, `status`, `deliver_at`, etc.

---

## 5.2. Não Sacrificar Estrutura para Economizar Tokens

A otimização de tokens **NÃO** pode causar ambiguidade.

Nunca agrupe ou concatene mensagens distintas em uma linha corrida como:
`"Oi tudo bem trabalho muito também gosto disso"`

Preserve as quebras e autoria:
```text
PRETENDENTE | msg_1:
Oi

PRETENDENTE | msg_2:
Tudo bem?

PRETENDENTE | msg_3:
Trabalho muito
```

A sequência e a cadência em que a pessoa envia mensagens fazem parte fundamental do contexto interpretativo da conversa.

---

## 5.3. Contexto Diferente para Cada Camada

Não envie o mesmo TXT completo para todos os agentes. Cada camada deve receber apenas a projeção mínima necessária para cumprir sua tarefa.

1. **ConversationAgent (Roteador):**
   - Recebe apenas: estado atual (fase, checkpoint), bloco de mensagens novas, referências de replies e resumo mínimo do diálogo.
2. **Subagente ConexaoInicial:**
   - Recebe apenas: acolhimento, saudações recentes e validação de reciprocidade. Não recebe memórias de fases futuras.
3. **Subagente Descoberta:**
   - Recebe adicionalmente: memórias e fatos já consolidados sobre o pretendente (`[FATOS_CONHECIDOS]`: profissão, cidade, hobbies) e checkpoints da fase de descoberta.

---

## 5.4. Não Perder os Dados Estruturados Originais

A string textual é unicamente uma representação de entrada para a IA.

O backend **NÃO** substitui seus modelos internos por strings. O backend mantém os dados reais para:
- Idempotência (`lastProcessedMessageId`);
- Locks atômicos (`active_cycle_token`);
- Checkpoints e controle de estado;
- Validação de regras e integridade;
- Disparo oficial na Meta Graph API;
- Persistência no PostgreSQL / Supabase.

---

## 5.5. Função Central de Formatação

Toda conversão deve passar pela função pura e determinística:
`formatConversationContextForModel(payload, options)`

A função:
- Recebe dados tipados;
- Produz texto compacto;
- Escapa/normaliza espaços e quebras preservando integridade;
- Preserva autoria e referências sem duplicatas;
- É coberta por testes unitários estritos.

---

## 5.6. Bateria de Testes do Formato TXT
1. Múltiplas mensagens permanecem separadas no texto.
2. Autoria Larissa/Pretendente fica inequívoca.
3. Reply aparece associada à mensagem correta.
4. Mensagem antiga usada como referência fica separada das mensagens novas.
5. Não existe duplicação da mensagem referenciada.
6. 20 mensagens novas são serializadas integralmente.
7. Campos internos desnecessários não aparecem no prompt.
8. IDs necessários para rastreabilidade permanecem disponíveis.
9. Conteúdo contendo caracteres especiais/quebras de linha não quebra o formato.
10. A representação textual gerada é estável/determinística para a mesma entrada.
