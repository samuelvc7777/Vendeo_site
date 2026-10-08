# Consulta de recibos do histórico em lotes menores

Publicado em 08/10/2026: Supabase `wsdualhvopidgqcumonr`, API v529 ACTIVE. Bundle SHA256: `fa7da3d4c0c1e48cf65c9c4a360bf346008123639723c0354e4c670b73fce4ce`.

## Causa reproduzida

O ciclo `corr_1791467034775_b9ygr`, do chat de Warley, falhou na leitura de `openai_message_receipts` ao reconstruir o histórico. O bootstrap lia até 500 mensagens e colocava todos os IDs em um único filtro GET `in(...)`. Neste chat, os 291 IDs produziram uma URL de 17.306 caracteres e a requisição falhou com status 0. Consultas de 50 e 100 IDs retornaram HTTP 200. O reset repetia essa consulta, sem alterar a causa.

O diagnóstico foi reproduzido com consultas somente de leitura, sem imprimir credenciais, textos ou IDs das mensagens. A leitura dos mesmos 291 IDs em seis lotes menores retornou HTTP 200 em todos, afastando a hipótese de ID específico inválido ou falta de permissão para a tabela. O tamanho exato do limite de infraestrutura não foi determinado; a correção usa um orçamento conservador.

## Correção

Somente `api/openai_conversation_runtime.ts` foi alterado no pacote recuperado da API v528. A leitura dos recibos agora respeita no máximo 50 IDs e 6.000 caracteres no filtro codificado. IDs maiores reduzem automaticamente o lote. Um ID isolado acima do orçamento produz erro específico.

O histórico continua sendo paginado integralmente em blocos de 500 mensagens. Todos os recibos da página são consultados antes de criar itens no provedor. Recibos existentes, ordem do histórico, chaves de idempotência, confirmação de sincronização e erros reais de acesso foram preservados. Não houve limpeza de chats, alteração de schema, reset de sessão do WhatsApp ou mudança de regra da Rifa. Os demais 45 arquivos do pacote permaneceram iguais à API v528; alterações paralelas locais de memória/Jev não foram publicadas.

## Validação

- Teste de regressão executando o bootstrap real com dependências simuladas: três cenários falharam antes e passaram após a correção. Foram incluídos cinco cenários: histórico com 291 mensagens, IDs longos/recibos existentes, múltiplas páginas/ordem, falha de acesso e retomada sem duplicação.
- Consulta real, somente leitura: seis lotes para os 291 IDs, todos HTTP 200, URLs entre 2.521 e 3.222 caracteres.
- Suíte completa local: 484 testes passaram, sem falhas; inclui os testes presentes no workspace.
- API recuperada após o deploy: v529 ACTIVE, todos os 46 arquivos coincidiram com o pacote revisado.

Diagnóstico e relatório estão em `.firebase/automation-audit/check-bootstrap-receipt-size.mjs` e `bootstrap-receipt-tests.log`, ignorados pelo Git. Os testes não enviaram mensagens a clientes nem retomaram automaticamente o atendimento. O bootstrap/turno real completo após novo reset ainda depende do processamento do provedor; a correção verificada remove a falha de transporte reproduzida na leitura dos recibos.
