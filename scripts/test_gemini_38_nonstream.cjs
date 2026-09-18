const https = require('https');

const KIE_KEY = '467f4240bdb260cfed28f392c08d6771';

async function testNonStream() {
  console.log('--- Testando Gemini 3.8 Flash sem streaming (generateContent direto) ---');
  
  const payload = {
    contents: [
      {
        role: "user",
        parts: [
          { text: "Diga apenas 'NON_STREAM_OK'" }
        ]
      }
    ]
  };

  const data = JSON.stringify(payload);

  const options = {
    hostname: 'api.kie.ai',
    path: '/gemini/v1/models/gemini-3-8-flash:generateContent',
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

testNonStream();
