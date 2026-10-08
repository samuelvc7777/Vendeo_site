// Leitura do catálogo da persona e seleção com perguntas sintéticas; nenhum envio.
import fs from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { loadPersonaMemoryCatalog } from "../supabase/functions/api/persona_memory_repository.ts";
import { LARISSA_OPTIONAL_MEMORIES, LARISSA_CANONICAL_PROMPT, LARISSA_ESSENTIAL_PROMPT } from "../supabase/functions/api/larissa_canonical_prompt.generated.ts";
import { formatSelectedBrainMemories } from "../supabase/functions/api/brain_memory_context.ts";
import { selectJevMemories } from "../supabase/functions/api/jev_memory_selector.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (!process.argv.includes("--live")) {
  console.log("Use --live para consultar o catálogo e avaliar seleção; nenhuma chamada realizada.");
} else {
  await evaluate();
}
async function evaluate() {
  const local = fs.existsSync(path.join(root, ".env.local")) ? parseEnv(fs.readFileSync(path.join(root, ".env.local"), "utf8")) : {};
  const env = { ...local, ...process.env };
  if (!env.TYPESAFE_API_KEY || !env.SUPABASE_SERVICE_ROLE_KEY) { console.error("Credenciais locais necessárias ausentes."); process.exitCode = 2; return; }
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  if (new URL(url).hostname !== "wsdualhvopidgqcumonr.supabase.co") throw new Error("Projeto de avaliação inesperado");
  const db = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  if (process.argv.includes("--brain-tokens") && process.argv.includes("--production-key")) {
    const { data, error } = await db.from("instagram_config").select("app_secret").eq("id", "openai_api_key").maybeSingle();
    if (error || !data?.app_secret) throw new Error("Credencial OpenAI do servidor indisponível");
    env.OPENAI_API_KEY = data.app_secret.trim();
  }
  const start = Date.now();
  const catalog = [...LARISSA_OPTIONAL_MEMORIES, ...await loadPersonaMemoryCatalog({ supabase: db, personaId: "larissa", signal: AbortSignal.timeout(10000) })];
  const catalogLoadMs = Date.now() - start;
  const threshold = Number(process.argv.find(arg => arg.startsWith("--threshold="))?.split("=")[1] || env.JEV_MEMORY_THRESHOLD);
  if (!Number.isFinite(threshold) || threshold <= 0 || threshold >= 1) throw new Error("Limiar de avaliação inválido");
  const results = [];
  for (const message of ["Quais filmes você gosta?", "Você quer ter filhos no futuro?"]) {
    let batches = 0;
    const selection = await selectJevMemories({ memories: catalog, state: {
      messages: [message], recentMessages: [], stage: "conexao", objective: "Responder à pergunta atual com fatos comprovados.",
    }, config: { mode: "shadow", apiKey: env.TYPESAFE_API_KEY, threshold, timeoutMs: 10000 }, fetchImpl: async (...args) => { batches++; return fetch(...args); } });
    let brainTokens;
    if (process.argv.includes("--brain-tokens") && selection.status === "complete") {
      if (!env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY necessária para contar tokens");
      const count = async (instructions, input) => {
        const response = await fetch("https://api.openai.com/v1/responses/input_tokens", {
          method: "POST", headers: { Authorization: `Bearer ${env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: "gpt-6.1-sol", instructions, input }), signal: AbortSignal.timeout(30000),
        });
        const body = await response.json();
        if (!response.ok || !Number.isInteger(body.input_tokens)) throw new Error(`Contagem OpenAI indisponível: HTTP ${response.status}`);
        return body.input_tokens;
      };
      const baseline = await count(LARISSA_CANONICAL_PROMPT, message);
      const selected = await count(LARISSA_ESSENTIAL_PROMPT, [{ role: "system", content: formatSelectedBrainMemories(selection.memories) }, { role: "user", content: message }]);
      brainTokens = { model: "gpt-6.1-sol", baseline, selected, delta: selected - baseline, limitation: "Contagem de instruções e memórias, sem histórico, ferramentas, saída ou descontos de cache. Nenhuma resposta gerada." };
      console.log(JSON.stringify({ brainTokens }));
    }
    results.push({ question: message, status: selection.status, reason: selection.reason, evaluatedCount: selection.evaluatedCount, selectedIds: selection.memories.map(item => item.id), selectedBytes: new TextEncoder().encode(JSON.stringify(selection.memories)).length, durationMs: selection.durationMs, inputTokens: selection.inputTokens, outputTokens: selection.outputTokens, batches, brainTokens });
    console.log(JSON.stringify({ status: selection.status, reason: selection.reason, catalogCount: catalog.length, evaluatedCount: selection.evaluatedCount, selectedCount: selection.memories.length, selectedBytes: results.at(-1).selectedBytes, durationMs: selection.durationMs, batches }));
  }
  const output = path.join(root, ".firebase/jev-evaluation", `catalog-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify({ checkedAt: new Date().toISOString(), catalogCount: catalog.length, catalogLoadMs, threshold, limitations: "Perguntas sintéticas e leitura da persona, sem chats. Mede cobertura e desempenho; ainda não comprova qualidade final ou economia agregada do Brain.", results }, null, 2));
  console.log(`Relatório salvo: ${output}`);
  if (results.some(item => item.status !== "complete")) process.exitCode = 1;
}
