// Teste Ponta a Ponta: OpenAI Agent Brain conectado DIRETAMENTE ao MCP Remoto no Supabase
import fs from 'fs';
import path from 'path';

// 1. Carregar variáveis de ambiente
const envPath = path.resolve(process.cwd(), '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
const envVars = {};
envContent.split('\n').forEach((line) => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    let val = match[2] || '';
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
    envVars[match[1]] = val.trim();
  }
});

const OPENAI_API_KEY = envVars.OPENAI_API_KEY;
const AGENT_ID = envVars.OPENAI_BRAIN_AGENT_ID;
const MCP_TOKEN = envVars.VENDEO_BRAIN_MCP_TOKEN;
const MCP_URL = 'https://wsdualhvopidgqcumonr.supabase.co/functions/v1/vendeo-brain-mcp';

if (!OPENAI_API_KEY || !AGENT_ID || !MCP_TOKEN) {
  console.error('ERRO: OPENAI_API_KEY, OPENAI_BRAIN_AGENT_ID ou VENDEO_BRAIN_MCP_TOKEN ausente.');
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${OPENAI_API_KEY}`,
  'Content-Type': 'application/json',
  'OpenAI-Beta': 'agents=v1',
};

async function runLiveTest() {
  console.log('==================================================================');
  console.log('TESTE AO VIVO: OPENAI AGENT BRAIN -> MCP REMOTO DIRETO (SUPABASE)');
  console.log('==================================================================');
  console.log(`- Agent ID: ${AGENT_ID}`);
  console.log(`- MCP Server URL: ${MCP_URL}`);
  console.log(`- MCP Server Label: vendeo_memory`);
  console.log(`- Auth Bearer: ${MCP_TOKEN.slice(0, 15)}...`);

  // ETAPA 1: Consultar estado atual do Agent
  console.log('\n--> [1/5] Consultando configuração atual do Agent na OpenAI...');
  const resGet = await fetch(`https://api.openai.com/v1/agents/${AGENT_ID}`, { headers });
  if (!resGet.ok) {
    console.error(`Erro ao consultar agent: ${resGet.status} ${await resGet.text()}`);
    process.exit(1);
  }
  const agentBefore = await resGet.json();
  console.log(`Agent Name: ${agentBefore.name}`);
  console.log(`Agent Model: ${agentBefore.model}`);
  console.log(`Tools Atuais (${agentBefore.tools?.length || 0}):`, JSON.stringify(agentBefore.tools, null, 2));

  // ETAPA 2: Atualizar Agent para conectar ao MCP Remoto
  console.log('\n--> [2/5] Atualizando Agent para registrar MCP Remoto vendeo_memory...');
  const mcpToolDefinition = {
    type: 'mcp',
    server_label: 'vendeo_memory',
    transport: {
      type: 'http',
      server_url: `${MCP_URL}?token=${MCP_TOKEN}`,
      headers: {
        'X-Vendeo-Token': MCP_TOKEN,
      },
    },
    allowed_tools: ['persona_memory_search'],
    connection_origin: 'service',
    required: false,
  };

  const resUpdate = await fetch(`https://api.openai.com/v1/agents/${AGENT_ID}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      tools: [mcpToolDefinition],
    }),
  });

  if (!resUpdate.ok) {
    const errText = await resUpdate.text();
    console.error(`FALHA ao atualizar agent com MCP: ${resUpdate.status} - ${errText}`);
    process.exit(1);
  }

  const agentAfter = await resUpdate.json();
  console.log('✅ Agent atualizado com sucesso com ferramenta MCP!');
  console.log('Tools ativas pós-atualização:', JSON.stringify(agentAfter.tools, null, 2));

  // ETAPA 3: Criar Sessão Real na OpenAI Agents API
  console.log('\n--> [3/5] Criando Sessão REAL na OpenAI Agents API com o cenário motocross...');
  const scenarioMessage = 'Eu curto motocross, vou quase todo final de semana e você?';
  const promptInput = `O pretendente enviou a seguinte mensagem na conversa: "${scenarioMessage}".
Consulte a ferramenta de memória persona_memory_search para verificar as preferências e fatos da Larissa (ex: se ela pratica ou gosta de motocross, seus gostos e rotina) e responda de forma autêntica como Larissa.`;

  const sessionPayload = {
    agent_id: AGENT_ID,
    environment: { type: 'none' },
    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: promptInput,
          },
        ],
      },
    ],
  };

  const resSession = await fetch('https://api.openai.com/v1/agents/sessions', {
    method: 'POST',
    headers,
    body: JSON.stringify(sessionPayload),
  });

  if (!resSession.ok) {
    const errText = await resSession.text();
    console.error(`FALHA ao criar sessão: ${resSession.status} - ${errText}`);
    process.exit(1);
  }

  const sessionData = await resSession.json();
  const sessionId = sessionData.id;
  console.log(`✅ Sessão criada com sucesso! Session ID: ${sessionId} (status inicial: ${sessionData.status})`);

  // ETAPA 4: Monitorar o ciclo da Sessão na OpenAI
  console.log('\n--> [4/5] Monitorando execução da OpenAI com MCP...');
  let sessionFinalStatus = null;
  let sawRequiresAction = false;
  let activeTurnId = null;

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const pollRes = await fetch(`https://api.openai.com/v1/agents/sessions/${sessionId}`, { headers });
    if (!pollRes.ok) {
      console.warn(`[Poll ${i + 1}] Falha ao consultar sessão: ${pollRes.status}`);
      continue;
    }

    const pollData = await pollRes.json();
    console.log(`[Poll ${i + 1} | ${(i + 1) * 2}s] Status: ${pollData.status}`);

    if (pollData.status === 'requires_action') {
      sawRequiresAction = true;
      console.warn('⚠️ ATENÇÃO: Sessão entrou em requires_action! A OpenAI solicitou ação manual do cliente.');
      activeTurnId = pollData.required_actions?.[0]?.turn_id;
      break;
    }

    if (pollData.status === 'completed' || pollData.status === 'idle') {
      sessionFinalStatus = pollData.status;
      break;
    }

    if (pollData.status === 'failed') {
      console.error('FALHA: A sessão falhou na OpenAI:', JSON.stringify(pollData.error, null, 2));
      process.exit(1);
    }
  }

  console.log(`\nStatus final da sessão: ${sessionFinalStatus || 'tempo limite'}`);
  console.log(`Entrou em requires_action (intermediação backend)? ${sawRequiresAction ? 'SIM (Inesperado para MCP)' : 'NÃO (Comportamento MCP Direto Esperado!)'}`);

  // ETAPA 5: Inspecionar itens gerados na Sessão (Turnos, Chamadas de Ferramentas, Resposta)
  console.log('\n--> [5/5] Inspecionando itens e histórico da sessão na OpenAI...');
  // Inspeciona Turns
  const turnsRes = await fetch(`https://api.openai.com/v1/agents/sessions/${sessionId}/turns`, { headers });
  if (turnsRes.ok) {
    const turnsData = await turnsRes.json();
    console.log(`Total de turns na sessão: ${turnsData.data?.length || 0}`);
    turnsData.data?.forEach((t, i) => {
      console.log(`  Turn #${i + 1} (${t.id}): status=${t.status}`);
      if (t.error) console.error(`    Erro no Turn:`, JSON.stringify(t.error, null, 2));
    });
  }

  const itemsRes = await fetch(`https://api.openai.com/v1/agents/sessions/${sessionId}/items`, { headers });
  let items = [];
  if (itemsRes.ok) {
    const itemsData = await itemsRes.json();
    items = itemsData.data || [];
  }

  console.log(`Total de itens registrados na sessão: ${items.length}`);
  items.forEach((item, idx) => {
    console.log(`\nItem #${idx + 1}:`);
    console.log(`  Tipo: ${item.type}`);
    console.log(`  Role: ${item.role || 'N/A'}`);
    console.log(`  Phase: ${item.phase || 'N/A'}`);
    if (item.name) console.log(`  Name/Tool: ${item.name}`);
    if (item.arguments) console.log(`  Arguments:`, JSON.stringify(item.arguments));
    if (item.output) console.log(`  Output:`, typeof item.output === 'string' ? item.output.slice(0, 300) : item.output);
    if (item.content) {
      item.content.forEach((c) => {
        if (c.text) console.log(`  Content text: ${c.text}`);
        else console.log(`  Content:`, JSON.stringify(c));
      });
    }
  });

  const assistantMsg = items.find(
    (it) => it.type === 'message' && it.role === 'assistant' && (it.phase === 'final_answer' || !it.phase)
  );
  const finalAnswer = assistantMsg?.content?.[0]?.text || 'Nenhum texto final encontrado';

  console.log('\n==================================================================');
  console.log('AUDITORIA DE EXECUÇÃO:');
  console.log('==================================================================');
  console.log(`1. Session ID: ${sessionId}`);
  console.log(`2. Backend Vendeo participou do tool call? ${sawRequiresAction ? 'SIM' : 'NÃO (OpenAI conectou diretamente ao MCP!)'}`);
  console.log(`3. Resposta final do Brain:`);
  console.log(`   "${finalAnswer}"`);
  console.log('==================================================================');
}

runLiveTest().catch((err) => {
  console.error('Erro na execução do teste ao vivo:', err);
  process.exit(1);
});
