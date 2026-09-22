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

const sessionIds = [
  { id: 1, name: 'Saudação Inicial', sessId: 'sess_0f910e8d6bded21d006ab298100e54819482159834f9f985cf' },
  { id: 2, name: 'Discovery Question Memory Gate', sessId: 'sess_00c40faf75e1e9f8006ab29822be688193815daf7660abee9b' },
  { id: 3, name: 'Self Disclosure Continuity', sessId: 'sess_01c54e36159a8c11006ab29834bee8819384ec283ef33bac26' },
  { id: 4, name: 'Alligator / Immediate-Turn Continuity', sessId: 'sess_0b63f2b76f52da26006ab2985375bc81968f79981981575102' },
  { id: 5, name: 'Already Satisfied & Evidence Binding', sessId: 'sess_0292367554a95d91006ab29865d6ec81948dd58d7e205a688a' },
  { id: 6, name: 'Zero Question Allowed', sessId: 'sess_026c24872a3423f2006ab298777d248193ad5cb7a6b51fd63c' },
];

async function collect() {
  console.log('Consultando tokens e usage das 6 sessões...');
  const detailedUsage = [];

  for (const item of sessionIds) {
    const turnsRes = await fetch(`https://api.openai.com/v1/agents/sessions/${item.sessId}/turns`, { headers });
    let usage = null;
    if (turnsRes.ok) {
      const turnsData = await turnsRes.json();
      const turns = turnsData.data || [];
      console.log(`\n--- Caso ${item.id}: ${item.name} (${item.sessId}) ---`);
      console.log(`Total de turns: ${turns.length}`);
      for (let i = 0; i < turns.length; i++) {
        const t = turns[i];
        console.log(`Turn ${i}: status=${t.status}, usage=`, JSON.stringify(t.usage));
        if (t.usage) {
          usage = t.usage;
        }
      }
    }

    if (!usage) {
      const sRes = await fetch(`https://api.openai.com/v1/agents/sessions/${item.sessId}`, { headers });
      if (sRes.ok) {
        const sData = await sRes.json();
        console.log(`Session status=${sData.status}, usage=`, JSON.stringify(sData.usage));
        usage = sData.usage;
      }
    }

    detailedUsage.push({
      caseId: item.id,
      name: item.name,
      sessId: item.sessId,
      usage,
    });
  }

  fs.writeFileSync('scripts/luna_detailed_usage.json', JSON.stringify(detailedUsage, null, 2), 'utf8');
}

collect().catch(console.error);
