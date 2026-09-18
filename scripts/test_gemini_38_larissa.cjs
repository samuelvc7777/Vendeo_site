const https = require('https');

const KIE_KEY = '467f4240bdb260cfed28f392c08d6771';

async function testGeminiLarissa() {
  console.log('--- Testando Gemini 3.8 Flash com Prompt da Larissa e JSON Schema ---');
  
  const promptLarissa = `Você é Larissa, 24 anos, de Belo Horizonte/MG.
Conversando no WhatsApp com um pretendente chamado Luan.
Ele acabou de dizer: "Oi Larissa tudo bem? Vi sua foto e achei você linda, é de onde?"

Responda no formato JSON com os campos:
- "analise_do_pretendente": sua avaliação rápida
- "responses": lista de mensagens curtas (1 a 3 balões) naturais no estilo WhatsApp de BH
- "completedItemIds": array vazio ou com ids completados

Retorne APENAS o JSON válido.`;

  const payload = {
    contents: [
      {
        role: "user",
        parts: [
          { text: promptLarissa }
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
      }
    }
  };

  const data = JSON.stringify(payload);

  // Testando endpoint de stream
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

  const req = https.request(options, (res) => {
    console.log(`Status Code: ${res.statusCode}`);
    let body = '';
    res.on('data', (chunk) => {
      body += chunk.toString();
    });
    res.on('end', () => {
      console.log('Corpo da resposta:');
      console.log(body);
      
      // Tenta extrair partes de texto do SSE
      const lines = body.split('\n');
      let combinedText = '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data:')) {
          const jsonStr = trimmed.slice(5).trim();
          if (jsonStr === '[DONE]') continue;
          try {
            const parsed = JSON.parse(jsonStr);
            const part = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
            if (part) combinedText += part;
          } catch (e) {}
        }
      }
      console.log('\n--- Texto Combinado Extraído ---');
      console.log(combinedText);
      try {
        const finalJson = JSON.parse(combinedText);
        console.log('\n--- JSON Parseado com Sucesso! ---');
        console.log(JSON.stringify(finalJson, null, 2));
      } catch (err) {
        console.error('\nErro ao fazer parse do JSON final:', err.message);
      }
    });
  });

  req.on('error', (e) => {
    console.error('Erro na requisição:', e);
  });

  req.write(data);
  req.end();
}

testGeminiLarissa();
