# Publicação — recuperação de fotos do WhatsApp (14/10/2026)

## Escopo

- O gateway renova a URL quando o navegador rejeita uma foto `pps.whatsapp.net`, sem reutilizar a mesma URL quebrada.
- Cache de avatar do gateway não é repovoado com links persistidos antigos; resultados inválidos podem zerar `avatar` e `avatar_url` da respectiva conversa.
- Novo endpoint `POST /chat/profile/refresh`, com validação de contato e URL rejeitada.
- A interface faz uma tentativa controlada por contato e URL, com deduplicação de requisições, e usa avatar padrão quando necessário.
- Informações do contato e seletor de destinatários de Status usam fallback quando a imagem falha.
- A API Supabase e o banco não receberam migration nem deploy.

## Publicação e verificação

- Firebase Hosting: `https://vendeo-e755e.web.app`; `firebase deploy --only hosting --project vendeo-e755e --non-interactive` concluído com sucesso.
- O HTML público e o novo pacote de JS responderam HTTP 200; o HTML confere byte a byte com o build local. O pacote contém a chamada ao endpoint de atualização.
- `npm run build` passou, incluindo TypeScript.
- 19 testes focados passaram, inclusive 4 casos novos da recuperação de avatar.
- Gateway local reiniciado preservando `services/whatsapp2-gateway/.session` e o túnel Cloudflare; `/status` retornou `ready`, `/chats` respondeu com sucesso e a nova rota devolveu HTTP 400 para entrada inválida, como esperado.
- Não foram enviadas mensagens ou realizadas atualizações em massa de contatos.

## Backups e limites

- Arquivos estáticos anteriores: `.firebase/avatar-before-20261014.zip`.
- Fonte de referência anterior do gateway: `.firebase/avatar-gateway-before-20261014.cjs`.
- Logs do novo gateway: `.firebase/avatar-gateway-20261014.stdout.log` e `avatar-gateway-20261014.stderr.log`.
- A recuperação de fotos depende da disponibilidade e privacidade das imagens no WhatsApp; alguns contatos podem continuar sem foto.
- A confirmação final de recuperação para um contato real requer que o navegador encontre uma imagem quebrada e solicite a nova URL.
