# Base consolidada da produção — 08/10/2026

O código local foi reconciliado com o conjunto ativo, sem deploy, alteração de dados ou reinício do gateway. A branch `codex/production-baseline-20261008` registra o checkpoint para consolidar a `main`. Branches anteriores são referências históricas e não devem ser mescladas automaticamente por conterem implementações diferentes das publicadas.

## Fontes de autoridade

- Site Firebase: versão `377b1468256bab18`, servido em https://vendeo-e755e.web.app. Fontes de `src`, `public` e configuração recuperadas do diretório usado no build desse release. O HTML inicial e nove scripts públicos foram comparados por SHA256, com dez correspondências.
- Supabase `wsdualhvopidgqcumonr`: os 45 arquivos da API foram baixados diretamente da função ativa v526. Bundle `f25f08c6c45493dc5d8c8ea660f03d09028f0b9cb827d00ad985d86dd175bce6`.
- MCP: quatro arquivos baixados da função `vendeo-brain-mcp` v33. Bundle `24af8dfdca3584e50b3fe80ba607361790f820dd4e44ee82a88340823f707a4d`.
- Gateway: `index.cjs` corresponde à fonte do processo ativo; dependências e arquivos auxiliares correspondem à cópia auditada. Sessão e número conectado foram preservados.
- Prompt: versão 2.46.8, Markdown extraído do conteúdo publicado e sincronização conferida pelo gerador existente.
- Migrações: todas as 125 versões registradas no banco têm arquivo local. Três nomes locais de versão foram alinhados às versões efetivamente aplicadas: `20261008020018`, `20261008020021` e `20261008111042`. Nenhum SQL foi reaplicado.

O inventário com hashes está em `production-baseline-manifest.json`; `node scripts/verify-production-baseline.mjs --live` confere a fonte local e os dez arquivos públicos registrados. Essa verificação local passa nesta base; alterações futuras exigem novo registro de release, não a atualização silenciosa dos hashes para esconder divergências. Ela não confirma por conta própria a versão remota do Supabase, que foi consultada pelo conector durante a consolidação.

## Preservação e trabalho futuro

- Snapshot do trabalho anterior: `backup/pre-production-unification-20261008`, commit `f3e91a33dfbda0bb4480993c76be5992b23656f3`.
- Bundle local com referências Git e cópias de arquivos substituídos: `.firebase/production-unification-20261008/` (ignorado pelo Git; contém material de recuperação local).
- O módulo preliminar do Jev e seu teste estão no snapshot e na pasta local `unpublished`. Não fazem parte da base publicada e ainda não estão integrados ao Brain.
- Outros worktrees foram preservados, inclusive os que estão em HEAD destacado. Não foram apagados nem resetados.
- Credenciais, sessão do WhatsApp e caches não foram incluídos em novos arquivos de publicação.

## Validação e limites

O build estático isolado passou com Next.js 16.3.4 e verificação TypeScript. Os 87 testes da suíte de segurança passaram. O site e gateway local/público responderam; o gateway estava `ready`, sem último erro. As chamadas de corpo vazio às rotas de automação retornaram os erros de validação esperados, sem ativar atendimento.

A primeira execução da suíte completa teve **426/437 testes aprovados e 11 falhas**. A comparação posterior com o snapshot anterior reproduziu dez dessas falhas; uma foi introduzida pela consolidação ao retirar um módulo experimental do Tinder e deixar seu teste no conjunto principal. Relatório inicial local: `.firebase/production-unification-20261008/all-tests.log`; comparação: `before-failing-tests.log`.

### Correção das verificações, sem alteração do código publicado

Depois da autorização do usuário, os testes foram alinhados aos nomes reais de migrações, às variáveis atuais e ao bloco de manutenção da recuperação de ciclos. As verificações de citações passaram a executar as funções reais que criam a outbox e o espelho da mensagem enviada, incluindo recuperação da citação pelo payload. O teste de etapas agora confirma tanto o bloqueio com objetivo obrigatório pendente quanto o avanço após todos os obrigatórios serem concluídos e a solicitação válida do Brain. O teste de autorização verifica o contrato real de origem permitida, com HTTP 403 para origem inválida, sem alegar testar uma sessão de login inexistente nesse endpoint.

O teste experimental do Tinder foi preservado junto de seu módulo em `tests/experimental`; seus quatro cenários são executáveis separadamente e não representam o frontend publicado. Nenhum teste foi marcado como ignorado. Os testes de vídeo, antes interrompidos por caminho de migração inexistente, passaram a ser executados integralmente.

Resultado final: **439 testes da base aprovados, zero falhas**, mais quatro testes do protótipo preservado aprovados separadamente. Comando da base: `node scripts/test-production-baseline.mjs`. Relatório local: `.firebase/production-unification-20261008/all-tests-fixed.log`. Os hashes das 246 fontes de produção permaneceram iguais ao manifesto; não houve deploy, alteração de schema, mudança de prompt ou reinício do gateway nessa correção.

Esta consolidação comprova a correspondência da fonte recuperada com os artefatos inspecionados; não representa garantia de ausência de bugs já existentes na produção. O build novo foi apenas validado e não substituiu o site publicado.
