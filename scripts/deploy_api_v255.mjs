import fs from 'fs';
import path from 'path';

const API_DIR = path.resolve(import.meta.dirname, '../supabase/functions/api');
const filenames = fs.readdirSync(API_DIR).filter((f) => f.endsWith('.ts'));

console.log(`Lendo ${filenames.length} arquivos de ${API_DIR}...`);

const files = filenames.map((name) => {
  const content = fs.readFileSync(path.join(API_DIR, name), 'utf8');
  return {
    name: `api/${name}`,
    content,
  };
});

console.log(`Arquivos preparados (${files.length}):\n - ${files.map((f) => f.name).join('\n - ')}`);

const tokens = JSON.parse(
  fs.readFileSync('C:/Users/Samuel Vitor/.gemini/antigravity/mcp_oauth_tokens.json', 'utf8')
);
const token = tokens['https://mcp.supabase.com/mcp']?.token?.access_token;

if (!token) {
  console.error('Token OAuth do Supabase MCP não encontrado.');
  process.exit(1);
}

const MCP_URL = 'https://mcp.supabase.com/mcp';

async function deployApi() {
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
        clientInfo: { name: 'vendeo-deployer', version: '1.0.0' },
      },
    }),
  });

  if (!initRes.ok) {
    throw new Error(`Falha no initialize: HTTP ${initRes.status} - ${await initRes.text()}`);
  }

  const sessionId = initRes.headers.get('mcp-session-id');
  console.log(`Sessão MCP estabelecida: ${sessionId ? sessionId.slice(0, 30) : 'none'}...`);

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

  console.log('\n3. Executando deploy_edge_function para a função api (v255)...');
  const deployPayload = {
    project_id: 'wsdualhvopidgqcumonr',
    name: 'api',
    entrypoint_path: 'api/index.ts',
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

deployApi().catch(console.error);
