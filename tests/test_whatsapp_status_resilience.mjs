import assert from "node:assert/strict";
import statusPkg from "../services/whatsapp2-gateway/status/status-service.cjs";

const {
  validateTextStatusPayload,
  prepareImageStatusData,
  prepareVideoStatusData,
  publishTextStatus,
  resetIdempotencyCacheForTests,
  WhatsAppStatusError,
} = statusPkg;

console.log("=== INICIANDO TESTES DE RESILIÊNCIA E CONCORRÊNCIA ===");

// 1. Validação de texto vazio ou somente espaços
{
  assert.throws(
    () => validateTextStatusPayload({ text: "" }),
    (err) => err instanceof WhatsAppStatusError && err.code === "WHATSAPP2_STATUS_EMPTY_TEXT",
    "Deveria rejeitar texto vazio com código WHATSAPP2_STATUS_EMPTY_TEXT"
  );
  assert.throws(
    () => validateTextStatusPayload({ text: "   \n\t  " }),
    (err) => err instanceof WhatsAppStatusError && err.code === "WHATSAPP2_STATUS_EMPTY_TEXT",
    "Deveria rejeitar texto com apenas espaços em branco"
  );
  console.log("✔ 1. Validação de texto vazio aprovada.");
}

// 2. Validação de limite máximo de 700 caracteres de texto
{
  const longText = "a".repeat(750);
  assert.throws(
    () => validateTextStatusPayload({ text: longText }),
    (err) => err instanceof WhatsAppStatusError && err.code === "WHATSAPP2_STATUS_TEXT_TOO_LONG",
    "Deveria rejeitar texto com mais de 700 caracteres"
  );

  const exact700 = "a".repeat(700);
  const validated = validateTextStatusPayload({ text: exact700 });
  assert.equal(validated.text.length, 700, "Texto com 700 caracteres deve ser aceito");
  console.log("✔ 2. Limite máximo estrito de 700 caracteres de texto aprovado.");
}

// 3. Validação de formato de cor hexadecimal e limite de fonte
{
  assert.throws(
    () => validateTextStatusPayload({ text: "Status teste", backgroundColor: "cor_invalida" }),
    (err) => err instanceof WhatsAppStatusError && err.code === "WHATSAPP2_STATUS_INVALID_COLOR",
    "Deveria rejeitar cor hexadecimal inválida"
  );

  assert.throws(
    () => validateTextStatusPayload({ text: "Status teste", font: 99 }),
    (err) => err instanceof WhatsAppStatusError && err.code === "WHATSAPP2_STATUS_INVALID_FONT",
    "Deveria rejeitar fonte fora do intervalo de 0 a 5"
  );
  console.log("✔ 3. Validações de cor e fonte aprovadas.");
}

// 4. Validação de imagem com magic bytes falsos
{
  const fakePngBase64 = Buffer.from("conteúdo em texto puro que não é imagem").toString("base64");
  await assert.rejects(
    async () => {
      await prepareImageStatusData({ mediaBase64: fakePngBase64, mimetype: "image/png" });
    },
    (err) => err instanceof WhatsAppStatusError && err.code === "WHATSAPP2_STATUS_INVALID_IMAGE_MIME",
    "Deveria rejeitar arquivo com magic bytes inconsistentes"
  );
  console.log("✔ 4. Rejeição de imagem com magic bytes falsos aprovada.");
}

// 5. Validação de limite de tamanho de imagem (> 16MB)
{
  const hugePayload = Buffer.alloc(17 * 1024 * 1024).toString("base64");
  await assert.rejects(
    async () => {
      await prepareImageStatusData({ mediaBase64: hugePayload, mimetype: "image/jpeg" });
    },
    (err) => err.code === "WHATSAPP2_MEDIA_TOO_LARGE" || err.status === 413,
    "Deveria rejeitar imagem > 16MB com código de payload too large"
  );
  console.log("✔ 5. Limite máximo de 16MB para imagem aprovado.");
}

// 6. Validação de limite de tamanho de vídeo (> 64MB)
{
  const hugeVideo = Buffer.alloc(65 * 1024 * 1024).toString("base64");
  await assert.rejects(
    async () => {
      await prepareVideoStatusData({ mediaBase64: hugeVideo, mimetype: "video/mp4" });
    },
    (err) => err.code === "WHATSAPP2_MEDIA_TOO_LARGE" || err.status === 413,
    "Deveria rejeitar vídeo > 64MB com código de payload too large"
  );
  console.log("✔ 6. Limite máximo de 64MB para vídeo aprovado.");
}

// 7. Teste de concorrência com chave de idempotência (HTTP 409 em voo)
{
  resetIdempotencyCacheForTests();

  const testKey = `resilience_key_${Date.now()}`;
  const mockClient = {
    pupPage: {
      evaluate: async () => ({ id: "mock_resilience_id", ack: 1 }),
    },
  };

  // Dispara primeira chamada assíncrona
  const p1 = publishTextStatus({
    client: mockClient,
    body: { text: "Mensagem 1", idempotencyKey: testKey },
  });

  // Tenta disparar segunda chamada concorrente com a mesma chave imediatamente enquanto p1 está em voo
  await assert.rejects(
    async () => {
      await publishTextStatus({
        client: mockClient,
        body: { text: "Mensagem 1 duplicada", idempotencyKey: testKey },
      });
    },
    (err) => err instanceof WhatsAppStatusError && err.code === "WHATSAPP2_STATUS_IN_FLIGHT" && err.statusCode === 409,
    "Deveria rejeitar chamada concorrente com HTTP 409 (IN_FLIGHT)"
  );

  const res1 = await p1;
  assert.equal(res1.ok, true);

  // Terceira chamada subsequente após conclusão deve retornar do cache com cached: true
  const res2 = await publishTextStatus({
    client: mockClient,
    body: { text: "Mensagem 1 repetida", idempotencyKey: testKey },
  });
  assert.equal(res2.cached, true, "Requisição com mesma chave após sucesso deve retornar cached: true");

  console.log("✔ 7. Teste de concorrência com HTTP 409 e cache de idempotência aprovado.");
}

console.log("=== TODOS OS 7 TESTES DE RESILIÊNCIA E CONCORRÊNCIA FORAM APROVADOS! ===");
