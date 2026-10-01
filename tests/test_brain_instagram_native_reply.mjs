import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const brain = readFileSync(join(root, "supabase/functions/api/openai_brain.ts"), "utf8");
const sdk = readFileSync(join(root, "supabase/functions/api/openai_sdk_brain.ts"), "utf8");
const orchestrator = readFileSync(join(root, "supabase/functions/api/brain_orchestrator.ts"), "utf8");
const prompt = readFileSync(join(root, "supabase/functions/api/larissa_canonical_prompt.md"), "utf8");
const autoPilot = readFileSync(join(root, "src/domain/entities/AutoPilot.ts"), "utf8");
const direct = readFileSync(join(root, "src/presentation/components/chat/InstagramDirect.tsx"), "utf8");

test("prompt mantém reply opcional e econômico, sem usar por padrão", () => {
  assert.match(prompt, /VENDEO_AGENT_INSTRUCTIONS_VERSION: 2\.45\.2/);
  assert.match(prompt, /reply_to.*pergunta direta[\s\S]*?continuação já for óbvia/i);
  assert.doesNotMatch(
    prompt.match(/"outboundActions": \[[\s\S]*?\n  \]/)?.[0] || "",
    /reply_to/
  );
});

test("SDK expõe alvos compactos e limita a quatro mensagens recentes", () => {
  assert.match(sdk, /currentReplyTargets = \(params\.currentInboundMessages \|\| \[\]\)\.slice\(-4\)/);
  assert.match(sdk, /lines\.push\("REPLY_ALVOS:"\)/);
  assert.match(sdk, /slice\(0, 80\)/);
  assert.match(sdk, /reply_to=N quando a ação responder diretamente a um balão específico, especialmente pergunta direta, áudio\/foto ou vários assuntos no turno/);
});

test("validator converte alias curto em MID real e descarta alvo inválido sem retry", () => {
  assert.match(brain, /const rawReplyTarget = act\.reply_to \?\? act\.replyToMessageId/);
  assert.match(brain, /const numericAlias =/);
  assert.match(brain, /resolvedReplyTarget = allowedReplyTargetIds\[numericAlias - 1\]/);
  assert.match(brain, /if \(resolvedReplyTarget\) act\.replyToMessageId = resolvedReplyTarget/);
  assert.match(brain, /else delete act\.replyToMessageId/);
  assert.match(brain, /alvo inválido é descartado sem regenerar o turno/);
  assert.match(sdk, /slice\(-4\)\.map\(\(message\) => message\.id\)/);
});

test("outbox preserva o reply escolhido pelo Brain", () => {
  assert.match(orchestrator, /replyToMessageId: action\.replyToMessageId \|\| null/);
  assert.match(orchestrator, /payload: \{[\s\S]*?replyToMessageId: action\.replyToMessageId \|\| null/);
  assert.match(orchestrator, /replyToMessageId\?: string \| null/);
});

test("dispatcher do Brain envia reply_to nativo para a Meta", () => {
  const dispatchStart = orchestrator.indexOf("export async function dispatchOutboxEntry");
  const dispatchEnd = orchestrator.indexOf("export interface RunDurableOutboxDispatcherParams", dispatchStart);
  assert.ok(dispatchStart >= 0 && dispatchEnd > dispatchStart);
  const dispatch = orchestrator.slice(dispatchStart, dispatchEnd);
  assert.match(dispatch, /bodyPayload\.reply_to = \{ mid: replyToMessageId \}/);
  assert.match(dispatch, /bodyPayload\.messaging_type = "RESPONSE"/);
});

test("persistência e preview mantêm a citação antes e depois do envio", () => {
  assert.match(orchestrator, /reply_to_message_id: claimedEntry\.replyToMessageId/);
  assert.match(orchestrator, /pendingOutboundMessages[\s\S]*?replyToMessageId: entry\.replyToMessageId/);
  assert.match(autoPilot, /replyToMessageId\?: string \| null/);
  assert.match(direct, /replyToMessageId: preview\.replyToMessageId \|\| undefined/);
});

test("ledger da decisão registra o alvo do reply", () => {
  const persistenceStart = orchestrator.indexOf("actions: outboxBatch.map");
  assert.ok(persistenceStart >= 0);
  const persistence = orchestrator.slice(persistenceStart, persistenceStart + 2200);
  assert.match(persistence, /replyToMessageId: entry\.replyToMessageId/);
});
