import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const envContent = fs.readFileSync('.env.local', 'utf8');
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

const newToken = 'vendeo_mcp_' + crypto.randomBytes(32).toString('hex');

// 1. Atualizar .env.local
const newEnvContent = envContent.replace(
  /^VENDEO_BRAIN_MCP_TOKEN=.*$/m,
  `VENDEO_BRAIN_MCP_TOKEN="${newToken}"`
);
fs.writeFileSync('.env.local', newEnvContent, 'utf8');

// 2. Atualizar no Supabase instagram_config
const supabase = createClient(envVars.NEXT_PUBLIC_SUPABASE_URL, envVars.SUPABASE_SERVICE_ROLE_KEY);
const { error: upsertErr } = await supabase.from('instagram_config').upsert({
  id: 'vendeo_brain_mcp_token',
  app_secret: newToken,
  updated_at: new Date().toISOString(),
});

if (upsertErr) {
  console.error('Falha ao atualizar token no Supabase:', upsertErr.message);
  process.exit(1);
}

// Limpa telemetria antiga
await supabase.from('instagram_config').delete().in('id', ['last_mcp_telemetry', 'last_mcp_telemetry_body', 'last_mcp_output']);

// 3. Atualizar Agent na OpenAI com URL limpa, único header Authorization e regra estrita de grounding
const agentId = envVars.OPENAI_BRAIN_AGENT_ID;
const apiKey = envVars.OPENAI_API_KEY;
const mcpUrl = 'https://wsdualhvopidgqcumonr.supabase.co/functions/v1/vendeo-brain-mcp';

const openAiHeaders = {
  Authorization: `Bearer ${apiKey}`,
  'Content-Type': 'application/json',
  'OpenAI-Beta': 'agents=v1',
};

const getRes = await fetch(`https://api.openai.com/v1/agents/${agentId}`, { headers: openAiHeaders });
if (!getRes.ok) {
  console.error('Falha ao consultar agent na OpenAI:', getRes.status);
  process.exit(1);
}
const agentData = await getRes.json();

const groundingRule = `
REGRA OBRIGATÓRIA DE GROUNDING:
A ausência de um fato na PersonaMemory NÃO significa que o oposto é verdadeiro.
Se a busca não encontrar informação sobre algo, trate como desconhecido.
É PROIBIDO transformar ausência de evidência em afirmações como:
- nunca fiz
- nunca fui
- não gosto
- não pratico
- não tenho
- não bebo
- não conheço
a menos que exista um fato explícito e comprovado na PersonaMemory confirmando essa afirmação.
`;

const updatedInstructions = (agentData.instructions || '').includes('REGRA OBRIGATÓRIA DE GROUNDING')
  ? agentData.instructions
  : `${agentData.instructions}\n\n${groundingRule}`;

const mcpToolDefinition = {
  type: 'mcp',
  server_label: 'vendeo_memory',
  transport: {
    type: 'http',
    server_url: mcpUrl, // URL 100% LIMPA SEM QUERY TOKEN
    headers: {
      Authorization: `Bearer ${newToken}`, // ÚNICA SUPERFÍCIE DE AUTENTICAÇÃO
    },
  },
  allowed_tools: ['persona_memory_search'],
  connection_origin: 'service',
  required: false,
};

const updateRes = await fetch(`https://api.openai.com/v1/agents/${agentId}`, {
  method: 'POST',
  headers: openAiHeaders,
  body: JSON.stringify({
    instructions: updatedInstructions,
    tools: [mcpToolDefinition],
  }),
});

if (!updateRes.ok) {
  console.error('Falha ao atualizar agent na OpenAI:', updateRes.status, await updateRes.text());
  process.exit(1);
}

console.log('MCP token rotated successfully');
