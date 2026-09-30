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
  assert.match(source, /image_description: description/);
  assert.match(source, /if \(existing\)/);
});

test("worker intercepta vídeo antes do Brain e persiste mídia fora da CDN da Meta", () => {
  const source = read("supabase/functions/api/autopilot_inbound_queue.ts");
  const workerStart = source.indexOf("async function processClaimedInboundJob");
  const worker = source.slice(workerStart);
  const handoff = worker.indexOf("if (looksVideo && !operatorObservation)");
  const brain = worker.indexOf("const result = await runBrainOrchestration");
  assert.ok(handoff >= 0 && brain >= 0 && handoff < brain);
  assert.match(source, /persistInboundMediaToVault\(supabase, message, "image"\)/);
  assert.match(source, /persistInboundMediaToVault\(supabase, message, "video"\)/);
  assert.match(source, /media_observation_required\|\$\{mediaKind\}\|\$\{messageId\}/);
});

test("schema guarda descrição/observação e retoma pelo inbound mais recente", () => {
  const migration = read("supabase/migrations/20260930170000_instagram_media_understanding_and_observation.sql");
  assert.match(migration, /add column if not exists image_description text/);
  assert.match(migration, /add column if not exists media_operator_observation text/);
  assert.match(migration, /prepare_instagram_media_observation/);
  assert.match(migration, /v_resume_message_id/);
  assert.match(migration, /order by coalesce\(m\."timestamp", m\.created_at\) desc/);
});

test("webhook persiste vídeo como vídeo e a UI oferece observação humana", () => {
  const api = read("supabase/functions/api/index.ts");
  const ui = read("src/presentation/components/chat/InstagramDirect.tsx");
  assert.match(api, /p_media_type: isAudioMsg \? "audio" : imageUrl \? "image" : videoUrl \? "video" : null/);
  assert.match(api, /"\/operator\/brain\/media-observation"/);
  assert.match(ui, /Precisa de observação/);
  assert.match(ui, /media-observation/);
  assert.match(ui, /<video/);
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
