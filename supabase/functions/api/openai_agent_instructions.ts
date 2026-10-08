// ============================================================================
// OPENAI AGENT INSTRUCTIONS — adaptador da fonte canônica única
// ============================================================================
import crypto from "node:crypto";
import { LARISSA_CANONICAL_PROMPT, LARISSA_ESSENTIAL_PROMPT, LARISSA_CANONICAL_PROMPT_VERSION, QUESTION_INTENTS_CONTRACT_EXAMPLE } from "./larissa_canonical_prompt.generated.ts";

export { LARISSA_CANONICAL_PROMPT, QUESTION_INTENTS_CONTRACT_EXAMPLE };
export const VENDEO_AGENT_INSTRUCTIONS_VERSION = LARISSA_CANONICAL_PROMPT_VERSION;


/** Retorna a única instrução fixa usada pelo Agent; o contexto variável é montado por turno. */
export function buildCanonicalAgentInstructions(options?: { persistentMode?: boolean; selectedMemoryMode?: boolean } | string | boolean): string {
  return typeof options === "object" && options?.selectedMemoryMode === true ? LARISSA_ESSENTIAL_PROMPT : LARISSA_CANONICAL_PROMPT;
}

export function getCanonicalAgentInstructionsHash(options?: { persistentMode?: boolean; selectedMemoryMode?: boolean } | string | boolean): string {
  return crypto.createHash("sha256").update(buildCanonicalAgentInstructions(options), "utf8").digest("hex");
}
