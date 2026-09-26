// ============================================================================
// OPENAI AGENT INSTRUCTIONS — adaptador da fonte canônica única
// ============================================================================
import crypto from "node:crypto";
import { LARISSA_CANONICAL_PROMPT, LARISSA_CANONICAL_PROMPT_VERSION, QUESTION_INTENTS_CONTRACT_EXAMPLE } from "./larissa_canonical_prompt.generated.ts";

export { LARISSA_CANONICAL_PROMPT, QUESTION_INTENTS_CONTRACT_EXAMPLE };
export const VENDEO_AGENT_INSTRUCTIONS_VERSION = LARISSA_CANONICAL_PROMPT_VERSION;


/** Retorna a única instrução fixa usada pelo Agent; o contexto variável é montado por turno. */
export function buildCanonicalAgentInstructions(_options?: { persistentMode?: boolean } | string | boolean): string {
  return LARISSA_CANONICAL_PROMPT;
}

export function getCanonicalAgentInstructionsHash(_options?: { persistentMode?: boolean } | string | boolean): string {
  return crypto.createHash("sha256").update(LARISSA_CANONICAL_PROMPT, "utf8").digest("hex");
}

export const VENDEO_AGENT_INSTRUCTIONS_HASH = getCanonicalAgentInstructionsHash();
