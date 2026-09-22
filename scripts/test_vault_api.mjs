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

const headers = {
  Authorization: `Bearer ${envVars.OPENAI_API_KEY}`,
  'Content-Type': 'application/json',
  'OpenAI-Beta': 'agents=v1',
};

async function testVault() {
  console.log('1. Listando vaults existentes...');
  const listRes = await fetch('https://api.openai.com/v1/vaults', { headers });
  console.log('List vaults status:', listRes.status);
  console.log('List vaults response:', await listRes.text());

  console.log('\n2. Criando vault para o MCP vendeo_memory...');
  const createRes = await fetch('https://api.openai.com/v1/vaults', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      name: 'vendeo_mcp_vault',
    }),
  });
  console.log('Create vault status:', createRes.status);
  const vaultData = await createRes.json();
  console.log('Vault criado:', vaultData);

  if (vaultData.id) {
    console.log('\n3. Adicionando credencial ao vault...');
    const credRes = await fetch(`https://api.openai.com/v1/vaults/${vaultData.id}/credentials`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        name: 'vendeo_mcp_auth',
        auth: {
          type: 'static_bearer',
          mcp_server_url: 'https://wsdualhvopidgqcumonr.supabase.co/functions/v1/vendeo-brain-mcp',
          token: envVars.VENDEO_BRAIN_MCP_TOKEN,
        },
      }),
    });
    console.log('Add credential status:', credRes.status);
    console.log('Credential response:', await credRes.text());
  }
}

testVault().catch(console.error);
