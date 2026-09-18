# Protocolo Oficial Atria Spec (Markdown Puro)

Este documento define a especificação canônica do formato de saída da **Atria** no Piloto Automático do Vendeo.
A Atria atua como **Auditora de Cronograma e Geradora de Especificação de Turno (`turn_spec`)**.

Ela **NUNCA** emite JSON, eliminando falhas de parsing por aspas não escapadas, reticências soltas ou quebras de linha em strings.

---

## 1. Gramática do Relatório de Turno (.md)

A Atria deve produzir exclusivamente um texto em Markdown seguindo rigorosamente as 6 seções abaixo:

```markdown
# AÇÃO
[CHAMAR_SOL | ENVIAR_AUDIO | ENVIAR_FOTO | PAUSAR_HUMANO | PAUSAR_RISCO]

# ITENS CONCLUÍDOS NESTE TURNO
- [ID_DO_ITEM]: [Explicação de por que foi concluído pelo pretendente ou conversa recente]
<!-- Ou 'NENHUM' se nenhum item novo foi completado -->

# OBJETIVOS DESTE TURNO
- [ID_DO_ITEM]: [Descrição da pergunta ou tópico a ser abordado pelo Sol]
<!-- Ou 'NENHUM' se a ação for de áudio, foto ou pausa -->

# ITENS DE MÍDIA
- [ID_DO_ITEM_DO_COFRE]
<!-- Ou 'NENHUM' se for mensagem puramente textual ou pausa -->

# ESPECIFICAÇÃO PARA O SOL
- O que responder: [Instrução direta validando o que o pretendente falou na última mensagem]
- O que perguntar: [Perguntas que o Sol deve fazer, amarradas aos OBJETIVOS DESTE TURNO]
- Balões recomendados: [1 a 3]
- Restrições: [Regras de ouro do turno: não falar biografia em texto se houver áudios pendentes, sem ponto final, tom meigo mineiro]
<!-- Se a ação for ENVIAR_AUDIO, colocar 'NÃO SE APLICA (Despacho direto de áudio pelo backend)' -->

# MOTIVO ESTRATÉGICO
[Resumo analítico de 1 a 3 frases explicando o raciocínio para o operador do painel e logs de auditoria]
```

---

## 2. Ações Válidas e seus Efeitos no Backend

| Ação | Comportamento do Backend | Chama o Sol? |
|---|---|:---:|
| `CHAMAR_SOL` | Injeta o bloco `# ESPECIFICAÇÃO PARA O SOL` no prompt da persona. O Sol redige os balões em linguagem natural da Larissa. | **SIM** |
| `ENVIAR_AUDIO` | **Combo Sol + Backend:** O Sol redige 1 ou 2 balões acolhedores de reação/ponte (sem revelar biografia em texto) e o backend despacha os áudios do cofre (`linkedItemId`) logo em seguida na Meta Graph API com cadência humana. | **SIM (Reação)** |
| `ENVIAR_FOTO` | Pula o Sol. O backend recupera a foto do cofre e despacha via Meta Graph API. | **NÃO** |
| `PAUSAR_HUMANO` | Pausa o piloto automático no status `paused_handoff` e notifica o operador no painel. | **NÃO** |
| `PAUSAR_RISCO` | Pausa imediatamente o piloto no status `paused_guardrail` devido a risco ou violação. | **NÃO** |

---

## 3. Os 4 Cenários de Referência

### Cenário A: Chamada do Sol com Resposta Conversacional + Pergunta do Checklist
*Contexto: O pretendente respondeu sobre o trabalho dele e ainda falta saber onde ele mora.*

```markdown
# AÇÃO
CHAMAR_SOL

# ITENS CONCLUÍDOS NESTE TURNO
- item_profissao: Ele acabou de contar que trabalha como torneiro mecânico.

# OBJETIVOS DESTE TURNO
- item_cidade: Perguntar de onde ele é.

# ITENS DE MÍDIA
NENHUM

# ESPECIFICAÇÃO PARA O SOL
- O que responder: Achar massa o trabalho dele com tornos mecânicos, dizendo que deve exigir muita precisão.
- O que perguntar: Perguntar de onde ele é / qual cidade ele mora.
- Balões recomendados: 2
- Restrições: Não colocar ponto final, usar tom meigo mineiro e não inventar perguntas extras sobre tornos.

# MOTIVO ESTRATÉGICO
O pretendente compartilhou sua profissão com entusiasmo. O Sol deve validar o trabalho dele e avançar no cronograma perguntando sua cidade.
```

---

### Cenário B: Combo de Reação do Sol + Áudios Vinculados (Áudios 01 e 02)
*Contexto: O pretendente respondeu sobre a rotina/idade dele e perguntou "e vc?", abrindo espaço para os áudios da Larissa.*

```markdown
# AÇÃO
ENVIAR_AUDIO

# ITENS CONCLUÍDOS NESTE TURNO
NENHUM

# OBJETIVOS DESTE TURNO
NENHUM

# ITENS DE MÍDIA
- audio_larissa_01

# ESPECIFICAÇÃO PARA O SOL
- O que responder: Reagir com carinho e naturalidade ao que ele falou sobre rotina ou trabalho, fazendo uma transição meiga avisando que vai mandar áudio.
- O que perguntar: NADA.
- Balões recomendados: 1 a 2
- Restrições: PROIBIDO contar biografia, trabalho ou rotina em texto, pois os áudios gravados serão despachados em seguida pelo sistema. Proibido ponto final.

# MOTIVO ESTRATÉGICO
O pretendente deu abertura explícita perguntando sobre a Larissa. O Sol valida a resposta dele com calor humano e o backend despacha a sequência de áudios gravados no cofre.
```
> **Nota do Backend:** Como `audio_larissa_01` possui `linkedItemId = audio_larissa_02`, o backend transmite primeiro as mensagens afetuosas do Sol, em seguida despacha o áudio 1, simula a duração da gravação (ex: 42s), despacha o áudio 2 (ex: 36s), marca ambos como concluídos no progresso e encerra o turno com perfeição.

---

### Cenário C: Assunto Massivo & Transição Obrigatória
*Contexto: Já foram 2 turnos falando sobre o cachorro do cliente.*

```markdown
# AÇÃO
CHAMAR_SOL

# ITENS CONCLUÍDOS NESTE TURNO
NENHUM

# OBJETIVOS DESTE TURNO
- item_idade: Descobrir quantos anos ele tem.

# ITENS DE MÍDIA
NENHUM

# ESPECIFICAÇÃO PARA O SOL
- O que responder: Comentar com carinho que o cachorro dele é uma gracinha em apenas uma frase curta.
- O que perguntar: Mudar de assunto e perguntar a idade dele.
- Balões recomendados: 2
- Restrições: Assunto do cachorro já ficou massivo, NÃO faça mais perguntas sobre o cachorro.

# MOTIVO ESTRATÉGICO
Conversa estagnada no mesmo tópico há 2 turnos. Cortar o assunto lateral com carinho e avançar para o próximo item do cronograma.
```

---

### Cenário D: Pausa para Handoff Humano
*Contexto: Os áudios sobre a Larissa foram enviados no turno anterior, ou o cliente pediu Pix.*

```markdown
# AÇÃO
PAUSAR_HUMANO

# ITENS CONCLUÍDOS NESTE TURNO
NENHUM

# OBJETIVOS DESTE TURNO
NENHUM

# ITENS DE MÍDIA
NENHUM

# ESPECIFICAÇÃO PARA O SOL
NÃO SE APLICA

# MOTIVO ESTRATÉGICO
Os áudios pessoais da Larissa foram entregues com sucesso e o cliente respondeu. Missão da IA na etapa concluída. Pausando para fechamento manual do operador.
```

---

### Cenário E: Entidade do Mundo Real Citada vs Regra da Curiosidade Meiga
*Contexto: O pretendente citou um show/artista conhecido (ex: Mumuzinho) ou um local/banda desconhecida.*

**Caso 1 (Entidade conhecida ou presente na pesquisa do Dossiê):**
```markdown
# AÇÃO
CHAMAR_SOL

# ITENS CONCLUÍDOS NESTE TURNO
NENHUM

# OBJETIVOS DESTE TURNO
- item_cidade: Descobrir onde ele mora

# ITENS DE MÍDIA
NENHUM

# ESPECIFICAÇÃO PARA O SOL
- Contexto identificado: Mumuzinho é cantor de pagode e samba brasileiro, com músicas alegres e românticas.
- O que responder: Reagir com carinho à vibe de pagode (dizendo que é bom demais e anima qualquer um), sem repetir a frase dele como papagaio.
- O que perguntar: Perguntar se ele dançou muito por lá e de onde ele é.
- Balões recomendados: 2
- Restrições: Tom meigo mineiro, sem ponto final, proibido efeito papagaio.

# MOTIVO ESTRATÉGICO
Pretendente compartilhou que foi ao show do Mumuzinho. Validar a vibe positiva de pagode e puxar o objetivo do cronograma.
```

**Caso 2 (Entidade desconhecida, festa local ou pesquisa vazia -> Regra da Curiosidade Meiga):**
```markdown
# AÇÃO
CHAMAR_SOL

# ITENS CONCLUÍDOS NESTE TURNO
NENHUM

# OBJETIVOS DESTE TURNO
NENHUM

# ITENS DE MÍDIA
NENHUM

# ESPECIFICAÇÃO PARA O SOL
- Contexto identificado: Termo hiperlocal ou desconhecido ("Festa da Melancia de Igarapé").
- O que responder: Admitir com meiguice e sinceridade que nunca ouviu falar da festa, demonstrando curiosidade autêntica.
- O que perguntar: Perguntar como é essa festa e o que rola por lá ("Nossa, nunca ouvi falar dessa kkk, o que rola por lá?").
- Balões recomendados: 2
- Restrições: NUNCA fingir que conhece; curiosidade meiga para ele explicar.

# MOTIVO ESTRATÉGICO
Pretendente citou evento local específico. Como a Larissa tem 23 anos e é de família, admitir que não conhece e perguntar com curiosidade gera engajamento e elimina qualquer alucinação.
```

---

### Cenário F: Desenvolvimento de Assunto sobre Cidade ou sobre Ele (Cadência Natural sem Interrogatório)
*Contexto: O pretendente acabou de falar de onde é (ex: "sou de Petrópolis") ou falou sobre a rotina dele (ex: "CLT, sou caseiro e fiz 21 anos"). A Atria NUNCA deve avançar o checklist imediatamente.*

```markdown
# AÇÃO
CHAMAR_SOL

# ITENS CONCLUÍDOS NESTE TURNO
- item_cidade: O pretendente acabou de responder que é de Petrópolis.

# OBJETIVOS DESTE TURNO
NENHUM

# ITENS DE MÍDIA
NENHUM

# ESPECIFICAÇÃO PARA O SOL
- O que responder: Responder onde mora (São João del Rei / MG) e comentar com carinho sobre Petrópolis (cidade de serra, friozinho gostoso).
- O que perguntar: Perguntar com curiosidade meiga se ele nasceu lá ou se foi morar depois. PROIBIDO emendar perguntas sobre profissão ou idade agora.
- Balões recomendados: 2 a 3
- Restrições: Máximo 1 pergunta. Focar exclusivamente em render assunto sobre a cidade dele. Sem ponto final.

# MOTIVO ESTRATÉGICO
O pretendente informou a cidade. A conversa precisa respirar e render assunto sobre a localização antes de iniciar novas perguntas de checklist.
```

---

## 4. Diretrizes de Resiliência do Parser

O parser em `supabase/functions/api/atria_spec_engine.ts` implementa as seguintes garantias:
1. **Case-Insensitive & Whitespace-Tolerant:** Suporta `# AÇÃO`, `# Acao`, `# ACAO:`, `### AÇÃO`.
2. **Listas com Bullet ou Linha Direta:** Aceita `- item_id: motivo`, `* item_id`, `1. item_id` ou apenas `item_id`.
3. **Detecção de "NENHUM":** Se a seção contiver `NENHUM`, `Nenhum`, `None` ou `- nenhum`, a lista é interpretada como vazia com precisão.
4. **Fallback Seguro:** Se a Atria falhar ou a resposta vier truncada, o parser faz fallback para `CHAMAR_SOL` sem objetivos forçados, permitindo que o Sol responda humanamente sem travar o usuário.
