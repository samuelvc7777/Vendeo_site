# Instruções do projeto Vendeo

Responda e escreva planos em português. Confirme fatos no código ou no ambiente; declare o que não conseguiu verificar.

## Base oficial e branches históricas

**A `main` é a única base oficial para desenvolver este projeto.** Ela foi consolidada com as fontes da produção em 08/10/2026. Consulte [o registro da consolidação](docs/deployments/2026-10-08-production-unification.md) ao recuperar trabalho antigo, comparar com produção, organizar branches ou preparar uma publicação.

1. Antes de editar, confira `git status`, a branch atual e `git worktree list`. Preserve alterações de outras tarefas. Comece novos trabalhos na `main` atualizada ou em uma branch `codex/` criada a partir dela; ao continuar uma tarefa, confira a origem da branch antes de prosseguir.
2. Branches antigas, backups, worktrees de publicação e arquivos em `.firebase/` são referências históricas. **Não mescle branches históricas inteiras nem substitua a base oficial por seus arquivos.** Recupere somente a mudança necessária à tarefa, compare com a `main` e valide as dependências e o comportamento resultante. Um commit mais recente em uma branch antiga não comprova que ele está em produção.
3. O Jev e os testes em `tests/experimental/` são protótipos fora da produção. Integre-os apenas em uma tarefa que autorize essa funcionalidade; não os reintroduza como parte de uma limpeza ou sincronização. Confirme a documentação, as credenciais e o resultado real antes de anunciar uma integração ativa.
4. Preserve backups e alterações pendentes antes de reorganizar branches ou worktrees. Exclusão de referências, reset destrutivo e descarte de trabalho exigem autorização que cubra essas ações; não presuma essa autorização de um pedido genérico de correção.

## Conferência e publicação

- Para conferir a base registrada, use `node scripts/verify-production-baseline.mjs --live`. O manifesto documenta um release: mudanças intencionais posteriores podem divergir dele. Explique a divergência e confronte com os artefatos publicados; **não atualize hashes apenas para esconder diferenças ou fazer a conferência passar**.
- Ao alterar automação, execute `node scripts/test-production-baseline.mjs` e as verificações pertinentes à mudança. Execute testes experimentais separadamente; não apresente seu resultado como validação da aplicação publicada. Corrija testes obsoletos verificando o contrato real, preservando cobertura de bloqueios, entrega e persistência.
- Ao alterar o frontend, confira as instruções locais do Next.js abaixo e valide o build. Publique somente o pacote efetivamente revisado e validado, preservando correções já ativas. A versão remota da API, o site e o gateway devem ser conferidos diretamente; a branch local sozinha não comprova o estado da produção.
- Preserve a sessão do WhatsApp, o escopo da conta e os dados dos chats. Testes de código não devem enviar mensagens a clientes nem limpar conversas reais. Uma limpeza operacional deve estar dentro do escopo autorizado pelo usuário.
- Ao concluir, informe arquivos/comportamento alterados, validação, eventual publicação e limitações reais. Não prometa ausência absoluta de bugs.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
