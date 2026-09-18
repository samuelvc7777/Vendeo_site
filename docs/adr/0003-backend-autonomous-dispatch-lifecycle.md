# 0003. Arquitetura de Despacho Autonomo 24/7 no Backend (Webhook + Cron)

## Contexto e Decisao
O Piloto Automatico anterior rodava exclusivamente no cliente atraves de setInterval no React. Isso tornava o sistema inoperante com a tela do celular bloqueada ou sem conexao no navegador.
Decidimos mover o ciclo de execucao da IA Autonoma para o backend (Supabase Edge Function):
1. O webhook do Instagram/Tinder recebe a mensagem e programa a resposta no banco com debounce.
2. Uma rotina de background processa a fila, orquestra com a IA Gratis e o ChatGPT Sol, e despacha para a Meta Graph API.
3. O frontend assume papel de Console de Monitoramento e Intervencao (com Realtime), permitindo ligar/desligar o piloto e visualizar o status ao vivo.

## Consequencias
- A operacao funciona 24 horas por dia de forma resiliente para centenas de conversas simultaneas.
- O operador nao precisa manter a tela do celular acesa nem deixar guias abertas no desktop.
