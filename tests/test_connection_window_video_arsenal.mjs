import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const ui = read("../src/presentation/components/config/ConnectionWindowManager.tsx");
const entity = read("../src/domain/entities/ConversationArsenal.ts");
const upload = read("../src/app/api/instagram/upload/route.ts");
const edgeUpload = read("../supabase/functions/api/index.ts");
const runtime = read("../supabase/functions/api/connection_window_runtime.ts");
const sdkBrain = read("../supabase/functions/api/openai_sdk_brain.ts");
const orchestrator = read("../supabase/functions/api/brain_orchestrator.ts");
const dispatcher = read("../supabase/functions/api/channel_dispatcher.ts");
const migration = read("../supabase/migrations/20261007035521_connection_window_video_assets.sql");

test("vídeo entra no arsenal com upload, limite de arquivo e contexto temporal", () => {
  assert.match(entity, /"photo" \| "video"/);
  assert.match(entity, /value: "video", label: "Vídeo"/);
  assert.match(ui, /accept="video\/mp4,video\/quicktime"/);
  assert.match(ui, /O vídeo deve ter no máximo 10 MB/);
  assert.match(ui, /form\.type === "video" && !form\.visualDescription\.trim\(\)/);
  assert.match(ui, /form\.type === "photo" \|\| form\.type === "video"/);
  assert.match(upload, /videoContentType = file\.type === "video\/mp4" \|\| file\.type === "video\/quicktime"/);
  assert.match(upload, /file\.size > 10 \* 1024 \* 1024/);
  assert.match(edgeUpload, /if \(mediaType === "video"\)[\s\S]*file\.size > 10 \* 1024 \* 1024/);
  assert.match(edgeUpload, /ext = isMov \? "mov" : "mp4"/);
});

test("vídeo sem descrição/contexto não chega ao Brain", () => {
  assert.match(runtime, /item_type === "video" && !String\(item\.visual_description \|\| ""\)\.trim\(\)/);
  assert.match(runtime, /item\.item_type === "video"\) && !routineContext/);
  assert.match(sdkBrain, /item\.type === "video" && item\.visualDescription/);
  assert.match(sdkBrain, /candidate\.type !== "video" \|\| !candidate\.mediaUrl/);
});

test("ação de vídeo mantém a URL como anexo e só usa canais compatíveis", () => {
  assert.match(orchestrator, /const isVideo = action\.type === "video"/);
  assert.match(orchestrator, /messageType: isAudio \? "audio" : isImage \? "image" : isVideo \? "video"/);
  assert.match(orchestrator, /mediaUrl: isAudio[\s\S]*isVideo \? \(videoUrl \|\| null\)/);
  assert.match(dispatcher, /outboxEntry\.messageType === "video"/);
  assert.match(dispatcher, /kind = "video"/);
  assert.match(dispatcher, /type: outboxEntry\.messageType/);
  assert.match(dispatcher, /tinder_video_unsupported/);
});

test("banco aceita vídeos no arsenal e na fila do WhatsApp2", () => {
  assert.match(migration, /item_type in \('topic','question','story','audio','photo','video'\)/);
  assert.match(migration, /kind in \('text','audio','image','video','sticker'\)/);
});
