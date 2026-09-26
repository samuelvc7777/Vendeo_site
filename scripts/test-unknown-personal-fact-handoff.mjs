import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildPersistentTurnContext,
  validateConversationBrainPlan,
} from "../supabase/functions/api/openai_brain.ts";
import {
  buildCanonicalAgentInstructions,
  buildLegacyAgentInstructions,
} from "../supabase/functions/api/openai_agent_instructions.ts";

const inboundText = "Vc ja foi em juiz de fora?";

test("pergunta pessoal sem fato conhecido pode entrar em revisão humana sem enviar resposta", () => {
  const turnContext = buildPersistentTurnContext({
    supabase: null,
    conversationId: "conversation-regression-juiz-de-fora",
    currentStageId: "stage_1_conexao",
    currentObjectiveId: "goal_discover_profession",
    currentObjectiveLabel: "Descobrir profissão",
    currentObjectiveDescription: "Entender no que ele trabalha ou estuda",
    inboundMessages: [inboundText],
    currentInboundMessages: [{ id: "message-juiz-de-fora", text: inboundText }],
    recentMessages: [],
  });
  const persistentInstructions = buildCanonicalAgentInstructions({ persistentMode: true });
  const legacyInstructions = buildLegacyAgentInstructions();

  assert.match(turnContext, /"action": "reply" \| "wait"/);
  assert.match(turnContext, /Escolha "action": "wait"/i);
  assert.match(turnContext, /Vc ja foi em juiz de fora\?/i);
  assert.match(persistentInstructions, /pergunta direta sobre fato ou experiência pessoal sem evidência/i);
  assert.match(persistentInstructions, /action="wait"/i);
  assert.match(legacyInstructions, /pergunta direta sobre fato ou experiência.*sem evidência/i);
  assert.doesNotMatch(persistentInstructions, /Se não constar:.*Escolha outra continuação natural/s);
  assert.doesNotMatch(legacyInstructions, /Se não constar:.*Escolha outra continuação natural/s);

  assert.deepEqual(
    validateConversationBrainPlan({ action: "wait", reasoning: "Experiência não confirmada" }),
    { valid: true },
  );
});
