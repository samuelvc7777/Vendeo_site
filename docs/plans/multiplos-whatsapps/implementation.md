# Implementação local — múltiplos WhatsApps

Data: 25/10/2026  
Base: `origin/main` em `fdca9685`  
Branch: `codex/plano-multiplos-whatsapps`  
Estado: código local e não publicado.

## O que foi implementado

- Gerenciador de conexões no gateway com cadastro persistente, lock de instância, limite configurável, processo isolado e diretório de sessão por conexão. A conexão existente continua usando a sessão e as rotas legadas.
- Roteamento interno por conexão e validação de que a identidade WhatsApp confirmada corresponde à conta cadastrada. Pausar uma conta preserva sua sessão e não deve afetar as demais.
- IDs de mensagem com escopo de conta nas conexões adicionais, e bloqueios contra encaminhamento de envio para a conta divergente.
- Cliente web imutável por conta; configuração para adicionar, renomear e pausar/retomar conexões; seletor e contexto de remetente na caixa de entrada.
- Contexto de conta para Status, cache de avatar, ações do chat e resolução de contatos usados por rifas.
- Rascunho de texto isolado por conversa. Anexos em composição não são restaurados se a tela for desmontada durante a troca de conta.
- Migração aditiva para escopar registros de Status por `gateway_account_id`.

## Validação local

- TypeScript: `node node_modules/typescript/bin/tsc --noEmit --pretty false` passou.
- Build frontend: `node node_modules/next/dist/bin/next build --webpack` passou. O build padrão Turbopack não é utilizável nesta worktree porque `node_modules` é uma junction externa, recusada pelo Turbopack; dependências não foram reinstaladas nem alteradas.
- Suíte direcionada de multi-conta, filas, histórico, controles, sincronização e Status de texto/imagem: 54 testes passaram.
- Suíte geral: 510/513 passaram; três falhas conhecidas no ambiente/base: `test_e2e_contact_conversation_memory.mjs` depende de `.env.local` e de banco real de teste; `test_jev_memory_selection.mjs` cobre o protótipo Jev fora da produção e diverge do prompt consolidado; `test_whatsapp_status_video.mjs` exige o binário FFmpeg ausente. Não foram incluídas credenciais para forçar o E2E nem recuperado o protótipo.
- `git diff --check` passou; restam apenas avisos de conversão de fim de linha do Git.

## Ativação ainda necessária

### Prévia local

O frontend de desenvolvimento roda em `http://127.0.0.1:3001` com Webpack. Foi iniciada uma instância separada do gateway em `http://127.0.0.1:8789`, usando a sessão e o cadastro desta worktree e sem credencial privilegiada do Supabase. Ela aguarda pareamento; o gateway existente na porta 8788 foi preservado e continuou retornando `ready`.

A `.env.local` da prévia também recebeu somente `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY` da configuração original para carregar os dados existentes. Sem essas variáveis, os repositórios retornavam listas vazias. Consultas de leitura e a interface confirmaram 2 cronogramas e 4 etapas após a configuração, sem alterações no banco. Essas variáveis não habilitam o consumo de filas pelo gateway, que permanece sem chave de serviço.

A configuração pública apontava para um túnel indisponível, causando `Failed to fetch` antes de carregar a lista. Em desenvolvimento, uma URL explicitamente definida por `NEXT_PUBLIC_WHATSAPP2_GATEWAY_URL` agora tem prioridade sobre o túnel publicado. A `.env.local` ignorada pelo Git aponta para 8789. O teste de regressão executa o cliente no contexto de navegador e verifica essa prioridade; os sete testes de multi-conta passaram após a correção. A tela de gerenciamento foi conferida no navegador.

### Conexão existente e segundo número na mesma prévia

O gerenciador pode adotar um gateway existente por `WHATSAPP2_LEGACY_UPSTREAM_URL=http://127.0.0.1:8788`. Nesse modo ele não abre um navegador para a conta principal, não copia sua sessão e não inicia seus consumidores de filas. Encaminha as operações e streams para o gateway existente e inicia processos apenas para contas adicionais. A configuração aceita somente HTTP em loopback com porta explícita; um token opcional fica no servidor em `WHATSAPP2_LEGACY_UPSTREAM_TOKEN`.

Antes de encaminhar operações da conta principal, consulta seu status e confere o número confirmado com o cadastro. Troca de identidade bloqueia o encaminhamento. Falha da conta principal não oculta as outras contas. O teste de integração usa um servidor local simulado e cobre proxy, autenticação interna, conta desconhecida e bloqueio de identidade divergente. Os 30 testes direcionados de multi-conta, escopo, fila, limites de falha e sincronização passaram.

Na prévia, a porta 8789 adota a conta conectada na 8788; a conexão adicional já cadastrada como `Samuel` aguarda pareamento pelo usuário. Não foram confirmadas duas contas reais simultaneamente. As contas adicionais ainda não têm credencial de serviço para persistência e automação no banco; a validação operacional e a migração remota continuam pendentes.

Não aplicar a migração nem reiniciar/publicar o gateway a partir desta branch sem antes reconciliar as mudanças já existentes na pasta original e conferir os artefatos remotos. A pasta original estava numa branch histórica com mudanças pendentes em gateway, API e interface. O registro de baseline de 08/10/2026 reporta diferenças posteriores e não comprova o estado remoto atual.

Antes de ativar: revisar o modelo de autorização e exposição do endpoint de cadastro; conferir migrações e versões remotas; reconciliar mudanças locais/históricas da produção arquivo a arquivo; aplicar a migração aditiva compatível; validar a conexão existente sem novo pareamento; então conectar uma segunda conta de teste autorizada e percorrer recebimento, envio, Status, mídia, pausa e reinício. Não foram enviados mensagens a clientes nem modificados chats/sessões reais durante esta implementação.

O número máximo está configurado por `WHATSAPP2_MAX_ACCOUNTS` (padrão de software 4), mas não houve teste de capacidade de hardware. `WHATSAPP2_MULTI_ACCOUNT_ENABLED=0` desativa o gerenciador, porém o procedimento de rollback em produção ainda exige impedir que filas de outras contas sejam consumidas pelo gateway antigo.

## Limites funcionais conhecidos

Após nova tentativa do usuário pelo celular, foi confirmado no endpoint `/accounts` que `WhatsApp principal` e `Samuel` estão simultaneamente em `ready`, ambas com identidade vinculada. Isso confirma o pareamento de duas contas reais. Não comprova envio/recebimento, persistência ou automação da conta adicional, que ainda precisa dessas validações e da configuração de serviço/migração já descritas.

### Correção do pareamento na prévia

O erro `Minified invariant #56367` foi identificado no acesso ao armazenamento de modelos do WhatsApp Web. A mesma segunda instância também entrava em logout/reinicialização. A mensagem local de espera de um minuto era aplicada a falhas genéricas e não comprovava rate limit do provedor.

Foram separados erros de armazenamento/navegação (503, sem bloqueio artificial de um minuto) de limites explicitamente informados pelo provedor (429, espera preservada). A geração por número agora confere socket e armazenamento antes de chamar o provedor. Reconexões de logout dão tempo de recuperação à biblioteca e não destroem uma página que já tenha voltado ao QR, código ou autenticação. Eventos de uma inicialização substituída deixam de sobrescrever o estado atual. O Chrome usa sua identificação nativa.

O perfil não vinculado da segunda conta foi preservado em backup. Um perfil novo no caminho longo ainda falhava; a prévia passou a usar o cadastro copiado em `E:/v2-local` (configurado na `.env` ignorada do gateway), mantendo o cadastro anterior preservado. Com o caminho curto, a sonda real confirmou `UNPAIRED`, armazenamento disponível e geração de QR PNG; a conta principal continuou `ready`. Essa é uma mitigação operacional conferida, não uma prova de qual chamada do sistema de arquivos do Chrome falhou. A instrumentação de diagnóstico foi retirada.

Foi acrescentado pareamento por QR à interface, com geração local pelo pacote `qrcode@1.5.4`, sem enviar o segredo de pareamento a um serviço de imagens. O pacote e seu lock foram declarados no gateway. Para esta worktree, cujas dependências são compartilhadas por junction, o pacote foi instalado separadamente em `scratch/qr-runtime`; a execução atual usa `NODE_PATH` apontando para esse diretório, sem alterar a instalação do gateway existente. Uma instalação normal das dependências do gateway inclui o pacote declarado.

Validação após a mudança: build Webpack e TypeScript passaram; 14 testes direcionados de pareamento/multi-conta passaram; suíte geral 518/521, com os três bloqueios de ambiente/base já registrados (E2E sem chave de serviço, protótipo Jev e FFmpeg ausente). A geração de um novo código real por número e a conclusão do pareamento pelo celular continuam dependentes do usuário; nenhum número fictício foi usado em tentativas reais de pareamento.

- Duas sessões reais simultâneas foram confirmadas em `ready`; não foi validado o fluxo completo das duas contas nem medido o consumo real de memória/CPU.
- Catálogos e configurações de persona continuam compartilhados, conforme o escopo inicial do plano.
- Transferências entre canais e outros caminhos legados que iniciam conversa sem conta explícita ainda requerem auditoria; não se deve presumir paridade completa desses fluxos.
- A autorização de gerenciamento e os contratos de acesso às rotas precisam ser revisados no contexto remoto antes de publicar.
- Nenhuma migração remota foi aplicada, nenhum serviço existente foi reiniciado e nenhuma implantação foi feita. A prévia usa processos locais próprios.
