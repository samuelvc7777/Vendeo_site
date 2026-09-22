import fs from 'fs';
import path from 'path';

const envPath = path.resolve('.env.local');
const envVars = {};
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

const apiKey = envVars.OPENAI_API_KEY;
const headers = {
  Authorization: 'Bearer ' + apiKey,
  'Content-Type': 'application/json',
  'OpenAI-Beta': 'agents=v1',
};

async function main() {
  const res = await fetch('https://api.openai.com/v1/vaults', { headers });
  console.log('Status HTTP Vaults:', res.status);
  const data = await res.json();
  console.log('Vaults disponíveis:', JSON.stringify(data, null, 2));

  // Checa especificamente o vault do fallback de openai_brain.ts
  const fallbackVault = 'vault_06e9b5cb8d2d4b0a9fb5bfcbd8700af3cfbe57dc729c4c4e8f';
  const getRes = await fetch(`https://api.openai.com/v1/vaults/${fallbackVault}`, { headers });
  console.log(`\nStatus do fallback vault (${fallbackVault}):`, getRes.status);
  if (getRes.ok) {
    console.log('Fallback Vault dados:', await getRes.json());
    const credRes = await fetch(`https://api.openai.com/v1/vaults/${fallbackVault}/credentials`, { headers });
    console.log('Credenciais no Fallback Vault:', await credRes.json());
  }
}

main().catch(console.error);
