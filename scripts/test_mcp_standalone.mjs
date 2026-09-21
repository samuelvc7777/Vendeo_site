// Teste Isolado do Servidor MCP Remoto Vendeo (vendeo-brain-mcp)
import fs from 'fs';
import path from 'path';

// Carrega variaveis de ambiente de .env.local
const envPath = path.resolve(process.cwd(), '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
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

const MCP_URL = 'https://wsdualhvopidgqcumonr.supabase.co/functions/v1/vendeo-brain-mcp';
const MCP_TOKEN = envVars.VENDEO_BRAIN_MCP_TOKEN;

if (!MCP_TOKEN) {
  console.error('ERRO: VENDEO_BRAIN_MCP_TOKEN nao encontrado em .env.local');
  process.exit(1);
}

console.log('--- TESTE ISOLADO MCP VENDEO ---');
console.log('MCP URL:', MCP_URL);
console.log('MCP Token configurado:', MCP_TOKEN.slice(0, 15) + '...');

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  [PASS] ${message}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${message}`);
    failed++;
  }
}

async function runTests() {
  // Teste 1: Rejeicao 401 sem header Authorization
  console.log('\n1. Testando requisicao sem autorizacao...');
  const resNoAuth = await fetch(MCP_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
  assert(resNoAuth.status === 401, `Status deve ser 401 (recebido: ${resNoAuth.status})`);
  const bodyNoAuth = await resNoAuth.json();
  assert(bodyNoAuth?.error?.message?.includes('Unauthorized'), 'Mensagem deve indicar Unauthorized');

  // Teste 2: Rejeicao 401 com token invalido
  console.log('\n2. Testando requisicao com token falso...');
  const resBadAuth = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer token_completamente_falso_123',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
  });
  assert(resBadAuth.status === 401, `Status deve ser 401 com token invalido (recebido: ${resBadAuth.status})`);

  // Teste 2b: Acesso valido via header customizado X-Vendeo-Token (usado pela OpenAI Agents API)
  console.log('\n2b. Testando requisicao com X-Vendeo-Token...');
  const resCustomHeader = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Vendeo-Token': MCP_TOKEN,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'custom-1', method: 'tools/list' }),
  });
  assert(resCustomHeader.status === 200, `Status com X-Vendeo-Token deve ser 200 (recebido: ${resCustomHeader.status})`);
  const dataCustom = await resCustomHeader.json();
  assert(dataCustom?.result?.tools?.length === 1, 'Deve retornar ferramenta via X-Vendeo-Token');

  // Teste 3: Protocol handshake - initialize
  console.log('\n3. Testando handshake MCP initialize...');
  const resInit = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${MCP_TOKEN}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'init-1',
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test_client', version: '1.0' },
      },
    }),
  });
  assert(resInit.status === 200, `initialize status deve ser 200 (recebido: ${resInit.status})`);
  const dataInit = await resInit.json();
  assert(dataInit?.result?.protocolVersion === '2024-11-05', 'protocolVersion deve ser 2024-11-05');
  assert(dataInit?.result?.serverInfo?.name === 'vendeo_memory', 'serverInfo.name deve ser vendeo_memory');
  assert(dataInit?.result?.capabilities?.tools !== undefined, 'capabilities deve conter tools');

  // Teste 3b: Protocol discovery - server/discover (usado pela OpenAI Agents API)
  console.log('\n3b. Testando descoberta MCP server/discover...');
  const resDisc = await fetch(`${MCP_URL}?token=${MCP_TOKEN}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'openai-mcp-discover',
      method: 'server/discover',
    }),
  });
  assert(resDisc.status === 200, `server/discover status deve ser 200 (recebido: ${resDisc.status})`);
  const dataDisc = await resDisc.json();
  assert(dataDisc?.result?.capabilities?.tools !== undefined, 'server/discover deve anunciar capabilities.tools');
  assert(dataDisc?.result?.serverInfo?.name === 'vendeo_memory', 'serverInfo.name deve ser vendeo_memory');

  // Teste 4: tools/list
  console.log('\n4. Testando descoberta de ferramentas tools/list...');
  const resList = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${MCP_TOKEN}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'list-1',
      method: 'tools/list',
    }),
  });
  assert(resList.status === 200, `tools/list status deve ser 200 (recebido: ${resList.status})`);
  const dataList = await resList.json();
  const tools = dataList?.result?.tools;
  assert(Array.isArray(tools) && tools.length === 1, 'Deve listar exatamente 1 ferramenta');
  const memoryTool = tools?.[0];
  assert(memoryTool?.name === 'persona_memory_search', 'Ferramenta deve se chamar persona_memory_search');
  assert(memoryTool?.inputSchema?.properties?.query !== undefined, 'inputSchema deve conter query');
  assert(memoryTool?.inputSchema?.properties?.limit !== undefined, 'inputSchema deve conter limit');
  assert(memoryTool?.inputSchema?.required?.includes('query'), 'query deve ser required');

  // Teste 5: tools/call com query motocross
  console.log('\n5. Testando tools/call com query="motocross"...');
  const resCall = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${MCP_TOKEN}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'call-1',
      method: 'tools/call',
      params: {
        name: 'persona_memory_search',
        arguments: {
          query: 'motocross',
          limit: 5,
        },
      },
    }),
  });
  assert(resCall.status === 200, `tools/call status deve ser 200 (recebido: ${resCall.status})`);
  const dataCall = await resCall.json();
  const content = dataCall?.result?.content;
  assert(Array.isArray(content) && content.length > 0, 'result.content deve ser array nao vazio');
  const textPayload = content?.[0]?.text;
  assert(typeof textPayload === 'string', 'content[0].text deve ser string JSON');
  const parsedOutput = JSON.parse(textPayload || '{}');
  console.log('  Payload retornado do MCP:', JSON.stringify(parsedOutput, null, 2));
  assert(parsedOutput && typeof parsedOutput.found === 'boolean', 'Output deve conter campo found (boolean)');
  assert(Array.isArray(parsedOutput.results), 'Output deve conter array results');

  // Teste 6: tools/call com query conhecida (strogonoff)
  console.log('\n6. Testando tools/call com query="strogonoff"...');
  const resCallFood = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${MCP_TOKEN}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'call-2',
      method: 'tools/call',
      params: {
        name: 'persona_memory_search',
        arguments: {
          query: 'strogonoff',
          limit: 3,
        },
      },
    }),
  });
  const dataCallFood = await resCallFood.json();
  const outputFood = JSON.parse(dataCallFood?.result?.content?.[0]?.text || '{}');
  assert(outputFood.found === true, 'Deve encontrar fato com strogonoff (found: true)');
  assert(outputFood.results.length > 0, 'Deve retornar resultados para strogonoff');
  console.log('  Fato encontrado:', outputFood.results[0]?.key, '->', outputFood.results[0]?.value);

  // Teste 7: Sanitizacao de limites (limit: 50 -> teto de 8)
  console.log('\n7. Testando sanitizacao de limit excedente...');
  const resSanitize = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${MCP_TOKEN}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'call-3',
      method: 'tools/call',
      params: {
        name: 'persona_memory_search',
        arguments: {
          query: 'enfermagem',
          limit: 50, // excedente, deve ser sanitizado
        },
      },
    }),
  });
  const dataSanitize = await resSanitize.json();
  const outputSanitize = JSON.parse(dataSanitize?.result?.content?.[0]?.text || '{}');
  assert(outputSanitize.results.length <= 8, `Numero de resultados deve ser <= 8 (recebido: ${outputSanitize.results.length})`);

  // Teste 8: Tool inexistente
  console.log('\n8. Testando tool inexistente...');
  const resBadTool = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${MCP_TOKEN}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 'call-4',
      method: 'tools/call',
      params: {
        name: 'ferramenta_inexistente',
        arguments: {},
      },
    }),
  });
  const dataBadTool = await resBadTool.json();
  assert(dataBadTool?.error?.code === -32601, 'Deve retornar erro JSON-RPC -32601 para ferramenta inexistente');

  console.log(`\n========================================`);
  console.log(`RESULTADO DOS TESTES ISOLADOS MCP:`);
  console.log(`  PASSOU: ${passed}`);
  console.log(`  FALHOU: ${failed}`);
  console.log(`========================================`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Erro na execucao dos testes:', err);
  process.exit(1);
});
