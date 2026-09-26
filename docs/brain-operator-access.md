# Acesso às operações do Brain

O aplicativo não usa Supabase Auth e não possui usuários, roles ou ownership de conversas. A boundary atual é uma sessão administrativa global por instância:

- Quem conhece `BRAIN_OPERATOR_PASSWORD` é operador e pode consultar eventos e pedir ações manuais em qualquer conversa desta instância.
- A senha e `BRAIN_OPERATOR_SESSION_SECRET` existem somente no ambiente privado do servidor. Use senha longa e segredo aleatório com pelo menos 32 bytes.
- `POST /api/operator/session` valida a senha no servidor e define um cookie assinado, `HttpOnly`, `SameSite=Strict`, com validade de oito horas. A senha não é mantida no browser depois do login.
- `/api/operator/brain/*` valida o cookie, verifica a origem nas mutações e só então encaminha operações permitidas para a Edge Function. A `SUPABASE_SERVICE_ROLE_KEY` é lida apenas no servidor e nunca é enviada ao browser.
- As Edge Functions operacionais continuam exigindo o Bearer de serviço para chamadas internas. A leitura de eventos e as operações de retry/resolução manual passam pela rota Next autenticada.
- Sem os dois segredos de operador configurados, a boundary fica fechada e as operações retornam indisponível.

O acesso é global porque o schema não relaciona conversas a usuários. Essa implementação não inventa ownership. Para múltiplos operadores com permissões distintas, será necessário integrar um provedor de identidade e uma relação de autorização já definida pelo produto.
