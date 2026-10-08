# Correção da lista e do histórico do WhatsApp — 07/10/2026

A reconciliação da lista mantinha a chave do ID antigo ao preservar uma mensagem local mais recente. Isso recolocava o mesmo contato ao lado do ID canônico. Uma chave LID em cache também impedia usar o telefone recém-confirmado pelo gateway.

A lista agora mantém o ID e os controles canônicos, preservando apenas a prévia local mais recente. A identidade é recalculada com a resolução atual do WhatsApp.

O histórico em memória é reunido antes da troca de ID na atualização da lista e na ativação da IA. A importação de mensagens do gateway passa a complementar o cache, em vez de substituí-lo por uma janela de 140 mensagens. A união usa aliases confirmados e filtra a conta conectada. Nenhuma mensagem do banco é apagada.

Validação: regressão da reconciliação (dois cenários), preservação do histórico e isolamento entre contas, além dos testes existentes de identidade, proprietário do estado e ativação da IA. Publicação em release isolado do Firebase, preservando as demais alterações locais.
