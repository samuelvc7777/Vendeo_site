// Script de Rollback: Restaura a Function Tool persona_memory_search no OpenAI Agent Brain
import fs from 'fs';
import path from 'path';

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

const OPENAI_API_KEY = envVars.OPENAI_API_KEY;
const AGENT_ID = envVars.OPENAI_BRAIN_AGENT_ID;

if (!OPENAI_API_KEY || !AGENT_ID) {
  console.error('ERRO: OPENAI_API_KEY ou OPENAI_BRAIN_AGENT_ID ausentes em .env.local');
  process.exit(1);
}

const FUNCTION_TOOL_DEFINITION = {
  type: 'function',
  name: 'persona_memory_search',
  description:
    'Consulta a memoria canonica e temporal da Larissa para recuperar fatos pessoais confiaveis (hobbies, preferencias, rotina, estudos, etc). Retorna os fatos encontrados.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Termo de busca ou pergunta sobre a Larissa (ex: motocross, curso, comida favorita, onde mora)',
        maxLength: 200,
      },
      limit: {
        type: 'integer',
        description: 'Quantidade maxima de fatos a retornar (1 a 8, default 5)',
        minimum: 1,
        maximum: 8,
        default: 5,
      },
    },
    required: ['query'],
    additionalProperties: false,
  },
  strict: false,
};

async function rollback() {
  console.log(`[ROLLBACK] Restaurando Function Tool no Agent ${AGENT_ID}...`);

  const res = await fetch(`https://api.openai.com/v1/agents/${AGENT_ID}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json',
      'OpenAI-Beta': 'agents=v1',
    },
    body: JSON.stringify({
      tools: [FUNCTION_TOOL_DEFINITION],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.error(`[ROLLBACK] Falha ao restaurar agent: HTTP ${res.status} - ${errText}`);
    process.exit(1);
  }

  const updatedAgent = await res.json();
  console.log('[ROLLBACK] Agent restaurado com sucesso para Function Tool!');
  console.log('Tools ativas:', JSON.stringify(updatedAgent.tools, null, 2));
}

rollback().catch((err) => {
  console.error('[ROLLBACK] Erro inesperado:', err);
  process.exit(1);
});
