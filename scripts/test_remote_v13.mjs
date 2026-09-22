import fs from 'fs';

const env = fs.readFileSync('.env.local', 'utf8');
const tokenMatch = env.match(/VENDEO_BRAIN_MCP_TOKEN="?([^\s"\n]+)"?/);
const token = tokenMatch ? tokenMatch[1] : '';

async function testRemoteV13() {
  const url = 'https://wsdualhvopidgqcumonr.supabase.co/functions/v1/vendeo-brain-mcp';

  console.log('1. Testando POST com query token ?token=123 (deve retornar 401 proibido)...');
  const res1 = await fetch(url + '?token=123', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
  });
  console.log('Status query token:', res1.status, await res1.text());

  console.log('\n2. Testando POST sem Authorization (deve retornar 401 token required)...');
  const res2 = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping' }),
  });
  console.log('Status sem auth:', res2.status, await res2.text());

  console.log('\n3. Testando POST com Bearer token valido (deve retornar 200 ping)...');
  const res3 = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'ping' }),
  });
  console.log('Status com Bearer token:', res3.status, await res3.text());

  console.log('\n4. Testando POST tools/call persona_memory_search...');
  const res4 = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + token,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'persona_memory_search',
        arguments: { query: 'enfermagem', limit: 3 },
      },
    }),
  });
  console.log('Status tools/call:', res4.status);
  const toolResult = await res4.json();
  console.log('Output do MCP:', JSON.stringify(toolResult, null, 2));
}

testRemoteV13().catch(console.error);
