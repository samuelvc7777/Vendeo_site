import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const envPath = path.resolve('.env.local');
const envVars = {};
for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eq = trimmed.indexOf('=');
  if (eq > 0) {
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    envVars[trimmed.slice(0, eq).trim()] = val;
  }
}

const apiKey = envVars.OPENAI_API_KEY;
const agentId = envVars.OPENAI_BRAIN_AGENT_ID || 'agent_aa96ea5a95c04c8895e310e69cb27dd9279dbdf7ea0e4d8482';

if (!apiKey) {
  console.error('ERRO: OPENAI_API_KEY não encontrada em .env.local');
  process.exit(1);
}

const headers = {
  Authorization: 'Bearer ' + apiKey,
  'Content-Type': 'application/json',
  'OpenAI-Beta': 'agents=v1',
};

async function updateAgentModel() {
  console.log('================================================================');
  console.log(' ATUALIZANDO MODELO DO OPENAI AGENT REMOTO: TERRA -> LUNA');
  console.log('================================================================');
  console.log(`Agent ID alvo: ${agentId}`);

  // 1. GET do estado antes
  console.log('\n--- 1. CONSULTANDO ESTADO REMOTO ATUAL (GET) ---');
  const getBefore = await fetch(`https://api.openai.com/v1/agents/${agentId}`, { headers });
  if (!getBefore.ok) {
    throw new Error(`Falha no GET: ${getBefore.status} - ${await getBefore.text()}`);
  }
  const agentBefore = await getBefore.json();
  const instructionsBefore = agentBefore.instructions || '';
  const hashBefore = crypto.createHash('sha256').update(instructionsBefore).digest('hex');
  console.log(`MODEL_BEFORE = ${agentBefore.model}`);
  console.log(`INSTRUCTIONS_HASH_BEFORE = ${hashBefore}`);
  console.log(`INSTRUCTIONS_LENGTH = ${instructionsBefore.length}`);

  // 2. Tentativa 1: POST apenas com { model: 'gpt-5.6-luna' }
  console.log('\n--- 2. ENVIANDO POST DE ATUALIZAÇÃO DO MODELO ---');
  let patchPayload = { model: 'gpt-5.6-luna' };
  let updateRes = await fetch(`https://api.openai.com/v1/agents/${agentId}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(patchPayload),
  });

  // Se a API exigir instructions ou tools, enviamos preservando exatamente o que já estava remoto
  if (!updateRes.ok) {
    console.log(`POST minimal retornou ${updateRes.status}. Tentando com preservação estrita de instructions e tools...`);
    patchPayload = {
      model: 'gpt-5.6-luna',
      instructions: instructionsBefore,
      tools: agentBefore.tools,
    };
    updateRes = await fetch(`https://api.openai.com/v1/agents/${agentId}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(patchPayload),
    });
  }

  if (!updateRes.ok) {
    throw new Error(`Falha no POST de atualização: ${updateRes.status} - ${await updateRes.text()}`);
  }
  console.log(`Status do POST de atualização: ${updateRes.status}`);

  // 3. GET de confirmação
  console.log('\n--- 3. CONFIRMAÇÃO PÓS-ALTERAÇÃO (GET) ---');
  const getAfter = await fetch(`https://api.openai.com/v1/agents/${agentId}`, { headers });
  if (!getAfter.ok) {
    throw new Error(`Falha no GET pós-alteração: ${getAfter.status} - ${await getAfter.text()}`);
  }
  const agentAfter = await getAfter.json();
  const instructionsAfter = agentAfter.instructions || '';
  const hashAfter = crypto.createHash('sha256').update(instructionsAfter).digest('hex');

  const mcpTool = (agentAfter.tools || []).find(t => t.type === 'mcp' || t.server_label === 'vendeo_memory');
  const m = instructionsAfter.match(/VENDEO_AGENT_INSTRUCTIONS_VERSION:\s*([^\r\n]+)/);
  const versionAfter = m ? m[1].trim() : 'desconhecida';

  console.log('RESULTADO DA ATUALIZAÇÃO:');
  console.log(`AGENT_ID = ${agentAfter.id}`);
  console.log(`MODEL_BEFORE = ${agentBefore.model}`);
  console.log(`MODEL_AFTER = ${agentAfter.model}`);
  console.log(`INSTRUCTIONS_VERSION_AFTER = ${versionAfter}`);
  console.log(`INSTRUCTIONS_HASH_BEFORE = ${hashBefore}`);
  console.log(`INSTRUCTIONS_HASH_AFTER  = ${hashAfter}`);
  console.log(`INSTRUCTIONS_HASH_PRESERVED = ${hashBefore === hashAfter}`);
  console.log(`MCP_REQUIRED = ${Boolean(mcpTool?.required)}`);
  console.log(`ALLOWED_TOOLS = ${JSON.stringify(mcpTool?.allowed_tools || [])}`);

  if (agentAfter.model !== 'gpt-5.6-luna') {
    throw new Error(`FALHA: model retornado (${agentAfter.model}) não é gpt-5.6-luna!`);
  }
  if (hashBefore !== hashAfter) {
    throw new Error('FALHA: As instructions foram alteradas inadvertidamente!');
  }
  console.log('\n=== MODELO ATUALIZADO COM SUCESSO PARA GPT-5.6-LUNA ===');
}

updateAgentModel().catch(err => {
  console.error('ERRO:', err);
  process.exit(1);
});
