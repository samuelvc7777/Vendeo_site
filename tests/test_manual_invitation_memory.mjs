import test from "node:test";
import assert from "node:assert/strict";
import { searchConversationEpisodicMemory } from "../supabase/functions/api/conversation_episodic_memory.ts";

test("recupera da memória um convite anterior quando a pessoa pergunta se já chamou para sair", async () => {
  const episode = {
    conversation_id: "conv-lucas",
    actor: "pretendente",
    event_type: "plan",
    topic: "invitation",
    summary: "O pretendente já convidou Larissa para se encontrar. Ela respondeu manualmente.",
    original_text: "Bora tomar um café sábado?",
    semantic_keys: ["pretendente.invitation", "pretendente.meeting", "date_invitation", "encounter"],
    metadata: { memory_class: "landmark" },
    created_at: "2026-09-25T15:00:00.000Z",
  };

  const query = {
    select() { return this; },
    eq() { return this; },
    order() { return this; },
    limit() { return this; },
    then(resolve, reject) {
      return Promise.resolve({ data: [episode], error: null }).then(resolve, reject);
    },
  };
  const supabase = { from: () => query };

  const results = await searchConversationEpisodicMemory({
    supabase,
    conversationId: "conv-lucas",
    query: "ele já me convidou pra sair antes?",
    memoryClass: "landmark",
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].topic, "invitation");
  assert.match(results[0].summary, /já convidou Larissa/);
});
