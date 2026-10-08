# Conferência para restauração anterior às 22h de 06/10/2026

Conferência somente de leitura em produção. Nenhuma restauração executada.

## Evidências confirmadas

- Firebase: release de 06/10/2026 21:37:53 (America/Sao_Paulo), versão sites/vendeo-e755e/versions/9c31bb27c6f409f9, retornada pelo histórico oficial de releases.
- API: logs function_edge_logs entre 20:30 e 22:00 mostram exclusivamente versão 509 para a função api, com 667 registros nesse intervalo.
- Recuperado o pacote real v509, 22 arquivos, a partir do resultado de get_edge_function capturado às 21:34:59 daquela noite. Preservado em .firebase/rollback-20261006-2137/api-v509. SHA256 do resultado recuperado: 7e12ee93f493b05f4e32e4ad7023993260da96dfccf83fd003965e5400fb9969.
- Existe snapshot do gateway anterior ao escopo por conta. A entrada carrega módulos da pasta viva de serviços; restaurar apenas index.cjs não garante restaurar os módulos auxiliares e a biblioteca WhatsApp. É necessário preparar e conferir o conjunto do gateway.

## Compatibilidade do banco atual

Há 56 conversas no formato wa2:account-..., com 29 IAs habilitadas, e 941 conversas legadas sem IA ativa no instante da conferência. A versão antiga usa IDs sem conta. Uma volta literal pode deixar o progresso e o histórico novo fora do chat exibido, mesmo sem apagar registros.

As filas foram alteradas para separar contas. claim_whatsapp2_delivery_batch ganhou um parâmetro com default primary; a fila de entrada passou a ter chave composta por conta e message_id. As alterações de segurança, identidade multicanal e vídeos também são posteriores ao corte e não devem ser desfeitas indiscriminadamente.

A restauração requer: selecionar o release oficial antigo; publicar o pacote API v509; preparar o gateway e dependências correspondentes; definir uma compatibilidade controlada para os IDs e filas atuais. Não restaurar o banco inteiro para ontem, pois isso perderia dados criados desde então. Nenhum envio real foi feito na conferência.

## Correção da conferência anterior

Na preparação efetiva da restauração foi encontrado um marcador de truncamento no conteúdo do brain_orchestrator.ts retornado pela ferramenta histórica. Portanto, os 22 arquivos recuperados não constituíam uma cópia completa e integral da API v509. A fonte íntegra do motor foi recuperada do commit anterior às 22h, e a publicação reconstruída está documentada em 2026-10-07-restored-baseline-new-number.md. Não foi executado rollback do banco.
