import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

console.log('🧪 Testando integração ao vivo com a OpenAI Oficial...');

const env = fs.readFileSync('.env.local', 'utf8').split('\n');
const getVar = (name) => {
  const line = env.find(l => l.startsWith(name + '='));
  return line ? line.split('=')[1].trim() : '';
};
const url = getVar('NEXT_PUBLIC_SUPABASE_URL');
const serviceKey = getVar('SUPABASE_SERVICE_ROLE_KEY');
const supabase = createClient(url, serviceKey);

// 1. Busca a chave gravada em instagram_config
const { data: cfgSecret } = await supabase
  .from('instagram_config')
  .select('app_secret')
  .eq('id', 'openai_api_key')
  .maybeSingle();

const openAiKey = cfgSecret?.app_secret?.trim();
if (!openAiKey) {
  console.error('❌ Erro: Chave openai_api_key não encontrada no Supabase!');
  process.exit(1);
}
console.log('✔ Chave recuperada com sucesso do Supabase:', openAiKey.substring(0, 15) + '...');

// 2. Dispara prompt estruturado para o modelo gpt-4o-mini
const prompt = `Você é o ConversationAgent da Larissa no Instagram.
Responda EXCLUSIVAMENTE em formato JSON com o seguinte schema:
{
  "targetSubagent": "conexao_inicial" | "descoberta" | "none",
  "action": "reply" | "wait",
  "reason": "motivo da decisão",
  "suggestedResponse": "fala informal e meiga da Larissa em português de celular (sem ponto final, sem cê, sem trampando)"
}

Mensagem recebida do pretendente: "Oi Larissa, tudo bem com vc? Como foi seu dia?"`;

console.log('Invocando OpenAI oficial (gpt-4o-mini)...');
const t0 = Date.now();
const res = await fetch('https://api.openai.com/v1/chat/completions', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${openAiKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: 'gpt-4o-mini',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.3,
    response_format: { type: 'json_object' },
  }),
});

const elapsed = Date.now() - t0;
console.log(`Status HTTP OpenAI: ${res.status} (${elapsed}ms)`);

if (!res.ok) {
  const errText = await res.text();
  console.error('❌ Falha na chamada da OpenAI:', errText);
  process.exit(1);
}

const data = await res.json();
const content = data.choices?.[0]?.message?.content;
console.log('\n--- Resposta Estruturada da OpenAI ---');
console.log(content);
console.log('\nUso de tokens:', data.usage);

const parsed = JSON.parse(content);
if (parsed.action && parsed.targetSubagent) {
  console.log('\n🎉 SUCESSO TOTAL! A OpenAI Oficial está ativa, respondendo e integrada ao banco de dados!');
} else {
  console.warn('⚠️ Resposta recebida mas formato JSON inesperado:', parsed);
}
