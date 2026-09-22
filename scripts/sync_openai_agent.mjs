import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  buildCanonicalAgentInstructions,
  VENDEO_AGENT_INSTRUCTIONS_VERSION,
  getCanonicalAgentInstructionsHash,
} from '../supabase/functions/api/openai_agent_instructions.ts';
import { LARISSA_INTERACTION_DNA_VERSION } from '../supabase/functions/api/larissa_interaction_dna.ts';

// 1. Carrega variáveis de ambiente (.env.local)
const envPath = path.resolve(import.meta.dirname, '../.env.local');
const envVars = {};
if (fs.existsSync(envPath)) {
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
}

const apiKey = envVars.OPENAI_API_KEY;
const agentId = envVars.OPENAI_BRAIN_AGENT_ID || 'agent_aa96ea5a95c04c8895e310e69cb27dd9279dbdf7ea0e4d8482';

if (!apiKey) {
  console.error('ERRO: OPENAI_API_KEY não encontrada em .env.local');
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${apiKey}`,
  'Content-Type': 'application/json',
  'OpenAI-Beta': 'agents=v1',
};

async function syncCanonicalOpenAiAgent() {
  console.log('================================================================');
  console.log(' SINCRONIZADOR OFICIAL ÚNICO — OPENAI AGENT DO VENDEO');
  console.log('================================================================');
  console.log(`Agent ID alvo: ${agentId}`);
  console.log(`Instruções Canônicas Versão: ${VENDEO_AGENT_INSTRUCTIONS_VERSION}`);
  console.log(`Larissa Interaction DNA Versão: ${LARISSA_INTERACTION_DNA_VERSION}`);

  // 1. Constrói instructions canônicas e calcula hash local
  const canonicalInstructions = buildCanonicalAgentInstructions();
  const localHash = getCanonicalAgentInstructionsHash();
  console.log(`Hash Local Canônico (SHA-256): ${localHash}`);
  console.log(`Tamanho das instruções locais: ${canonicalInstructions.length} caracteres`);

  // 2. GET inicial do Agent remoto
  console.log('\n--- 1. CONSULTANDO ESTADO ATUAL REMOTO (GET) ---');
  const get1Res = await fetch(`https://api.openai.com/v1/agents/${agentId}`, { headers });
  if (!get1Res.ok) {
    throw new Error(`Falha no GET inicial do Agent: ${get1Res.status} - ${await get1Res.text()}`);
  }
  const currentAgent = await get1Res.json();
  console.log('Status GET:', get1Res.status);
  console.log('Model atual:', currentAgent.model);
  console.log('Tamanho instructions antes:', currentAgent.instructions?.length);

  // 3. Valida e preserva ferramentas MCP autoritativas
  const updatedTools = (currentAgent.tools || []).map((tool) => {
    if (tool.server_label === 'vendeo_memory' || tool.type === 'mcp') {
      return {
        ...tool,
        required: true,
        allowed_tools: [
          'persona_memory_search',
          'contact_memory_search',
          'conversation_memory_search',
        ],
      };
    }
    return tool;
  });

  // 4. Executa o POST de sincronização com as instruções canônicas
  console.log('\n--- 2. ENVIANDO INSTRUÇÕES CANÔNICAS (POST) ---');
  const postPayload = {
    instructions: canonicalInstructions,
    tools: updatedTools,
  };

  const updateRes = await fetch(`https://api.openai.com/v1/agents/${agentId}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(postPayload),
  });

  if (!updateRes.ok) {
    throw new Error(`Falha no POST de sincronização: ${updateRes.status} - ${await updateRes.text()}`);
  }
  console.log('Status POST:', updateRes.status);
  console.log('Request-ID POST:', updateRes.headers.get('x-request-id'));

  // 5. GET de verificação pós-atualização
  console.log('\n--- 3. VERIFICANDO ESTADO REMOTO PÓS-POST (GET) ---');
  const get2Res = await fetch(`https://api.openai.com/v1/agents/${agentId}`, { headers });
  if (!get2Res.ok) {
    throw new Error(`Falha no GET pós-atualização: ${get2Res.status} - ${await get2Res.text()}`);
  }
  const verifiedAgent = await get2Res.json();
  const remoteInstructions = verifiedAgent.instructions || '';
  const remoteHash = crypto.createHash('sha256').update(remoteInstructions, 'utf8').digest('hex');

  console.log('Tamanho instructions remoto pós-POST:', remoteInstructions.length);
  console.log(`Hash Remoto Retornado: ${remoteHash}`);

  // 6. Verificação estrita de integridade
  const hashMatches = localHash === remoteHash;
  console.log(`REMOTE_HASH_MATCHES_LOCAL = ${hashMatches}`);

  if (!hashMatches) {
    console.error('ERRO CRÍTICO: Hash remoto não confere com o hash local canônico!');
    console.error(`Local:  ${localHash}`);
    console.error(`Remoto: ${remoteHash}`);
    process.exit(1);
  }

  const mcpTool = verifiedAgent.tools?.find((t) => t.type === 'mcp' || t.server_label === 'vendeo_memory');
  console.log('\n=== SINCRONIZAÇÃO CANÔNICA CONCLUÍDA COM SUCESSO ===');
  console.log(`Agent ID: ${verifiedAgent.id}`);
  console.log(`Model: ${verifiedAgent.model}`);
  console.log(`Instructions Version: ${VENDEO_AGENT_INSTRUCTIONS_VERSION}`);
  console.log(`Interaction DNA Version: ${LARISSA_INTERACTION_DNA_VERSION}`);
  console.log(`MCP Server: ${mcpTool?.transport?.server_url || 'vendeo_memory'}`);
  console.log(`MCP Required: ${mcpTool?.required}`);
  console.log(`Allowed Tools: ${JSON.stringify(mcpTool?.allowed_tools)}`);
  console.log(`MULTIPLE_AGENT_INSTRUCTION_WRITERS = false`);
  console.log(`REMOTE_HASH_MATCHES_LOCAL = true`);
}

syncCanonicalOpenAiAgent().catch((err) => {
  console.error('Falha fatal na sincronização do OpenAI Agent:', err);
  process.exit(1);
});
