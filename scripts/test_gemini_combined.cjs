const https = require('https');

const KIE_KEY = '467f4240bdb260cfed28f392c08d6771';

async function testWithThinkingAndSchema() {
  console.log('--- Testando Gemini 3.8 Flash com thinkingConfig + JSON Schema ---');
  
  const payload = {
    stream: true,
    contents: [
      {
        role: "user",
        parts: [
          { text: "Você é Larissa de Belo Horizonte. Responda o Luan que disse 'Oi linda tudo bem?' no formato JSON com analise_do_pretendente, responses e completedItemIds." }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.7,
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          analise_do_pretendente: { type: "STRING" },
          responses: {
            type: "ARRAY",
            items: { type: "STRING" }
          },
          completedItemIds: {
            type: "ARRAY",
            items: { type: "STRING" }
          }
        },
        required: ["analise_do_pretendente", "responses"]
      },
      thinkingConfig: {
        thinkingLevel: "low"
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

  const startTime = Date.now();
  const req = https.request(options, (res) => {
    console.log(`Status Code: ${res.statusCode} (em ${Date.now() - startTime}ms)`);
    let body = '';
    res.on('data', (chunk) => {
      body += chunk.toString();
    });
    res.on('end', () => {
      console.log(`Resposta completa em ${Date.now() - startTime}ms`);
      console.log(body);
    });
  });

  req.on('error', (e) => {
    console.error('Erro:', e);
  });

  req.write(data);
  req.end();
}

testWithThinkingAndSchema();
