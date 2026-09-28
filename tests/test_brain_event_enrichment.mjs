import test from "node:test";
import assert from "node:assert/strict";
import { enrichBrainDecisionActionRows, enrichBrainTurnEventRows } from "../supabase/functions/api/brain_event_enrichment.ts";
import { groupBrainTurns } from "../src/presentation/components/chat/brain-turn-view-model.ts";

test("eventos de projeção em ciclos distintos são associados ao mesmo turno manual persistido", () => {
  const rows = enrichBrainTurnEventRows([
    { id: 1, event_type: "manual_resolution_required", turn_id: null, session_id: null, metadata: { cycleId: "cycle-original" }, created_at: "2026-09-27T12:00:00Z" },
    { id: 2, event_type: "brain_started", turn_id: null, session_id: null, metadata: { cycleId: "cycle-resume" }, created_at: "2026-09-27T12:05:00Z" },
    { id: 3, event_type: "action_sent", turn_id: "canonical-turn", session_id: "canonical-session", metadata: { cycleId: "cycle-resume" }, created_at: "2026-09-27T12:05:05Z" },
  ], [
    { turn_id: "canonical-turn", session_id: "canonical-session", payload: { semanticState: { cycleToken: "cycle-original" } } },
    { turn_id: "canonical-turn", session_id: "canonical-session", payload: { semanticState: { cycleToken: "cycle-resume" } } },
  ]);

  assert.equal(rows[0].turn_id, "canonical-turn");
  assert.equal(rows[1].turn_id, "canonical-turn");
  assert.equal(rows[2].turn_id, "canonical-turn");
  const turns = groupBrainTurns(rows.map((row) => ({
    turnId: row.turn_id || undefined,
    sessionId: row.session_id || undefined,
    cycleId: row.metadata.cycleId,
    conversationId: "conversation-1",
    sequence: row.id,
    event: row.event_type,
    status: row.event_type === "manual_resolution_required" ? "waiting_human" : undefined,
    phase: "brain",
    timestamp: row.created_at,
    metadata: row.metadata,
  })));
  assert.equal(turns.length, 1);
  assert.equal(turns[0].id, "turn:canonical-turn");
  assert.equal(turns[0].status, "running");
});

test("ID canônico do evento tem precedência sobre a associação inferida", () => {
  const [event] = enrichBrainTurnEventRows([
    { turn_id: "explicit-turn", session_id: null, metadata: { cycleId: "cycle-1" } },
  ], [
    { turn_id: "other-turn", session_id: "session-1", payload: { semanticState: { cycleToken: "cycle-1" } } },
  ]);
  assert.equal(event.turn_id, "explicit-turn");
});

test("ações operacionais recebem turno e delivery_status da decisão persistida", () => {
  const [action] = enrichBrainDecisionActionRows([
    { id: "action-0", decision_id: "decision-tiquin", status: "failed_confirmed", provider_message_id: null, attempts: 3 },
  ], [
    { id: "decision-tiquin", turn_id: "turn-tiquin", delivery_status: "delivery_pending" },
  ]);
  assert.deepEqual(action, {
    id: "action-0",
    decision_id: "decision-tiquin",
    status: "failed_confirmed",
    provider_message_id: null,
    attempts: 3,
    turn_id: "turn-tiquin",
    decision_delivery_status: "delivery_pending",
  });
});
