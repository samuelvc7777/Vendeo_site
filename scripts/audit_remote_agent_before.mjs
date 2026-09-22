import fs from 'fs';
import path from 'path';

const envPath = path.resolve('.env.local');
const env = fs.readFileSync(envPath, 'utf8').split('\n').reduce((acc, l) => {
  const [k, ...v] = l.trim().split('=');
  if (k && v.length) acc[k] = v.join('=').replace(/^["']|["']$/g, '').trim();
  return acc;
}, {});

const key = env.OPENAI_API_KEY;
const agentId = 'agent_aa96ea5a95c04c8895e310e69cb27dd9279dbdf7ea0e4d8482';
const headers = {
  Authorization: `Bearer ${key}`,
  'Content-Type': 'application/json',
  'OpenAI-Beta': 'agents=v1',
};

async function auditRemoteAgent() {
  const res = await fetch(`https://api.openai.com/v1/agents/${agentId}`, { headers });
  if (!res.ok) {
    console.error('Falha ao obter Agent remoto:', res.status, await res.text());
    process.exit(1);
  }
  const agent = await res.json();
  const instructions = agent.instructions || '';

  const mcpTool = agent.tools?.find(t => t.type === 'mcp') || {};
  
  console.log('=== METADADOS DO AGENT REMOTO ===');
  console.log('Agent ID:', agent.id);
  console.log('Model:', agent.model);
  console.log('Instructions Length:', instructions.length);
  console.log('Tools count:', agent.tools?.length);
  console.log('MCP Server Type:', mcpTool.type);
  console.log('MCP Server URL:', mcpTool.transport?.server_url);
  console.log('MCP Server Label:', mcpTool.server_label);
  console.log('MCP Required:', mcpTool.required);
  console.log('Allowed Tools:', JSON.stringify(mcpTool.allowed_tools));

  // Detecção da versão do DNA
  const dnaMatch = instructions.match(/LARISSA_INTERACTION_DNA\s*\(([^\)]+)\)/i) ||
                   instructions.match(/LARISSA_INTERACTION_DNA_VERSION\s*[:=]\s*([^\s\n]+)/i);
  const detectedDnaVersion = dnaMatch ? dnaMatch[1] : 'não detectada explicitamente';
  console.log('DNA Version detectada nas instructions:', detectedDnaVersion);

  // Auditoria semântica dos itens A a Q
  const checks = {
    'A) Brain authority': /Conversation Brain|autoridade|Brain central/i.test(instructions),
    'B) Turno único': /turno único|TURNO ÚNICO/i.test(instructions),
    'C) Grounding': /ausencia de um fato.*não significa|REGRA OBRIGATORIA DE GROUNDING|ausência de evidência/i.test(instructions),
    'D) AFFINITY CHECK': /AFFINITY CHECK/i.test(instructions),
    'E) TOOL EXECUTION INVARIANT': /TOOL EXECUTION INVARIANT/i.test(instructions),
    'F) Progressão Oportunística': /Progressão Oportunística|progressao oportunistica|oportunística/i.test(instructions),
    'G) Acknowledgement loop protection': /acknowledgement|loop de acknowledgement|eco|papagaio/i.test(instructions),
    'H) PersonaMemory': /persona_memory_search/i.test(instructions),
    'I) ContactMemory': /contact_memory_search/i.test(instructions),
    'J) ConversationMemory': /conversation_memory_search/i.test(instructions),
    'K) Anti-repetição de longo prazo': /ANTI-REPETIÇÃO DE PERGUNTAS|anti-repetição/i.test(instructions),
    'L) Continuidade de autorrevelações': /CONTINUIDADE DE AUTORREVELAÇÕES|autorrevelações/i.test(instructions),
    'M) memoryWrites': /memoryWrites/i.test(instructions),
    'N) LARISSA_INTERACTION_DNA v1.1.0': /LARISSA_INTERACTION_DNA\s*\(v1\.1\.0\)|v1\.1\.0/i.test(instructions),
    'O) evidenceMessageId': /evidenceMessageId/i.test(instructions),
    'P) satisfiedObjectiveId': /satisfiedObjectiveId/i.test(instructions),
    'Q) Regra already_satisfied com ID de inbound real': /\[MENSAGEM id="|already_satisfied.*evidenceMessageId/i.test(instructions),
  };

  console.log('\n=== AUDITORIA SEMÂNTICA DOS ITENS (A até Q) ===');
  for (const [key, present] of Object.entries(checks)) {
    let status = present ? 'PRESENTE' : 'AUSENTE';
    if (key.includes('v1.1.0') && detectedDnaVersion.includes('v1.0.0')) {
      status = 'DESATUALIZADO (está v1.0.0)';
    }
    console.log(`${key}: ${status}`);
  }

  fs.writeFileSync('scripts/remote_agent_instructions_snapshot.txt', instructions, 'utf8');
  console.log('\nSnapshot das instructions salvo em scripts/remote_agent_instructions_snapshot.txt');
}

auditRemoteAgent().catch(console.error);
