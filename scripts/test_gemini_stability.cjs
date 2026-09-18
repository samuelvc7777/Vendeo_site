const https = require('https');

const KIE_KEY = '467f4240bdb260cfed28f392c08d6771';
const SUPABASE_URL = 'https://wsdualhvopidgqcumonr.supabase.co';
const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndzZHVhbGh2b3BpZGdxY3Vtb25yIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4ODkwODM4OSwiZXhwIjoyMTA0NDg0Mzg5fQ.ebpH41NJdrNgRbgch4ciTxTS6SppRRoJzSPoyEmN2MU';

async function testRealPrompt() {
  // Vamos buscar o prompt gerado para o Luan chamando a Edge Function /instagram/debug-prompt ou montando
  console.log('Testando requisição direta do Gemini 3.8 com retry inteligente...');

  async function callGemini(attempt = 1) {
    return new Promise((resolve) => {
      const payload = {
        stream: true,
        contents: [
          {
            role: "user",
            parts: [{ text: "Você é Larissa de Belo Horizonte. Responda o Luan que disse que estava no futebol. Em JSON com analise_do_pretendente e responses." }]
          }
        ],
        generationConfig: {
          temperature: 0.7,
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              analise_do_pretendente: { type: "STRING" },
              responses: { type: "ARRAY", items: { type: "STRING" } }
            },
            required: ["analise_do_pretendente", "responses"]
          }
        }
      };

      const data = JSON.stringify(payload);
      const options = {
        hostname: 'api.kie.ai',
        path: '/gemini/v1/models/gemini-3-8-flash:streamGenerateContent',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${KIE_KEY}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(data)
        }
      };

      const start = Date.now();
      const req = https.request(options, (res) => {
        let body = '';
        res.on('data', (c) => body += c.toString());
        res.on('end', () => {
          resolve({ status: res.statusCode, time: Date.now() - start, body });
        });
      });
      req.on('error', (e) => resolve({ error: e.message }));
      req.write(data);
      req.end();
    });
  }

  for (let i = 1; i <= 5; i++) {
    const res = await callGemini(i);
    const isError = res.body.includes('"code":500');
    console.log(`Tentativa ${i}: Status=${res.status} Tempo=${res.time}ms Erro500=${isError}`);
    if (!isError) {
      console.log('Sucesso! Corpo:', res.body.slice(0, 300).replace(/\n/g, ' '));
      break;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

testRealPrompt();
