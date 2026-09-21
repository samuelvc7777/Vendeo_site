// ============================================================================
// ATUALIZAÇÃO E AUDITORIA AO VIVO DO OPENAI AGENT "BRAIN" (ZERO MOCK)
// OpenAI Agents API (v1) — Validação Completa de Ponta a Ponta
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

// 1. Carrega credenciais server-side de .env.local
const envPath = path.resolve(process.cwd(), '.env.local');
if (!fs.existsSync(envPath)) {
  console.error("ERRO: .env.local não encontrado!");
  process.exit(1);
}

const envContent = fs.readFileSync(envPath, 'utf8');
const getEnv = (key) => {
  const match = envContent.match(new RegExp(`^${key}=(.*)`, 'm'));
  return match ? match[1].trim() : process.env[key];
};

const apiKey = getEnv('OPENAI_API_KEY');
const agentId = getEnv('OPENAI_BRAIN_AGENT_ID');
const supabaseUrl = getEnv('NEXT_PUBLIC_SUPABASE_URL');
const supabaseKey = getEnv('SUPABASE_SERVICE_ROLE_KEY') || getEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY');

if (!apiKey || !agentId) {
  console.error("ERRO: OPENAI_API_KEY ou OPENAI_BRAIN_AGENT_ID ausentes!");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const headers = {
  Authorization: `Bearer ${apiKey}`,
  'Content-Type': 'application/json',
  'OpenAI-Beta': 'agents=v1',
};

// Contrato formal da Function Tool persona_memory_search
const PERSONA_MEMORY_FUNCTION_TOOL = {
  type: 'function',
  name: 'persona_memory_search',
  description: 'Pesquisa a PersonaMemory oficial da Larissa no Supabase para encontrar fatos, preferências, hábitos, experiências, gostos e informações relevantes ao contexto atual. Use quando precisar descobrir algo verdadeiro sobre Larissa. Não invente fatos que podem ser consultados nesta ferramenta.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Informação que precisa ser pesquisada sobre a Larissa.',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 8,
      },
    },
    required: ['query'],
    additionalProperties: false,
  },
};

async function main() {
  console.log("==================================================================");
  console.log("AUDITORIA E VALIDAÇÃO REAL DO OPENAI AGENT BRAIN NA AGENTS API");
  console.log(`Agent ID: ${agentId}`);
  console.log("==================================================================\n");

  // 1. GET ANTES
  console.log("--> [1/6] Consultando configuração remota do Agent...");
  const resBefore = await fetch(`https://api.openai.com/v1/agents/${agentId}`, {
    method: 'GET',
    headers,
  });

  if (!resBefore.ok) {
    console.error(`ERRO ao consultar Agent: ${resBefore.status} ${await resBefore.text()}`);
    process.exit(1);
  }

  const agentConfig = await resBefore.json();
  console.log("Configuração remota atual obtida com sucesso.");

  // 2. POST UPDATE (Garante preservação de todos os campos e registra a Function Tool)
  console.log("\n--> [2/6] Atualizando Agent remoto com a Function Tool persona_memory_search...");
  const updatePayload = {
    name: agentConfig.name,
    model: agentConfig.model,
    instructions: agentConfig.instructions,
    reasoning: agentConfig.reasoning,
    text: agentConfig.text,
    tools: [PERSONA_MEMORY_FUNCTION_TOOL],
  };

  const resUpdate = await fetch(`https://api.openai.com/v1/agents/${agentId}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(updatePayload),
  });

  if (!resUpdate.ok) {
    console.error(`ERRO na atualização remota: HTTP ${resUpdate.status}\n${await resUpdate.text()}`);
    process.exit(1);
  }

  // 3. GET DEPOIS
  console.log("\n--> [3/6] Confirmando registro da Tool no Agent...");
  const resAfter = await fetch(`https://api.openai.com/v1/agents/${agentId}`, {
    method: 'GET',
    headers,
  });
  const agentAfter = await resAfter.json();

  if (!agentAfter.tools || agentAfter.tools.length === 0) {
    console.error("FALHA: O campo tools continua vazio após atualização!");
    process.exit(1);
  }
  console.log(`✅ Sucesso: O Agent agora possui ${agentAfter.tools.length} ferramenta(s) registrada(s): [${agentAfter.tools.map(t => t.name).join(', ')}]`);

  // 4. CRIAR SESSÃO CONVERSATION-ONLY COM ENVIRONMENT NONE E INPUT REAL
  console.log("\n--> [4/6] Iniciando Sessão REAL na OpenAI Agents API...");
  const userMessage = "Eu curto motocross, vou quase todo final de semana e você?";

  const sessionPayload = {
    agent_id: agentId,
    environment: { type: "none" },
    input: [
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: `O pretendente enviou a seguinte mensagem na conversa: "${userMessage}".\nSe você precisar consultar fatos ou preferências da Larissa para responder com autenticidade, use a ferramenta persona_memory_search.`,
          },
        ],
      },
    ],
  };

  const resSession = await fetch("https://api.openai.com/v1/agents/sessions", {
    method: "POST",
    headers,
    body: JSON.stringify(sessionPayload),
  });

  if (!resSession.ok) {
    console.error(`ERRO ao criar sessão: ${resSession.status} ${await resSession.text()}`);
    process.exit(1);
  }

  const sessionData = await resSession.json();
  const sessionId = sessionData.id;
  console.log(`✅ Sessão criada com sucesso! Session ID: ${sessionId} (status: ${sessionData.status})`);

  // 5. MONITORAR ATÉ O AGENT ENTRAR EM REQUIRES_ACTION (TOOL CALL)
  console.log("\n--> [5/6] Aguardando o Agent processar e solicitar a Tool persona_memory_search...");
  let toolCallAction = null;
  let activeTurnId = null;

  for (let i = 0; i < 20; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const pollRes = await fetch(`https://api.openai.com/v1/agents/sessions/${sessionId}`, { headers });
    if (pollRes.ok) {
      const pollData = await pollRes.json();
      console.log(`[Poll ${i + 1}] Status da sessão: ${pollData.status}`);
      if (pollData.status === "requires_action" && pollData.required_actions?.length > 0) {
        toolCallAction = pollData.required_actions[0];
        activeTurnId = toolCallAction.turn_id;
        break;
      }
    }
  }

  if (!toolCallAction) {
    console.error("FALHA: O Agent não solicitou a tool dentro do tempo limite.");
    process.exit(1);
  }

  console.log("✅ TOOL CALL SOLICITADO PELO AGENT:");
  console.log(`- Nome da Ferramenta: ${toolCallAction.name}`);
  console.log(`- Call ID: ${toolCallAction.call_id}`);
  console.log(`- Turn ID: ${toolCallAction.turn_id}`);
  console.log(`- Argumentos:`, JSON.stringify(toolCallAction.arguments, null, 2));

  // 6. EXECUTAR BUSCA REAL NO SUPABASE
  console.log("\n--> [6/6] Executando busca real na tabela public.persona_memory do Supabase...");
  const query = toolCallAction.arguments?.query || "motocross";
  const { data: dbFacts, error: dbError } = await supabase
    .from("persona_memory")
    .select("*")
    .eq("persona_id", "larissa");

  if (dbError) {
    console.error("Erro ao ler Supabase persona_memory:", dbError);
    process.exit(1);
  }

  const queryTerms = query.toLowerCase().split(/\s+/).filter(w => w.length >= 3);
  const matchedFacts = (dbFacts || []).filter(f => {
    const key = (f.key || '').toLowerCase();
    const val = typeof f.value === 'string' ? f.value.toLowerCase() : JSON.stringify(f.value).toLowerCase();
    return queryTerms.some(t => key.includes(t) || val.includes(t));
  });

  const toolOutput = {
    found: matchedFacts.length > 0,
    results: matchedFacts.slice(0, 6).map(f => ({
      key: f.key,
      category: f.category,
      value: f.value,
      source_type: f.source_type,
      score: 18,
    })),
  };

  console.log(`Fatos encontrados no banco Supabase: ${matchedFacts.length}`);
  console.log("Output enviado de volta ao Agent:", JSON.stringify(toolOutput, null, 2));

  // SUBMETER OUTPUT DO TOOL RESULT
  console.log("\nSubmetendo tool_result para a sessão...");
  const submitRes = await fetch(`https://api.openai.com/v1/agents/sessions/${sessionId}/events`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      events: [
        {
          type: "agent.session.input.tool_result",
          turn_id: activeTurnId,
          call_id: toolCallAction.call_id,
          success: true,
          output: JSON.stringify(toolOutput),
        },
      ],
    }),
  });

  if (!submitRes.ok && submitRes.status !== 202) {
    console.error(`ERRO ao submeter tool_result: ${submitRes.status} ${await submitRes.text()}`);
    process.exit(1);
  }
  console.log(`Tool output aceito pela OpenAI (HTTP ${submitRes.status})!`);

  // AGUARDAR CONCLUSÃO DO TURNO
  console.log("Aguardando o Agent concluir o turno com a resposta final...");
  let turnCompleted = false;
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const checkTurn = await fetch(`https://api.openai.com/v1/agents/sessions/${sessionId}/turns/${activeTurnId}`, { headers });
    if (checkTurn.ok) {
      const turnData = await checkTurn.json();
      console.log(`[Turn Poll ${i + 1}] Turn status: ${turnData.status}`);
      if (turnData.status === "completed") {
        turnCompleted = true;
        break;
      }
    }
  }

  if (!turnCompleted) {
    console.error("FALHA: O turno não completou dentro do tempo esperado.");
    process.exit(1);
  }

  // BUSCA OS ITENS FINAIS DA SESSÃO
  const itemsRes = await fetch(`https://api.openai.com/v1/agents/sessions/${sessionId}/items`, { headers });
  const itemsData = await itemsRes.json();
  const assistantMsg = (itemsData.data || []).find(it => it.type === 'message' && it.role === 'assistant' && it.phase === 'final_answer');
  const finalAnswerText = assistantMsg?.content?.[0]?.text || "Sem texto emitido";

  console.log("\n==================================================================");
  console.log("RELATÓRIO DE AUDITORIA FINAL — OPENAI AGENT BRAIN");
  console.log("==================================================================");
  console.log(`- Session ID: ${sessionId}`);
  console.log(`- Turn ID: ${activeTurnId}`);
  console.log(`- Tool Solicitada: ${toolCallAction.name}`);
  console.log(`- Argumentos: ${JSON.stringify(toolCallAction.arguments)}`);
  console.log(`- Status do Turno: COMPLETED`);
  console.log(`- Resposta Final do Agent: ${finalAnswerText}`);
  console.log("==================================================================\n");
}

main().catch(err => {
  console.error("ERRO:", err);
  process.exit(1);
});
