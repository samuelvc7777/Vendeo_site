import assert from "node:assert/strict";
import test from "node:test";
import { OpenAiCycleUsageAccumulator, normalizeOpenAiUsage } from "../supabase/functions/api/openai_usage.ts";
import { publishAutoPilotState } from "../supabase/functions/api/autopilot_state.ts";

const completion = (id, model, input, cached, output, reasoning = 0) => ({
  id,
  source: "chat_completion",
  model,
  serviceTier: "standard",
  usage: {
    prompt_tokens: input,
    prompt_tokens_details: { cached_tokens: cached, cache_write_tokens: 0 },
    completion_tokens: output,
    completion_tokens_details: { reasoning_tokens: reasoning },
    total_tokens: input + output,
  },
});

test("normaliza tokens cacheados e não cacheados sem valores fictícios", () => {
  assert.deepEqual(normalizeOpenAiUsage({ input_tokens: 10, input_tokens_details: { cached_tokens: 4 } }), {
    inputTokens: 10, cachedInputTokens: 4, uncachedInputTokens: 6,
    outputTokens: null, reasoningTokens: null, cacheWriteTokens: null, totalTokens: null,
  });
  assert.equal(normalizeOpenAiUsage({ input_tokens: 4, input_tokens_details: { cached_tokens: 99 } }).cachedInputTokens, 4);
});

test("deduplica a mesma inferência e agrega duas respostas do ciclo", () => {
  const accumulator = new OpenAiCycleUsageAccumulator("cycle-a", 5);
  accumulator.addInference(completion("resp-1", "gpt-6-sol", 1000, 400, 100, 50));
  accumulator.addInference(completion("resp-1", "gpt-6-sol", 1000, 400, 100, 50));
  accumulator.addInference(completion("resp-2", "gpt-6-sol", 2000, 1000, 200, 80));
  const usage = accumulator.snapshot();
  assert.equal(usage.requestCount, 2);
  assert.equal(usage.inputTokens, 3000);
  assert.equal(usage.cachedInputTokens, 1400);
  assert.equal(usage.uncachedInputTokens, 1600);
  assert.equal(usage.outputTokens, 300);
  assert.equal(usage.reasoningTokens, 130);
  assert.equal(usage.totalTokens, 3300);
  assert.equal(usage.cacheHitRate, 1400 / 3000 * 100);
  assert.ok(Math.abs(usage.estimatedUsd - ((1600 / 1_000_000 * 2) + (1400 / 1_000_000 * 0.2) + (300 / 1_000_000 * 10))) < 1e-12);
  assert.ok(Math.abs(usage.estimatedBrl - usage.estimatedUsd * 5) < 1e-12);
});

test("aplica preços Luna e não cobra reasoning em duplicidade", () => {
  const accumulator = new OpenAiCycleUsageAccumulator("cycle-luna", null);
  accumulator.addInference(completion("luna-1", "gpt-6-luna", 1_000_000, 500_000, 100_000, 80_000));
  const usage = accumulator.snapshot();
  assert.equal(usage.estimatedUsd, 0.05 + 0.005 + 0.05);
  assert.equal(usage.reasoningTokens, 80_000);
  assert.equal(usage.outputTokens, 100_000);
  assert.equal(usage.estimatedBrl, null);
});

test("deduplica Generation span IDs e deixa request count desconhecido sem trace", () => {
  const known = new OpenAiCycleUsageAccumulator("cycle-trace", null);
  const session = { sessionId: "s1", model: "gpt-6-sol", sessionUsage: { input_tokens: 5, input_tokens_details: { cached_tokens: 1 }, output_tokens: 2, total_tokens: 7, output_tokens_details: { reasoning_tokens: 1 } }, turns: [], generationIds: ["g1", "g1", "g2"] };
  known.addAgentSession(session);
  known.addAgentSession(session);
  assert.equal(known.snapshot().requestCount, 2);
  assert.equal(known.snapshot().inputTokens, 5);

  const unknown = new OpenAiCycleUsageAccumulator("cycle-no-trace", null);
  unknown.addAgentSession({ ...session, sessionId: "s2", generationIds: null });
  assert.equal(unknown.snapshot().requestCount, null);
});

test("persiste o evento terminal e seu usage no estado compartilhado, recuperável após reload", async () => {
  const rows = new Map();
  const client = {
    from() {
      return {
        select() { return this; },
        eq(_key, value) { this.id = value; return this; },
        async maybeSingle() { return { data: rows.has(this.id) ? { stage_completed_rules: rows.get(this.id) } : null }; },
        async upsert(row) { rows.set(row.id, row.stage_completed_rules); return { error: null }; },
      };
    },
    channel() { return { async send() { return "ok"; } }; },
  };
  await publishAutoPilotState(client, "conversation-1", {
    cycleId: "cycle-persist",
    status: "completed",
    cycleEvent: { event: "cycle_completed", phase: "completed", label: "Ciclo concluído", metadata: { usage: { requestCount: 2, inputTokens: 30, estimatedUsd: 0.001 } } },
  });
  const reloaded = rows.get("__autopilot_states__").states["conversation-1"];
  assert.equal(reloaded.cycleEvents[0].event, "cycle_completed");
  assert.deepEqual(reloaded.cycleEvents[0].metadata.usage, { requestCount: 2, inputTokens: 30, estimatedUsd: 0.001 });
});

test("ciclo cancelado mantém uso já acumulado sem criar evento por inferência", () => {
  const accumulator = new OpenAiCycleUsageAccumulator("cycle-cancelled", null);
  accumulator.addInference(completion("cancel-1", "gpt-6-sol", 100, 25, 10));
  assert.equal(accumulator.snapshot().inputTokens, 100);
  assert.equal(accumulator.snapshot().requestCount, 1);
});
