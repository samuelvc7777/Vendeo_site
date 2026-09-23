import fs from 'fs';
import path from 'path';

async function deploy() {
  const tokens = JSON.parse(
    fs.readFileSync('C:/Users/Samuel Vitor/.gemini/antigravity/mcp_oauth_tokens.json', 'utf8')
  );
  const token = tokens['https://mcp.supabase.com/mcp'].token.access_token;
  const projectId = 'pdhtgzwfbqygflzbwdkt';

  console.log('1. Conectando ao MCP oficial do Supabase...');
  const initRes = await fetch('https://mcp.supabase.com/mcp', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
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
        clientInfo: { name: 'antigravity', version: '1.0.0' },
      },
    }),
  });

  if (!initRes.ok) {
    throw new Error('Falha no init do MCP: ' + initRes.status + ' ' + (await initRes.text()));
  }

  const sessionId = initRes.headers.get('mcp-session-id');
  console.log('Sessão MCP estabelecida. Session ID:', sessionId);

  // Notificação initialized requerida pelo MCP spec
  await fetch('https://mcp.supabase.com/mcp', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json',
      'mcp-session-id': sessionId,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    }),
  });

  // Coleta arquivos de api/
  const apiDir = 'supabase/functions/api';
  const apiFiles = fs
    .readdirSync(apiDir)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => ({
      name: `api/${f}`,
      content: fs.readFileSync(path.join(apiDir, f), 'utf8'),
    }));

  // Coleta arquivos de _shared/
  const sharedDir = 'supabase/functions/_shared';
  const sharedFiles = fs
    .readdirSync(sharedDir)
    .filter((f) => f.endsWith('.ts'))
    .map((f) => ({
      name: `_shared/${f}`,
      content: fs.readFileSync(path.join(sharedDir, f), 'utf8'),
    }));

  const allFiles = [...apiFiles, ...sharedFiles];
  console.log(`2. Arquivos empacotados para deploy (${allFiles.length}):`);
  for (const f of allFiles) {
    console.log(`   - ${f.name} (${f.content.length} caracteres)`);
  }

  console.log(`\n3. Disparando deploy_edge_function para projeto ${projectId} (name: 'api')...`);
  const deployRes = await fetch('https://mcp.supabase.com/mcp', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'mcp-session-id': sessionId,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: {
        name: 'deploy_edge_function',
        arguments: {
          project_id: projectId,
          name: 'api',
          entrypoint_path: 'api/index.ts',
          verify_jwt: false,
          files: allFiles,
        },
      },
    }),
  });

  console.log('Status HTTP resposta MCP:', deployRes.status);
  const resultText = await deployRes.text();
  console.log('Resposta do Deploy MCP:\n', resultText);

  // Validação adicional: consulta a Edge Function via API
  console.log('\n4. Verificando versão ativa da Edge Function pós-deploy...');
  const fnRes = await fetch(
    `https://api.supabase.com/v1/projects/${projectId}/functions/api`,
    {
      headers: { Authorization: 'Bearer ' + token },
    }
  );
  if (fnRes.ok) {
    const fnData = await fnRes.json();
    console.log('Dados da função ativa:', {
      id: fnData.id,
      slug: fnData.slug,
      name: fnData.name,
      status: fnData.status,
      version: fnData.version,
      updated_at: fnData.updated_at,
    });
    if (fnData.version > 22 && fnData.status === 'ACTIVE') {
      console.log(`\n✅ DEPLOY DA EDGE FUNCTION API REALIZADO COM SUCESSO! Versão: ${fnData.version}`);
    } else {
      console.log(`\n⚠️ Atenção: versão atual é ${fnData.version}, status: ${fnData.status}`);
    }
  } else {
    console.error('Falha ao verificar função ativa:', fnRes.status, await fnRes.text());
  }
}

deploy().catch((err) => {
  console.error('Erro fatal no deploy da Edge Function:', err);
  process.exit(1);
});
