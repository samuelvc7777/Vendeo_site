# Roadmap do Vendeo

## Fase 1: Fundação & Infraestrutura (Concluída)
- [x] Criação da estrutura de governança `.agents/`
- [x] Inicialização do projeto Next.js com App Router, TypeScript e Tailwind CSS
- [x] Configuração de ferramentas essenciais: Lucide Icons, Framer Motion, Vaul, Sonner
- [x] Criação do Shell Mobile (`MobileContainer`, `Header`, `BottomNav`)

## Fase 2: Experiência Visual & Gestos
- [x] Drawer / Bottom Sheet móvel interativo com física de arraste (Drag to dismiss)
- [x] Moldura de smartphone interativa para desktop com botão de alternância de modo
- [x] Toasts táteis de feedback instantâneo (Sonner)
- [ ] Transições de páginas dedicadas com View Transitions API

## Fase 3: Módulos de Domínio (Vendas / Catálogo)
- [x] Feed principal de produtos com cards táteis e badges de desconto/destaque
- [x] Bottom Sheet de detalhes completos do produto com contato direto com vendedor
- [x] Sacola de compras interativa com cálculo em tempo real e checkout Vendeo Pay
- [x] Modal de publicação rápida de anúncios (Vender)
- [x] Telas de Explorar tendências, Meus Pedidos e Perfil do Vendedor com saque PIX

## Fase 4: PWA & Offline
- [ ] Manifesto Web App (`manifest.json`) com ícones e splash screen
- [ ] Service Worker para cache e suporte offline
- [ ] Prompt inteligente para "Instalar Aplicativo"

## Fase 5: Integrações Sociais, Mensageria Real & Produtividade (Concluída)
- [x] Integração oficial com Tinder (Matches, Mensagens em tempo real e visualizador de perfis completos)
- [x] Conexão Profissional & Segura com Instagram Direct (Meta Graph API v21.0, Webhook HMAC-SHA256 e Supabase)
- [x] Motor de Humanização Anti-IA e Assistente Contextual Larissa (cadência realista, vocabulário natural e anti-repetição de emojis)
- [x] Cofre Flutuante de Pastas, Textos, Áudios Baixados e Fotos no Chat (IndexedDB de alta capacidade + envio nativo)
- [x] Sincronização & Normalização de Fuso Horário Oficial (Horário de Brasília America/Sao_Paulo / UTC-3 em todas as APIs e Webhooks)
- [x] Encaminhamento Inteligente com Conversor Universal de Áudio (.mp4, .mp3, .ogg, .webm, .wav), Confirmação de Destinatário e Envio com Delay Humano em Segundo Plano no Servidor (Duração do Áudio / 10s Texto)
- [x] Navegação Segura de Retorno (History API / popstate) sem fechar o App, com Preservação Integral de Scroll, Filtros e Estado
- [x] Indicadores Elegantes de Leitura na Lista (Sininho para conversas abertas, bolinha indicadora para não lidas e horário colado à direita)
- [x] Persistência Definitiva de Leitura (Sininho permanente vs Bolinha) com sincronização síncrona de cache local e banco Supabase
- [x] Design Fiel do Instagram Direct com Barra de Pílulas Oficial, Aba Pedidos e Gestão Completa de Contas Restringidas
- [x] Menu Contextual de Clicar e Segurar (Long Press) com Opção de Restringir Conta, Alternar Leitura e Ver Perfil
- [x] Sincronização em Nuvem Global do Cofre (Supabase Cloud + Realtime entre múltiplos aparelhos simultâneos)
- [x] Botão de Exclusão de Pasta no Cofre com Modal Nativo de Confirmação Segura e Feedback Tátil
- [x] Botão de Resposta Rápida (Reply do Instagram) Visível no Mobile/Touch e Renderização Oficial de Mensagens Respondidas por Terceiros (Quote Reply)
- [x] Ocultação Automática do Sininho em Conversas Respondidas (sininho some quando a última mensagem for enviada pelo próprio usuário)
- [x] Reordenação de Itens do Cofre por Clique e Arraste (Drag & Drop com Framer Motion e sincronização na nuvem)
- [x] Botão de Edição de Itens do Cofre (Título e Conteúdo de texto ao lado do botão de exclusão com modal dedicado)
- [x] Seleção Múltipla de Itens no Cofre com Barra Flutuante e Envio em Lote Sequencial Humanizado
- [x] Remoção da Opção de Responder a Si Mesmo (botão de resposta visível exclusivamente em mensagens recebidas de terceiros)
- [x] Correção Definitiva e Rastreamento de Respostas a Mensagens Específicas (Quote Reply) com Payload Oficial da Meta, Resolução Retroativa no Supabase e Logs Ponta a Ponta
- [x] Deploy da Edge Function do Supabase em Produção com Payload Oficial Meta (`reply_to` + `messaging_type: RESPONSE`), Resolução Nativa de Quotes no Webhook e Blindagem de Polling na UI
- [x] Correção Definitiva do Envio de Mensagens no Tinder (disparo real autenticado na API oficial do Tinder Web) e Eliminação Total do Bug Visual de Mensagens Duplicadas
- [x] Reordenação de Itens do Cofre por Botões Táteis de Setas (⬆️ / ⬇️) eliminando qualquer conflito de arraste e garantindo scroll vertical 100% livre e nativo no mobile com sincronização imediata na nuvem
- [x] Restringir Matches no Tinder com Identidade Visual Nativa (aba dedicada Restritos, menu de clique e segurar estilizado com tema Tinder, banner de proteção, botões no cabeçalho e sincronização em tempo real no Supabase)
- [x] Motor de Transcrição de Áudio 100% em Nuvem (Groq Whisper Large v3), com Injeção Automática de Áudios no Contexto do Prompt da IA Larissa, Visualizador/Player com Transcrição Inline no Chat e Gestão Segura de Chave de API na aba Config
- [x] Botão de Download de Áudio Visível e Tátil nos Balões do Chat (`InstagramAudioMessage.tsx`), com estratégia híbrida de download (blob + link nativo), toasts instantâneos Sonner e toque ergonômico no mobile
- [x] Correção Definitiva do Upload e Salvamento de Áudios no Cofre Flutuante (`vendeo_vault`), com cliente oficial do Supabase Storage na Edge Function, preservação dos formatos de áudio sem inflar tamanho e persistência robusta na nuvem
- [x] Sincronização Integral e Exibição Completa de Mensagens do Tinder (Edge Function com busca ao vivo na API oficial do Tinder `/v2/matches/{matchId}/messages`, preservação de histórico e previews na listagem sem sobrescrita, ordenação cronológica ascendente estrita por timestamp na view e remoção de interceptações indevidas de texto por cards de mídia)
- [x] Blindagem de Linguagem Estritamente Feminina e Anti-Clichê de IA (inclusão de "trampo", "dar uma agitada" e validações mornas na lista de proibições, reforço de vocabulário e gírias femininas doces nos prompts do Instagram e Tinder, e sanitização automática inteligente para converter desvios masculinos em linguagem 100% feminina)
- [x] Correção Definitiva de Layout no Chat do Instagram Direct (Normalização visual do Quote Reply com autor correto "Você", remoção de borda azul e textos redundantes "respondeu a você", eliminação de truncamento quebrado no meio de palavras, correção da orientação do ícone de resposta para a esquerda, alinhamento vertical sutil e adição de espaçamento inferior seguro impedindo corte pelo rodapé)
- [x] Blindagem Definitiva de Contenção de Balões de Mensagem no Chat (Eliminação do bug de mensagem saindo/cortando fora da tela: aplicação de `w-full min-w-0 max-w-full overflow-hidden` nos contêineres flex, `break-words [word-break:break-word] [overflow-wrap:anywhere]` no balão e parágrafos, `overflow-x-hidden` na área de mensagens e contenção com `text-ellipsis` no Quote Reply impedindo estouro de largura intrínseca flexbox)
- [x] Otimização e Limpeza Visual do Header do Chat (Remoção do indicador visual "LIVE/SYNC" do cabeçalho da conversa aberta, mantendo o WebSocket Realtime 100% ativo em segundo plano e liberando espaço horizontal para exibição do nome do contato no mobile)
- [x] Expansão de Contexto Integral da IA para 500 Mensagens & Agrupamento de Raciocínio Contínuo (Aumento da busca no Supabase para até 500 mensagens recentes em ordem cronológica reversa eliminando perda de contexto no momento atual, garantia de consideração do histórico completo de ambos os lados e reformulação da diretriz da IA para unificar mensagens de fluxo contínuo do pretendente em 1 único balão natural com `indices: [[0, 1]]` em vez de fragmentar respostas artificialmente)
- [x] Botões Lado a Lado no Modal de Perfil do Instagram (Inclusão do botão "Abrir perfil no Instagram" ao lado de "Voltar para a conversa" com acionamento nativo no app do Instagram via Intent no Android e Universal Link no iOS quando for perfil do Instagram, mantendo exclusivamente o botão único de retorno nos perfis do Tinder)

## Fase 6: Engenharia & Habilidades de Agentes IA (Matt Pocock Skills)
- [x] Instalação do Pacote Oficial de Skills de Matt Pocock (`mattpocock/skills`) com 37 ferramentas de engenharia, arquitetura, testes e refinamento em `.agents/skills/`, `.claude/skills/` e `skills/` (incluindo `ask-matt`, `code-review`, `codebase-design`, `diagnosing-bugs`, `domain-modeling`, `grill-me`, `grill-with-docs`, `tdd`, `to-spec`, `to-tickets`, `triage`, `wayfinder`, `wizard`, etc.)

## Fase 7: CRM de Conversão Guiada por Etapas & Checklists (Check-ups)
- [x] Arquitetura Completa de Funil de Conversão com Check-ups:
  - Modelagem de domínio formal em `CONTEXT.md` e decisão arquitetural em `docs/adr/0001-chat-funnel-and-checklists.md`.
  - Entidades `ChatStage`, `ChatProgress`, `StageChecklistItem` e interfaces de repositório em Clean Architecture.
  - Gerenciador de Etapas na tela de Configurações (`ChatStagesManager`), com reordenação tátil (⬆️ / ⬇️), paleta de cores e vinculação direta com Pastas do Cofre de Ativos (`VaultFolder`).
  - Barra Superior Retrátil no Chat Aberto (`ChatStageBar`) com visualização compacta/expandida, checkboxes táteis, botão de Disparo Rápido com 1 Toque (envia fotos, áudios e textos com delay humano) e avanço manual consciente para a próxima etapa ou conclusão do Objetivo Final.
  - Marcação híbrida inteligente: auto-check imediato ao disparar mídia do cofre ou enviar frases idênticas, permitindo toggle manual livre pelo operador.
  - Sincronização em nuvem resiliente no Supabase (`instagram_conversations`) com suporte a Realtime e cache local instantâneo no navegador.
  - Filtros horizontais por etapa na listagem de conversas do Instagram e Tinder ("Todas", etapas 1..N, "🏆 Concluídos") e badges coloridas em cada card.

## Fase 8: Governança do Cofre & Calibração de Fuso Horário (Concluída)
- [x] Edição e Renomeação Dinâmica de Pastas no Cofre Flutuante (`FloatingVaultModal`):
  - Botão tátil de edição com ícone de lápis (`Pencil`) integrado diretamente nos cards de pastas criadas (ao lado do contador de itens e da lixeira) e no cabeçalho interno da pasta aberta.
  - Modal nativo e elegante de edição com foco automático, validação de nome, tratamento de erro e toasts táteis instantâneos (`sonner`).
  - Sincronização em tempo real na nuvem (`SupabaseVaultRepository`) e no cache local persistente (`IndexedDbVaultRepository`).
- [x] Calibração Rigorosa de Fuso Horário Oficial do Brasil (Horário de Brasília America/Sao_Paulo / UTC-3):
  - Função auxiliar canônica `formatToBrasiliaTime` em todas as rotas e eventos da Edge Function do Supabase (`supabase/functions/api/index.ts`).
  - Eliminação definitiva da divergência de +3 horas causada por servidores em nuvem rodando em UTC.
  - Exibição consistente de hora nos balões do chat e nas mensagens otimistas via `formatMessageTime(msg.timestamp || msg.sentDate || msg.createdAt)`.
  - Deploys oficiais executados em produção: Supabase Edge Functions (`api`) e Firebase Hosting (`https://vendeo-e755e.web.app`).
- [x] Limpeza e Otimização Visual dos Cards de Conversa do Instagram Direct:
  - Remoção definitiva da badge redundante `"Não respondido"` / `"Respondido"` ao lado do nome do contato, mantendo o layout limpo e minimalista oficial do Instagram.
  - Preservação da badge de segurança `"Restrito"` e da badge colorida da etapa do funil (Check-ups).
- [x] Refinamento da Barra de Etapas e Isolamento Total do Tinder:
  - Remoção do botão estático `"Todas (xxx)"` da barra de etapas do Instagram, habilitando alternância fluida (toggle) por toque em cada etapa e no botão Concluídos.
  - Isolamento estrito do Tinder: remoção completa da barra de etapas na listagem, da barra retrátil interna (`ChatStageBar`), das badges nos cards e dos disparos de auto-check em conversas do Tinder.
- [x] Download Nativo de Áudios e Fotos no Cofre Flutuante (`FloatingVaultModal`):
  - Botão tátil de download com ícone `Download` adicionado tanto no rodapé do item (ao lado dos botões "Encaminhar Áudio" e "Encaminhar Foto") quanto no cabeçalho de ações rápidas e na busca global de itens.
  - Estratégia de download híbrida com prioridade para Blobs locais em cache IndexedDB e fallback seguro via fetch e link nativo para mídias do Supabase Storage.
  - Feedback tátil instantâneo via toasts `sonner` com indicação de progresso e sucesso.

## Fase 9: Refinamento de CRM ("Finalizado") & Eliminação do Erro 400 Supabase (Concluída)
- [x] Renomeação Integral de "Ganho" para "Finalizado":
  - Badge no cabeçalho retrátil do chat (`ChatStageBar`): alterada de `[ 🏆 Ganho ]` para `[ 🏆 Finalizado ]`.
  - Botão de ação rápida no rodapé do drawer: atualizado para `[ 🏆 Finalizado / Marcar como Finalizado ]`.
  - Badge em cada card de conversa na listagem do Instagram Direct (`InstagramDirect`): `[ 🏆 Finalizado ]`.
  - Pílula de filtro na barra horizontal de etapas: `[ 🏆 Finalizados ]`.
- [x] Resolução Definitiva do Erro HTTP 400 (Bad Request) no Supabase:
  - Causa raiz identificada: `SupabaseChatStageRepository.ts` enviava campos inexistentes no schema do PostgreSQL (`is_verified`, `profile_pic_url`, `unread_count`, `last_message_text`, `last_message_timestamp`), rejeitados pelo PostgREST com status 400.
  - Normalização dos payloads de upsert para utilizar apenas as colunas oficiais da tabela `instagram_conversations` (`id`, `username`, `full_name`, `status`, `unread`, `stage_completed_rules`, `last_message`, `last_message_at`, `updated_at`).
  - Teste de integração ponta a ponta validado com resposta HTTP 200 OK no Supabase.
- [x] Blindagem contra Exibição de Registros de Sistema na Lista de Chats:
  - Filtragem estrita de registros de infraestrutura (`__chat_stages__`, `__chat_progress__`, `__vault_data__`) na query Supabase, no fallback da API e no callback de Realtime em `InstagramDirect.tsx`.
- [x] Deploy Completo em Produção:
  - Build otimizado Next.js 16 com zero erros de compilação ou TypeScript.
  - Deploy publicado no Firebase Hosting (`https://vendeo-e755e.web.app`).

## Fase 10: Integração Ágil do Gemini com Links Diretos de Chat & Cópia com 1 Toque (Concluída)
- [x] Geração de Links Universais Diretos no Prompt da IA (`GenerateAiPromptUseCase.ts`):
  - Inclusão automática de link direto clicável para o Instagram (`https://ig.me/m/{username}`) ou Tinder (`https://tinder.com/app/messages/{id}`).
  - Formatação Híbrida Inteligente no Gemini (Leitura Responsiva vs Cópia Limpa Contínua):
    - **Leitura rápida sem rolagem lateral:** O Gemini renderiza o texto em citação em negrito (`> **texto da resposta**`), quebrando as linhas de forma natural e responsiva na tela do smartphone.
    - **Cópia limpa com 1 clique:** O Gemini gera logo abaixo o bloco de código Markdown (` ```text `) estritamente em **uma única linha contínua**, sem quebras artificiais (`\n`). Ao clicar no botão nativo "Copiar" e colar no Direct do Instagram, a mensagem cola perfeitamente fluida e limpa, sem quebras esquisitas.
  - Indicação contextual da mensagem do pretendente antes de cada balão de resposta no Gemini (`💬 Mensagem N (Respondendo a: "mensagem dele")`).
  - Orientação no prompt para o operador no iOS/iPhone (toque longo de 1s para fixar a abertura no app do Instagram caso o Safari tente interceptar).
  - Preservação do bloco JSON oficial delimitado no rodapé da resposta para automação compatível com o app.
- [x] Parser Resiliente e Atalho Nativo no Modal (`AiAssistantModal.tsx`):
  - Compilação estrita TypeScript e build Next.js 16 validados com zero erros.
- [x] Modo Livre e Espontâneo da Persona Larissa (Eliminação de Regras e Travas Rígidas):
  - Remoção de dezenas de restrições prescritivas e proibições rígidas (hard-bans de emojis, travas de perguntas, proibições de ponto/exclamação, fórmulas de tamanho de frase e pares contrastivos).
  - Preservação estrita da identidade e personalidade da Larissa (23 anos, São João del Rei, Enfermagem no 10º período, lojinha de moda masculina, meiga, autêntica e doce).
  - Preservação do formato prático de operação no Gemini (atalho clicável do chat, balão para leitura na tela sem scroll horizontal, bloco ` ```text ` contínuo para copiar com 1 clique e JSON oficial no rodapé).
- [x] Blindagem Anti-Gírias e Anti-Clichês (`GenerateAiPromptUseCase.ts`):
  - Remoção de gírias masculinas, pesadas ou forçadas da internet ("trampo", "mano", "brother", "show de bola", "massa", "top", "bora", "firmeza", "daora", "rolê").
  - Remoção de clichês artificiais de assistente de IA ("Que bacana saber disso!", "Com certeza!", "Compreendo perfeitamente", "Trocar uma ideia contigo", "Super entendo", "Que incrível!").
  - Calibração de fala limpa, meiga, feminina e autêntica de uma jovem mineira de 23 anos com exemplos grounded de naturalidade.


## Fase 12: Modelo ChatGPT Terra com Raciocínio Alto & Envio Inteligente de Áudios (Concluída)
- [x] Integração do Modelo `gpt-5-6-terra` com Raciocínio Alto (`reasoning: { effort: "high" }`):
  - Configuração do modelo prioritário na Kie.ai para execução avançada tanto no Edge Function quanto no hook de piloto automático.
  - Timeout estendido de 45 segundos para suporte a cadeias de raciocínio aprofundadas.
  - Roteamento inteligente na Edge Function do Supabase (`supabase/functions/api/index.ts`) com fallback robusto.
- [x] Regra de Envio Inteligente de Áudios Pessoais da Larissa:
  - **Cenário A (Rapaz perguntou sobre ela):** A Larissa reage com meiguice e avisa previamente que vai mandar um áudio contando da rotina (*"Vou te mandar um áudio te contando tudinho da minha rotina kkk"*), enviando o áudio no balão seguinte.
  - **Cenário B (Rapaz NÃO perguntou sobre ela):** A Larissa nunca manda o áudio seco. Ela reage aos detalhes da rotina dele com bom humor, avisa de forma espontânea (*"Deixa eu te falar um pouquinho de mim também pra vc me conhecer melhor"*) e então envia o áudio de apresentação.
  - **Proibição Estrita:** Áudios sobre ela jamais são enviados de forma descontextualizada ou sem aviso prévio.
- [x] Separação e Cadência Humana de Balões e Mídias no AutoPilot:
  - Resolução de combos obrigatórios e envio sequencial com cadência humana (10s para texto, tempo exato do áudio para mídias).
  - Soma cumulativa de delays para envios múltiplos (2 áudios, 2 textos ou texto + áudio) replicando perfeitamente o comportamento do operador humano.
- [x] Deploy Ponta a Ponta:
  - Edge Function `api` implantada com sucesso no Supabase (`wsdualhvopidgqcumonr`).
  - Frontend compilado e implantado com sucesso no Firebase Hosting (`https://vendeo-e755e.web.app`).

## Fase 13: Normalização Temporal Absoluta, Datas Reais e Cronologia Estrita no Prompt da IA (Concluída)
- [x] Eliminação do Bug "Tudo como Hoje" e Deslocamento Duplo de Fuso:
  - Causa raiz eliminada: as rotas de backend e Edge Functions não mais pré-formatam `m.timestamp` apenas como `"HH:mm"`, preservando o timestamp SQL/ISO completo (`sentDate || timestamp`).
  - `getMessageTimestampMs`: normalização robusta de strings SQL (`2026-09-13 19:51:50+00`) para padrão ISO com conversão de milissegundos precisa.
  - `formatMessageDateTime`: contextualização inteligente no fuso oficial de Brasília (`America/Sao_Paulo` / UTC-3):
    * `"hoje às HH:mm"` para mensagens do dia de hoje.
    * `"ontem às HH:mm"` para mensagens de ontem (permitindo à IA discernir saudações passadas como "Boa tarde ontem").
    * `"DD/MM às HH:mm"` (ex: `13/09 às 16:51`) para dias anteriores.
- [x] Ordenação Cronológica Estrita Ascendente:
  - Ordenação por `(a.sentDate || a.timestamp)` em vez de ordenar apenas pela hora do dia, eliminando o embaralhamento de mensagens de dias diferentes.
  - Sincronização nos use-cases e componentes: `GenerateAiPromptUseCase.ts`, `instagram_ai.ts`, `index.ts`, `route.ts`, `cloud_autopilot.ts`, `useAutoPilot.ts` e `AiAssistantModal.tsx`.
- [x] Deploys Oficiais em Produção:
  - Supabase Edge Function `api` atualizada com sucesso no projeto `wsdualhvopidgqcumonr`.
  - Firebase Hosting atualizado com sucesso em `https://vendeo-e755e.web.app`.

## Fase 14: Fila Central de Envio Sequencial & Delays Acumulativos Inteligentes (Concluída)
- [x] Arquitetura de Fila Central por Conversa (`latestScheduledDeliverAtRef` & `getScheduledQueueInfo`):
  - Rastreamento dinâmico e síncrono da última mensagem agendada (`deliverAt > Date.now()`) no chat aberto, combinando o estado do React com `ref` síncrono à prova de cliques simultâneos rápidos.
  - Cálculo atômico de tempo restante em segundos (`remainingSeconds`), timestamp alvo final e quantidade de itens na fila.
- [x] Encadeamento Sequencial do Cofre de Ativos & Check-ups (`handleForwardVaultItem` & `handleQuickSendChecklistItem`):
  - Ao enviar itens do cofre ou checklists com mensagens já na fila, o novo item soma sua cadência natural (10s para texto/foto, duração exata em segundos para áudios) ao tempo restante da última mensagem agendada.
  - O item aguarda o término das mensagens anteriores e dispara estritamente em seguida, eliminando qualquer inversão ou atropelamento de ordem.
- [x] Proteção e Enfileiramento no Input Normal de Texto (`sendMessageWithText`):
  - Se não houver mensagens agendadas na conversa, o envio pelo input normal ocorre imediatamente (delay 0s), preservando a digitação em tempo real.
  - Se já houver mensagens agendadas na fila (geradas pela IA ou enviadas pelo cofre), a nova mensagem digitada entra automaticamente no final da fila com contagem regressiva visual (`MessageCountdown`) e delay acumulado correspondente (`remainingSeconds + 10s`).
- [x] Multi-Envio da IA com Delays Encadeados (`handleSendMultipleMessages`):
  - Ao disparar respostas geradas pela IA, o balão 1 aguarda o tempo residual de qualquer item pendente anterior mais sua cadência, e os balões subsequentes somam gradualmente suas durações, respeitando a cadência natural humana.
- [x] Verificação Rigorosa & Deploy em Produção:
  - TypeScript em modo estrito validado com zero erros (`npx tsc --noEmit`).
  - Next.js 16 compilado e otimizado com sucesso (`npm run build`).
  - Publicação oficial concluída no Firebase Hosting (`https://vendeo-e755e.web.app`).

## Fase 15: Arquitetura Backend-Driven de Envio & Desacoplamento Total da View (Concluída)
- [x] Banco de Dados Supabase (`instagram_messages` e `tinder_messages`):
  - Criada coluna duradoura `deliver_at TIMESTAMPTZ` em `instagram_messages` e `tinder_messages`.
  - Criada coluna `status TEXT DEFAULT 'sent'` em `tinder_messages`.
- [x] Custódia Integral no Backend (Supabase Edge Function & Next.js API):
  - Ao receber qualquer mensagem com `delaySeconds > 0`, o servidor grava imediatamente com `status: "sending"` e `deliver_at: now + delaySeconds * 1000`.
  - O Backend assume 100% da responsabilidade de espera assíncrona em background (`EdgeRuntime.waitUntil`), garantindo a entrega na Meta Graph API e Tinder mesmo se o usuário fechar a aba 1 segundo depois de clicar em enviar.
  - Ao concluir a entrega, o Backend atualiza o banco para `status: "sent"` e emite broadcast Supabase Realtime informando a entrega.
  - O `GET` de mensagens de ambas as plataformas retorna `deliverAt` para que a contagem regressiva seja viva e sincronizada com o banco ao recarregar a página ou abrir em outro celular.
- [x] View Reativa Pura (`InstagramDirect.tsx`):
  - **Eliminação completa** do loop `for` com `await new Promise(setTimeout)` no navegador durante envios múltiplos da IA: todas as mensagens são disparadas imediatamente em paralelo para a API com seus respectivos `delaySeconds`.
  - A View não segura timers frágeis na memória da aba; ela reflete reativamente o estado do banco e os eventos do Supabase Realtime.
  - Fechamento de aba 100% seguro: fechar a aba após o clique não cancela nem atrasa nenhuma mensagem agendada.
- [x] Deploys Oficiais em Produção:
  - Supabase Edge Function `api` implantada com sucesso no projeto `wsdualhvopidgqcumonr`.
  - Firebase Hosting compilado e implantado com sucesso em `https://vendeo-e755e.web.app`.

## Fase 16: Indicador Oficial de "Visto" (Read Receipts / Mensagem Visualizada) no Instagram Direct (Concluída)
- [x] Banco de Dados Supabase:
  - Adicionada coluna duradoura `seen_at TIMESTAMPTZ` na tabela `instagram_conversations` (com `last_status TEXT`).
  - Adicionada coluna `seen_at TIMESTAMPTZ` na tabela `instagram_messages` (com `status TEXT`).
  - Adicionadas colunas correspondentes em `tinder_conversations` e `tinder_messages` para consistência e suporte futuro.
- [x] Webhooks da Meta Graph API (Edge Function Supabase & Next.js Route):
  - Captura dos eventos oficiais de leitura (`msgEvent.read`) contendo `watermark` e `sender.id`.
  - Resolução atômica de `conversationId` a partir do IGSID do remetente.
  - Atualização no banco: `instagram_conversations.last_status = 'seen'` e `seen_at = watermarkIso`.
  - Atualização no banco: `instagram_messages.status = 'seen'` e `seen_at = watermarkIso` para mensagens enviadas por nós (`is_mine = true` e `timestamp <= watermarkIso`).
  - Disparo de broadcasts de altíssima velocidade (< 20ms) via Supabase Realtime nos canais `instagram_seen` e `instagram_conversation_update`.
- [x] Camada de Domínio, Repositórios e Hooks:
  - `InstagramConversation` e `InstagramMessage` atualizados com `lastStatus`, `seenAt` e `status: 'seen'`.
  - `SupabaseInstagramRepository`: mapeamento completo de `lastStatus` e `seenAt` em `getConversations`, `saveConversation`, `getMessages` e `saveMessage`.
  - `RealtimeBroadcaster`: método `broadcastInstagramSeen` implementado e campos `lastStatus` e `seenAt` integrados.
  - `useChatRealtime`: escuta dedicada de `instagram_seen` com sincronização entre abas via `BroadcastChannel` local.
- [x] Interface do Usuário (Fidelidade Absoluta ao Instagram Direct Oficial):
  - **Na Listagem de Conversas (Inbox):**
    - Quando a última mensagem é nossa (`lastSender === 'me'`) e o cliente visualizou (`lastStatus === 'seen'`), o preview exibe o texto nativo do Instagram: `Visto · HH:mm` em cinza sutil (`text-[#8e8e8e]`), sem necessidade de abrir o chat para saber quem deixou a Larissa no vácuo.
    - No lado direito do card, renderiza a miniatura sutil do avatar do contato (estilo oficial do app móvel do Instagram quando a mensagem é vista).
    - Ao enviar nova mensagem pela Larissa ou IA, o status reseta automaticamente para `sent`, garantindo que o "Visto" só apareça após o contato abrir a mensagem nova.
  - **No Chat Aberto (Thread):**
    - Abaixo do último balão enviado por nós que foi visualizado, exibe o indicador oficial alinhado à direita: `Visto às HH:mm` (ou `Visto`).
- [x] Deploys Oficiais em Produção:
  - TypeScript estrito validado com zero erros (`npx tsc --noEmit`).
  - Next.js 16 compilado com sucesso (`npm run build`).
  - Supabase Edge Function `api` implantada com sucesso no projeto `wsdualhvopidgqcumonr`.
  - Firebase Hosting compilado e implantado com sucesso em `https://vendeo-e755e.web.app`.

## Fase 17: Parser Semântico da Atria (Zero Throw), Reconciliação de Áudios & Deploy v167 (Concluída)
- [x] Parser Semântico Tolerante a Falhas de Tripla Camada (`parseAtriaJson`):
  - Camada 1: JSON direto com limpeza de tags `<think>` e delimitadores de código markdown.
  - Camada 2: Regex com lookahead `(?=\s*,\s*"[a-zA-Z_]+"|\s*})` para resgatar campos mesmo quando o modelo não escapa aspas internas no campo `reason`.
  - Camada 3: Extração de texto livre e reflexão corrida sem JSON, com dedução de ação semântica e sem lançamento de exceção (`Zero Throw`).
  - Extinção definitiva da mensagem de erro *"Atria retornou formato inválido; Sol seguirá com uma resposta natural."*.
  - Normalização suave de ações não padronizadas para `call_persona` preservando a diretriz estratégica gerada.
- [x] Reconciliação Automática de Áudios Pessoais do Histórico:
  - Detecção no histórico de conversas se os 2 áudios da Larissa já foram enviados anteriormente.
  - Promoção automática da conversa para a Etapa 02 (2/5) com marcação dos áudios no checklist e ativação de pausa com handoff humano quando o contato já respondeu.
- [x] Verificações e Cobertura Automatizada:
  - Bateria de testes expandida para 29 testes em `scripts/test-cloud-autopilot.cjs` com 100% de sucesso.
  - Tipagem TypeScript estrita validada com 0 erros (`npx tsc --noEmit`).
  - Next.js build de produção validado (`npm run build`).
- [x] Deploy da Edge Function em Produção:
  - Supabase Edge Function `api` publicada com status `ACTIVE`, versão **v167** no projeto `wsdualhvopidgqcumonr`.

## Fase 18: Calibração de Tolerância e Espera de Rede para Kie.ai (Sol) & Deploy v168 (Concluída)
- [x] Ampliação de Espera de Recuperação (Backoff Paciente):
  - No backend (`cloud_autopilot_support.ts`), intervalo entre tentativas do Sol aumentado de 1s para **3.5s** com timeout estendido para 45s.
  - No frontend (`GenerateAiResponseUseCase.ts`), adicionado delay de **3.5s** antes do retry automático para permitir que o cluster da Kie.ai finalize a reinicialização de pods.
  - Captura ampliada de códigos de erro no stream SSE: inclui `server_error`, `error` e `upstream_error`.
- [x] Verificações e Cobertura:
  - Bateria de 29 testes do piloto automático 100% verde (`scripts/test-cloud-autopilot.cjs`).
  - TypeScript estrito validado com 0 erros (`npx tsc --noEmit`).
  - Next.js build de produção compilado com sucesso (`npm run build`).
- [x] Deploys Oficiais em Produção:
  - Supabase Edge Function `api` publicada com status `ACTIVE`, versão **v168** no projeto `wsdualhvopidgqcumonr`.
  - Firebase Hosting compilado e implantado com sucesso em `https://vendeo-e755e.web.app`.

## Fase 19: Arquitetura Atria Spec .md, Sol Otimizado (20 msgs), Pesquisa Web & HUD Reativo Antigravity (Concluída)
- [x] Arquitetura Atria Spec .md & Sol Otimizado:
  - Atria recebe Dossiê Completo (500 mensagens, áudios transcritos, contexto temporal e pesquisa na web).
  - Sol recebe histórico leve com apenas as últimas 20 mensagens + Especificação Oficial da Atria (`=== ESPECIFICAÇÃO OFICIAL DESTE TURNO (ATRIA SPEC .md) ===`).
  - Prompt do Sol reduzido de 48k para 23k caracteres, acelerando o tempo de resposta de 8-15s para 1-2s.
- [x] Pesquisa na Internet & Regra da Curiosidade Meiga:
  - Detecção automática de entidades, artistas, shows e locais citados pelo cliente no turno.
  - Injeção das informações reais no Dossiê da Atria com a diretriz da Curiosidade Meiga (*"Nossa, nunca ouvi falar kkk, toca o que por lá?"*) para manter o charme e a autenticidade humana da Larissa caso ela não conheça o assunto.
- [x] HUD Cognitivo Reativo no Chat (Estilo Antigravity):
  - Card flutuante sobre o chat se auto-expande reativamente durante o processamento da IA.
  - Stepper visual com 3 etapas: 1. Atria (Estratégia) -> 2. Sol (Voz da Larissa) -> 3. Envio (Cadência e balões).
  - Exibição ao vivo dos pensamentos estruturados da Atria (ciano) e do Sol (âmbar), com estados animados de raciocínio.
  - Controles completos de operador: timer regressivo em segundos, edição imediata do balão, envio prioritário ("Enviar Já") e pausa emergencial.
- [x] Limpeza da Caixa de Entrada (Inbox):
  - Removido o badge piscante `Digitando` ao lado do nome do cliente na lista de conversas, mantendo apenas o selo discreto e elegante `Piloto`.
- [x] Verificação & Cobertura:
  - Bateria ampliada para **39 testes automatizados** em `scripts/test-cloud-autopilot.cjs` com **100% de aprovação**.
  - TypeScript estrito (`npx tsc --noEmit`) validado com **0 erros**.

## Fase 21: Publicação de Stories no WhatsApp 2 com Controle Granular de Privacidade e Audiência Específica (Concluída)
- [x] Backend & Gateway WhatsApp 2 (`services/whatsapp2-gateway`):
  - Endpoints REST dedicados: `GET /status/privacy`, `POST /status/privacy` e `GET /status/contacts`.
  - Normalização de aliases e validação estrita com tipagem defensiva (`contact`, `deny-list`, `allow-list`).
  - Sincronização em tempo de execução via WPPConnect (`WPP.privacy.setStatus` e `WPP.status.updateParticipants`).
  - Agregação inteligente de contatos da agenda e conversas recentes ativas (`client.getContacts` + `client.getChats` + WPP) com busca em tempo real e ordenação alfabética.
  - Suporte ao parâmetro `privacy` nos disparadores de status de texto, imagem e vídeo.
- [x] Cliente Frontend & Camada de Domínio:
  - Tipos TypeScript estritos em `whatsapp2-client.ts` e `src/domain/entities/WhatsAppStatus.ts` (`WhatsAppStatusPrivacyConfig`, `WhatsAppStatusContact`, `privacyType`, `privacyCount`).
  - Métodos assíncronos `getWhatsApp2StatusPrivacy()`, `setWhatsApp2StatusPrivacy()` e `getWhatsApp2StatusContacts()`.
  - Integração do payload de privacidade nas chamadas de publicação de texto, imagem e vídeo.
- [x] Interface de Usuário Mobile First (`WhatsAppStatusModal.tsx`):
  - Botão de seletor de público integrado no rodapé de publicação com visualização de status ativo e contadores dinâmicos (🟢 *Meus contatos*, 🟠 *Exceto X*, 🟣 *Somente X*).
  - Sub-modal nativo com 3 opções claras de privacidade:
    1. *Meus contatos* (Padrão para toda a agenda).
    2. *Meus contatos, exceto...* (Bloqueio seletivo com lista de exclusão).
    3. *Compartilhar somente com...* (Estilo Melhores Amigos / lista de inclusão seletiva).
  - Barra de busca instantânea de contatos por nome ou número, com avatars, checkboxes arredondados e ações em lote ("Limpar", "Marcar listados").
  - Badges visuais coloridas no histórico de publicações indicando o público de cada story enviado.
- [x] Testes & Validação Técnica Ponta a Ponta:
  - 21 testes automatizados específicos de Status/Stories aprovados (`tests/test_whatsapp_status_*.mjs`).
  - Endpoints HTTP testados e validados ao vivo na porta 8788 com a sessão persistente da Larissa Resende conectada e intacta.
  - TypeScript estrito validado com 0 erros (`npx tsc --noEmit`).

## Fase 22: Biblioteca de Stories Evergreen com Filtro Automático Anti-Repetição (Concluída)
- [x] Arquitetura de Domínio & Repositório:
  - Entidade `WhatsAppStoryMedia.ts` com ID único, tipo (`image` | `video`), `mediaUrl`, `caption`, `seenContactIds: string[]`, `timesPosted`, `createdAt`, `lastPostedAt`.
  - Repositório `WhatsAppStoryMediaRepository.ts` com persistência estruturada local, métodos `getAll`, `getById`, `create`, `save`, `delete`, `recordContactsSeen` e `resetSeenContacts`.
- [x] Central de Controle / Configurações:
  - Componente `WhatsAppStoryMediaManager.tsx` integrado em `ConfigView.tsx` na seção *Biblioteca de Stories (Evergreen)*.
  - Upload de imagens e vídeos com preview em tempo real, definição de título e legenda padrão.
  - Grid com contadores em tempo real de visualizadores únicos (`seenContactIds`) e total de publicações (`timesPosted`).
  - Ações para excluir e resetar histórico de visualizadores.
- [x] Modal de Publicação do WhatsApp (`WhatsAppStatusModal.tsx`):
  - Nova aba *Biblioteca* com cards dos stories salvos e botão "Usar este Story".
  - **Filtro Estrito Anti-Repetição:** Contatos que já visualizaram aquele story específico **são sumariamente ocultados da lista de seleção** (`eligibleContactsList`), exibindo apenas novos contatos que nunca viram o conteúdo.
  - Banner informativo dinâmico destacando a quantidade de contatos ocultados e novos elegíveis.
  - Ação em lote "Marcar listados (N)" para selecionar rapidamente os contatos novos.
  - Atualização automática e atômica de `seenContactIds` pós-publicação bem-sucedida, garantindo que os contatos marcados nunca mais apareçam para aquele mesmo story.
- [x] Coexistência Fluida entre Modelo Tradicional e Biblioteca Evergreen:
  - Preservação 100% integral do modo avulso tradicional: abas Texto, Foto e Vídeo funcionam de maneira independente sem ocultação de contatos (`selectedLibraryStory === null`).
  - Badge no preview com botão tátil "Desmarcar" permitindo transitar instantaneamente do story da biblioteca de volta para o modelo tradicional avulso.
  - Seleção manual de arquivo (upload de foto ou vídeo) redefine automaticamente o modo para avulso tradicional.
  - No modo tradicional, o seletor de público exibe todos os contatos salvos da agenda sem nenhum filtro restritivo.
- [x] Correção Definitiva da Publicação de Status (Pipeline Nativo WhatsApp Web):
  - Diagnóstico em tempo de execução via Puppeteer: identificada falha de rejeição interna de criptografia multi-device na biblioteca WPPConnect (`isSendFailure: true`, `ack: 0`), mantendo o status em loop de "Enviando...".
  - Implementação de automação de UI nativa oficial no WhatsApp Web para postagem de status de texto (abre modal oficial, injeta texto via `InputEvent`, ajusta formatação e aciona botão nativo "Enviar").
  - Testado e comprovado ao vivo: status publicado oficialmente nos servidores da Meta com `ack: 1` e transição imediata para *"Hoje às 12:28"*.
- [x] Qualidade & Compilação:
  - `npx tsc --noEmit` validado com **0 erros**.
  - Testes automatizados de privacidade e coexistência aprovados.

## Fase 23: Conexão Oficial Badoo (Padrão Simples & Direto estilo Tinder) (Concluída)
- [x] **Arquitetura & Domínio:**
  - Criação da entidade `Badoo.ts` com tipagem estrita para `BadooProfile`, `BadooSession`, `BadooRawMatch`, `BadooRawMessage`, `BadooFilter`.
- [x] **Banco de Dados & Supabase Realtime:**
  - Criação e execução da migration `20261004130000_add_badoo_integration.sql`.
  - Criação das tabelas `badoo_config`, `badoo_conversations`, `badoo_messages` com políticas públicas e adição à publicação `supabase_realtime`.
  - Atualização das constraints `instagram_conversations_channel_check` e `instagram_messages_channel_check` para suportar o canal `'badoo'`.
- [x] **Infraestrutura HTTP & Criptografia:**
  - Criação do `BadooApiClient.ts` implementando o protocolo JSON-RPC (`webapi.phtml`) do cliente Web do Badoo com cálculo automático de assinatura MD5 no cabeçalho `X-Pingback`.
  - Implementação de `broadcastBadooMessage` e `broadcastBadooConversation` em `RealtimeBroadcaster.ts`.
- [x] **Rotas de API (Next.js App Router):**
  - `/api/badoo/auth`: autenticação via cookie/token da Web com persistência em `badoo_config`.
  - `/api/badoo/status`: verificação de conectividade e perfil do usuário autenticado com fallback para cache.
  - `/api/badoo/disconnect`: desconexão limpa e expiração de sessão.
  - `/api/badoo/matches`: sincronização bidirecional de contatos/matches com as tabelas locais e a visão unificada `instagram_conversations`.
  - `/api/badoo/messages/[matchId]`: histórico completo e envio de mensagens com broadcast Realtime imediato.
  - `/api/badoo/matches/[matchId]/restrict`: controle de restrição/pausa de automação por contato.
- [x] **Interface do Usuário & Experiência Mobile-First:**
  - Componente `BadooConnectModal.tsx`: modal temático roxo/violeta com passo a passo e script de 1 clique (`copy(document.cookie)`).
  - Componente `BadooProfileModal.tsx`: visualizador de fotos em carrossel, bio, idade e cidade do contato.
  - Atualização do `ChatFilterModal.tsx`: suporte a filtros de status específicos do Badoo.
  - Integração no `InstagramDirect.tsx`:
    - Aba Badoo na barra superior de seleção de canais com contadores e badge de não lidas.
    - Suporte a envio de mensagens e carregamento de histórico do Badoo.
    - Abertura de modal de perfil ao clicar no avatar do contato (cabeçalho ou lista).
    - Estado vazio dedicado para Badoo conectado/desconectado com botão de ação direta.
  - Integração no `ConfigView.tsx`: card de gerenciamento e status da conta Badoo com suporte a conectar, desconectar e sincronizar contatos.
- [x] **Hooks & Realtime:**
  - Atualização do `useChatRealtime.ts` para escutar em tempo real eventos de mensagens e conversas do Badoo.
- [x] **Qualidade & Validação:**
  - Teste automatizado `tests/test_badoo_integration.mjs` criado e aprovado (100% pass).
  - `npx tsc --noEmit` validado com **0 erros** de TypeScript.

## Fase 24: Refatoração Arquitetural — Experiência Exclusiva WhatsApp (Em Andamento)
- [x] **Tarefa 1: Inventário Diagnóstico Completo:**
  - Mapeamento exaustivo de runtime, tipos e componentes de Tinder, Badoo, WhatsApp 1 e WhatsApp 2.
- [x] **Tarefa 2: Remoção do Runtime do Tinder:**
  - Exclusão dos 12 arquivos exclusivos e limpeza de referências compartilhadas sem quebra de testes.
- [x] **Tarefa 3: Remoção do Runtime do Badoo:**
  - Exclusão dos arquivos exclusivos e limpeza de referências compartilhadas mantendo 100% de testes verdes.
- [x] **Tarefa 4: Remoção do WhatsApp 1 (Meta Cloud API):**
  - Remoção de prefixos `wa:`, cartões e polling legados em `ConfigView.tsx`, `WhatsAppContactInfo.tsx` e `InstagramDirect.tsx`.
- [x] **Tarefa 5: Limpeza de Tipos, Imports e Estados Mortos:**
  - Purga de canais e flags legadas em `DirectConversation`, types e broadcaster.
- [x] **Tarefa 6: Ocultação do Instagram na Visão Operacional Principal de Chat:**
  - Canal operacional fixado em WhatsApp (`whatsapp2`), remoção de abas, header iOS com botão `+ Status` e preservação do Instagram no backend e em `ConfigView.tsx`.
- [x] **Tarefa 7: Simplificação Estrutural da View Principal para Operação Exclusiva do WhatsApp:**
  - `autoPilotConversations` e `platformConversations` simplificados para operar diretamente sobre `whatsapp2Conversations`.
  - Remoção de contadores e listas intermediárias mortas do Instagram (`visiblePlatformConversations`, `instagramConversationCount`, `instagramUnreadCount`).
  - Cabeçalho da conversa aberto simplificado para layout nativo WhatsApp iOS (`ChevronLeft`, avatar com abertura de `WhatsAppContactInfo`, botão de IA com feedback tátil e glass).
  - Remoção de botões mortos de Restringir e Sincronizar Instagram no cabeçalho do chat.
  - Remoção de modais mortos na tela de chat (`InstagramProfileModal`, `InstagramConnectModal` e Action Sheet de contexto do Instagram), mantendo apenas as ações contextuais nativas do WhatsApp iOS (bloquear, trancar, marcar leitura).
- [x] **Tarefa 8: Rebranding Visual "WhatsApp 2" -> "WhatsApp" (Concluída):**
  - Eliminação completa de sufixos " 2" e menções "WhatsApp 2" em todos os textos exibidos ao usuário (título do card de conexão, botões "Conectar WhatsApp" / "Desconectar WhatsApp", modal de confirmação, toasts de sucesso e erro, empty states e erros de rede).
  - Preservação estrita de todos os identificadores e contratos técnicos internos (`channel === "whatsapp2"`, prefixo `wa2:`, `WHATSAPP2_GATEWAY_URL`, RPCs, tabelas e métodos de cliente).
  - TypeScript compilando com 0 erros (`npx tsc --noEmit`), build de produção do Next.js gerado com sucesso e 58/58 testes oficiais aprovados.
- [x] **Tarefa 9: Investigação de Banco e Migrations Futuras (Concluída):**
  - Mapeamento exaustivo de 15+ foreign keys que dependem com `ON DELETE CASCADE` de `instagram_conversations` (espinha dorsal do Brain, sessões, outbox e estados).
  - Constatação de integridade: Badoo e Tinder possuem 6 tabelas vazias em produção (`tinder_config`, `tinder_conversations`, `tinder_messages`, `badoo_config`, `badoo_conversations`, `badoo_messages`) com 0 registros e sem FKs externas.
  - Salvaguarda do identificador `whatsapp2`: comprovada a necessidade crítica de manter o identificador interno `whatsapp2` no banco, tabelas do gateway (`whatsapp2_*`) e nas 17+ RPCs atômicas do PostgreSQL para evitar quebras em cadeia, mantendo o rebranding 100% restrito à camada de UI.
  - Salvaguarda das constraints: manutenção tolerante de `instagram_conversations_channel_check` e `instagram_messages_channel_check` para preservar integralmente o histórico de 38 conversas e 1.044 mensagens reais de `channel='whatsapp'`.
- [x] **Tarefa 9.2: Preparação Final da Limpeza e Reconciliação do Ledger (Concluída):**
  - Arquivamento fora da pasta ativa de `20261003233000_reconnect_tinder_integration.sql` em `supabase/migrations_archive/` impedindo ressurreição acidental de Tinder via `db push`.
  - Alinhamento de timestamp da migration de Status local para `20261005013711_whatsapp_status_posts.sql` em sincronia com o ledger remoto de produção.
  - Criação da migration oficial de limpeza via Supabase CLI (`supabase/migrations/20261005041506_cleanup_legacy_tinder_badoo_and_whatsapp1.sql`) sem aplicar em produção:
    * Remoção explícita do RPC sem consumidor `ingest_whatsapp_inbound_atomic`.
    * `DROP TABLE IF EXISTS` fail-safe sem `CASCADE` para as 6 tabelas órfãs vazias de Tinder e Badoo (com desassociação automática nativa de `supabase_realtime` no PostgreSQL 17).
    * Atualização das constraints para permitir apenas `'instagram'`, `'whatsapp'` (legado preservado) e `'whatsapp2'` (atual).
- [ ] **Tarefa 10: Verificação e Validação Ponta a Ponta.**


