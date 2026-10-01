# Acesso às operações do Brain

O Vendeo é um site público e não usa login de operador.

- O navegador não armazena senha, sessão, cookie ou token de operador.
- As ações da interface chamam a Edge Function diretamente.
- Requisições iniciadas pelo site são aceitas quando a origem é uma origem Vendeo permitida.
- Chamadas internas servidor-servidor continuam podendo usar `SUPABASE_SERVICE_ROLE_KEY`; essa chave nunca é enviada ao navegador.
- `BRAIN_OPERATOR_PASSWORD` e `BRAIN_OPERATOR_SESSION_SECRET` não fazem mais parte do runtime.
- A rota `/operator/session` permanece apenas como compatibilidade para versões antigas do frontend e sempre retorna sessão pública para origens Vendeo válidas.
