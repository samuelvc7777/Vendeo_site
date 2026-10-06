import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const statusServicePath = join(root, "services/whatsapp2-gateway/status/status-service.cjs");
const gatewayIndexPath = join(root, "services/whatsapp2-gateway/index.cjs");
const clientPath = join(root, "src/presentation/components/chat/whatsapp2-client.ts");

// Import CommonJS module via dynamic import com pathToFileURL
const statusService = await import(pathToFileURL(statusServicePath).href);
const {
  validateTextStatusPayload,
  publishTextStatus,
  WhatsAppStatusError,
  MAX_STATUS_TEXT_LENGTH,
  resetIdempotencyCacheForTests,
} = statusService.default || statusService;

test("validação de payload do status de texto", () => {
  // Rejeita payload nulo ou não-objeto
  assert.throws(() => validateTextStatusPayload(null), {
    name: "WhatsAppStatusError",
    code: "WHATSAPP2_STATUS_INVALID_PAYLOAD",
    statusCode: 400,
  });

  // Rejeita texto vazio ou apenas espaços
  assert.throws(() => validateTextStatusPayload({ text: "" }), {
    name: "WhatsAppStatusError",
    code: "WHATSAPP2_STATUS_EMPTY_TEXT",
    statusCode: 400,
  });
  assert.throws(() => validateTextStatusPayload({ text: "   \n\t  " }), {
    name: "WhatsAppStatusError",
    code: "WHATSAPP2_STATUS_EMPTY_TEXT",
    statusCode: 400,
  });

  // Rejeita texto excedendo limite de 700 caracteres
  const longText = "A".repeat(MAX_STATUS_TEXT_LENGTH + 1);
  assert.throws(() => validateTextStatusPayload({ text: longText }), {
    name: "WhatsAppStatusError",
    code: "WHATSAPP2_STATUS_TEXT_TOO_LONG",
    statusCode: 400,
  });

  // Aceita texto válido no limite máximo
  const maxValidText = "A".repeat(MAX_STATUS_TEXT_LENGTH);
  const validatedMax = validateTextStatusPayload({ text: maxValidText });
  assert.equal(validatedMax.text.length, MAX_STATUS_TEXT_LENGTH);
  assert.equal(validatedMax.font, 0);
  assert.equal(validatedMax.backgroundColor, undefined);

  // Validação de cor hexadecimal
  assert.throws(
    () => validateTextStatusPayload({ text: "Olá", backgroundColor: "invalid_color" }),
    {
      name: "WhatsAppStatusError",
      code: "WHATSAPP2_STATUS_INVALID_COLOR",
      statusCode: 400,
    },
  );

  const withValidHex = validateTextStatusPayload({
    text: "Status colorido",
    backgroundColor: "#128C7E",
  });
  assert.equal(withValidHex.backgroundColor, "#128C7E");

  const withBareHex = validateTextStatusPayload({
    text: "Status colorido",
    backgroundColor: "00A884",
  });
  assert.equal(withBareHex.backgroundColor, "#00A884");

  // Validação de fonte (0 a 5)
  assert.throws(() => validateTextStatusPayload({ text: "Olá", font: 9 }), {
    name: "WhatsAppStatusError",
    code: "WHATSAPP2_STATUS_INVALID_FONT",
    statusCode: 400,
  });
  assert.throws(() => validateTextStatusPayload({ text: "Olá", font: -1 }), {
    name: "WhatsAppStatusError",
    code: "WHATSAPP2_STATUS_INVALID_FONT",
    statusCode: 400,
  });

  const withValidFont = validateTextStatusPayload({ text: "Olá", font: 3 });
  assert.equal(withValidFont.font, 3);
});

test("publicação de status com mock do Puppeteer e WPP.status", async () => {
  resetIdempotencyCacheForTests();

  let evaluatedArgs = null;
  const mockClient = {
    pupPage: {
      evaluate: async (fn, args) => {
        evaluatedArgs = args;
        return {
          id: { _serialized: "true_status@broadcast_3EB0123456789" },
          ack: 1,
          sendResult: "OK",
        };
      },
    },
  };

  const result = await publishTextStatus({
    client: mockClient,
    body: {
      text: "Meu status de teste",
      backgroundColor: "#128C7E",
      font: 2,
      idempotencyKey: "test-idempotency-1",
    },
    timeoutMs: 5000,
  });

  assert.equal(result.ok, true);
  assert.equal(result.id, "true_status@broadcast_3EB0123456789");
  assert.equal(result.ack, 1);
  assert.equal(result.status, "sent");
  assert.equal(result.type, "text");
  assert.equal(result.text, "Meu status de teste");
  assert.equal(result.backgroundColor, "#128C7E");
  assert.equal(result.font, 2);
  assert.equal(evaluatedArgs.text, "Meu status de teste");
  assert.equal(evaluatedArgs.backgroundColor, "#128C7E");
  assert.equal(evaluatedArgs.font, 2);

  // Segunda chamada com mesma chave de idempotência retorna do cache imediatamente
  const secondCall = await publishTextStatus({
    client: mockClient,
    body: {
      text: "Meu status de teste",
      idempotencyKey: "test-idempotency-1",
    },
  });
  assert.equal(secondCall.cached, true);
  assert.equal(secondCall.id, "true_status@broadcast_3EB0123456789");
});

test("tratamento de conflito de idempotência (in_flight) gera erro 409", async () => {
  resetIdempotencyCacheForTests();

  let resolveEvaluate;
  const slowEvaluatePromise = new Promise((resolve) => {
    resolveEvaluate = resolve;
  });

  const mockClient = {
    pupPage: {
      evaluate: async () => {
        return await slowEvaluatePromise;
      },
    },
  };

  // Dispara primeira requisição sem aguardar
  const req1Promise = publishTextStatus({
    client: mockClient,
    body: {
      text: "Status concorrente",
      idempotencyKey: "key-concurrent",
    },
  });

  // Imediatamente dispara a segunda com a mesma chave: deve lançar 409
  await assert.rejects(
    () =>
      publishTextStatus({
        client: mockClient,
        body: {
          text: "Status concorrente",
          idempotencyKey: "key-concurrent",
        },
      }),
    {
      name: "WhatsAppStatusError",
      code: "WHATSAPP2_STATUS_IN_FLIGHT",
      statusCode: 409,
    },
  );

  // Resolve a primeira requisição
  resolveEvaluate({ id: "status_done", ack: 1 });
  const req1Result = await req1Promise;
  assert.equal(req1Result.ok, true);
  assert.equal(req1Result.id, "status_done");
});

test("tratamento de timeout na publicação gera erro 504", async () => {
  resetIdempotencyCacheForTests();

  const mockHangingClient = {
    pupPage: {
      evaluate: async () => {
        // Promessa que nunca resolve
        return new Promise(() => {});
      },
    },
  };

  await assert.rejects(
    () =>
      publishTextStatus({
        client: mockHangingClient,
        body: { text: "Status com timeout" },
        timeoutMs: 50, // 50ms para teste rápido
      }),
    {
      name: "WhatsAppStatusError",
      code: "WHATSAPP2_STATUS_TIMEOUT",
      statusCode: 504,
    },
  );
});

test("alinhamento de contrato entre gateway e whatsapp2-client", () => {
  const gatewayCode = fs.readFileSync(gatewayIndexPath, "utf8");
  const clientCode = fs.readFileSync(clientPath, "utf8");

  // Gateway deve ter a rota registrada
  assert.match(
    gatewayCode,
    /url\.pathname === "\/status\/text"/,
    "Gateway deve registrar a rota POST /status/text",
  );
  assert.match(
    gatewayCode,
    /publishTextStatus/,
    "Gateway deve invocar publishTextStatus",
  );

  // Client frontend deve expor a função correspondente
  assert.match(
    clientCode,
    /export async function publishWhatsAppStatusText/,
    "whatsapp2-client.ts deve exportar publishWhatsAppStatusText",
  );
  assert.match(
    clientCode,
    /request<WhatsApp2StatusPublishResult>\("\/status\/text"/,
    "publishWhatsAppStatusText deve chamar o endpoint /status/text",
  );
});
