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

const apiKey = envVars.OPENAI_API_KEY;
const agentId = envVars.OPENAI_BRAIN_AGENT_ID;
const mcpToken = envVars.VENDEO_BRAIN_MCP_TOKEN;
const cleanMcpUrl = 'https://wsdualhvopidgqcumonr.supabase.co/functions/v1/vendeo-brain-mcp';

const headers = {
  Authorization: `Bearer ${apiKey}`,
  'Content-Type': 'application/json',
  'OpenAI-Beta': 'agents=v1',
};

async function main() {
  console.log('1. Criando Vault Oficial para o MCP...');
  const createVaultRes = await fetch('https://api.openai.com/v1/vaults', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: 'vendeo_official_mcp_vault',
    }),
  });
  const vault = await createVaultRes.json();
  console.log('Vault criado:', vault.id);

  console.log('2. Registrando credencial static_bearer no Vault...');
  const addCredRes = await fetch(`https://api.openai.com/v1/vaults/${vault.id}/credentials`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: 'vendeo_brain_mcp_bearer',
      auth: {
        type: 'static_bearer',
        mcp_server_url: cleanMcpUrl,
        token: mcpToken,
      },
    }),
  });
  const cred = await addCredRes.json();
  console.log('Credencial registrada no Vault:', cred.id);

  // Salvar OPENAI_MCP_VAULT_ID em .env.local
  let updatedEnv = envContent;
  if (/^OPENAI_MCP_VAULT_ID=.*$/m.test(updatedEnv)) {
    updatedEnv = updatedEnv.replace(/^OPENAI_MCP_VAULT_ID=.*$/m, `OPENAI_MCP_VAULT_ID="${vault.id}"`);
  } else {
    updatedEnv += `\nOPENAI_MCP_VAULT_ID="${vault.id}"\n`;
  }
  fs.writeFileSync('.env.local', updatedEnv, 'utf8');

  console.log('3. Atualizando Agent remoto com a tool MCP limpa e regras de Grounding...');
  const groundingInstructions = `Brain central do Vendeo. Analisa cada conversa, consulta memorias e dados da Larissa, decide objetivos e acoes do turno e coordena os subagentes responsaveis pela resposta.

REGRA OBRIGATORIA DE GROUNDING:
A ausencia de um fato na PersonaMemory NAO significa que o oposto e verdadeiro.
Se a busca nao encontrar informacao sobre algo, trate como desconhecido.
E terminantemente PROIBIDO transformar ausencia de evidencia em afirmacoes categoricas negativas (como: "nunca fiz", "nunca fui", "nao gosto", "nao pratico", "nao tenho", "nao bebo", "nao conheco"), a menos que exista um fato explicito e comprovado na PersonaMemory confirmando essa afirmacao.`;

  const mcpTool = {
    type: 'mcp',
    server_label: 'vendeo_memory',
    transport: {
      type: 'http',
      server_url: cleanMcpUrl, // URL limpa sem query token
    },
    allowed_tools: ['persona_memory_search'],
    connection_origin: 'service',
    required: false,
  };

  const updateAgentRes = await fetch(`https://api.openai.com/v1/agents/${agentId}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      instructions: groundingInstructions,
      tools: [mcpTool],
    }),
  });

  const updatedAgent = await updateAgentRes.json();
  console.log('Agent remoto atualizado com sucesso:');
  console.log('- Tools:', JSON.stringify(updatedAgent.tools, null, 2));
  console.log('- Vault salvo em .env.local:', vault.id);
}

main().catch(console.error);
