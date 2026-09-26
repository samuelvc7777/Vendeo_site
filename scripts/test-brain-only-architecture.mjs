/**
 * Barreira estrutural da arquitetura Brain único.
 *
 * O teste audita somente o runtime atual. Scripts e fixtures históricas podem
 * mencionar nomes antigos para reproduzir migrações, contratos ou dados de
 * compatibilidade e não devem reabrir uma rota de produção.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { resolve } from "node:path";

const productionFiles = [
  "supabase/functions/api/index.ts",
  "supabase/functions/api/brain_orchestrator.ts",
  "supabase/functions/api/openai_brain.ts",
  "supabase/functions/api/audio_transcription.ts",
  "src/application",
  "src/infrastructure/ai",
  "src/presentation/components/chat",
  "src/presentation/components/config",
  "src/app",
];

const bannedRuntimeTerms = [
  "AtriaChatService",
  "KieChatService",
  "GroqChatService",
  "GenerateAiResponseUseCase",
  "GenerateAiPromptUseCase",
  "DeepSeek",
  "TokenHarbor",
  "NVIDIA",
  "buildSubagentExecutorPrompt",
  "callModelOrOpenAi",
  "callModelOrKie",
  "callModelOrAtria",
  "/api/ai/generate",
  "/ai/generate",
  "/api/ai/prompt",
  "/ai/prompt",
];

const removedFiles = [
  "src/presentation/components/chat/AiAssistantModal.tsx",
  "src/app/api/ai/generate/route.ts",
  "src/app/api/ai/prompt/[conversationId]/route.ts",
  "src/app/api/ai/kie-status/route.ts",
  "src/application/use-cases/GenerateAiResponseUseCase.ts",
  "src/application/use-cases/GenerateAiPromptUseCase.ts",
  "src/infrastructure/ai/AtriaChatService.ts",
  "src/infrastructure/ai/KieChatService.ts",
  "src/infrastructure/ai/GroqChatService.ts",
  "src/domain/services/LarissaPromptBuilder.ts",
  "supabase/functions/api/instagram_ai.ts",
  "supabase/functions/api/LarissaPromptBuilder.ts",
  "supabase/functions/api/tinder_ai.ts",
];

function collectFiles(relativePath) {
  const absolutePath = resolve(relativePath);
  if (!existsSync(absolutePath)) return [];
  if (statSync(absolutePath).isFile()) return [absolutePath];

  const files = [];
  for (const entry of readdirSync(absolutePath, { withFileTypes: true })) {
    const childPath = `${absolutePath}/${entry.name}`;
    if (entry.isDirectory()) files.push(...collectFiles(childPath));
    else if (/\.(ts|tsx|mjs)$/.test(entry.name)) files.push(childPath);
  }
  return files;
}

function readProductionSources() {
  const files = productionFiles.flatMap(collectFiles);
  return files.map((file) => ({ file, content: readFileSync(file, "utf8") }));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
  console.log(`✅ ${message}`);
}

const sources = readProductionSources();
const combined = sources.map(({ content }) => content).join("\n");

console.log("Auditoria Brain único — runtime de produção\n");

for (const file of removedFiles) {
  assert(!existsSync(resolve(file)), `arquivo removido: ${file}`);
}

for (const { file, content } of sources) {
  for (const term of bannedRuntimeTerms) {
    assert(!content.includes(term), `${file.replace(`${process.cwd()}\\`, "")} sem '${term}'`);
  }
}

assert(
  combined.includes("runOpenAiBrainTurn") && combined.includes("runBrainOrchestration"),
  "o runtime conecta o orquestrador ao Brain oficial OpenAI",
);
assert(
  combined.includes("GroqCloudAudioTranscriber") || combined.includes("whisper-large-v3"),
  "a transcrição de áudio Groq continua disponível",
);

const orchestrator = readFileSync(resolve("supabase/functions/api/brain_orchestrator.ts"), "utf8");
const api = readFileSync(resolve("supabase/functions/api/index.ts"), "utf8");
assert(!/\bisOpenAiAgentBrain\b/.test(orchestrator), "não existe seletor nominal para executor alternativo");
assert(!/\b(callModelOr|buildSubagentExecutorPrompt|runKie|runAtria)\b/.test(orchestrator), "não existe chamada de provedor conversacional legado");
assert(!/\/ai\/(generate|kie-status|prompt)/.test(api), "não existem endpoints manuais de geração, prompt ou Kie");
assert(/export const runExperimentalOrchestration = runBrainOrchestration/.test(orchestrator), "alias histórico aponta diretamente para o Brain atual");

console.log("\nArquitetura Brain único validada com sucesso.");
