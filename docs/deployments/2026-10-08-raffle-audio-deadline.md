# Áudio da Rifa até o quarto turno

Publicado em 08/10/2026 no Supabase `wsdualhvopidgqcumonr`: API v528, ACTIVE, prompt 2.46.9. Bundle SHA256: `959e15d30b597c3550826ec4b9bcb3c163310baec171e6524b77580f35ff3ac3`.

## Regra autorizada

O operador autorizou uma exceção temporal específica para o áudio do objetivo `goal_1790861876963_d8oti`, da etapa Rifa `stage_1790861775316_am5wy`. A gravação pode ser enviada mesmo contendo referências incompatíveis ao estágio, horário ou cobrança de hoje. Essa autorização não permite reproduzir essas afirmações em texto nem libera outros áudios.

A configuração preserva `finalizeWorkflowOnCompletion: true` e `completionPolicy: delivery_confirmed`, acrescentando `maxStageTurns: 4` e `allowAudioTemporalMismatch: true`. O SQL idempotente aplicado está em `scripts/configure-raffle-audio-policy.sql`; não houve alteração de schema ou progresso dos contatos.

O contador consulta decisões duráveis `respond` na etapa após a transição mais recente e deduplica versões pelo `turn_id`. O turno da transição ainda pertence à etapa anterior; o primeiro turno que começa na Rifa é o turno 1. O Brain recebe o número do turno e o prazo. A partir do quarto turno, um plano de resposta sem áudio autorizado do objetivo é rejeitado e o próprio Brain tem a oportunidade existente de corrigir o plano no mesmo turno. Não há seleção determinística de áudio nem fallback que invente uma resposta. Ausência de candidato elegível e pausas de segurança continuam exigindo tratamento pelo operador; uso único e confirmação de entrega permanecem ativos.

## Pacote e verificação

O pacote foi montado diretamente sobre os 45 arquivos da API v527 recuperados pelo conector. Quatro arquivos foram alterados (`brain_orchestrator.ts`, `openai_brain.ts`, `openai_sdk_brain.ts`, `larissa_canonical_prompt.generated.ts`) e `objective_audio_deadline.ts` foi acrescentado. Os outros 41 arquivos foram preservados. Alterações locais paralelas de memória/Jev não foram incluídas. Site e gateway não foram publicados nesta tarefa.

- Suíte local: 477 testes passaram, sem falhas. Inclui os testes presentes no workspace; não equivale à publicação de todos os módulos locais.
- Pacote exato de publicação: seis testes específicos passaram, incluindo o validador real do SDK, contagem/deduplicação, quarto turno, turno atrasado, áudio de outro objetivo e falta de candidato.
- Avaliação real isolada do modelo: sete cenários passaram. O áudio da Rifa foi selecionado no quarto turno às 10:24 e no sétimo turno às 20:15; o áudio comum incompatível continuou bloqueado. Avaliações sintéticas não enviaram mensagens a clientes.
- A consulta real do contador/configuração passou sem enviar mensagens.
- Após o deploy, os 46 arquivos recuperados da API ativa coincidiram com o pacote revisado. Markdown e módulo gerado estão sincronizados.

Relatórios e pacote exato: `.firebase/automation-audit/rifa-deadline-tests.log`, `rifa-reviewed-model-eval.json` e `rifa-reviewed/` (ignorados pelo Git). O manifesto anterior foi preservado; seus hashes descrevem o release anterior e divergem intencionalmente desta mudança.

## Rafael

Durante a tarefa, uma nova conferência mostrou que o áudio já havia sido entregue por resolução manual às 10:31:36 de 08/10/2026, antes desta publicação. O objetivo estava concluído com `source: delivery_confirmed` e mensagem do provider `true_250113310122221@lid_3EB0798AC94BE0557A4C8B`. A gravação não foi reenviada, e a pausa após concluir o cronograma foi preservada.

O limite controla decisões aceitas do Brain; falhas de transporte ou pausas legítimas podem impedir a entrega no horário esperado. A conclusão continua dependendo da confirmação real do provider.
