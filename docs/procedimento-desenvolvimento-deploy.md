# Desenvolvimento e publicação do Vendeo

O fluxo oficial é **GitHub main → branch própria → revisão e testes → integração → publicação autorizada → registro da versão**.

1. Confira `git status`, branch e `git worktree list`. Preserve mudanças pendentes. Atualize a referência remota sem `--prune` antes de escolher a base. Use a `main` oficial; branches históricas de deploy servem apenas para comparação.
2. Crie uma branch `codex/<tarefa>` a partir da `main` atualizada, preferencialmente em um worktree isolado. Cada agente mantém sua branch. Não reaproveite cegamente fontes de publicação antigas.
3. Leia `AGENTS.md` e os guias locais aplicáveis. Implemente apenas a tarefa. Não adicione `.env`, sessões, bancos, dumps, logs com dados pessoais, caches ou credenciais ao Git.
4. Revise o diff e execute build, TypeScript, arquitetura e testes pertinentes. Execute também `node scripts/test-production-baseline.mjs`. Use fixtures e banco local nos testes de escrita; nunca credenciais de produção. Falhas precisam de relatório e comparação com a base, sem enfraquecer contratos.
5. Integre somente depois da revisão e da resolução das falhas que impedem promoção. Confira novamente `origin/main`; preserve os commits de ambos os lados. Uma divergência exige revisão, nunca force push.
6. Publique somente com autorização e a partir do commit e pacote validados. Confirme separadamente Firebase Hosting, versões e fontes das Edge Functions, migrações aplicadas e código/configuração do gateway ativo. Uma branch não comprova produção. Migrações, reinícios, sessões e dados exigem escopo operacional próprio.
7. Registre commit, parâmetros públicos de build, versões remotas, hashes e verificações somente de leitura. Guarde artefatos e backups privados fora do Git. Um novo release ganha novo manifesto; não sobrescreva hashes de releases anteriores para esconder diferenças.
8. Depois da integração, confira se cada worktree está limpo, se seus commits estão incorporados e se o backup foi verificado. Proponha arquivamento ou remoção em tarefa separada e obtenha autorização antes de excluir referências ou descartar trabalho.

## Consolidação de 28/10/2026

A branch `codex/consolidacao-producao-20261028` preserva o histórico da `main` local `89148629` e recupera as fontes efetivamente publicadas. O relatório em `docs/deployments/2026-10-28-consolidacao-producao.md` registra as diferenças e os bloqueios de validação. Ela **não deve ser promovida automaticamente**: a API remota v635 diverge de proteções existentes na `main` e os testes correspondentes permanecem falhando.

Depois de resolver e revisar esses bloqueios, a promoção requer autorização explícita do usuário após o relatório. Reconfira a `main` remota, revise todos os commits a integrar e prepare a tag `production-2026-10-28` apenas para o estado validado. Nenhum comando de merge, push ou publicação é disparado por este procedimento.
