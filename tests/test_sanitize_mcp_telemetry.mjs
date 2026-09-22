import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeMcpTelemetry } from "../supabase/functions/vendeo-brain-mcp/_shared/telemetry.ts";

test("sanitizeMcpTelemetry nunca vaza tokens, headers ou query string na telemetria", () => {
  const secretToken = "super-secret-mcp-token-xyz-12345678901234567890";
  const fakeReq = {
    url: `https://wsdualhvopidgqcumonr.supabase.co/functions/v1/vendeo-brain-mcp?token=${secretToken}&user=123`,
    method: "POST",
    headers: {
      get: (header) => {
        const lower = header.toLowerCase();
        if (lower === "authorization") return `Bearer ${secretToken}`;
        if (lower === "mcp-session-id") return "mcp_sess_abc123";
        if (lower === "user-agent") return "OpenAI-Agent-Runner/1.0";
        if (lower === "x-api-key") return "apikey-secret";
        return null;
      },
    },
  };

  const rpcBody = {
    jsonrpc: "2.0",
    id: 42,
    method: "tools/call",
    params: {
      name: "persona_memory_search",
      arguments: { query: "motocross" },
      secretTokenField: secretToken,
    },
  };

  const telemetry = sanitizeMcpTelemetry(fakeReq, rpcBody);

  // 1. O objeto de telemetria retornado contem APENAS chaves autorizadas
  const allowedKeys = new Set([
    "at",
    "method",
    "pathname",
    "rpcMethod",
    "rpcId",
    "userAgent",
    "hasAuthorization",
    "hasMcpSessionId",
  ]);

  for (const key of Object.keys(telemetry)) {
    assert.ok(allowedKeys.has(key), `Chave nao autorizada encontrada na telemetria: ${key}`);
  }

  // 2. O token secreto NUNCA deve aparecer em nenhuma propriedade nem na serializacao
  const serialized = JSON.stringify(telemetry);
  assert.ok(!serialized.includes(secretToken), "O token secreto vazou na serializacao da telemetria!");
  assert.ok(!serialized.includes("token="), "Query params vazaram na telemetria!");
  assert.ok(!serialized.includes("apikey-secret"), "Header confidencial vazou na telemetria!");

  // 3. Valida campos especificos
  assert.equal(telemetry.method, "POST");
  assert.equal(telemetry.pathname, "/functions/v1/vendeo-brain-mcp");
  assert.equal(telemetry.rpcMethod, "tools/call");
  assert.equal(telemetry.rpcId, 42);
  assert.equal(telemetry.userAgent, "OpenAI-Agent-Runner/1.0");
  assert.equal(telemetry.hasAuthorization, true);
  assert.equal(telemetry.hasMcpSessionId, true);
});

test("sanitizeMcpTelemetry lida graciosamente com requisicoes sem auth e sem body", () => {
  const fakeReq = {
    url: "https://wsdualhvopidgqcumonr.supabase.co/functions/v1/vendeo-brain-mcp",
    method: "GET",
    headers: {
      get: () => null,
    },
  };

  const telemetry = sanitizeMcpTelemetry(fakeReq, null);

  assert.equal(telemetry.method, "GET");
  assert.equal(telemetry.pathname, "/functions/v1/vendeo-brain-mcp");
  assert.equal(telemetry.hasAuthorization, false);
  assert.equal(telemetry.hasMcpSessionId, false);
  assert.equal(telemetry.rpcMethod, undefined);
  assert.equal(telemetry.rpcId, null);
});
