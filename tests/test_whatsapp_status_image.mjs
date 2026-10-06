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
  prepareImageStatusData,
  publishImageStatus,
  WhatsAppStatusError,
  ALLOWED_IMAGE_MIMES,
  MAX_STATUS_CAPTION_LENGTH,
  resetIdempotencyCacheForTests,
} = statusService.default || statusService;

// Buffers mínimos válidos para teste
const SAMPLE_JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);
const SAMPLE_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00]);
const SAMPLE_WEBP = Buffer.from("RIFF\x20\x00\x00\x00WEBPVP8 \x14\x00\x00\x00", "binary");
const SAMPLE_GIF = Buffer.from("GIF89a\x01\x00\x01\x00\x80\x00\x00", "binary");
const SAMPLE_PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n", "utf8");

test("validação de payload e formatos aceitos para status com imagem", async () => {
  // Rejeita payload sem mídia
  await assert.rejects(
    () => prepareImageStatusData({ caption: "Foto sem imagem" }),
    {
      name: "WhatsAppStatusError",
      code: "WHATSAPP2_STATUS_MISSING_MEDIA",
      statusCode: 400,
    },
  );

  // Aceita JPEG válido
  const jpegResult = await prepareImageStatusData({
    mediaBase64: SAMPLE_JPEG.toString("base64"),
    mimetype: "image/jpeg",
    caption: "Minha foto JPEG",
  });
  assert.equal(jpegResult.mimeType, "image/jpeg");
  assert.equal(jpegResult.caption, "Minha foto JPEG");
  assert.equal(ALLOWED_IMAGE_MIMES.has(jpegResult.mimeType), true);

  // Aceita PNG válido
  const pngResult = await prepareImageStatusData({
    mediaBase64: `data:image/png;base64,${SAMPLE_PNG.toString("base64")}`,
  });
  assert.equal(pngResult.mimeType, "image/png");
  assert.equal(ALLOWED_IMAGE_MIMES.has(pngResult.mimeType), true);

  // Aceita WEBP válido
  const webpResult = await prepareImageStatusData({
    mediaBase64: SAMPLE_WEBP.toString("base64"),
    mimetype: "image/webp",
  });
  assert.equal(webpResult.mimeType, "image/webp");
  assert.equal(ALLOWED_IMAGE_MIMES.has(webpResult.mimeType), true);

  // Rejeita GIF (GIF não é aceito como imagem estática de status)
  await assert.rejects(
    () =>
      prepareImageStatusData({
        mediaBase64: SAMPLE_GIF.toString("base64"),
        mimetype: "image/gif",
      }),
    {
      name: "WhatsAppStatusError",
      code: "WHATSAPP2_STATUS_INVALID_IMAGE_MIME",
      statusCode: 400,
    },
  );

  // Rejeita PDF mascarado como imagem
  await assert.rejects(
    () =>
      prepareImageStatusData({
        mediaBase64: SAMPLE_PDF.toString("base64"),
        mimetype: "image/jpeg",
      }),
    {
      name: "WhatsAppStatusError",
      code: "WHATSAPP2_STATUS_INVALID_IMAGE_MIME",
      statusCode: 400,
    },
  );

  // Validação de limite de legenda
  const longCaption = "C".repeat(MAX_STATUS_CAPTION_LENGTH + 1);
  await assert.rejects(
    () =>
      prepareImageStatusData({
        mediaBase64: SAMPLE_JPEG.toString("base64"),
        caption: longCaption,
      }),
    {
      name: "WhatsAppStatusError",
      code: "WHATSAPP2_STATUS_CAPTION_TOO_LONG",
      statusCode: 400,
    },
  );

  const maxValidCaption = "C".repeat(MAX_STATUS_CAPTION_LENGTH);
  const validCaptionResult = await prepareImageStatusData({
    mediaBase64: SAMPLE_JPEG.toString("base64"),
    caption: maxValidCaption,
  });
  assert.equal(validCaptionResult.caption?.length, MAX_STATUS_CAPTION_LENGTH);
});

test("publicação de status com imagem com mock do Puppeteer e WPP.status", async () => {
  resetIdempotencyCacheForTests();

  let evaluatedDataUrl = null;
  let evaluatedOptions = null;

  const mockClient = {
    pupPage: {
      evaluate: async (fn, args) => {
        evaluatedDataUrl = args.dataUrl;
        evaluatedOptions = { caption: args.caption, filename: args.filename };
        return {
          id: "true_status@broadcast_3EB0IMG12345",
          ack: 1,
          sendMsgResult: { messageSendResult: "OK" },
        };
      },
    },
  };

  const result = await publishImageStatus({
    client: mockClient,
    body: {
      mediaBase64: SAMPLE_JPEG.toString("base64"),
      caption: "Legenda da foto",
      idempotencyKey: "test-img-idempotency-1",
    },
    timeoutMs: 5000,
  });

  assert.equal(result.ok, true);
  assert.equal(result.id, "true_status@broadcast_3EB0IMG12345");
  assert.equal(result.ack, 1);
  assert.equal(result.status, "sent");
  assert.equal(result.type, "image");
  assert.equal(result.caption, "Legenda da foto");
  assert.equal(result.mimeType, "image/jpeg");
  assert.ok(result.fileSize > 0);
  assert.match(evaluatedDataUrl, /^data:image\/jpeg;base64,/);
  assert.equal(evaluatedOptions.caption, "Legenda da foto");

  // Deduplicação retorna do cache
  const cachedCall = await publishImageStatus({
    client: mockClient,
    body: {
      mediaBase64: SAMPLE_JPEG.toString("base64"),
      idempotencyKey: "test-img-idempotency-1",
    },
  });
  assert.equal(cachedCall.cached, true);
  assert.equal(cachedCall.id, "true_status@broadcast_3EB0IMG12345");
});

test("recuperação resiliente (fallback) caso o ack sofra timeout mas mensagem exista", async () => {
  resetIdempotencyCacheForTests();

  const mockClientWithRecovery = {
    pupPage: {
      evaluate: async () => {
        // Simula erro de timeout no evento do WhatsApp Web, com recuperação pelo getMyStatus
        return {
          id: "true_status@broadcast_RECOVERED_123",
          ack: 1,
          sendMsgResult: { messageSendResult: "OK" },
          recoveredFromTimeout: true,
        };
      },
    },
  };

  const result = await publishImageStatus({
    client: mockClientWithRecovery,
    body: {
      mediaBase64: SAMPLE_PNG.toString("base64"),
      caption: "Status recuperado via fallback",
    },
  });

  assert.equal(result.ok, true);
  assert.equal(result.id, "true_status@broadcast_RECOVERED_123");
  assert.equal(result.type, "image");
});

test("tratamento de conflito de concorrência (in_flight) para status de imagem", async () => {
  resetIdempotencyCacheForTests();

  let finishEvaluate;
  const slowEvaluatePromise = new Promise((resolve) => {
    finishEvaluate = resolve;
  });

  const mockClient = {
    pupPage: {
      evaluate: async () => {
        return await slowEvaluatePromise;
      },
    },
  };

  const req1Promise = publishImageStatus({
    client: mockClient,
    body: {
      mediaBase64: SAMPLE_WEBP.toString("base64"),
      idempotencyKey: "key-concurrent-img",
    },
  });

  // Segunda requisição com a mesma chave deve retornar 409
  await assert.rejects(
    () =>
      publishImageStatus({
        client: mockClient,
        body: {
          mediaBase64: SAMPLE_WEBP.toString("base64"),
          idempotencyKey: "key-concurrent-img",
        },
      }),
    {
      name: "WhatsAppStatusError",
      code: "WHATSAPP2_STATUS_IN_FLIGHT",
      statusCode: 409,
    },
  );

  finishEvaluate({ id: "status_img_done", ack: 1 });
  const req1Result = await req1Promise;
  assert.equal(req1Result.ok, true);
  assert.equal(req1Result.id, "status_img_done");
});

test("alinhamento de contrato de imagem entre gateway e whatsapp2-client", () => {
  const gatewayCode = fs.readFileSync(gatewayIndexPath, "utf8");
  const clientCode = fs.readFileSync(clientPath, "utf8");

  // Gateway registra rotas /status/image e /status/media
  assert.match(
    gatewayCode,
    /url\.pathname === "\/status\/image" \|\| url\.pathname === "\/status\/media"/,
    "Gateway deve registrar POST /status/image e POST /status/media",
  );
  assert.match(
    gatewayCode,
    /publishImageStatus/,
    "Gateway deve invocar publishImageStatus",
  );

  // Client frontend deve expor publishWhatsAppStatusImage chamando /status/image
  assert.match(
    clientCode,
    /export async function publishWhatsAppStatusImage/,
    "whatsapp2-client.ts deve exportar publishWhatsAppStatusImage",
  );
  assert.match(
    clientCode,
    /request<WhatsApp2StatusImagePublishResult>\("\/status\/image"/,
    "publishWhatsAppStatusImage deve chamar /status/image",
  );
});
