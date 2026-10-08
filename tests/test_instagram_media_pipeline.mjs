import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function read(path) {
  return fs.readFileSync(path, "utf8");
}

function loadQualityGate() {
  const code = read("supabase/functions/api/ConversationQualityGate.ts");
  const js = ts.transpileModule(code, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
    },
  }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(js, {
    module: mod,
    exports: mod.exports,
    Set, String, Array, Math, Number, RegExp,
  });
  return mod.exports;
}

test("imagem e vídeo entram no pipeline; arquivo e emoji isolado continuam fora", () => {
  const quality = loadQualityGate();
  assert.equal(quality.isActionableInboundMessage({
    mediaType: "image",
    text: "[image:https://cdn.test/foto.jpg]",
  }), true);
  assert.equal(quality.isActionableInboundMessage({
    mediaType: "video",
    text: "[video:https://cdn.test/video.mp4]",
  }), true);
  assert.equal(quality.isActionableInboundMessage({
    mediaType: "sticker",
    text: "[sticker:https://cdn.test/sticker.webp]",
  }), true);
  assert.equal(quality.isActionableInboundMessage({
    mediaType: "file",
    text: "[file:https://cdn.test/a.pdf]",
  }), false);
  assert.equal(quality.isActionableInboundMessage({ text: "❤️" }), false);
});

test("análise visual usa apenas Luna Flex e reaproveita descrição persistida", () => {
  const source = read("supabase/functions/api/image_analysis.ts");
  assert.match(source, /IMAGE_MODEL = "gpt-6-luna"/);
  assert.match(source, /IMAGE_SERVICE_TIER = "flex"/);
  assert.match(source, /reasoning: \{ effort: "none" \}/);
  assert.match(source, /type: "input_image"/);
  assert.match(source, /detail: "low"/);
  assert.match(source, /callImageModel\(false\)/);
  assert.match(source, /flex processing is temporarily unavailable/i);
  assert.match(source, /image_description: description/);
  assert.match(source, /if \(existing\)/);
});

test("worker resolve toda mídia coalescida antes do Brain e persiste fora da CDN da Meta", () => {
  const source = read("supabase/functions/api/autopilot_inbound_queue.ts");
  const workerStart = source.indexOf("async function processClaimedInboundJob");
  const worker = source.slice(workerStart);
  const batchLoad = worker.indexOf("mediaBatch = await loadCurrentInboundMediaBatch");
  const batchLoop = worker.indexOf("for (const pendingMedia of mediaBatch)");
  const brain = worker.indexOf("const result = await runBrainOrchestration");
  assert.ok(batchLoad >= 0 && batchLoop >= 0 && brain >= 0);
  assert.ok(batchLoad < batchLoop && batchLoop < brain);
  assert.match(source, /\.in\("media_type", \["image", "video", "sticker"\]\)/);
  assert.match(source, /\.gte\("created_at", String\(batchStartedAt\)\)/);
  assert.match(source, /\.lte\("created_at", latestCreatedAt\)/);
  assert.match(source, /persistInboundMediaToVault\(\s*supabase,\s*pendingMedia,/);
  assert.match(source, /media_observation_required\|\$\{mediaKind\}\|\$\{messageId\}/);
});

test("regressão Luan: foto seguida de texto continua acionando o Brain pelo lote", () => {
  const source = read("supabase/functions/api/autopilot_inbound_queue.ts");
  assert.match(source, /conversation\?\.ai_debounce_started_at \|\| null/);
  assert.match(source, /hasActionableMediaInBatch = true/);
  assert.match(source, /const actionable =\s*transferReentryEvents\.length > 0 \|\|\s*hasActionableMediaInBatch \|\|/);
  assert.match(source, /await enqueueInboundMediaSync\(supabase, job\.conversation_id, preparedMedia\)/);
});

test("schema guarda descrição/observação e retoma pelo inbound mais recente", () => {
  const migration = read("supabase/migrations/20260930183821_instagram_media_understanding_and_observation.sql");
  assert.match(migration, /add column if not exists image_description text/);
  assert.match(migration, /add column if not exists media_operator_observation text/);
  assert.match(migration, /prepare_instagram_media_observation/);
  assert.match(migration, /v_resume_message_id/);
  assert.match(migration, /order by coalesce\(m\."timestamp", m\.created_at\) desc/);
});

test("webhook persiste vídeo como vídeo e a UI oferece observação humana", () => {
  const api = read("supabase/functions/api/index.ts");
  const ui = read("src/presentation/components/chat/InstagramDirect.tsx");
  assert.match(api, /p_media_type: isAudioMsg \? "audio" : imageUrl \? "image" : \(videoUrl \|\| isSharedMedia\) \? "video" : null/);
  assert.match(api, /"\/operator\/brain\/media-observation"/);
  assert.match(ui, /Precisa de observação/);
  assert.match(ui, /media-observation/);
  assert.match(ui, /<video/);
  assert.match(ui, /InstagramSharedReelCard/);
  assert.match(ui, /Reel compartilhado/);
  assert.match(ui, /isSharedObservation/);
});

test("Reel ou publicação compartilhada é preservado e segue o mesmo gate humano de vídeo", () => {
  const api = read("supabase/functions/api/index.ts");
  const queue = read("supabase/functions/api/autopilot_inbound_queue.ts");
  assert.match(api, /type === "share" \|\| type === "reel"/);
  assert.match(api, /\[share:\$\{sharedMediaUrl\}\]/);
  assert.match(api, /"🎞️ Reel ou publicação compartilhada"/);
  assert.match(api, /\(videoUrl \|\| isSharedMedia\) \? "video"/);
  assert.match(queue, /startsWith\("\[share:"\)/);
  assert.match(queue, /Reel ou publicação recebida\. Abra a mídia e descreva/);
});

test("Brain recebe descrição visual e suspeita de automação exige resolução manual", () => {
  const runtime = read("supabase/functions/api/openai_conversation_runtime.ts");
  const prompt = read("supabase/functions/api/larissa_canonical_prompt.md");
  assert.match(runtime, /image_description/);
  assert.match(runtime, /media_operator_observation/);
  assert.match(runtime, /VÍDEO — OBSERVAÇÃO HUMANA PENDENTE/);
  assert.match(prompt, /SUSPEITA DE ROBÔ \/ IA \/ BOT \/ AUTOMAÇÃO EXIGE OPERADOR/);
  assert.match(prompt, /action="manual_resolution"/);
  assert.match(prompt, /outboundActions=\[\]/);
  assert.match(prompt, /backend não usa palavras-chave para decidir isso/);
});
