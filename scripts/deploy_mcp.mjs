import fs from 'fs';
import path from 'path';

const MCP_DIR = path.resolve(import.meta.dirname, '../supabase/functions/vendeo-brain-mcp');
const SHARED_DIR = path.resolve(import.meta.dirname, '../supabase/functions/_shared');

const files = [
  {
    name: 'vendeo-brain-mcp/index.ts',
    content: fs.readFileSync(path.join(MCP_DIR, 'index.ts'), 'utf8'),
  },
  {
    name: 'vendeo-brain-mcp/_shared/mcp_memory_helpers.ts',
    content: fs.readFileSync(path.join(MCP_DIR, '_shared/mcp_memory_helpers.ts'), 'utf8'),
  },
  {
    name: 'vendeo-brain-mcp/_shared/persona_memory.ts',
    content: fs.readFileSync(path.join(MCP_DIR, '_shared/persona_memory.ts'), 'utf8'),
  },
  {
    name: '_shared/memory_tool_context.ts',
    content: fs.readFileSync(path.join(SHARED_DIR, 'memory_tool_context.ts'), 'utf8'),
  },
];

console.log(`Arquivos preparados para deploy de vendeo-brain-mcp:`);
files.forEach((f) => console.log(`  ${f.name} (${f.content.length} bytes)`));

const tokens = JSON.parse(
  fs.readFileSync('C:/Users/Samuel Vitor/.gemini/antigravity/mcp_oauth_tokens.json', 'utf8')
);
const token = tokens['https://mcp.supabase.com/mcp']?.token?.access_token;

if (!token) {
  console.error('Token OAuth do Supabase MCP não encontrado.');
  process.exit(1);
}

const MCP_URL = 'https://mcp.supabase.com/mcp';

async function deployMcp() {
  console.log('\n1. Inicializando sessão MCP com Supabase...');
  const initRes = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'vendeo-mcp-deployer', version: '1.0.0' },
      },
    }),
  });

  if (!initRes.ok) {
    throw new Error(`Falha no initialize: HTTP ${initRes.status} - ${await initRes.text()}`);
  }

  const sessionId = initRes.headers.get('mcp-session-id');
  console.log(`Sessão MCP estabelecida: ${sessionId.slice(0, 30)}...`);

  console.log('\n2. Enviando notificação initialized...');
  await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'mcp-session-id': sessionId,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
      params: {},
    }),
  });

  console.log('\n3. Executando deploy_edge_function para a função vendeo-brain-mcp...');
  const deployPayload = {
    project_id: 'wsdualhvopidgqcumonr',
    name: 'vendeo-brain-mcp',
    entrypoint_path: 'vendeo-brain-mcp/index.ts',
    verify_jwt: false,
    files,
  };

  const deployRes = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'mcp-session-id': sessionId,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'deploy_edge_function',
        arguments: deployPayload,
      },
    }),
  });

  console.log(`Deploy HTTP status: ${deployRes.status}`);
  const result = await deployRes.json();
  console.log('Deploy result:', JSON.stringify(result, null, 2));
}

deployMcp().catch(console.error);
