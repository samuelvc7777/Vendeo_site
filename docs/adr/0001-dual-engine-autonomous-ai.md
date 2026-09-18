# 0001. Arquitetura Dual de IA Autônoma (Orquestrador Grátis + Cérebro de Persona ChatGPT)

## Contexto e Decisão
Para operar centenas de conversas diárias com máxima qualidade humana e custo sustentável, decidimos dividir a IA autônoma em dois componentes especializados:
1. **Orquestrador de Controle (Custo Zero / Groq ou Llama-3.3):** Analisa o estado do chat, checa pendências do checklist da etapa, calcula tempos de espera humanos e prepara o contexto do pretendente.
2. **Cérebro de Persona (ChatGPT Sol / OpenAI):** Recebe o contexto limpo e estruturado para gerar as respostas e os ganchos conversacionais com a inteligência máxima e o DNA linguístico da Larissa.

## Consequências e Trade-offs
- **Vantagem:** Custo drasticamente reduzido (tokens de análise de sistema e cronograma não consom a API paga do ChatGPT; o modelo premium é acionado apenas para a fala da persona).
- **Trade-off:** Exige orquestração entre duas chamadas encadeadas, com tratamento de falhas em caso de indisponibilidade de um dos provedores.
