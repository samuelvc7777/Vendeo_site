const https = require('https');

const KIE_KEY = '467f4240bdb260cfed28f392c08d6771';

async function testGemini() {
  console.log('--- Testando Gemini 3.8 Flash no Kie.ai ---');
  
  const payload = {
    contents: [
      {
        role: "user",
        parts: [
          { text: "Diga apenas 'GEMINI_OK' se você estiver funcionando." }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.7
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

  const req = https.request(options, (res) => {
    console.log(`Status Code: ${res.statusCode}`);
    let body = '';
    res.on('data', (chunk) => {
      body += chunk.toString();
    });
    res.on('end', () => {
      console.log('Corpo da resposta:');
      console.log(body);
    });
  });

  req.on('error', (e) => {
    console.error('Erro na requisição:', e);
  });

  req.write(data);
  req.end();
}

testGemini();
