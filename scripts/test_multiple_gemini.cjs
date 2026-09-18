const https = require('https');

const KIE_KEY = '467f4240bdb260cfed28f392c08d6771';

async function testModel(modelName) {
  return new Promise((resolve) => {
    const payload = {
      stream: true,
      contents: [
        {
          role: "user",
          parts: [
            { text: "Diga apenas 'OK'" }
          ]
        }
      ]
    };

    const data = JSON.stringify(payload);

    const options = {
      hostname: 'api.kie.ai',
      path: `/gemini/v1/models/${modelName}:streamGenerateContent`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${KIE_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data)
      }
    };

    const startTime = Date.now();
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk.toString(); });
      res.on('end', () => {
        resolve({
          model: modelName,
          status: res.statusCode,
          elapsed: Date.now() - startTime,
          body: body
        });
      });
    });

    req.on('error', (err) => {
      resolve({ model: modelName, error: err.message });
    });

    req.write(data);
    req.end();
  });
}

async function run() {
  const models = [
    'gemini-3-8-flash',
    'gemini-3-pro',
    'gemini-2.5-flash',
    'gemini-2.5-pro'
  ];

  for (const m of models) {
    const res = await testModel(m);
    console.log(`\n=== [${res.model}] status=${res.status} (${res.elapsed}ms) ===`);
    console.log(res.body || res.error);
  }
}

run();
