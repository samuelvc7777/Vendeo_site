import fs from 'fs';

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

const headers = {
  Authorization: `Bearer ${envVars.OPENAI_API_KEY}`,
  'Content-Type': 'application/json',
  'OpenAI-Beta': 'agents=v1',
};

async function test() {
  console.log('1. Testando GET /v1/agents/' + envVars.OPENAI_BRAIN_AGENT_ID);
  const agentRes = await fetch(`https://api.openai.com/v1/agents/${envVars.OPENAI_BRAIN_AGENT_ID}`, { headers });
  console.log('GET Agent status:', agentRes.status);
  const agentData = await agentRes.json();
  console.log('Agent model:', agentData.model);
  console.log('Agent tools:', JSON.stringify(agentData.tools));

  console.log('\n2. Testando POST /v1/agents/sessions simples (sem vault)...');
  const payload1 = {
    agent_id: envVars.OPENAI_BRAIN_AGENT_ID,
    environment: { type: 'none' },
    input: [
      {
        role: 'user',
        content: [{ type: 'input_text', text: 'Ola teste' }],
      },
    ],
  };
  const res1 = await fetch('https://api.openai.com/v1/agents/sessions', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload1),
  });
  console.log('Status session simples:', res1.status);
  console.log('Response session simples:', await res1.text());

  console.log('\n3. Testando POST /v1/agents/sessions com vault_ids...');
  const payload2 = {
    ...payload1,
    vault_ids: [envVars.OPENAI_MCP_VAULT_ID],
  };
  const res2 = await fetch('https://api.openai.com/v1/agents/sessions', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload2),
  });
  console.log('Status session com vault:', res2.status);
  console.log('Response session com vault:', await res2.text());
}

test().catch(console.error);
