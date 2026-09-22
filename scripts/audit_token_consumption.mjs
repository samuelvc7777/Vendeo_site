import fs from 'fs';
import path from 'path';
import { buildOpenAiBrainContextMessage } from '../supabase/functions/api/openai_brain.ts';

const envPath = path.resolve('.env.local');
const env = fs.readFileSync(envPath, 'utf8').split('\n').reduce((acc, l) => {
  const [k, ...v] = l.trim().split('=');
  if (k && v.length) acc[k] = v.join('=').replace(/^["']|["']$/g, '').trim();
  return acc;
}, {});

const key = env.OPENAI_API_KEY;
const agentId = 'agent_aa96ea5a95c04c8895e310e69cb27dd9279dbdf7ea0e4d8482';
const headers = {
  Authorization: `Bearer ${key}`,
  'Content-Type': 'application/json',
  'OpenAI-Beta': 'agents=v1',
};

// Estimador de tokens para o200k_base (gpt-4o / gpt-5): ~3.5 a 4 chars por token em pt-br
function estimateTokens(text) {
  if (!text) return 0;
  // Para português técnico/coloquial misto, ~3.6 caracteres por token
  return Math.ceil(text.length / 3.6);
}

async function audit() {
  console.log('================================================================');
  console.log(' AUDITORIA QUANTITATIVA DETALHADA DE TOKENS (GPT-5.6-TERRA)');
  console.log('================================================================');

  // 1. Agent Persistent Instructions
  const aRes = await fetch(`https://api.openai.com/v1/agents/${agentId}`, { headers });
  const aData = await aRes.json();
  const persistentInstructions = aData.instructions || '';
  const persistentChars = persistentInstructions.length;
  const persistentTokens = estimateTokens(persistentInstructions);

  console.log(`\n1. INSTRUÇÕES PERSISTENTES DO AGENT:`);
  console.log(`   - Caracteres: ${persistentChars}`);
  console.log(`   - Tokens Estimados: ~${persistentTokens}`);

  // 2. Turn Context via buildOpenAiBrainContextMessage
  const sampleParams = {
    conversationId: 'test_conv_audit_123',
    currentStageId: 'descoberta',
    currentObjectiveId: 'goal_job',
    currentObjectiveLabel: 'Profissão',
    currentObjectiveDescription: 'Descobrir área profissional ou ocupação dele',
    currentObjectiveRequired: false,
    inboundMessages: ['hoje o trabalho tá tranquilo kkk'],
    recentMessages: [
      { sender: 'user', text: 'tô aqui no plantão de boa hoje' },
    ],
    availableSubagents: [
      { id: 'conexao_inicial', name: 'Conexão Inicial', mission: 'Criar rapport e quebrar o gelo' },
      { id: 'descoberta', name: 'Descoberta', mission: 'Descobrir contexto e interesses sem interrogar' },
    ],
    memoryScopeId: 'scope_audit_12345678',
  };

  const contextMessage = buildOpenAiBrainContextMessage(sampleParams);
  const contextChars = contextMessage.length;
  const contextTokens = estimateTokens(contextMessage);

  console.log(`\n2. TURN CONTEXT MESSAGE (buildOpenAiBrainContextMessage):`);
  console.log(`   - Caracteres Totais: ${contextChars}`);
  console.log(`   - Tokens Estimados: ~${contextTokens}`);

  // Decomposição por seções do contextMessage
  console.log(`\n   DECOMPOSIÇÃO DO CONTEXT MESSAGE:`);
  const sections = contextMessage.split('\n## ');
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    const title = s.split('\n')[0].replace(/^# /, '').slice(0, 45);
    const chars = s.length;
    const tokens = estimateTokens(s);
    console.log(`     - [${i + 1}] "${title}": ${chars} chars (~${tokens} tokens)`);
    if (title.includes('INSTRUÇÃO DE DECISÃO')) {
      const items = s.split(/\n(?=[0-9]+\.\s)/);
      for (let j = 0; j < items.length; j++) {
        const item = items[j];
        const itemTitle = item.split('\n')[0].slice(0, 50);
        console.log(`         * Item ${j}: "${itemTitle}": ${item.length} chars (~${estimateTokens(item)} tokens)`);
      }
    }
  }

  // 3. Tool Schemas das 3 Tools MCP
  // Ferramentas registradas no servidor MCP
  const mcpToolsRes = await fetch('https://wsdualhvopidgqcumonr.supabase.co/functions/v1/vendeo-brain-mcp', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.VENDEO_BRAIN_MCP_TOKEN || ''}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: {},
    }),
  });
  let toolsJsonChars = 0;
  if (mcpToolsRes.ok) {
    const toolsData = await mcpToolsRes.json();
    const toolsStr = JSON.stringify(toolsData.result?.tools || []);
    toolsJsonChars = toolsStr.length;
    console.log(`\n3. TOOL SCHEMAS MCP (3 Ferramentas):`);
    console.log(`   - Caracteres JSON: ${toolsJsonChars}`);
    console.log(`   - Tokens Estimados: ~${estimateTokens(toolsStr)}`);
    for (const t of toolsData.result?.tools || []) {
      const tStr = JSON.stringify(t);
      console.log(`     - "${t.name}": ${tStr.length} chars (~${estimateTokens(tStr)} tokens)`);
    }
  }

  // 4. Sessões Reais Auditadas da OpenAI Agents API
  console.log(`\n4. MEDIÇÃO REAL DA OPENAI AGENTS API:`);
  // Caso B (Turno sem Tool Call)
  const sessBId = 'sess_07395aaac458a297006ab2683832cc819598188f0670a2518a';
  const resB = await fetch(`https://api.openai.com/v1/agents/sessions/${sessBId}`, { headers });
  const dataB = await resB.json();
  console.log(`   Sessão B (Turno Único Direto - Sem Tool):`);
  console.log(`     Input Tokens: ${dataB.usage?.input_tokens}`);
  console.log(`     Output Tokens: ${dataB.usage?.output_tokens} (reasoning: ${dataB.usage?.output_tokens_details?.reasoning_tokens})`);
  console.log(`     Total Tokens: ${dataB.usage?.total_tokens}`);

  // Caso C (Turno com Tool Call MCP)
  const sessCId = 'sess_053ae568d254cf4b006ab2684c53748194b1fe6edbcb649486';
  const resC = await fetch(`https://api.openai.com/v1/agents/sessions/${sessCId}`, { headers });
  const dataC = await resC.json();
  console.log(`   Sessão C (Turno com Tool Call MCP):`);
  console.log(`     Input Tokens Acumulados: ${dataC.usage?.input_tokens} (cached: ${dataC.usage?.input_tokens_details?.cached_tokens})`);
  console.log(`     Output Tokens: ${dataC.usage?.output_tokens} (reasoning: ${dataC.usage?.output_tokens_details?.reasoning_tokens})`);
  console.log(`     Total Tokens: ${dataC.usage?.total_tokens}`);
}

audit().catch(console.error);
