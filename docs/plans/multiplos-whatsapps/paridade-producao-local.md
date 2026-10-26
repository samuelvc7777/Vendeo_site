# Recuperação de funcionalidades publicadas para a prévia local

Data: 26/10/2026. Branch de trabalho: `codex/plano-multiplos-whatsapps`, originada da `main` em `fdca9685`.

## Evidências e método

O site `https://vendeo-e755e.web.app` foi consultado diretamente. Os nove arquivos JavaScript referenciados pela página coincidiram por SHA-256 com os artefatos em `E:/aplicativos/Vendeo_site/out`. Esses arquivos incluem as funcionalidades “Finalizar Sozinha”, cofre da persona/fotos, contexto de reação e visualização única. Isso comprova os artefatos servidos; não comprova individualmente cada fonte pendente na pasta original.

A API de gerenciamento do Supabase confirmou a função `api` ativa na versão 620. As duas tentativas de baixar seu corpo expiraram; portanto não foi confirmada equivalência byte a byte entre o backend remoto e as fontes locais recuperadas.

Foi feita integração de arquivos pela diferença desde o ancestral comum `372c39172552efb469d934077300a343ead14dc1`, preservando as alterações posteriores da `main` e as mudanças locais de múltiplos WhatsApps. A branch histórica não foi mesclada inteira. Backups de cada arquivo anterior e hashes de entrada estão em `scratch/production-parity/integration`, ignorado pelo Git. A pasta original não foi alterada.

## Funcionalidades recuperadas

- Controle por conversa “Finalizar Sozinha”, com leitura de `auto_close_test_enabled` também na projeção da caixa WhatsApp e atualização visual após a confirmação da requisição. Respostas atrasadas não mudam o botão de outra conversa.
- Cofre de finalização com categorias de reação, envio filtrado por contexto e campos de rifa/contato no contrato do cliente.
- Cofre de fotos e áudios da persona, imagens com visualização única e horários permitidos.
- Estados e indicadores recentes do Brain, console e controles de ativação individual/em lote.
- Melhorias dos contatos/compradores de rifas e campos associados, conservando a resolução por conta implementada nesta tarefa.
- Fontes correspondentes de API, prompt e migrações recuperadas para revisão local. Nenhuma migração foi aplicada nem função publicada.

O modal de troca de WhatsApp ao lado do sino, as sessões separadas, o cliente imutável por conta, os rascunhos e a identidade das mensagens adicionais foram preservados.

## Ajustes durante a integração

Foram preservados os bloqueios de origem da `main` em `brain_operator_auth.ts`, em vez de importar a liberação de origens arbitrárias por chave pública. A execução SDK mantém o tier configurado, sem fallback automático de Flex para Standard/auto. Foram preservados a política de pesquisa web e o bloqueio de perguntas de identificadores técnicos na resolução manual.

O console reconhece uma retomada posterior a uma espera humana. Testes antigos que exigiam o handoff de toda menção antecipada à rifa foram alinhados ao comportamento publicado de reações, incluindo respeito à recusa. A verificação de stale continua cobrindo a recuperação atômica, delimitada antes da rotina independente de ghost. A escolha de contatos da rifa acompanha os registros finalizados, incluindo os arquivados/trancados usados pelo fluxo publicado.

No gateway local, a entrega de mídia conserva o tratamento de resultado incerto: não foi recuperada a tentativa automática por outro caminho após erro de envio. O enfileiramento de finalização inclui conta/conversa na idempotência e bloqueia falha na consulta de duplicidade. A consulta de números da rifa não fabrica cotas, não expira reservas antigas e não troca silenciosamente a rifa solicitada; dados ausentes ou esgotamento geram erro.

## Validação

- Build `next build --webpack`: passou.
- TypeScript: passou.
- `git diff --check`: passou.
- 56 testes direcionados das regressões encontradas na recuperação: passaram.
- 15 testes direcionados adicionais de números reais, isolamento multi-conta, falhas de entrega e finalização: passaram.
- Suíte geral final: 525/528 passaram. Permanecem as três falhas de ambiente/base previamente registradas: E2E sem chave de serviço, teste do prompt do protótipo Jev e binário FFmpeg ausente.
- Prompt Markdown e módulo gerado: sincronizados em 2.46.17.
- GET da página local: HTTP 200. Os seis chunks consultados do localhost contêm “Finalizar Sozinha”, “Cofre de Fotos”, `reaction_context` e o botão “Trocar conta de WhatsApp”.
- Consultas remotas sem linhas de dados confirmaram `auto_close_test_enabled`, `reaction_context` e `persona_images` com `is_view_once`, `allowed_time_start` e `allowed_time_end`: HTTP 200. POST sem conversa à rota `toggle-auto-close` retornou HTTP 400 com a validação esperada, sem alterar chat.
- Ambos os WhatsApps continuavam em `ready` na conferência do cadastro do gerenciador.

O acesso automatizado ao navegador foi desativado nas configurações do Work durante esta etapa. Por isso, a verificação final foi feita por HTTP, compilação e testes; não foi registrada uma nova inspeção visual do botão dentro de uma conversa.

## Limites de execução

A prévia continua acessando a API e o banco remotos. “Frontend no localhost” não significa que o Brain esteja executando numa API local. Nenhuma IA foi ativada automaticamente em chats, nenhum envio/finalização de cliente real foi usado como teste e nenhum serviço de produção foi reiniciado.

As novas fontes do gateway foram integradas no disco; os processos já conectados foram preservados durante a recuperação. A segunda conta continua com as limitações já registradas de persistência e automação por falta de credencial de serviço/migração nessa instância. A execução completa de finalização autônoma em duas contas ainda não foi validada. Não se deve anunciar paridade operacional integral ou publicar este conjunto sem revisar as fontes recuperadas contra o corpo remoto e percorrer os fluxos de aceitação em contas de teste.
