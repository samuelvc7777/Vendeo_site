/**
 * deploy_api_function.mjs
 * Realiza o deploy oficial da Edge Function 'api' no Supabase (wsdualhvopidgqcumonr)
 * utilizando o servidor MCP oficial da Supabase (https://mcp.supabase.com/mcp).
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { resolve, join } from 'path';

const MCP_URL = 'https://mcp.supabase.com/mcp';
const PROJECT_ID = 'wsdualhvopidgqcumonr';
const FUNCTION_NAME = 'api';

// Carrega o token OAuth
const tokenFilePath = 'C:/Users/Samuel Vitor/.gemini/antigravity/mcp_oauth_tokens.json';
const oauthConfig = JSON.parse(readFileSync(tokenFilePath, 'utf8'));
const accessToken = oauthConfig[MCP_URL]?.token?.access_token;

if (!accessToken) {
  console.error('ERRO: Token de acesso do Supabase MCP não encontrado em mcp_oauth_tokens.json');
  process.exit(1);
}

// Coleta todos os arquivos da pasta local supabase/functions/api
const apiDir = resolve(process.cwd(), 'supabase/functions/api');
const fileNames = readdirSync(apiDir);
const files = [];

for (const f of fileNames) {
  const fullPath = join(apiDir, f);
  if (statSync(fullPath).isFile()) {
    const content = readFileSync(fullPath, 'utf8');
    files.push({
      name: `api/${f}`,
      content,
    });
  }
}

// Coleta arquivos de supabase/functions/_shared se existirem
const sharedDir = resolve(process.cwd(), 'supabase/functions/_shared');
if (existsSync(sharedDir)) {
  const sharedFileNames = readdirSync(sharedDir);
  for (const f of sharedFileNames) {
    const fullPath = join(sharedDir, f);
    if (statSync(fullPath).isFile()) {
      const content = readFileSync(fullPath, 'utf8');
      files.push({
        name: `_shared/${f}`,
        content,
      });
    }
  }
}

console.log(`Preparando deploy da função '${FUNCTION_NAME}' para o projeto '${PROJECT_ID}'...`);
console.log(`Arquivos incluídos (${files.length}):`);
for (const f of files) {
  console.log(`  • ${f.name} (${f.content.length} chars)`);
}

async function deploy() {
  // 1. Handshake Initialize no MCP
  console.log('\n[1/2] Inicializando sessão MCP com Supabase...');
  const initRes = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'vendeo_deploy_script', version: '1.0.0' },
      },
    }),
  });

  if (!initRes.ok) {
    const errText = await initRes.text();
    console.error(`Falha no initialize do MCP (HTTP ${initRes.status}):`, errText);
    process.exit(1);
  }

  const sessionId = initRes.headers.get('mcp-session-id');
  if (!sessionId) {
    console.error('ERRO: Sessão MCP não retornou Mcp-Session-Id no header.');
    process.exit(1);
  }
  console.log('Sessão MCP estabelecida com sucesso.');

  // 2. Chamada deploy_edge_function
  console.log('\n[2/2] Enviando deploy_edge_function...');
  const deployPayload = {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'deploy_edge_function',
      arguments: {
        project_id: PROJECT_ID,
        name: FUNCTION_NAME,
        entrypoint_path: 'api/index.ts',
        verify_jwt: false,
        files,
      },
    },
  };

  const deployRes = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'Mcp-Session-Id': sessionId,
    },
    body: JSON.stringify(deployPayload),
  });

  const resText = await deployRes.text();
  console.log(`Status HTTP do Deploy: ${deployRes.status}`);

  try {
    const json = JSON.parse(resText);
    console.log('\nResultado do deploy:', JSON.stringify(json, null, 2));

    if (json.error || json.result?.isError) {
      console.error('ERRO no deploy:', json.error || json.result);
      process.exit(1);
    }
  } catch {
    console.log('Resposta bruta:', resText);
  }
}

deploy().catch(console.error);
