const https = require('https');

const KIE_KEY = '467f4240bdb260cfed28f392c08d6771';

async function testExactUserCurl() {
  console.log('--- Testando exatamente o payload do usuário ---');
  
  const payload = {
    "stream": true,
    "contents": [
        {
            "role": "user",
            "parts": [
                {
                    "text": "What is the weather in Beijing today?"
                }
            ]
        }
    ],
    "generationConfig": {
        "thinkingConfig": {
            "includeThoughts": true,
            "thinkingLevel": "high"
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
    console.log(`Status: ${res.statusCode} (${Date.now() - startTime}ms)`);
    let body = '';
    res.on('data', (chunk) => { body += chunk.toString(); });
    res.on('end', () => {
      console.log('Body:');
      console.log(body);
    });
  });

  req.on('error', (err) => {
    console.error('Req error:', err);
  });

  req.write(data);
  req.end();
}

testExactUserCurl();
