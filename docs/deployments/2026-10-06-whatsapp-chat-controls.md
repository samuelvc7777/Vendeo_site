# Publicação dos controles de conversa do WhatsApp

Publicação concluída em 06/10/2026 no Firebase Hosting do projeto `vendeo-e755e`.

Site: https://vendeo-e755e.web.app

## Escopo publicado

- Atualização dos estados de arquivamento e trancamento recebidos em realtime.
- Ponte dos eventos `change:archive` e `change:isLocked` do WhatsApp Web para a inbox inteira.
- Conversas arquivadas e trancadas sem exclusão pela janela de sete dias.
- Persistência ordenada dos controles, incluindo resolução do telefone de identidades LID.
- Estados atuais do gateway prevalecem sobre estados antigos da projeção do banco.

O frontend e o gateway foram preparados sobre o commit `9a193d2f`, com as correções deste escopo. As demais alterações em andamento no checkout não foram incluídas nessa publicação. Nenhuma migration ou Edge Function foi publicada nesta operação.

## Artefatos operacionais

- Build do frontend: `.firebase/chat-controls-release/out`.
- Entrada do gateway em produção: `.firebase/gateway-production-entry.cjs`.
- Código do gateway em execução: `.firebase/gateway-production-source.cjs`.
- PID registrado: `.firebase/gateway-production.pid`.
- Logs locais: `.firebase/gateway-production.log` e `.firebase/gateway-production-error.log`.
- Verificação da publicação: `.firebase/chat-controls-production-verification.json`.

Esses artefatos locais precisam ser preservados enquanto essa versão do gateway estiver em uso. A entrada carrega os módulos, as configurações e a sessão persistente de `services/whatsapp2-gateway`.

O gateway roda em processo independente da sessão do terminal, na máquina Windows já usada por essa integração, e continua acessível pelo túnel público existente. Seu funcionamento depende dessa máquina e do túnel permanecerem ligados.

## Validação

- 16 testes direcionados passaram tanto no checkout quanto nos artefatos preparados.
- TypeScript e build de produção passaram.
- HTML e bundle principal publicados conferidos por SHA-256 contra os arquivos do build.
- Bundle publicado contém o tratamento de `chat_state_changed`.
- Site e gateway público responderam HTTP 200; gateway com status `ready`.
- Ponte de eventos conferida diretamente na sessão ativa do WhatsApp Web.

A validação não arquivou, destrancou ou enviou mensagens para contatos reais.

## Correção complementar do caso Paulo

Foi reproduzida uma conversa trancada ausente do snapshot porque sua última mensagem era `notification_template` e não havia mensagem visível entre as mensagens recentes consultadas. A projeção da inbox usava então o estado antigo `active` do banco; segurar a conversa consultava o estado individual e fazia o item sair da caixa principal.

O gateway passou a manter arquivadas e trancadas também nesse caso. Os limites do snapshot, da sincronização e da rota `/chats` agora se aplicam à caixa principal e preservam as categorias especiais. Snapshots sem mensagem visível preservam a prévia, a data e o status de entrega da última mensagem real já salva.

Essa correção complementar foi aplicada no gateway em produção. A reprodução da montagem da inbox com dados reais passou: Paulo ficou com `status=locked`, em concordância com a consulta individual do WhatsApp, sem depender do menu de pressão longa. O frontend publicado permanece o mesmo, pois a correção complementar fica no gateway.

## Restauração do botão de reiniciar a IA

O botão de reiniciar no cabeçalho do chat estava nas alterações locais e não fazia parte da base `9a193d2f` usada no primeiro build isolado. Foram restaurados no artefato do frontend o botão na linha do nome do cliente, seu handler, a operação `restartAutoPilotForChat` e os headers de acesso à API.

Foi conferido que a Edge Function `api` em produção já contém `/autopilot/restart-chat` e que a RPC `restart_autopilot_runtime_atomic(text)` existe. Uma chamada sem identificador de conversa retornou a validação esperada HTTP 400, sem reiniciar uma conversa real. O handler foi validado com API simulada, e TypeScript e build de produção passaram antes da republicação do frontend.
