import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  buildCanonicalAgentInstructions,
  VENDEO_AGENT_INSTRUCTIONS_VERSION,
  getCanonicalAgentInstructionsHash,
} from '../supabase/functions/api/openai_agent_instructions.ts';
import { LARISSA_INTERACTION_DNA_VERSION } from '../supabase/functions/api/larissa_interaction_dna.ts';
import { COFRE_AUDIO_SEARCH_TOOL_DEFINITION } from '../supabase/functions/api/openai_brain.ts';

/**
 * Constrói o payload de sincronização canônico com preservação estrita de configurações remotas.
 *
 * Regras mandatórias:
 * 1. Preservar o model remoto (ex: gpt-6-luna). Nunca substituir por constante local.
 * 2. Preservar o reasoning remoto (ex: extra_high, max, etc.). Nunca forçar 'max'.
 * 3. Preservar a verbosity remota (ex: medium).
 * 4. Preservar todas as ferramentas remotas existentes e injetar cofre_audio_search se ausente.
 * 5. Fail-closed: se o estado remoto for incompleto ou desconhecido, aborta antes de qualquer mutação.
 */
export function buildAgentSyncPayload(currentAgent, canonicalInstructions, cofreAudioTool = COFRE_AUDIO_SEARCH_TOOL_DEFINITION) {
  if (!currentAgent || typeof currentAgent !== 'object') {
    throw new Error('FAIL_CLOSED: Objeto do Agent remoto é inválido ou nulo.');
  }

  // 1. Validação estrita do modelo remoto (Fail-Closed)
  if (!currentAgent.model || typeof currentAgent.model !== 'string' || !currentAgent.model.trim()) {
    throw new Error('FAIL_CLOSED: Não foi possível identificar o model do Agent remoto com segurança.');
  }
  const preservedModel = currentAgent.model.trim();

  // 2. Extração e validação estrita de reasoning (Fail-Closed)
  let preservedReasoning = null;
  if (typeof currentAgent.reasoning === 'string' && currentAgent.reasoning.trim()) {
    preservedReasoning = currentAgent.reasoning.trim();
  } else if (typeof currentAgent.reasoning_effort === 'string' && currentAgent.reasoning_effort.trim()) {
    preservedReasoning = currentAgent.reasoning_effort.trim();
  } else if (currentAgent.reasoning && typeof currentAgent.reasoning.effort === 'string') {
    preservedReasoning = currentAgent.reasoning.effort.trim();
  } else if (currentAgent.model_settings && typeof currentAgent.model_settings.reasoning === 'string') {
    preservedReasoning = currentAgent.model_settings.reasoning.trim();
  } else if (currentAgent.model_settings && typeof currentAgent.model_settings.reasoning_effort === 'string') {
    preservedReasoning = currentAgent.model_settings.reasoning_effort.trim();
  }

  if (!preservedReasoning) {
    throw new Error('FAIL_CLOSED: Configurações de reasoning do Agent remoto não puderam ser verificadas.');
  }

  // 3. Extração e preservação de verbosity
  let preservedVerbosity = null;
  if (typeof currentAgent.verbosity === 'string' && currentAgent.verbosity.trim()) {
    preservedVerbosity = currentAgent.verbosity.trim();
  } else if (currentAgent.text && typeof currentAgent.text.verbosity === 'string') {
    preservedVerbosity = currentAgent.text.verbosity.trim();
  } else if (currentAgent.model_settings && typeof currentAgent.model_settings.verbosity === 'string') {
    preservedVerbosity = currentAgent.model_settings.verbosity.trim();
  }

  // 4. Preservação de ferramentas e injeção do cofre_audio_search
  if (!Array.isArray(currentAgent.tools)) {
    throw new Error('FAIL_CLOSED: A lista de ferramentas (tools) do Agent remoto não é um array válido.');
  }

  const existingTools = currentAgent.tools;
  const hasCofreAudio = existingTools.some(
    (t) => (t.type === 'function' && t.function?.name === 'cofre_audio_search') || t.name === 'cofre_audio_search'
  );

  const updatedTools = existingTools.map((tool) => {
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

  if (!hasCofreAudio && cofreAudioTool) {
    updatedTools.push(cofreAudioTool);
  }

  // 5. Montagem do payload de atualização
  const payload = {
    instructions: canonicalInstructions,
    tools: updatedTools,
    model: preservedModel,
    reasoning: preservedReasoning,
    reasoning_effort: preservedReasoning,
  };

  if (preservedVerbosity) {
    payload.verbosity = preservedVerbosity;
  }

  // 6. Assert de segurança: Se o remoto era extra_high, NUNCA pode ter virado max
  if (preservedReasoning === 'extra_high' && (payload.reasoning === 'max' || payload.reasoning_effort === 'max')) {
    throw new Error('ASSERT_FAILED: Tentativa de sobrescrever extra_high para max detectada.');
  }

  // 7. Assert de segurança: O modelo não pode divergir do remoto
  if (payload.model !== preservedModel) {
    throw new Error(`ASSERT_FAILED: Modelo divergente. Esperado: ${preservedModel}, Gerado: ${payload.model}`);
  }

  // 8. Assert de ferramentas: cofre_audio_search deve estar presente
  const toolNames = payload.tools.map((t) => t.function?.name || t.name || t.server_label);
  if (!toolNames.includes('cofre_audio_search')) {
    throw new Error('ASSERT_FAILED: cofre_audio_search ausente nas ferramentas atualizadas.');
  }

  return payload;
}

// -----------------------------------------------------------------------------
// Script de execução para sincronização futura controlada
// -----------------------------------------------------------------------------
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

export async function syncCanonicalOpenAiAgent(options = {}) {
  const { allowRemoteMutation = false } = options;

  console.log('================================================================');
  console.log(' SINCRONIZADOR OFICIAL ÚNICO — OPENAI AGENT DO VENDEO');
  console.log('================================================================');
  console.log(`Agent ID alvo: ${agentId}`);
  console.log(`Instruções Canônicas Versão: ${VENDEO_AGENT_INSTRUCTIONS_VERSION}`);
  console.log(`Larissa Interaction DNA Versão: ${LARISSA_INTERACTION_DNA_VERSION}`);

  if (!apiKey) {
    throw new Error('ERRO: OPENAI_API_KEY não encontrada em .env.local');
  }

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
    'OpenAI-Beta': 'agents=v1',
  };

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
  console.log('Model atual remoto:', currentAgent.model);
  console.log('Reasoning atual remoto:', currentAgent.reasoning || currentAgent.reasoning_effort || 'desconhecido');
  console.log('Verbosity atual remoto:', currentAgent.verbosity || 'desconhecido');
  console.log('Tamanho instructions antes:', currentAgent.instructions?.length);

  // 3. Monta payload estrito preservando configurações remotas
  const postPayload = buildAgentSyncPayload(currentAgent, canonicalInstructions, COFRE_AUDIO_SEARCH_TOOL_DEFINITION);

  console.log('\n--- PAYLOAD VALIDADO COM SUCESSO ---');
  console.log(`Model preservado: ${postPayload.model}`);
  console.log(`Reasoning preservado: ${postPayload.reasoning}`);
  console.log(`Verbosity preservado: ${postPayload.verbosity || 'não definido'}`);
  console.log(`Quantidade total de tools: ${postPayload.tools.length}`);

  if (!allowRemoteMutation) {
    console.log('\n[AVISO DE SEGURANÇA] allowRemoteMutation = false. Nenhuma alteração remota foi executada.');
    return {
      success: true,
      dryRun: true,
      agentId,
      model: postPayload.model,
      reasoning: postPayload.reasoning,
      verbosity: postPayload.verbosity,
      toolsCount: postPayload.tools.length,
      instructionsVersion: VENDEO_AGENT_INSTRUCTIONS_VERSION,
      localHash,
    };
  }

  // 4. Executa o POST de sincronização com as instruções canônicas (quando explicitamente autorizado)
  console.log('\n--- 2. ENVIANDO INSTRUÇÕES CANÔNICAS (POST) ---');
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

  const hashMatches = localHash === remoteHash;
  console.log(`REMOTE_HASH_MATCHES_LOCAL = ${hashMatches}`);

  if (!hashMatches) {
    throw new Error(`ERRO CRÍTICO: Hash remoto (${remoteHash}) não confere com local (${localHash})!`);
  }

  const mcpTool = verifiedAgent.tools?.find((t) => t.type === 'mcp' || t.server_label === 'vendeo_memory');
  console.log('\n=== SINCRONIZAÇÃO CANÔNICA CONCLUÍDA COM SUCESSO ===');
  console.log(`Agent ID: ${verifiedAgent.id}`);
  console.log(`Model: ${verifiedAgent.model}`);
  console.log(`Reasoning: ${verifiedAgent.reasoning || verifiedAgent.reasoning_effort}`);
  console.log(`Instructions Version: ${VENDEO_AGENT_INSTRUCTIONS_VERSION}`);
  console.log(`Interaction DNA Version: ${LARISSA_INTERACTION_DNA_VERSION}`);
  console.log(`MCP Server: ${mcpTool?.transport?.server_url || 'vendeo_memory'}`);
  console.log(`Allowed Tools: ${JSON.stringify(mcpTool?.allowed_tools)}`);

  return {
    success: true,
    dryRun: false,
    agentId: verifiedAgent.id,
    model: verifiedAgent.model,
    reasoning: verifiedAgent.reasoning || verifiedAgent.reasoning_effort,
    instructionsVersion: VENDEO_AGENT_INSTRUCTIONS_VERSION,
    localHash,
    remoteHash,
  };
}

// Execução direta via CLI protegida contra mutação acidental
if (process.argv[1] && process.argv[1].endsWith('sync_openai_agent.mjs')) {
  const isAuthorized = process.env.AUTHORIZE_OPENAI_AGENT_MUTATION === 'true';
  syncCanonicalOpenAiAgent({ allowRemoteMutation: isAuthorized }).catch((err) => {
    console.error('Falha fatal na sincronização do OpenAI Agent:', err);
    process.exit(1);
  });
}
