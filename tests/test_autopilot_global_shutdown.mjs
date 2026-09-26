import test from "node:test";
import assert from "node:assert/strict";
import {
  applyDeferredGlobalShutdown,
  createGlobalShutdownChatState,
  hasActiveBrainCycle,
} from "../supabase/functions/api/autopilot_global_shutdown.ts";

test("global shutdown preserves an active cycle and disables its next-cycle state", () => {
  const now = "2026-09-25T18:00:00.000Z";
  const current = {
    conversationId: "chat-1",
    isEnabled: true,
    status: "processing",
    activity: { phase: "brain", updatedAt: now },
  };

  assert.equal(hasActiveBrainCycle(current, { active_cycle_token: "cycle-1" }), true);
  const pending = createGlobalShutdownChatState("chat-1", current, true, "cycle-1", now);
  assert.equal(pending.isEnabled, false);
  assert.equal(pending.disableAfterCycle, true);
  assert.equal(pending.status, "processing");

  const finished = applyDeferredGlobalShutdown(
    pending,
    { cycleEvent: { phase: "completed" } },
    { ...pending, status: "idle", activity: { phase: "completed" } },
    now,
  );
  assert.equal(finished.shouldDisableConversation, true);
  assert.equal(finished.updated.isEnabled, false);
  assert.equal(finished.updated.disableAfterCycle, false);
  assert.equal(finished.updated.status, "disabled");
});

test("idle chats disable immediately while manual review remains visible", () => {
  const now = "2026-09-25T18:00:00.000Z";
  const idle = createGlobalShutdownChatState("chat-2", { isEnabled: true, status: "waiting_delay" }, false, null, now);
  assert.equal(idle.isEnabled, false);
  assert.equal(idle.disableAfterCycle, false);
  assert.equal(idle.status, "disabled");

  const review = createGlobalShutdownChatState(
    "chat-3",
    { pendingManualResponse: { inboundMessage: "oi" }, status: "needs_manual_response" },
    false,
    null,
    now,
  );
  assert.equal(review.isEnabled, false);
  assert.equal(review.status, "needs_manual_response");
});

test("recent processing state is treated as active when the conversation row lacks a cycle token", () => {
  const now = Date.parse("2026-09-25T18:00:00.000Z");
  assert.equal(
    hasActiveBrainCycle({ status: "processing", stateUpdatedAt: new Date(now - 10_000).toISOString() }, null, now),
    true,
  );
  assert.equal(
    hasActiveBrainCycle({ status: "processing", stateUpdatedAt: new Date(now - 400_000).toISOString() }, null, now),
    false,
  );
});
