# Roteiro golden de conversas do Brain

Esses casos são o roteiro de validação manual e de evolução dos testes automatizados. O texto do Brain é avaliado por cobertura do contexto, uso das ações e estados persistidos; não por frases idênticas ao exemplo.

## A. Texto simples e cadência inicial

- Config: delay inicial de 1 minuto.
- Cliente: “oi, tudo bem?”
- Esperado: o backend mantém o debounce configurado; Brain emite uma decisão e uma ação textual; a decisão e a ação existem antes da chamada à Meta; o outbound confirmado aparece no próximo contexto.

## B. Vários balões inbound

- Cliente envia: “trabalho com TI”, “moro em Campinas” e “e você trabalha com o quê?” antes do debounce vencer.
- Esperado: o Brain recebe os três inbounds na mesma vez e emite as ações que julgar apropriadas; o backend não corta balões por análise semântica.

## C–D. Áudio por objetivo, seleção pelo Brain

- Config: dois ou mais áudios habilitados no mesmo objective_id, cada um com transcrição, instrução de uso e duração.
- Cliente traz assuntos de trabalho, rotina e uma pergunta pessoal.
- Esperado: Brain consulta pelo objective_id; recebe todos os candidatos elegíveis daquele objetivo; escolhe zero ou um áudio e pode combinar áudio e texto. Nenhum texto é removido por comparação semântica com a transcrição.

## E. Inbound durante ações pendentes

- Brain persiste três ações; a primeira foi confirmada e as duas seguintes aguardam envio.
- Cliente envia uma nova mensagem antes da próxima ação.
- Esperado: ação confirmada continua imutável; Brain recebe a nova mensagem e decide KEEP, CANCEL ou REPLACE para as ações pendentes antes de novo despacho.

## F. Retorno tardio após 120 segundos

- Iniciar um turno do Agent que conclui depois do limite de espera do backend.
- Esperado: ciclo libera o lock e registra brain_late; a recuperação reutiliza session_id e provider turn_id; a decisão daquele mesmo turno é persistida uma vez e segue para outbox.

## G. Queda após primeira ação

- Persistir texto, áudio e texto; confirmar a primeira ação; encerrar o processo antes da segunda.
- Esperado: recuperação não repete o texto confirmado e despacha somente as ações restantes em ordem.

## H–I. Falha confirmada e envio incerto

- H: Meta rejeita de forma explícita todas as tentativas de uma ação.
- Esperado: action fica failed_confirmed e pode ser enviada manualmente; confirmação manual vira sent e entra no histórico de conversa.
- I: chamada termina com timeout após transmissão.
- Esperado: action fica dispatch_uncertain; não é reenviada nem enviada manualmente até reconciliação.

## J. Resolução manual

- Cliente: “você já foi aos Estados Unidos?” e o Brain não tem esse fato.
- Esperado: Brain emite manual_resolution com pergunta e contexto, sem ação para o cliente; operador fornece apenas o fato; o Brain retoma com o mesmo contexto de sessão e cria a resposta para o cliente. O operador escolhe se o fato deve compor sessões futuras.

## K. Memória por sessão

- Operador fornece um fato em uma resolução manual e escolhe “Não salvar para novas sessions”.
- Esperado: sessão atual recebe o fato; memória permanente não muda; uma sessão nova não recebe o fato.
- Repetir com “Sim”: sessão nova recebe o fato; sessão antiga não é retroalimentada automaticamente.

## L. Evidência histórica

- Brain aponta um objective_id configurado e uma mensagem inbound anterior já persistida como evidência.
- Esperado: backend valida existência e ownership do objective_id/evidence_id sem exigir que a mensagem pertença ao lote recém-claimed e sem julgar se a evidência satisfaz semanticamente o objetivo.

## M. Autoridade semântica

- Inspecionar logs e estado para WAIT, objective updates, transição de etapa, seleção de áudio e resposta.
- Esperado: somente a decisão emitida pelo Brain escolhe essas opções. Backend rejeita referências inválidas e executa/persiste a decisão sem criar fala ou mudar sua estratégia.
