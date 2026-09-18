# Vendeo - Modelo de Dominio

Vocabulario canonico do sistema de atendimento autonomo e vendas sociais do Vendeo.

## Linguagem Ubiqua

**Orquestrador (Dispatcher / Controller IA)**:
Camada autonoma de custo zero (executada via Groq / Llama-3.3) que inspeciona o historico, valida o cumprimento estrito do cronograma, calcula os delays humanos e emite a ordem de comando para o modelo de persona.
_Evitar_: Bot, robo de site, macro.

**Cerebro de Persona (Larissa / OpenAI Sol)**:
Modelo de inteligencia maxima que redige as mensagens com o DNA linguistico autentico da Larissa, aplicando a Regra do Bumerangue e gerando as conexoes para envio dos audios e mensagens do checklist.
_Evitar_: Chatbot padrao, assistente generico, ChatGPT cru.

**Cronograma do Checklist**:
Sequencia obrigatoria e inegociavel de etapas e conteudos (audios gravados e mensagens-chave) que a IA deve cobrir na conversa.
_Evitar_: Roteiro solto, script estatico, fluxo livre.

**Regra do Bumerangue**:
Diretriz conversacional rigida onde a IA reage humanamente ao que o pretendente falou, mas obrigatoriamente fecha a mensagem conduzindo o gancho de volta ao proximo item do checklist.
_Evitar_: Ignorar assunto do cliente, divagacao sem rumo.

**Ponto de Parada da Rifa (Raffle Hand-off)**:
Momento exato em que todos os audios pessoais sobre a historia da Larissa foram entregues. A IA cessa o envio autonomo, entra em Silencio de Fechamento e dispara o alerta para o operador.
_Evitar_: Fechamento automatico da rifa, interrupcao cega.

**Silencio de Fechamento**:
Estado incondicional em que a IA fica totalmente muda apos a entrega dos audios pessoais, garantindo que o fechamento do Pix seja feito com exclusividade pelo operador humano.
_Evitar_: Resposta automatica pos-rifa, enrolacao de plantao.

**Alerta Visual de Oferta (Piscador de Entrada)**:
Borda neon dourada pulsante no card da conversa na caixa de entrada, acompanhada do badge [PRONTO PARA RIFA], sinalizando a maturidade para venda manual.
_Evitar_: Badge comum, mensagem nao lida.

**Gatilho Hibrido (Webhook + Cron Watcher)**:
Mecanismo no backend Supabase que agenda a resposta assincrona assim que a mensagem do cliente entra via webhook e mantem um cron de contingencia para tolerancia a falhas.
_Evitar_: Polling puro, loop em aba do navegador.

**Ativacao Individual por Conversa (Chat Whitelist)**:
Regra em que a IA so atua nas conversas explicitamente ativadas pelo operador atraves do seletor individual no chat.
_Evitar_: Piloto global indiscriminado, spam geral.
