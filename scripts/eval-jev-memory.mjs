// Opt-in, API TypeSafe somente; casos fictícios, nenhum chat ou envio WhatsApp.
import fs from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import { selectJevMemories } from "../supabase/functions/api/jev_memory_selector.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixture = JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures/jev-memory-evaluation.json"), "utf8"));
const dataset = process.argv.includes("--holdout") ? "holdout" : "calibration";
if (dataset === "holdout") fixture.cases = JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures/jev-memory-holdout.json"), "utf8")).cases;
const ids = new Set(fixture.memories.map(memory => memory.id));
if (ids.size !== fixture.memories.length || fixture.cases.some(item => item.expected.some(id => !ids.has(id)))) throw new Error("Fixture de avaliação inconsistente");
if (!process.argv.includes("--live")) {
  console.log(`Avaliação preparada: ${fixture.cases.length} casos fictícios. Use --live e TYPESAFE_API_KEY para executar; nenhuma chamada feita.`);
} else {
  await runEvaluation();
}

async function runEvaluation() {
  const local = fs.existsSync(path.join(root, ".env.local")) ? parseEnv(fs.readFileSync(path.join(root, ".env.local"), "utf8")) : {};
  const apiKey = process.env.TYPESAFE_API_KEY || local.TYPESAFE_API_KEY;
  if (!apiKey) { console.error("TYPESAFE_API_KEY ausente; avaliação real não executada."); process.exitCode = 2; return; }
  const threshold = Number(process.argv.find(arg => arg.startsWith("--threshold="))?.split("=")[1] || process.env.JEV_MEMORY_THRESHOLD || local.JEV_MEMORY_THRESHOLD);
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold >= 1) { console.error("Defina JEV_MEMORY_THRESHOLD explicitamente para a rodada de calibração."); process.exitCode = 2; return; }
  const results = [];
  for (const item of fixture.cases) {
    const selected = await selectJevMemories({ memories: fixture.memories, state: {
      messages: item.messages, recentMessages: item.recent || [], context: item.context || "",
      stage: "conexao", objective: "Responder às perguntas atuais com fatos comprovados.",
    }, config: { mode: "shadow", apiKey, threshold, timeoutMs: 10000 } });
    const actual = selected.memories.map(memory => memory.id);
    const recalled = item.expected.filter(id => actual.includes(id)).length;
    const passed = selected.status === "complete" && recalled === item.expected.length && (item.allowExtra !== false || actual.every(id => item.expected.includes(id)));
    results.push({ id: item.id, critical: Boolean(item.critical), expected: item.expected, selected: actual, scores: selected.scores, recalled, passed, ...Object.fromEntries(["status", "reason", "durationMs", "inputTokens", "outputTokens", "model", "policyVersion"].map(key => [key, selected[key]])) });
    console.log(JSON.stringify({ id: item.id, passed, status: selected.status, selected: actual }));
  }
  const expectedCount = results.reduce((sum, item) => sum + item.expected.length, 0);
  const inputTokens = results.reduce((sum, item) => sum + item.inputTokens, 0);
  const report = {
    checkedAt: new Date().toISOString(), dataset, threshold, cases: results.length,
    recall: results.reduce((sum, item) => sum + item.recalled, 0) / Math.max(1, expectedCount),
    criticalPassed: results.filter(item => item.critical).every(item => item.passed),
    inputTokens, selectorEstimatedUsd: inputTokens / 1000000 * 0.042,
    limitations: "Preço de referência em 08/10/2026. Esta rodada mede o seletor com catálogo fictício pequeno; não comprova custo agregado do Brain, latência do catálogo real nem qualidade final das respostas.",
    results,
  };
  const output = path.join(root, ".firebase/jev-evaluation", `selection-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2));
  console.log(`Relatório salvo: ${output}`);
  if (report.recall < 0.98 || !report.criticalPassed || results.some(item => !item.passed)) process.exitCode = 1;
}
