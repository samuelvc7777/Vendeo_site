# Publicação — múltiplos WhatsApps — 26/10/2026

## O que foi publicado

- O export estático do frontend foi implantado no Firebase Hosting do projeto `vendeo-e755e`: https://vendeo-e755e.web.app. O deploy enviou 91 arquivos e terminou com `Deploy complete`.
- O frontend agora aponta o gerenciamento de contas para o gateway multi-conta exposto em `https://dom-grad-remote-filling.trycloudflare.com`.
- Foi aplicada no Supabase `wsdualhvopidgqcumonr` somente a migração `20261025180000_whatsapp_multi_account_status_scope.sql`, que adiciona `gateway_account_id` às tabelas de status e destinatários de stories.
- A API Supabase permaneceu na versão 620; não houve deploy de Functions.
- O gateway manager foi iniciado na porta local 8789 e encaminha a conta principal para o gateway anterior em 8788. A listagem pública confirmou `WhatsApp principal` e `Samuel` como `ready`.

## Segurança e operação

Ações de criação e pausa de contas exigem `WHATSAPP2_MANAGER_TOKEN`. O segredo está no `.env` ignorado do gateway e não foi incluído no bundle do site. Para criar ou pausar contas futuras, o operador precisa copiar o valor da linha `WHATSAPP2_MANAGER_TOKEN` de `E:\aplicativos\Vendeo_wa_multi_plan\services\whatsapp2-gateway\.env` para o campo de chave em Config. Alternar entre as contas já conectadas não exige essa chave.

O endereço Cloudflare é um Quick Tunnel e o gateway manager e o túnel estão rodando nesta máquina. O endereço pode mudar e a integração deixa de responder se os processos forem encerrados ou a máquina ficar indisponível. Esta publicação não configura serviço permanente nem Named Tunnel; para operação contínua, essa infraestrutura precisa ser estabilizada.

## Validação e limites

- Build estático de produção e verificação TypeScript passaram; o export contém 91 arquivos.
- Testes direcionados de múltiplas contas: 9/9 aprovados. `git diff --check` passou.
- Site publicado, arquivo de configuração e endpoints do gateway responderam via HTTP. O endpoint de gerenciamento sem chave respondeu 401 e não criou conta.
- O segredo de gerenciamento não apareceu nos assets públicos. Nenhuma mensagem foi enviada, conversa foi limpa ou automação de IA foi ativada.
- A conferência visual manual no navegador não foi realizada. As verificações da publicação foram por build, comparação dos assets e HTTP.
- O deploy foi somente do Firebase Hosting. Os quatro commits locais da `main` ainda não foram enviados a `origin/main`.
