import fs from "fs";

const env = fs.readFileSync(".env.local", "utf8");
const apiKey = env.match(/OPENAI_API_KEY=([^\s\n]+)/)[1];

async function test() {
  console.log("=== 1. Testando /v1/chat/completions com gpt-5.6-terra SEM temperature ===");
  try {
    const res1 = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5.6-terra",
        messages: [{ role: "user", content: 'responda em json: {"status": "ok", "mensagem": "ola"}' }],
        response_format: { type: "json_object" },
      }),
    });
    console.log("Chat completions status:", res1.status);
    const json1 = await res1.json();
    console.log("Chat completions content:", json1.choices?.[0]?.message?.content);
    console.log("Chat completions usage:", json1.usage);
  } catch (e) {
    console.error("Chat completions error:", e.message);
  }

  console.log("\n=== 2. Testando /v1/responses com gpt-5.6-terra ===");
  try {
    const res2 = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-5.6-terra",
        input: 'responda em json: {"status": "ok", "mensagem": "ola"}',
      }),
    });
    console.log("Responses API status:", res2.status);
    const json2 = await res2.json();
    console.log("Responses API output text:", json2.output?.[0]?.content?.[0]?.text);
    console.log("Responses API usage:", json2.usage);
  } catch (e) {
    console.error("Responses API error:", e.message);
  }
}

test();
