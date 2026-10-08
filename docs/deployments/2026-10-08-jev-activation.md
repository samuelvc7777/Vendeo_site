# Ativação do Jev — 08/10/2026

Integração publicada no projeto Supabase `wsdualhvopidgqcumonr`, função `api`. Pacote construído sobre os 46 arquivos baixados da API ativa v530, substituindo somente cinco módulos revisados e acrescentando três de memória. Preservadas as correções recentes de áudio da rifa e recibos de bootstrap.

## Estado confirmado

- Publicação de código retornou API v531 ACTIVE; após mudanças nos secrets, inventário retornou API v535 ACTIVE com o mesmo bundle `2536051a47d2edb475565002eb089af5d289e956cf0cca0b3a22e7e9f3852e10`.
- Todos os 49 arquivos publicados correspondem ao pacote revisado, normalizando apenas fim de linha e whitespace final.
- `JEV_MEMORY_MODE=active` confirmado pelo digest do secret e por execução restrita no servidor. `TYPESAFE_API_KEY` configurada somente no servidor. Prazo 10.000 ms.
- Política Jev 3.0.0, catálogo de 789 candidatos: 781 registros globais elegíveis e oito fatos opcionais extraídos da fonte canônica.
- Regras, rotina, fatos confirmados da sessão e resposta atual do operador continuam no contexto obrigatório. Jev escolhe até duas memórias. Falha conserva fallback; retries do mesmo turno reutilizam seleção.
- Nenhum deploy do site, reset de WhatsApp, limpeza de chat ou mensagem de teste a cliente nesta ativação. A consolidação anterior de 40 duplicatas da persona foi uma operação separada autorizada.

## Consumo do Brain versus backend antigo

Contagem real pelo endpoint `responses/input_tokens` do modelo `gpt-6.1-sol`. Recuperação lexical antiga executada diretamente do código atual sobre o banco; estado operacional sintético igual; seleção e definição da ferramenta nova do Jev incluídas no caminho ativo.

| Pergunta sintética | Backend antigo | Jev | Diferença |
| --- | ---: | ---: | ---: |
| Filmes | 19.427 | 19.407 | -20 (-0,10%) |
| Filhos no futuro | 19.454 | 19.391 | -63 (-0,32%) |
| Intenção no app | 19.446 | 19.446 | 0 |

Não houve aumento da entrada nesses três exemplos. Não representa a fatura real: exclui histórico real, ferramentas comuns aos dois caminhos, geração, saída, raciocínio, eventuais consultas adicionais e descontos de cache. A troca do prefixo pode afetar o aquecimento de cache; não inferir economia faturada somente pela contagem.

## Validação no servidor

Diagnóstico temporário restrito por credencial aleatória, sem acesso a conversas nem envio, executou os módulos publicados em modo shadow e depois active. Resposta sem credencial recebeu 403. No modo active:

- Intenção no app: `complete`, uma memória, 789 candidatos, 39.283 tokens, 2.006 ms, `useSelectedPrompt=true`.
- Filhos: `complete`, uma memória, 789 candidatos, 39.418 tokens, 3.110 ms, `useSelectedPrompt=true`.

Essa prova valida seleção no runtime e habilitação do prompt selecionado; não é avaliação de uma resposta final completa do Brain nem comprovação de entrega do WhatsApp. Função e secret temporários de diagnóstico foram removidos e ausência conferida.

487 testes da base e 87 de segurança passaram. Cópias dos artefatos anteriores/posteriores e resultados estão em `.firebase/jev-rollout-20261008/`, ignorada pelo Git. Comparação do Brain em `.firebase/jev-evaluation/brain-vs-legacy.json`. Não modificar o manifesto histórico de produção para esconder diferenças.

Para reverter a seleção no próximo turno: definir `JEV_MEMORY_MODE=off` nos secrets do projeto. Não apagar memórias, sessões, agendamentos ou histórico. Pacote v530 preservado localmente se for necessária reversão de código revisada.
