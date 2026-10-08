# Estado visual do AutoPilot após resposta no WhatsApp2

## Causa

A lista agrupava aliases de telefone e LID confirmados pelo WhatsApp, mas selecionava o registro da conversa pelo horário da última mensagem. Uma mensagem nova podia tornar mais recente uma linha criada pelo snapshot, sem configuração de atendimento. O chat aberto passava a usar seu ID e mostrava AutoPilot desligado, embora o registro configurado continuasse habilitado.

Reproduzido com os payloads reais de seleção da interface: três testes falharam antes da correção. Nos registros de produção de Rafael, o registro mais recente estava desligado e o registro configurado permanecia ligado. Maycon e Wanderson também tinham dois aliases com estados diferentes.

## Correção

`selectWhatsApp2StateOwner` seleciona o registro com configuração de atendimento, preservando tanto a ativação quanto o desligamento explícito. A seleção ocorre apenas dentro dos grupos de aliases já confirmados pelo WhatsApp. Quando ambos têm configuração, a preferência por telefone é estável e independe da data da última mensagem.

A prévia e a data da mensagem continuam usando a projeção mais recente. A consulta carrega somente o status de configuração necessário do JSON, sem carregar todo o histórico de orquestração.

## Verificação

19 testes direcionados passaram. A consulta real via Data API confirmou a projeção `autopilot_status:stage_completed_rules->>status`. O mapeamento do próprio WhatsApp confirmou os grupos de aliases de Rafael, Maycon e Wanderson; o seletor manteve a IA ligada nos três casos.

Publicação limitada ao frontend, preparada sobre a cópia isolada da publicação anterior.

Build estático e TypeScript concluídos. Firebase confirmou a publicação de 89 arquivos em 07/10/2026. O HTML público retornou HTTP 200 e seus nove scripts corresponderam por SHA-256 ao build publicado.
