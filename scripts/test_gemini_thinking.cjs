const https = require('https');

const KIE_KEY = '467f4240bdb260cfed28f392c08d6771';

async function testThinking() {
  console.log('--- Testando thinkingConfig no Gemini 3.8 Flash ---');
  
  const payload = {
    stream: true,
    contents: [
      {
        role: "user",
        parts: [
          { text: "Diga apenas 'THINKING_OK'" }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.7,
      thinkingConfig: {
        includeThoughts: true,
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
    console.error('Erro:', e);
  });

  req.write(data);
  req.end();
}

testThinking();
