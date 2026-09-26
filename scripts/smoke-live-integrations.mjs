// Smoke probes somente leitura. Nunca cria sessions/turns, envia mensagens ou altera dados.
// OpenAI consulta somente sessão/turno existentes. Meta faz GET da identidade da conta.
// Nenhum probe cria sessão/turno, envia mensagem ou altera dados.
const results = [];

async function probe(name, requiredEnv, request) {
  const missing = requiredEnv.filter((key) => !process.env[key]);
  if (missing.length) {
    results.push({ integration: name, status: "BLOCKED BY ENVIRONMENT", missing });
    return;
  }
  try {
    const response = await request();
    results.push({ integration: name, status: response.ok ? "PASS" : "FAIL", httpStatus: response.status });
  } catch (error) {
    results.push({ integration: name, status: "FAIL", error: error instanceof Error ? error.message : String(error) });
  }
}

const openAiSessionId = process.env.OPENAI_BRAIN_SESSION_ID;
const openAiTurnId = process.env.OPENAI_BRAIN_TURN_ID;
await probe("OpenAI Agent (GET existing session turn)", [
  "OPENAI_API_KEY",
  "OPENAI_BRAIN_SESSION_ID",
  "OPENAI_BRAIN_TURN_ID",
], () => fetch(
  `https://api.openai.com/v1/agents/sessions/${encodeURIComponent(openAiSessionId)}/turns/${encodeURIComponent(openAiTurnId)}`,
  { method: "GET", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "OpenAI-Beta": "agents=v1" } },
));

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
await probe("Supabase (GET one Brain event id)", ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"].filter((key) => key !== "NEXT_PUBLIC_SUPABASE_URL" || !supabaseUrl), () => fetch(
  `${supabaseUrl.replace(/\/$/, "")}/rest/v1/brain_turn_events?select=id&limit=1`,
  { method: "GET", headers: {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
  } },
));

await probe("Meta Graph (GET account identity)", ["META_ACCESS_TOKEN"], () => {
  const version = process.env.META_GRAPH_VERSION || "v21.0";
  return fetch(`https://graph.instagram.com/${version}/me?fields=id,username&access_token=${encodeURIComponent(process.env.META_ACCESS_TOKEN)}`, { method: "GET" });
});

for (const result of results) console.log(JSON.stringify(result));
if (results.some((result) => result.status === "FAIL")) process.exitCode = 1;
