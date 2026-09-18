const https = require('https');

const KIE_KEY = '467f4240bdb260cfed28f392c08d6771';

async function testGeminiSize(size) {
  return new Promise((resolve) => {
    const filler = "Esta é uma conversa de exemplo para teste de contexto. ".repeat(Math.ceil(size / 55)).slice(0, size);
    const text = `Você é Larissa de Belo Horizonte. Responda 'OK' após ler o contexto:\n${filler}\nResponda em JSON com {"responses": ["ok"]}`;

    const payload = {
      stream: true,
      contents: [
        {
          role: "user",
          parts: [{ text }]
        }
      ],
      generationConfig: {
        temperature: 0.7,
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            responses: { type: "ARRAY", items: { type: "STRING" } }
          },
          required: ["responses"]
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
      res.on('data', (c) => { body += c.toString(); });
      res.on('end', () => {
        resolve({
          size,
          status: res.statusCode,
          elapsed: Date.now() - start,
          body: body.slice(0, 150).replace(/\n/g, ' ')
        });
      });
    });

    req.on('error', (e) => {
      resolve({ size, error: e.message });
    });

    req.write(data);
    req.end();
  });
}

async function run() {
  console.log('--- Benchmark de Tamanho de Prompt no Gemini 3.8 Flash (Kie.ai) ---');
  for (const s of [1000, 5000, 10000, 15000, 20000, 30000]) {
    const res = await testGeminiSize(s);
    console.log(`Size: ${res.size} chars | Status: ${res.status} | Time: ${res.elapsed}ms | Body: ${res.body || res.error}`);
  }
}

run();
