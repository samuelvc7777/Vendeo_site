import fs from 'fs';

const envContent = fs.readFileSync('.env.local', 'utf8');
const envVars = {};
for (const line of envContent.split('\n')) {
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
const agentId = envVars.OPENAI_BRAIN_AGENT_ID;

const headers = {
  Authorization: `Bearer ${apiKey}`,
  'Content-Type': 'application/json',
  'OpenAI-Beta': 'agents=v1',
};

async function updateAndConfirmAgent() {
  console.log('=== 1. OBTENDO ESTADO ATUAL ===');
  const get1Res = await fetch(`https://api.openai.com/v1/agents/${agentId}`, { headers });
  const currentAgent = await get1Res.json();
  console.log('GET 1 Status:', get1Res.status);
  console.log('GET 1 x-request-id:', get1Res.headers.get('x-request-id'));

  const updatedTools = (currentAgent.tools || []).map((t) => {
    if (t.server_label === 'vendeo_memory' || t.type === 'mcp') {
      return {
        ...t,
        required: true,
      };
    }
    return t;
  });

  console.log('\n=== 2. APLICANDO REQUIRED=TRUE VIA POST ===');
  const postPayload = {
    instructions: currentAgent.instructions,
    tools: updatedTools,
  };

  const updateRes = await fetch(`https://api.openai.com/v1/agents/${agentId}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(postPayload),
  });

  console.log('POST Status:', updateRes.status);
  const postRequestId = updateRes.headers.get('x-request-id');
  console.log('POST x-request-id:', postRequestId);
  const updatedData = await updateRes.json();

  console.log('\n=== 3. CONFIRMANDO COM GET FINAL ===');
  const get2Res = await fetch(`https://api.openai.com/v1/agents/${agentId}`, { headers });
  console.log('GET 2 Status:', get2Res.status);
  const get2RequestId = get2Res.headers.get('x-request-id');
  console.log('GET 2 x-request-id:', get2RequestId);
  const confirmedAgent = await get2Res.json();

  const mcpTool = confirmedAgent.tools?.find((t) => t.server_label === 'vendeo_memory');
  console.log('\n=== RESULTADO DA CONFIRMAÇÃO ===');
  console.log('Agent ID:', confirmedAgent.id);
  console.log('Model:', confirmedAgent.model);
  console.log('Server Label:', mcpTool?.server_label);
  console.log('Server URL:', mcpTool?.transport?.server_url);
  console.log('Allowed Tools:', mcpTool?.allowed_tools);
  console.log('Connection Origin:', mcpTool?.connection_origin);
  console.log('Required:', mcpTool?.required);
  console.log('Confirmado required === true?', mcpTool?.required === true);

  return {
    postRequestId,
    get2RequestId,
    required: mcpTool?.required,
  };
}

updateAndConfirmAgent().catch(console.error);
