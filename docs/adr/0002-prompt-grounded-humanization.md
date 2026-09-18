# 0002: Humanização por Referência Canônica no Prompt (Persona Grounding) em Substituição à Sanitização por Código

## Contexto
Anteriormente, o sistema utilizava uma abordagem de higienização programática pós-geração (`TextHumanizerService` e botões de "Auto-Humanizar" no modal do chat), aplicando expressões regulares para remover pontuações formais, cortar clichês de IA corporativa e substituir gírias masculinas ou sintéticas.
Essa abordagem gerava atrito operacional (o operador precisava clicar em botões para consertar o texto da IA), causava distorções semânticas pontuais devido à rigidez de substituições por regex e mantinha a IA externa sem o referencial estilístico autêntico da persona Larissa.

## Decisão
Substituir o modelo de "higienização mecânica por código" pelo modelo de **Humanização por Referência Canônica de Persona (Few-Shot In-Context Grounding)**:
1. **Pares Contrastivos e Dataset Canônico no Prompt:** O prompt contextual passa a alimentar a IA diretamente na fonte com:
   - Pares contrastivos cirúrgicos ("Como uma IA falaria" vs "Como a Larissa realmente digita").
   - Um bloco rico de diálogos autênticos da Larissa divididos por situações reais (rotina no hospital, cumprimentos meigos, recusa suave, reações espontâneas).
2. **Arquitetura Híbrida de Armazenamento:**
   - Fallback de alta fidelidade: Base canônica fixa incorporada diretamente no caso de uso (`GenerateAiPromptUseCase.ts`) e na Edge Function (`instagram_ai.ts`).
   - Expansão dinâmica: Suporte a referências adicionais gerenciadas no Supabase para inclusão de novos diálogos reais sem alteração de código.
3. **Eliminação da Sanitização Programática:**
   - Desativação do botão "Auto-Humanizar / Ajustar" e dos linters de advertência na interface (`AiAssistantModal.tsx`).
   - O texto retornado pela IA é exibido fielmente na tela para revisão e disparo direto pelo operador, preservando a autonomia de edição humana manual nos campos de texto.

## Consequências
- A IA gera respostas indistinguíveis de pessoas reais de primeira, reduzindo passos manuais do operador.
- Eliminação de heurísticas frágeis de regex que poderiam corromper palavras legítimas ou alterar a intenção da mensagem.
- Maior expressividade e naturalidade no diálogo com os pretendentes.
