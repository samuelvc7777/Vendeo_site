# ADR 0001: Brain único oficial para conversa autônoma

## Contexto

O Vendeo tinha caminhos históricos de geração conversacional separados do fluxo do piloto automático. Isso permitia que a interface manual, provedores alternativos e executores antigos produzissem respostas fora do ciclo oficial de validação e outbox.

## Decisão

Toda decisão conversacional de produção passa pelo mesmo fluxo:

`Deterministic Backend`
→ `Single OpenAI Brain Agent`
→ `Deterministic Validation`
→ `Durable Outbox`
→ `Channel Dispatch`

Webhook, cron e autopilot entram em `runBrainOrchestration`, que chama `runOpenAiBrainTurn`. O resultado passa pelos guardrails determinísticos, autorização de áudio, persistência CAS e outbox durável antes do despacho para Meta ou Tinder.

O Brain opera em fail-closed. Uma falha não chama Atria, Kie, DeepSeek, Groq conversacional, TokenHarbor, NVIDIA, b.ai, subagente ou outro modelo de geração. Groq permanece restrita à transcrição de áudio.

## Consequências

- Há uma única fonte de decisão conversacional e uma única cadeia de telemetria de produção.
- ConversationQualityGate, anti-repeat, intent guard, memória, autorização de áudio, locks, CAS, idempotência, outbox e retries autorizados permanecem no backend determinístico.
- RPCs com nomes históricos `experimental_*` permanecem porque fazem parte do ciclo transacional oficial. A limpeza nominal desses RPCs exige uma migração futura coordenada.
- Campos JSON históricos podem continuar sendo lidos durante a migração, mas novos ciclos devem preferir nomenclatura neutra do Brain.
