import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const statusServicePath = join(root, "services/whatsapp2-gateway/status/status-service.cjs");
const videoTranscoderPath = join(root, "services/whatsapp2-gateway/status/video-transcoder.cjs");
const gatewayIndexPath = join(root, "services/whatsapp2-gateway/index.cjs");
const clientPath = join(root, "src/presentation/components/chat/whatsapp2-client.ts");

// Import CommonJS modules
const statusService = await import(pathToFileURL(statusServicePath).href);
const videoTranscoder = await import(pathToFileURL(videoTranscoderPath).href);

const {
  prepareVideoStatusData,
  publishVideoStatus,
  WhatsAppStatusError,
  ALLOWED_VIDEO_MIMES,
  MAX_STATUS_CAPTION_LENGTH,
  resetIdempotencyCacheForTests,
} = statusService.default || statusService;

const {
  getFfmpegPath,
  MAX_STATUS_VIDEO_SECONDS,
} = videoTranscoder.default || videoTranscoder;

// Mock de buffer mínimo com cabeçalho MP4/ftyp
const SAMPLE_MP4 = Buffer.from([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, // ....ftyp
  0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00, // isom....
  0x6d, 0x70, 0x34, 0x31, 0x00, 0x00, 0x00, 0x08, // mp41....
]);

test("validação de payload e formatos para status com vídeo", async () => {
  // Rejeita sem mídia
  await assert.rejects(
    () => prepareVideoStatusData({ caption: "Vídeo sem mídia" }),
    {
      name: "WhatsAppStatusError",
      code: "WHATSAPP2_STATUS_MISSING_MEDIA",
      statusCode: 400,
    },
  );

  // Aceita MP4 válido com skipTranscode para teste unitário rápido
  const mp4Result = await prepareVideoStatusData({
    mediaBase64: SAMPLE_MP4.toString("base64"),
    mimetype: "video/mp4",
    caption: "Meu vídeo de status",
    skipTranscode: true,
  });
  assert.equal(mp4Result.mimeType, "video/mp4");
  assert.equal(mp4Result.caption, "Meu vídeo de status");
  assert.equal(ALLOWED_VIDEO_MIMES.has(mp4Result.mimeType), true);

  // Rejeita imagem ou PDF enviado para rota de vídeo
  await assert.rejects(
    () =>
      prepareVideoStatusData({
        mediaBase64: Buffer.from("%PDF-1.4").toString("base64"),
        mimetype: "video/mp4",
      }),
    {
      name: "WhatsAppStatusError",
      code: "WHATSAPP2_STATUS_INVALID_VIDEO_MIME",
      statusCode: 400,
    },
  );

  // Validação de limite de legenda
  const longCaption = "V".repeat(MAX_STATUS_CAPTION_LENGTH + 1);
  await assert.rejects(
    () =>
      prepareVideoStatusData({
        mediaBase64: SAMPLE_MP4.toString("base64"),
        caption: longCaption,
        skipTranscode: true,
      }),
    {
      name: "WhatsAppStatusError",
      code: "WHATSAPP2_STATUS_CAPTION_TOO_LONG",
      statusCode: 400,
    },
  );
});

test("infraestrutura de FFmpeg existente é encontrada e configurada", () => {
  const ffmpegPath = getFfmpegPath();
  assert.ok(ffmpegPath, "Caminho do FFmpeg deve ser retornado");
  assert.equal(fs.existsSync(ffmpegPath), true, "Binário do FFmpeg deve existir");
  assert.equal(MAX_STATUS_VIDEO_SECONDS, 30, "Limite de vídeo deve ser 30 segundos");
});

test("publicação de status com vídeo com mock do Puppeteer e WPP.status", async () => {
  resetIdempotencyCacheForTests();

  let evaluatedArgs = null;
  const mockClient = {
    pupPage: {
      evaluate: async (fn, args) => {
        evaluatedArgs = args;
        return {
          id: "true_status@broadcast_3EB0VID12345",
          ack: 1,
          sendMsgResult: { messageSendResult: "OK" },
        };
      },
    },
  };

  const result = await publishVideoStatus({
    client: mockClient,
    body: {
      mediaBase64: SAMPLE_MP4.toString("base64"),
      caption: "Vídeo publicado",
      idempotencyKey: "test-vid-idempotency-1",
      skipTranscode: true,
    },
    timeoutMs: 5000,
  });

  assert.equal(result.ok, true);
  assert.equal(result.id, "true_status@broadcast_3EB0VID12345");
  assert.equal(result.ack, 1);
  assert.equal(result.status, "sent");
  assert.equal(result.type, "video");
  assert.equal(result.caption, "Vídeo publicado");
  assert.equal(result.mimeType, "video/mp4");
  assert.match(evaluatedArgs.dataUrl, /^data:video\/mp4;base64,/);
  assert.equal(evaluatedArgs.caption, "Vídeo publicado");

  // Deduplicação retorna do cache
  const cached = await publishVideoStatus({
    client: mockClient,
    body: {
      mediaBase64: SAMPLE_MP4.toString("base64"),
      idempotencyKey: "test-vid-idempotency-1",
      skipTranscode: true,
    },
  });
  assert.equal(cached.cached, true);
  assert.equal(cached.id, "true_status@broadcast_3EB0VID12345");
});

test("tratamento de concorrência em publicação de vídeo", async () => {
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

  const req1Promise = publishVideoStatus({
    client: mockClient,
    body: {
      mediaBase64: SAMPLE_MP4.toString("base64"),
      idempotencyKey: "key-concurrent-vid",
      skipTranscode: true,
    },
  });

  await assert.rejects(
    () =>
      publishVideoStatus({
        client: mockClient,
        body: {
          mediaBase64: SAMPLE_MP4.toString("base64"),
          idempotencyKey: "key-concurrent-vid",
          skipTranscode: true,
        },
      }),
    {
      name: "WhatsAppStatusError",
      code: "WHATSAPP2_STATUS_IN_FLIGHT",
      statusCode: 409,
    },
  );

  finishEvaluate({ id: "status_vid_done", ack: 1 });
  const req1Result = await req1Promise;
  assert.equal(req1Result.ok, true);
  assert.equal(req1Result.id, "status_vid_done");
});

test("alinhamento de contrato de vídeo entre gateway e whatsapp2-client", () => {
  const gatewayCode = fs.readFileSync(gatewayIndexPath, "utf8");
  const clientCode = fs.readFileSync(clientPath, "utf8");

  // Gateway registra rota /status/video
  assert.match(
    gatewayCode,
    /url\.pathname === "\/status\/video"/,
    "Gateway deve registrar POST /status/video",
  );
  assert.match(
    gatewayCode,
    /publishVideoStatus/,
    "Gateway deve invocar publishVideoStatus",
  );

  // Client frontend deve expor publishWhatsAppStatusVideo
  assert.match(
    clientCode,
    /export async function publishWhatsAppStatusVideo/,
    "whatsapp2-client.ts deve exportar publishWhatsAppStatusVideo",
  );
  assert.match(
    clientCode,
    /request<WhatsApp2StatusVideoPublishResult>\("\/status\/video"/,
    "publishWhatsAppStatusVideo deve chamar /status/video",
  );
});
