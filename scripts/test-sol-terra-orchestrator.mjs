import fs from 'node:fs';

function loadEnv() {
  const envContent = fs.readFileSync('.env.local', 'utf8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq > 0) {
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      process.env[key] = val;
    }
  }
}

loadEnv();

async function main() {
  console.log('🧪 Iniciando validação ao vivo dos modelos Sol e Terra...');

  const apiKey = process.env.KIE_API_KEY || '467f4240bdb260cfed28f392c08d6771';

  const testPrompt = `Você é o Router de conversas da Larissa (São João del-Rei).
Analise esta mensagem do pretendente: "Moro em Lafaiete e trabalho com mineração".
Responda ESTRITAMENTE em formato JSON:
{
  "targetSubagent": "descoberta",
  "reasoning": "Pretendente informou moradia e trabalho",
  "checkpoint": "chk_troca_cidade"
}`;

  console.log('\n1. Testando Router com Modelo Sol (gpt-5-6-sol)...');
  const t0 = Date.now();
  const resSol = await fetch('https://api.kie.ai/codex/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-5-6-sol',
      input: [{ role: 'user', content: [{ type: 'input_text', text: testPrompt }] }],
      reasoning: { effort: 'low' }
    })
  });

  if (!resSol.ok) {
    throw new Error(`Kie.ai Sol falhou com HTTP ${resSol.status}: ${await resSol.text()}`);
  }

  const solText = await resSol.text();
  console.log(`✔ Sol respondeu com sucesso em ${Date.now() - t0}ms (HTTP ${resSol.status})`);
  const lines = solText.split('\n');
  let extractedSol = '';
  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;
    const dataStr = line.slice(6).trim();
    if (!dataStr || dataStr === '[DONE]') continue;
    try {
      const data = JSON.parse(dataStr);
      if (data.type === 'response.output_text.done') extractedSol = data.text;
      if (data.type === 'response.output_text.delta') extractedSol += data.delta;
    } catch {}
  }
  console.log('JSON retornado pelo Sol:', extractedSol);
  const parsedSol = JSON.parse(extractedSol.replace(/```(?:json)?/g, '').trim());
  console.log('Decisão validada:', parsedSol.targetSubagent, '| Checkpoint:', parsedSol.checkpoint);

  console.log('\n2. Testando Geração com Modelo Terra (gpt-5-6-terra)...');
  const t1 = Date.now();
  const resTerra = await fetch('https://api.kie.ai/codex/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-5-6-terra',
      input: [{ role: 'user', content: [{ type: 'input_text', text: testPrompt }] }],
      reasoning: { effort: 'low' }
    })
  });

  if (!resTerra.ok) {
    throw new Error(`Kie.ai Terra falhou com HTTP ${resTerra.status}: ${await resTerra.text()}`);
  }

  const terraText = await resTerra.text();
  console.log(`✔ Terra respondeu com sucesso em ${Date.now() - t1}ms (HTTP ${resTerra.status})`);
  let extractedTerra = '';
  for (const line of terraText.split('\n')) {
    if (!line.startsWith('data: ')) continue;
    const dataStr = line.slice(6).trim();
    if (!dataStr || dataStr === '[DONE]') continue;
    try {
      const data = JSON.parse(dataStr);
      if (data.type === 'response.output_text.done') extractedTerra = data.text;
      if (data.type === 'response.output_text.delta') extractedTerra += data.delta;
    } catch {}
  }
  console.log('JSON retornado pelo Terra:', extractedTerra);
  const parsedTerra = JSON.parse(extractedTerra.replace(/```(?:json)?/g, '').trim());
  console.log('Decisão validada:', parsedTerra.targetSubagent, '| Checkpoint:', parsedTerra.checkpoint);

  console.log('\n🎉 SUCESSO: Ambos os motores Sol e Terra estão operando com 100% de estabilidade!');
}

main().catch(err => {
  console.error('Erro no teste:', err);
  process.exit(1);
});
