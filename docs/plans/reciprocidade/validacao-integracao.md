# Validação integrada de reciprocidade

Verificação em 03/11/2026, após incorporação da revisão e do runner sintético do ticket #9.

- Base oficial consultada: origin/main aa90524bcddb2b7e188c222224a19fda81d4a2dd.
- Build integrado: npm run build aprovado, incluindo TypeScript e exportação estática.
- Módulos backend: tsc --noEmit com allowImportingTsExtensions aprovado.
- Suíte específica: 46 testes aprovados, zero falhas, incluindo SQL real em PGlite.
- Suíte geral: 645 testes, 625 aprovados, 20 falhas. A main antes do recurso tinha 599 testes, 579 aprovados e as mesmas 20 falhas.
- PGlite não comprova concorrência entre sessões remotas. Interface foi verificada por renderização SSR e build; não foi exercido um fluxo completo com navegador conectado ao backend migrado.
- Nenhuma migração foi aplicada ao ambiente remoto; não houve deploy, envio a contatos ou limpeza de conversas.

## Conferência do release registrado

O comando node scripts/verify-production-baseline.mjs --live não passou. O manifesto registra um release antigo; há diferenças locais e nenhum dos dez artefatos antigos conferiu com os arquivos servidos atualmente. As mudanças deste PR em arquivos existentes são intencionais, mas o conjunto de divergências também inclui áreas que este PR não modifica. Não foi alterado qualquer hash para ocultar diferenças. Essa conferência não comprova a versão remota atual da API ou do gateway e não constitui autorização para publicar.

## Falhas já presentes na main
- Brain SDK aplica service_tier configurável sem fallback silencioso para Standard
- uma chave anon longa não autoriza uma origem externa desconhecida
- estado de IA do match informa flags desligadas sem ativar conversa
- preparação da IA recusa sync real enquanto qualquer flag de operação estiver desligada
- CONTRATO 0B: engajamento com a rifa segue reações configuradas e respeita recusa
- tests\test_e2e_contact_conversation_memory.mjs
- Flex 429 stays Flex, no Standard provider fallback
- retry uses durable schedule, no outgoing action duplication
- prompt essencial mantém rotina/regras e todo fato retirado tem origem canônica
- configuração de sessão antiga precisa ser recriada para receber ferramenta e política
- Brain mantém pesquisa interna sem backend decidir o conteúdo
- preserva o tier configurado no provider e falha sem fallback de preço
- não interfere em recuperação técnica que preserva o mesmo tier
- dispatch publica progresso e fim do envio sem sobrescrever ciclos novos
- 17. Ativação prepara histórico Tinder e cronograma compartilhado sem ligar a IA
- IA Tinder exige sessão e flags antes do toggle
- Boost rejeita consumo sem confirmação explícita
- manual_resolution rejeita pedido de identificador técnico interno
- envio recusa conta diferente da conversa antes de consultar ou alterar a fila
- infraestrutura de FFmpeg existente é encontrada e configurada