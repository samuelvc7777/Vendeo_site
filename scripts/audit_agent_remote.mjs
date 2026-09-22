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

const headers = {
  Authorization: 'Bearer ' + apiKey,
  'Content-Type': 'application/json',
  'OpenAI-Beta': 'agents=v1',
};

async function audit() {
  const res = await fetch('https://api.openai.com/v1/agents/' + agentId, { headers });
  if (!res.ok) {
    console.error('Erro no GET:', res.status, await res.text());
    process.exit(1);
  }
  const agent = await res.json();
  const instructions = agent.instructions || '';
  const hash = crypto.createHash('sha256').update(instructions).digest('hex');
  const m = instructions.match(/VENDEO_AGENT_INSTRUCTIONS_VERSION:\s*([^\r\n]+)/);
  const version = m ? m[1].trim() : 'desconhecida';
  
  const mcpTool = (agent.tools || []).find(t => t.type === 'mcp' || t.server_label === 'vendeo_memory');

  console.log('AUDITORIA INICIAL DO AGENT REMOTO:');
  console.log('AGENT_ID = ' + agent.id);
  console.log('MODEL_BEFORE = ' + agent.model);
  console.log('INSTRUCTIONS_VERSION = ' + version);
  console.log('INSTRUCTIONS_HASH = ' + hash);
  console.log('INSTRUCTIONS_LENGTH = ' + instructions.length);
  console.log('MCP_REQUIRED = ' + Boolean(mcpTool?.required));
  console.log('ALLOWED_TOOLS = ' + JSON.stringify(mcpTool?.allowed_tools || []));
  console.log('FULL_TOOLS = ' + JSON.stringify(agent.tools, null, 2));
}

audit().catch(console.error);
