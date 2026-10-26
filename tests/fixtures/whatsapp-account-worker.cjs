// Processo de teste: não carrega WhatsApp, navegador, credenciais ou Supabase.
const http = require("node:http");
const server = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  res.setHeader("content-type", "application/json");
  res.end(JSON.stringify({ ok: true, connectionId: process.env.WHATSAPP2_CONNECTION_ID,
    path: req.url, body: Buffer.concat(chunks).toString(),
    authorized: req.headers.authorization === `Bearer ${process.env.WHATSAPP2_GATEWAY_TOKEN}`,
  }));
});
server.listen(0, "127.0.0.1", () => {
  process.send({ type: "listening", port: server.address().port });
  process.send({ type: "state", status: "ready" });
});
process.on("message", message => { if (message.type === "shutdown") server.close(() => process.exit(0)); });
process.on("disconnect", () => process.exit(0));
