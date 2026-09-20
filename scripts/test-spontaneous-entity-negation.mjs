import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import ts from "typescript";

function loadModule(filePath) {
  const fullPath = path.resolve(filePath);
  const tsCode = fs.readFileSync(fullPath, "utf8");
  const jsCode = ts.transpileModule(tsCode, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;

  const moduleObj = { exports: {} };
  const context = {
    module: moduleObj,
    exports: moduleObj.exports,
    require: (dep) => {
      if (dep.endsWith(".ts") || dep.endsWith(".js") || dep.startsWith("./") || dep.startsWith("../")) {
        const depPath = path.resolve(path.dirname(fullPath), dep.endsWith(".ts") ? dep : dep + ".ts");
        return loadModule(depPath);
      }
      return {};
    },
    console,
    Date,
    Math,
    Set,
    Map,
    Array,
    Object,
    String,
    Number,
    Boolean,
    RegExp,
    JSON,
    fetch: async () => ({ ok: true, json: async () => ({}) }),
    AbortSignal,
    Deno: { env: { get: () => undefined } },
  };

  vm.runInNewContext(jsCode, context);
  return moduleObj.exports;
}

const orchestrator = loadModule("supabase/functions/api/experimental_orchestrator.ts");
const { detectSpontaneousObjectiveCompletions } = orchestrator;

console.log("🧪 Iniciando auditoria dos 6 casos de Entidade, Negação e Temporalidade...\n");

// Caso 1: “meu irmão tem 27 anos”
{
  const matches = detectSpontaneousObjectiveCompletions(
    [{ id: "m1", text: "meu irmão tem 27 anos", sender: "pretendente" }],
    ["goal_age", "goal_job", "goal_relationship"]
  );
  const ageMatch = matches.find((m) => m.field === "age");
  assert.equal(ageMatch, undefined, "Caso 1: 'meu irmão tem 27 anos' NÃO deve atribuir idade ao pretendente (entidade terceiro)");
  console.log("✔ Caso 1: 'meu irmão tem 27 anos' -> Ignorado com sucesso (entidade: irmão)");
}

// Caso 2: “eu tinha 27 quando comecei”
{
  const matches = detectSpontaneousObjectiveCompletions(
    [{ id: "m2", text: "eu tinha 27 quando comecei", sender: "pretendente" }],
    ["goal_age"]
  );
  const ageMatch = matches.find((m) => m.field === "age");
  assert.equal(ageMatch, undefined, "Caso 2: 'eu tinha 27 quando comecei' NÃO deve atribuir idade atual (temporalidade passado)");
  console.log("✔ Caso 2: 'eu tinha 27 quando comecei' -> Ignorado com sucesso (temporalidade: passado)");
}

// Caso 3: “não sou solteiro”
{
  const matches = detectSpontaneousObjectiveCompletions(
    [{ id: "m3", text: "não sou solteiro", sender: "pretendente" }],
    ["goal_relationship"]
  );
  const relMatch = matches.find((m) => m.field === "relationship_status");
  assert(relMatch?.value !== "solteiro", "Caso 3: 'não sou solteiro' NUNCA deve atribuir 'solteiro'");
  assert.equal(relMatch?.value, "não é solteiro", "Caso 3: 'não sou solteiro' deve reconhecer negação");
  console.log("✔ Caso 3: 'não sou solteiro' -> Negação respeitada com sucesso (value: 'não é solteiro')");
}

// Caso 4: “minha ex trabalha com mineração”
{
  const matches = detectSpontaneousObjectiveCompletions(
    [{ id: "m4", text: "minha ex trabalha com mineração", sender: "pretendente" }],
    ["goal_job"]
  );
  const workMatch = matches.find((m) => m.field === "job" || m.field === "work");
  assert.equal(workMatch, undefined, "Caso 4: 'minha ex trabalha com mineração' NÃO deve atribuir profissão ao pretendente (entidade terceiro)");
  console.log("✔ Caso 4: 'minha ex trabalha com mineração' -> Ignorado com sucesso (entidade: ex)");
}

// Caso 5: “trabalhava com mineração, hoje sou motorista”
{
  const matches = detectSpontaneousObjectiveCompletions(
    [{ id: "m5", text: "trabalhava com mineração, hoje sou motorista", sender: "pretendente" }],
    ["goal_job"]
  );
  const workMatch = matches.find((m) => m.field === "job" || m.field === "work");
  assert(workMatch, "Caso 5: Deve detectar profissão");
  assert.equal(workMatch.value, "motorista", "Caso 5: Trabalho atual deve ser 'motorista', vencendo o passado 'mineração'");
  console.log("✔ Caso 5: 'trabalhava com mineração, hoje sou motorista' -> Priorizou presente com sucesso (value: 'motorista')");
}

// Caso 6: “não tenho filhos, mas quero dois”
{
  const matches = detectSpontaneousObjectiveCompletions(
    [{ id: "m6", text: "não tenho filhos, mas quero dois", sender: "pretendente" }],
    ["goal_has_children", "goal_wants_children"]
  );
  const hasKidsMatch = matches.find((m) => m.objectiveId === "goal_has_children");
  const wantsKidsMatch = matches.find((m) => m.objectiveId === "goal_wants_children");

  assert(hasKidsMatch, "Caso 6: Deve detectar status de ter filhos");
  assert.equal(hasKidsMatch.value, "sem filhos", "Caso 6: Situação atual deve ser 'sem filhos'");
  assert(wantsKidsMatch, "Caso 6: Deve detectar intenção futura de ter filhos");
  assert.equal(wantsKidsMatch.value, "quero dois", "Caso 6: Intenção futura deve ser 'quero dois'");
  console.log("✔ Caso 6: 'não tenho filhos, mas quero dois' -> Distinguiu ter filhos de querer filhos com sucesso");
}

console.log("\n🎉 TODOS OS 6 CASOS DE ENTIDADE, NEGAÇÃO E TEMPORALIDADE FORAM APROVADOS!");
