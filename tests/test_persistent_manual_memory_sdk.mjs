import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const sdk = fs.readFileSync("supabase/functions/api/openai_sdk_brain.ts", "utf8");
const orchestrator = fs.readFileSync("supabase/functions/api/brain_orchestrator.ts", "utf8");

test("Agent SDK recebe memória manual permanente relevante em formato compacto", () => {
  assert.match(sdk, /if \(params\.persistentManualFacts\?\.length\)/);
  assert.match(sdk, /MEMORIA_CONFIRMADA_RELEVANTE:/);
  assert.match(sdk, /persistentManualFacts\.slice\(0, 2\)/);
  assert.match(sdk, /não peça ao operador o mesmo dado novamente/);
});

test("fallback legado mantém dois fatos; modo Jev ativo não faz seleção lexical", () => {
  const relevantBlock = orchestrator.slice(
    orchestrator.indexOf("const loadLegacyPersistentManualFacts"),
    orchestrator.indexOf("let recoveredAudioToolState"),
  );
  assert.match(relevantBlock, /limit: 2/);
  assert.doesNotMatch(relevantBlock, /limit: 6/);
  assert.match(relevantBlock, /jevConfig.mode === "active" && useSdkConversationRuntime\s*\? \[\] : await loadLegacyPersistentManualFacts\(\)/);
});

test("correção não adiciona chamada de modelo ou ferramenta", () => {
  const block = sdk.slice(
    sdk.indexOf('if (params.persistentManualFacts?.length)'),
    sdk.indexOf('if (params.recentStyleStateSnippet)'),
  );
  assert.doesNotMatch(block, /fetch\(/);
  assert.doesNotMatch(block, /tool/i);
  assert.doesNotMatch(block, /responses\.create|chat\.completions/);
});
