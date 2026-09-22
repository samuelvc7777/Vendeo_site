/**
 * test-no-subagents-guard.mjs
 * Barreira Estática de Verificação Contínua — NO_VENDEO_SUBAGENTS = true
 *
 * Garante que NENHUM resíduo da camada legada de subagentes do produto Vendeo
 * retorne ao código de produção, assegurando a consolidação do Brain Único.
 */

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

const BANNED_TERMS = [
  "responsibleSubagent",
  "routedSubagent",
  "loadSubagentsCatalog",
  "CANONICAL_SUBAGENTS",
  "subagent_definitions",
  "allowedSubagents",
  "primarySubagent",
  "delegate_mission",
];

const BANNED_FILES = [
  "src/domain/repositories/ISubagentRepository.ts",
  "src/infrastructure/repositories/SupabaseSubagentRepository.ts",
  "src/domain/entities/Subagent.ts",
];

const PRODUCTION_CODE_FILES = [
  "src/domain/entities/ChatStage.ts",
  "src/infrastructure/repositories/SupabaseChatStageRepository.ts",
  "supabase/functions/api/index.ts",
  "supabase/functions/api/openai_brain.ts",
  "supabase/functions/api/brain_orchestrator.ts",
];

let passed = 0;
let failed = 0;

function assert(description, condition) {
  if (condition) {
    console.log(`  ✅ PASS | ${description}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL | ${description}`);
    failed++;
  }
}

console.log("================================================================================");
console.log("BARREIRA ESTÁTICA: GUARDA CONTRA SUBAGENTES NO RUNTIME DO VENDEO");
console.log("================================================================================\n");

// 1. Verificar arquivos banidos deletados
console.log("--- 1. AUSÊNCIA DE ARQUIVOS DE DOMÍNIO DE SUBAGENTES ---");
for (const file of BANNED_FILES) {
  const fullPath = resolve(file);
  const exists = existsSync(fullPath);
  assert(`Arquivo banido '${file}' não existe no projeto`, !exists);
}

// 2. Verificar ausência dos 8 termos banidos no código de produção
console.log("\n--- 2. AUDITORIA DOS 8 TERMOS BANIDOS NO CÓDIGO DE PRODUÇÃO ---");
for (const file of PRODUCTION_CODE_FILES) {
  const fullPath = resolve(file);
  if (!existsSync(fullPath)) {
    assert(`Arquivo de produção '${file}' existe para auditoria`, false);
    continue;
  }
  const content = readFileSync(fullPath, "utf-8");
  for (const term of BANNED_TERMS) {
    const hasTerm = content.includes(term);
    assert(`'${file}' está 100% livre de '${term}'`, !hasTerm);
  }
}

console.log("\n================================================================================");
console.log(`TOTAL DE ASSERÇÕES: ${passed + failed}`);
console.log(`✅ APROVADAS: ${passed}`);
console.log(`❌ FALHAS: ${failed}`);
console.log("================================================================================");

if (failed > 0) {
  process.exit(1);
} else {
  console.log("\n🚀 GUARDA APROVADA: Arquitetura Brain Único consolidada com sucesso!");
}
