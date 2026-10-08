# Conferência de restauração exata — 07/10/2026

Objetivo: verificar a possibilidade de restaurar o projeto ao estado de produção anterior às 22h de 06/10/2026, horário de São Paulo. Nesta conferência não houve deploy, alteração de banco ou reinício do gateway.

## Resultado

A versão exata do site está identificada no Firebase: `sites/vendeo-e755e/versions/9c31bb27c6f409f9`, publicada às 21:37:53.769. A restauração integral do projeto ainda não está comprovada.

A API ativa naquela janela aparece nos logs como v509. Há 21 arquivos completos preservados na consulta histórica. O arquivo atribuído a `brain_orchestrator.ts` nessa resposta está truncado: o marcador também atravessou arquivos, e seu final corresponde ao final de `openai_brain.ts`. Portanto o arquivo extraído não é um Brain válido nem completo.

## Evidências recuperadas nesta conferência

- Inventário Git: 38.393 objetos; 433 commits examinados. Não foi encontrado um commit de todo o projeto feito perto de 22h. O HEAD é das 11:38 de 06/10.
- Blob Brain `a4cd341bab227c1a4b79fb8521d61b80da8cccfd`: completo, com os 207.393 caracteres iniciais normalizados iguais ao trecho original preservado. Sua diferença para o pacote de deploy posterior v510 corresponde a alterações posteriores de roteamento/envio; ainda não há hash completo do arquivo original publicado para provar igualdade integral. A contagem com CRLF diverge em 129 caracteres da contagem registrada no deploy, podendo envolver finais de linha mistos; isso não foi tratado como prova de igualdade.
- Blob OpenAI Brain `1593f50d650a641fb3f09b155b64d210c61cbe00`: seus 152.235 caracteres finais normalizados correspondem integralmente ao trecho final preservado na consulta histórica. A contagem CRLF diverge em 43 caracteres da registrada; igualmente não prova igualdade integral.
- Log original do deploy registra 46 arquivos com contagens de caracteres. Além dos 21 originais completos, 19 arquivos do pacote posterior v510 possuem a mesma contagem registrada; tamanho igual isoladamente não prova conteúdo idêntico.
- Foram encontrados blobs candidatos de `channel_transfer_service.ts` e `multichannel_identity_service.ts` com a contagem original registrada. Sua proveniência completa ainda precisa ser validada.
- `larissa_canonical_prompt.md` e `tinder_match_routes.ts` ainda não foram confirmados no estado exato publicado. O prompt gerado da API está entre os arquivos originais completos; isso não recupera automaticamente o Markdown fonte.
- Existem snapshots do gateway, mas a correspondência da versão efetivamente executada antes de 22h com todos os módulos locais e a biblioteca WhatsApp não está comprovada. Restaurar apenas `index.cjs` não comprova equivalência do serviço.

## Artefatos

Evidências e candidatos estão em `.firebase/rollback-20261006-2137/`: `original-file-recovery-manifest.json`, `remaining-source-candidates.json`, `original-brain-edits.json`, `git-recent-hidden-commits.json` e `git-recovered-blobs/`.

## Limite da conclusão

É possível restaurar exatamente o site. Há candidatos fortes para recuperar mais da API original, mas ainda não é correto afirmar que todo o projeto pode ser restaurado com identidade comprovada. A versão atualmente em produção continua sendo a reconstrução aproximada documentada anteriormente. Nenhum dado de conversas foi revertido.
