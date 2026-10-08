# Não repetir confirmação da gravação aprovada da Rifa

API v530 ACTIVE, Supabase `wsdualhvopidgqcumonr`, prompt 2.46.10. Bundle SHA256: `df841d4547fd230986e079cc0d3c04f1d759f0f1063a829cc088e4e6092fda20`.

O operador esclareceu que a exceção vale somente para a gravação aprovada do objetivo da Rifa. Dúvidas sobre outros fatos devem continuar podendo abrir resolução manual. A instrução agora proíbe nova confirmação das referências da gravação a estágio, horário, boleto ou bilhetes, sem autorizar repetir essas afirmações em texto.

Com a exceção ativa, uma resolução manual deve informar `manualResolution.reasonCategory`: `audio_content` para dúvida sobre a gravação ou `other` para uma questão independente. `audio_content` é rejeitado e o Brain recebe feedback para corrigir o plano; ausência/categoria inválida também exige correção. `other` permanece permitido. Não há classificador por palavras-chave. Uso único, elegibilidade no Cofre, confirmação real de entrega e bloqueios independentes continuam ativos. O limite de quatro turnos foi preservado.

Alterados somente `objective_audio_deadline.ts`, `openai_sdk_brain.ts` e `larissa_canonical_prompt.generated.ts` sobre os 46 arquivos recuperados da API v529. Demais 43 arquivos preservados, inclusive a correção da leitura de recibos. Alterações locais paralelas de memória/Jev não foram publicadas.

Validação: 485 testes locais passaram. Sete testes específicos passaram no pacote exato. Avaliações isoladas do modelo enviaram o áudio no terceiro turno às 10:55, no cenário da pergunta de Rafael, e no quarto turno pela manhã. Esses testes não enviaram mensagens a clientes. Fonte publicada recuperada após o deploy conferida com o pacote revisado.

Na tentativa de retomar a pergunta antiga de Rafael, não havia turno `waiting_manual`; o endpoint de retomada respondeu HTTP 401. Nenhuma retomada foi confirmada por esta tarefa, nem se anunciou envio a esse contato. A regra está ativa para novos turnos. Relatório: `.firebase/automation-audit/approved-raffle-audio-tests.log`.
