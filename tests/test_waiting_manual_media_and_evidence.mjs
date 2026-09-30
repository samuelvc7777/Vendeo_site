import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p) => fs.readFileSync(p, "utf8");

test("Conversation history pode ser evidência técnica sem expor message id ao Agent", () => {
  const evidence = read("supabase/functions/api/objective_evidence.ts");
  const prompt = read("supabase/functions/api/larissa_canonical_prompt.md");
  assert.match(evidence, /"conversation_history"/);
  assert.match(evidence, /evidence\.id !== "current"/);
  assert.match(evidence, /provider_session_id/);
  assert.match(prompt, /\{type:"conversation_history",id:"current"\}/);
  assert.match(prompt, /nunca peça ao operador ID de mensagem, turno, objetivo ou evidência/);
});

test("manual_resolution rejeita pedido de identificador técnico interno", () => {
  const source = read("supabase/functions/api/openai_brain.ts");
  assert.match(source, /isInternalTechnicalManualResolutionQuestion/);
  assert.match(source, /manual_resolution_technical_identifier_forbidden/);
  assert.match(source, /ID\/identificador interno de mensagem, turno, objetivo, evidência ou sessão/);
});

test("mídia recebida durante waiting_human preserva handoff e não chama Brain", () => {
  const worker = read("supabase/functions/api/autopilot_inbound_queue.ts");
  const waitingGuard = worker.indexOf('canonicalStatus === "waiting_human" && !hasMediaObservation');
  const deferred = worker.indexOf("waiting_human_preserved_media_deferred");
  const brain = worker.indexOf("const result = await runBrainOrchestration");
  assert.ok(waitingGuard >= 0 && deferred > waitingGuard && brain > deferred);
  assert.match(worker, /persistInboundMediaToVault/);
  assert.match(worker, /previousError/);
});

test("send-now e ativação imediata não atropelam waiting_manual", () => {
  const api = read("supabase/functions/api/index.ts");
  assert.match(api, /hasWaitingManualBrainTurn/);
  assert.match(api, /triggerImmediate && await hasWaitingManualBrainTurn/);
  assert.match(api, /result: "waiting_manual"/);
  assert.match(api, /status: "waiting_human"/);
});
